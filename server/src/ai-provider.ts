// G5-A — Lapisan provider AI Dadiweb (single provider: DeepInfra).
//
// Semua pemanggilan model di pipeline generate WAJIB lewat modul ini —
// generateWebsite tidak lagi memanggil ctx.inference secara langsung.
// Interface-nya generik (provider + model sebagai parameter) tetapi hanya
// DeepInfra yang dikonfigurasi; tidak ada provider kedua.
//
// Aturan yang ditegakkan di sini:
// - Klien DeepInfra: POST https://api.deepinfra.com/v1/openai/chat/completions
//   (OpenAI-compatible), Authorization: Bearer <token>. Token dibaca dari
//   tabel ai_provider_secrets dalam keadaan TERENKRIPSI AES-256-GCM (pola
//   yang sama seperti rahasia proyek G2: HKDF-SHA256 menurunkan kunci dari
//   material master server; plaintext hanya hidup sesaat di memori server
//   saat request dibuat). Token tidak pernah masuk log, prompt, ekspor,
//   atau respons aksi — yang keluar hanya petunjuk 4 karakter terakhir.
// - Keadaan "kunci belum terpasang" adalah status kelas satu
//   (AiKeyMissingError / status log "kunci_belum_terpasang"), bukan error
//   misterius dan bukan keberhasilan palsu.
// - SETIAP pemanggilan — sukses, gagal, maupun tertahan kunci — tercatat
//   satu baris di ai_usage_log, dengan biaya dihitung dari harga registry
//   ai_stage_models yang berlaku saat pemanggilan terjadi.
// - Fallback: runAiStage mencoba model utama tahap itu SATU KALI; bila
//   gagal (jaringan, timeout, tahap dinonaktifkan di registry, respons
//   tidak valid) ia mencoba model fallback tahap itu SATU KALI. Kedua
//   percobaan tercatat. Kunci belum terpasang TIDAK memicu fallback —
//   tidak ada model apa pun yang dipanggil dalam keadaan itu.

import { z, type Ctx } from "./sdk-shim";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

function dbOf(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
export type AiDb = ReturnType<typeof dbOf>;

export const AI_PROVIDER = "deepinfra";
const DEEPINFRA_CHAT_URL = "https://api.deepinfra.com/v1/openai/chat/completions";
// G5-D — Batas waktu PER TAHAP (bukan lagi 30 detik rata untuk semua).
// Diagnosis G5-D: uji koneksi kecil lolos dalam ±2–3 detik untuk kedua
// model, tetapi beban penuh Planner (keluaran JSON terstruktur panjang
// dari model penalaran DeepSeek-V4-Flash) TIMEOUT di batas lama 30 detik.
// Nilai yang dipilih (dokumentasi keputusan):
// - planner 120 detik: keluaran terstruktur paling panjang + model
//   penalaran; 120 dtk adalah batas atas yang masih wajar untuk satu
//   panggilan chat completion non-streaming.
// - designer/coder 90 detik: keluaran JSON lebih pendek dari Planner.
// - tahap lain 60 detik; uji koneksi tetap 30 detik (beban minimal).
// Skenario terburuk satu tahap = utama + fallback (2× batas tahap),
// tetapi fallback Qwen3-32B terukur menjawab dalam hitungan detik, dan
// max_tokens per tahap (di bawah) membatasi panjang keluaran sehingga
// timeout seharusnya menjadi pengecualian, bukan jalur normal.
const STAGE_TIMEOUT_MS: Record<AiStageKey, number> = {
  planner: 120_000,
  designer: 90_000,
  coder: 90_000,
  builder: 60_000,
  fixer: 60_000,
  responder: 60_000,
};
const REQUEST_TIMEOUT_MS = 30_000; // khusus uji koneksi (beban kecil)
// Batas token keluaran per tahap: membatasi model penalaran agar tidak
// menghabiskan waktu di rantai pikir yang tak terlihat, sekaligus cukup
// untuk JSON tahap itu (Planner paling besar karena memuat rancangan
// halaman + tabel database).
const STAGE_MAX_TOKENS: Record<AiStageKey, number> = {
  planner: 3000,
  designer: 1500,
  coder: 2000,
  builder: 1500,
  fixer: 1500,
  responder: 1200,
};

export type AiStageKey =
  | "planner"
  | "designer"
  | "coder"
  | "builder"
  | "fixer"
  | "responder";
export const AI_STAGES: AiStageKey[] = [
  "planner",
  "designer",
  "coder",
  "builder",
  "fixer",
];
// G6 — "responder" TIDAK masuk AI_STAGES: ia bukan tahap pipeline build,
// melainkan stage registry tersendiri untuk AI penjawab chat perencana
// (tanya/diskusi gratis). Ia tetap punya baris registry, timeout, dan
// max_tokens sendiri di bawah agar bisa dipanggil lewat runAiStage dan
// diubah lewat panel Admin seperti stage lain.

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Registry awal G5-A (single provider DeepInfra). ID model memakai format
// katalog DeepInfra (namespace/model). Harga USD per 1 juta token sesuai
// keputusan G5: Planner DeepSeek-V4-Flash ($0,09/$0,18), Designer/Coder/
// Fixer DeepSeek-V3.2 ($0,26/$0,38), Builder Llama-3.3-70B-Instruct-Turbo
// ($0,10/$0,32), fallback semua tahap Qwen3-32B ($0,08/$0,28). Baris ini
// hanya ditulis bila tabel masih kosong; setelah itu registry di database
// adalah sumber kebenaran dan bisa diubah lewat aksi admin.
export const AI_STAGE_DEFAULTS: Array<{
  stage: AiStageKey;
  primaryModel: string;
  fallbackModel: string;
  inputPriceUsd: number;
  outputPriceUsd: number;
  fallbackInputPriceUsd: number;
  fallbackOutputPriceUsd: number;
}> = [
  {
    stage: "planner",
    primaryModel: "deepseek-ai/DeepSeek-V4-Flash",
    fallbackModel: "Qwen/Qwen3-32B",
    inputPriceUsd: 0.09,
    outputPriceUsd: 0.18,
    fallbackInputPriceUsd: 0.08,
    fallbackOutputPriceUsd: 0.28,
  },
  {
    stage: "designer",
    primaryModel: "deepseek-ai/DeepSeek-V3.2",
    fallbackModel: "Qwen/Qwen3-32B",
    inputPriceUsd: 0.26,
    outputPriceUsd: 0.38,
    fallbackInputPriceUsd: 0.08,
    fallbackOutputPriceUsd: 0.28,
  },
  {
    stage: "coder",
    primaryModel: "deepseek-ai/DeepSeek-V3.2",
    fallbackModel: "Qwen/Qwen3-32B",
    inputPriceUsd: 0.26,
    outputPriceUsd: 0.38,
    fallbackInputPriceUsd: 0.08,
    fallbackOutputPriceUsd: 0.28,
  },
  {
    stage: "builder",
    primaryModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    fallbackModel: "Qwen/Qwen3-32B",
    inputPriceUsd: 0.1,
    outputPriceUsd: 0.32,
    fallbackInputPriceUsd: 0.08,
    fallbackOutputPriceUsd: 0.28,
  },
  {
    stage: "fixer",
    primaryModel: "deepseek-ai/DeepSeek-V3.2",
    fallbackModel: "Qwen/Qwen3-32B",
    inputPriceUsd: 0.26,
    outputPriceUsd: 0.38,
    fallbackInputPriceUsd: 0.08,
    fallbackOutputPriceUsd: 0.28,
  },
  // G6 — Responder chat perencana: model TERMURAH di registry
  // (Qwen3-32B, $0,08/$0,28) sebagai utama, karena tanya/diskusi
  // bersifat gratis bagi pengguna dan harus semurah mungkin. Fallback
  // DeepSeek-V4-Flash ($0,09/$0,18). Baris ini hanya ditulis bila
  // tabel masih kosong per tahap (insert-if-missing), jadi admin tetap
  // bisa mengubahnya lewat panel Admin.
  {
    stage: "responder",
    primaryModel: "Qwen/Qwen3-32B",
    fallbackModel: "deepseek-ai/DeepSeek-V4-Flash",
    inputPriceUsd: 0.08,
    outputPriceUsd: 0.28,
    fallbackInputPriceUsd: 0.09,
    fallbackOutputPriceUsd: 0.18,
  },
];

export type AiStageModelRow = typeof schema.aiStageModels.$inferSelect;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// Kunci provider belum terpasang di penyimpanan terenkripsi platform.
export class AiKeyMissingError extends Error {
  readonly kind = "kunci_belum_terpasang" as const;
  constructor(provider: string) {
    super(
      `Kunci API ${provider === "deepinfra" ? "DeepInfra" : provider} belum terpasang.`,
    );
    this.name = "AiKeyMissingError";
  }
}

export function isAiKeyMissing(e: unknown): e is AiKeyMissingError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "kunci_belum_terpasang"
  );
}

// Pemanggilan model gagal (jaringan/timeout/HTTP/respons tidak valid).
export class AiModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiModelError";
  }
}

// ---------------------------------------------------------------------------
// Enkripsi token provider (AES-256-GCM, pola sama seperti rahasia proyek G2)
// ---------------------------------------------------------------------------

const PROVIDER_MASTER_KEY_MATERIAL = "dadiweb-prototype-secret-master-v1";

async function deriveProviderKey(provider: string): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PROVIDER_MASTER_KEY_MATERIAL),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(`dadiweb-provider-${provider}`),
      info: new TextEncoder().encode("provider-secret-encryption"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis.btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// G8 — diekspor agar modul google-oauth memakai enkripsi yang persis
// sama (HKDF-SHA256 + AES-256-GCM, salt per provider) untuk Client
// Secret Google, bukan duplikasi logika enkripsi kedua.
export async function encryptProviderSecret(
  provider: string,
  plaintext: string,
): Promise<string> {
  const key = await deriveProviderKey(provider);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(cipher))}`;
}

export async function decryptProviderSecret(
  provider: string,
  stored: string,
): Promise<string | null> {
  try {
    const [ivB64, cipherB64] = stored.split(".");
    if (!ivB64 || !cipherB64) return null;
    const key = await deriveProviderKey(provider);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(cipherB64),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status & penyimpanan kunci provider
// ---------------------------------------------------------------------------

export interface ProviderKeyStatus {
  configured: boolean;
  // Hanya 4 karakter terakhir token (••••abcd); "" bila belum terpasang.
  hint: string;
}

export async function getProviderKeyStatus(
  db: AiDb,
  provider: string = AI_PROVIDER,
): Promise<ProviderKeyStatus> {
  const rows = await db
    .select()
    .from(schema.aiProviderSecrets)
    .where(eq(schema.aiProviderSecrets.provider, provider));
  const row = rows[0];
  if (!row || !row.ciphertext) return { configured: false, hint: "" };
  return { configured: true, hint: row.hint };
}

// Simpan token provider terenkripsi. Mengembalikan hanya petunjuk 4
// karakter terakhir — token utuh tidak pernah dikembalikan ke pemanggil.
export async function setProviderKey(
  db: AiDb,
  provider: string,
  token: string,
): Promise<ProviderKeyStatus> {
  const trimmed = token.trim();
  const ciphertext = await encryptProviderSecret(provider, trimmed);
  const hint = `••••${trimmed.slice(-4)}`;
  // Verifikasi integritas internal: ciphertext harus bisa dibuka kembali
  // server-side sebelum dinyatakan tersimpan. Plaintext hasil dekripsi
  // tidak pernah keluar dari fungsi ini.
  const roundtrip = await decryptProviderSecret(provider, ciphertext);
  if (roundtrip !== trimmed) {
    throw new AiModelError(
      "Verifikasi enkripsi kunci provider gagal; kunci tidak disimpan.",
    );
  }
  const existing = await db
    .select()
    .from(schema.aiProviderSecrets)
    .where(eq(schema.aiProviderSecrets.provider, provider));
  if (existing.length === 0) {
    await db.insert(schema.aiProviderSecrets).values({
      provider,
      ciphertext,
      hint,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.aiProviderSecrets)
      .set({ ciphertext, hint, updatedAt: new Date() })
      .where(eq(schema.aiProviderSecrets.provider, provider));
  }
  return { configured: true, hint };
}

export async function clearProviderKey(
  db: AiDb,
  provider: string = AI_PROVIDER,
): Promise<void> {
  await db
    .delete(schema.aiProviderSecrets)
    .where(eq(schema.aiProviderSecrets.provider, provider));
}

// Token plaintext hanya untuk dipakai klien DeepInfra di dalam complete();
// tidak pernah dicatat atau dikembalikan oleh aksi mana pun.
async function loadProviderToken(
  db: AiDb,
  provider: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.aiProviderSecrets)
    .where(eq(schema.aiProviderSecrets.provider, provider));
  const row = rows[0];
  if (!row || !row.ciphertext) return null;
  return decryptProviderSecret(provider, row.ciphertext);
}

// ---------------------------------------------------------------------------
// Registry model per tahap
// ---------------------------------------------------------------------------

// Isi registry dari AI_STAGE_DEFAULTS bila tabel kosong (insert-if-missing
// per tahap, jadi baris yang sudah diubah admin tidak pernah ditimpa).
export async function ensureAiStageModels(db: AiDb): Promise<void> {
  const existing = await db.select().from(schema.aiStageModels);
  const have = new Set(existing.map((r) => r.stage));
  for (const def of AI_STAGE_DEFAULTS) {
    if (have.has(def.stage)) continue;
    await db.insert(schema.aiStageModels).values({
      stage: def.stage,
      provider: AI_PROVIDER,
      primaryModel: def.primaryModel,
      fallbackModel: def.fallbackModel,
      isActive: true,
      inputPriceUsd: def.inputPriceUsd,
      outputPriceUsd: def.outputPriceUsd,
      fallbackInputPriceUsd: def.fallbackInputPriceUsd,
      fallbackOutputPriceUsd: def.fallbackOutputPriceUsd,
      updatedAt: new Date(),
    });
  }
}

export async function getStageModel(
  db: AiDb,
  stage: AiStageKey,
): Promise<AiStageModelRow | null> {
  await ensureAiStageModels(db);
  const rows = await db
    .select()
    .from(schema.aiStageModels)
    .where(eq(schema.aiStageModels.stage, stage));
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pencatatan biaya (ai_usage_log) — kegagalan menulis log tidak boleh
// menggagalkan pipeline, jadi semua error di sini ditelan.
// ---------------------------------------------------------------------------

async function logAiUsage(
  db: AiDb,
  entry: {
    provider: string;
    model: string;
    stage: string;
    projectId: number | null;
    userId: number | null;
    inputTokens: number;
    outputTokens: number;
    inputPriceUsd: number;
    outputPriceUsd: number;
    latencyMs: number;
    status: "sukses" | "gagal" | "kunci_belum_terpasang";
    detail: string;
  },
): Promise<void> {
  try {
    const costUsd =
      (entry.inputTokens * entry.inputPriceUsd +
        entry.outputTokens * entry.outputPriceUsd) /
      1_000_000;
    await db.insert(schema.aiUsageLog).values({
      provider: entry.provider,
      model: entry.model,
      stage: entry.stage,
      projectId: entry.projectId,
      userId: entry.userId,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      costUsd,
      latencyMs: Math.max(0, Math.round(entry.latencyMs)),
      status: entry.status,
      // Detail dibatasi (1.500 karakter — cukup untuk isi balasan error
      // DeepInfra: pesan + field yang ditolak) dan tidak pernah memuat
      // token API/prompt; balasan error provider dipotong & dibersihkan
      // oleh readProviderErrorDetail sebelum sampai ke sini.
      detail: entry.detail.slice(0, 1500),
    });
  } catch {
    /* pencatatan tidak boleh menggagalkan generate */
  }
}

// Catat penolakan pra-penerbangan (generate ditolak sebelum model apa pun
// dipanggil karena kunci belum terpasang). Satu baris per percobaan
// generate, atas nama tahap pertama (planner), token & biaya nol.
export async function logAiKeyMissing(
  db: AiDb,
  args: { userId: number | null; stage: AiStageKey; model: string },
): Promise<void> {
  await logAiUsage(db, {
    provider: AI_PROVIDER,
    model: args.model,
    stage: args.stage,
    projectId: null,
    userId: args.userId,
    inputTokens: 0,
    outputTokens: 0,
    inputPriceUsd: 0,
    outputPriceUsd: 0,
    latencyMs: 0,
    status: "kunci_belum_terpasang",
    detail:
      "Generate ditolak sebelum pemanggilan model: kunci DeepInfra belum terpasang di penyimpanan platform.",
  });
}

// ---------------------------------------------------------------------------
// complete() — satu-satunya pintu pemanggilan model
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// G5-D — baca ISI balasan error DeepInfra agar kegagalan bisa didiagnosis
// dari pesan & field yang sebenarnya ditolak, bukan hanya kode HTTP.
// Body dipotong 900 karakter dan whitespace diratakan. Body error
// provider tidak memuat kunci API (kunci hanya ada di header request),
// jadi aman dicatat di ai_usage_log.
async function readProviderErrorDetail(response: Response): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 900);
  } catch {
    body = "";
  }
  return body
    ? `DeepInfra menjawab HTTP ${response.status}: ${body}`
    : `DeepInfra menjawab HTTP ${response.status} (tanpa isi balasan).`;
}

// G5-D — payload sadar-model. `response_format: {type:"json_object"}`
// HANYA dikirim ke model yang terbukti menerimanya di DeepInfra
// (keluarga DeepSeek). Model lain (Qwen3-32B fallback, Llama) menolak
// field itu dengan HTTP 400 pada beban penuh — sementara uji koneksi
// kecil (tanpa response_format) lolos untuk model yang sama; itulah
// perbedaan payload yang membedakan kedua hasil itu. Untuk model tanpa
// dukungan json_object, keluaran JSON ditegakkan lewat instruksi sistem
// eksplisit + parser toleran parseStructured (pagar ```json / teks
// pengantar tetap diterima).
function supportsJsonObjectFormat(model: string): boolean {
  return model.toLowerCase().includes("deepseek");
}

// Petunjuk struktur dari skema Zod tahap: daftar field tingkat atas.
// Tanpa ini model hanya tahu perintah naratif dan bisa mengarang nama
// field; dengan json_object pun field tidak pernah dikomunikasikan.
function schemaFieldHint(zodSchema: z.ZodType<unknown>): string {
  const shape = (zodSchema as { shape?: Record<string, unknown> }).shape;
  if (!shape || typeof shape !== "object") return "";
  const keys = Object.keys(shape);
  return keys.length > 0 ? keys.join(", ") : "";
}

function buildChatPayload(args: {
  model: string;
  stage: AiStageKey;
  messages: AiMessage[];
  schema: z.ZodType<unknown>;
  structureHint?: string;
}): Record<string, unknown> {
  const jsonMode = supportsJsonObjectFormat(args.model);
  const hint = args.structureHint ?? schemaFieldHint(args.schema);
  const jsonInstruction = hint
    ? `Balas HANYA dengan satu objek JSON valid (tanpa teks lain, tanpa penjelasan) dengan struktur persis berikut: ${hint}. Semua nilai teks dalam Bahasa Indonesia.`
    : "Balas HANYA dengan satu objek JSON valid (tanpa teks lain, tanpa penjelasan). Semua nilai teks dalam Bahasa Indonesia.";
  const payload: Record<string, unknown> = {
    model: args.model,
    messages: jsonMode
      ? args.messages
      : [
          { role: "system" as const, content: jsonInstruction },
          ...args.messages,
        ],
    max_tokens: STAGE_MAX_TOKENS[args.stage] ?? 2000,
    temperature: 0.4,
  };
  if (jsonMode) {
    payload.response_format = { type: "json_object" };
    // Dalam mode json_object pun field wajib dikomunikasikan lewat prompt.
    payload.messages = [
      { role: "system" as const, content: jsonInstruction },
      ...args.messages,
    ];
  }
  return payload;
}

// Ekstrak objek JSON dari teks respons model (toleran pagar ```json dan
// teks pengantar) lalu validasi dengan skema Zod tahap itu.
function parseStructured<T>(raw: string, zodSchema: z.ZodType<T>): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new AiModelError("Respons model bukan JSON yang valid.");
    }
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new AiModelError("Respons model bukan JSON yang valid.");
    }
  }
  const result = zodSchema.safeParse(parsed);
  if (!result.success) {
    // Sertakan field yang ditolak + alasannya (path & pesan Zod) agar
    // kegagalan struktur bisa didiagnosis dari ai_usage_log, bukan
    // tebakan. Pesan Zod hanya memuat nama field & nilai enum yang
    // diharapkan/diterima — bukan isi respons model secara utuh.
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AiModelError(
      `Respons model tidak sesuai skema tahap ini. Field bermasalah: ${issues}`,
    );
  }
  return result.data;
}

export interface AiCompleteArgs<T> {
  db: AiDb;
  // Provider generik; hanya "deepinfra" yang terkonfigurasi.
  provider?: string;
  stage: AiStageKey;
  model: string;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  // Deskripsi struktur JSON persis yang diharapkan tahap ini (termasuk
  // nilai enum yang sah & bentuk objek bersarang). Bila diisi, ini yang
  // dikomunikasikan ke model; bila kosong, daftar field tingkat atas
  // diturunkan otomatis dari skema.
  structureHint?: string;
  userId: number | null;
  projectId: number | null;
  inputPriceUsd: number;
  outputPriceUsd: number;
}

export interface AiCompleteResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// Panggil SATU model satu kali. Selalu tercatat di ai_usage_log — sukses,
// gagal, maupun tertahan kunci. Melempar AiKeyMissingError bila kunci
// belum terpasang (tanpa request HTTP apa pun), AiModelError bila
// pemanggilan/validasi gagal.
export async function complete<T>(args: AiCompleteArgs<T>): Promise<AiCompleteResult<T>> {
  const provider = args.provider ?? AI_PROVIDER;
  const started = Date.now();
  const baseLog = {
    provider,
    model: args.model,
    stage: args.stage,
    projectId: args.projectId,
    userId: args.userId,
    inputPriceUsd: args.inputPriceUsd,
    outputPriceUsd: args.outputPriceUsd,
  };

  if (provider !== AI_PROVIDER) {
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "gagal",
      detail: `Provider "${provider}" tidak terkonfigurasi; hanya DeepInfra yang aktif.`,
    });
    throw new AiModelError(
      `Provider "${provider}" tidak terkonfigurasi di Dadiweb.`,
    );
  }

  const token = await loadProviderToken(args.db, provider);
  if (!token) {
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      status: "kunci_belum_terpasang",
      detail: "Kunci DeepInfra belum terpasang; tidak ada request yang dikirim.",
    });
    throw new AiKeyMissingError(provider);
  }

  const timeoutMs = STAGE_TIMEOUT_MS[args.stage] ?? 60_000;
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await globalThis.fetch(DEEPINFRA_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          buildChatPayload({
            model: args.model,
            stage: args.stage,
            messages: args.messages,
            schema: args.schema,
            structureHint: args.structureHint,
          }),
        ),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const timedOut =
      typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
    const detail = timedOut
      ? `Timeout ${timeoutMs / 1000} detik (batas tahap ${args.stage}) menunggu respons DeepInfra untuk model ${args.model}.`
      : "Gagal menghubungi DeepInfra (error jaringan).";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      status: "gagal",
      detail,
    });
    throw new AiModelError(detail);
  }

  if (!response.ok) {
    // G5-D — simpan ISI balasan error (pesan + field yang ditolak) ke
    // ai_usage_log, bukan hanya kode HTTP-nya.
    const detail = await readProviderErrorDetail(response);
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      status: "gagal",
      detail,
    });
    throw new AiModelError(detail);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const detail = "Respons DeepInfra bukan JSON yang valid.";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      status: "gagal",
      detail,
    });
    throw new AiModelError(detail);
  }

  const root = (payload ?? {}) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const content = root.choices?.[0]?.message?.content;
  const inputTokens =
    typeof root.usage?.prompt_tokens === "number"
      ? root.usage.prompt_tokens
      : estimateTokens(args.messages.map((m) => m.content).join("\n"));
  const outputTokens =
    typeof root.usage?.completion_tokens === "number"
      ? root.usage.completion_tokens
      : estimateTokens(typeof content === "string" ? content : "");

  if (typeof content !== "string" || content.trim() === "") {
    const detail = "Respons DeepInfra tidak memuat konten model.";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      status: "gagal",
      detail,
    });
    throw new AiModelError(detail);
  }

  let data: T;
  try {
    data = parseStructured(content, args.schema);
  } catch (e) {
    const detail =
      e instanceof AiModelError ? e.message : "Respons model tidak valid.";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      status: "gagal",
      detail,
    });
    throw new AiModelError(detail);
  }

  const latencyMs = Date.now() - started;
  await logAiUsage(args.db, {
    ...baseLog,
    inputTokens,
    outputTokens,
    latencyMs,
    status: "sukses",
    detail: "",
  });
  return { data, model: args.model, inputTokens, outputTokens, latencyMs };
}

// ---------------------------------------------------------------------------
// Uji koneksi model (G5-B) — satu panggilan chat completion minimal ke satu
// model, untuk tombol "Uji Koneksi" di panel admin. Selalu tercatat di
// ai_usage_log (sukses / gagal / kunci_belum_terpasang) dengan token &
// biaya sebenarnya bila panggilan terjadi. Token provider tidak pernah
// keluar dari modul ini.
// ---------------------------------------------------------------------------

export interface AiConnectionTestResult {
  ok: boolean;
  status: "sukses" | "gagal" | "kunci_belum_terpasang";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  detail: string;
}

// Harga untuk menghitung biaya uji: cocokkan model ke registry (model
// utama atau fallback pada tahap yang diberikan, lalu semua tahap). Model
// yang tidak ada di registry dihitung dengan harga 0 — uji tetap jalan.
async function pricesForModel(
  db: AiDb,
  model: string,
  stage: AiStageKey | null,
): Promise<{ inputPriceUsd: number; outputPriceUsd: number }> {
  await ensureAiStageModels(db);
  const rows = await db.select().from(schema.aiStageModels);
  const ordered = stage
    ? [...rows.filter((r) => r.stage === stage), ...rows.filter((r) => r.stage !== stage)]
    : rows;
  for (const r of ordered) {
    if (r.primaryModel === model) {
      return { inputPriceUsd: r.inputPriceUsd, outputPriceUsd: r.outputPriceUsd };
    }
    if (r.fallbackModel === model) {
      return {
        inputPriceUsd: r.fallbackInputPriceUsd,
        outputPriceUsd: r.fallbackOutputPriceUsd,
      };
    }
  }
  return { inputPriceUsd: 0, outputPriceUsd: 0 };
}

export async function testModelConnection(args: {
  db: AiDb;
  model: string;
  stage: AiStageKey | null;
  userId: number | null;
}): Promise<AiConnectionTestResult> {
  const provider = AI_PROVIDER;
  const logStage = args.stage ?? "uji-koneksi";
  const prices = await pricesForModel(args.db, args.model, args.stage);
  const baseLog = {
    provider,
    model: args.model,
    stage: logStage,
    projectId: null,
    userId: args.userId,
    inputPriceUsd: prices.inputPriceUsd,
    outputPriceUsd: prices.outputPriceUsd,
  };
  const zero = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  const token = await loadProviderToken(args.db, provider);
  if (!token) {
    const detail =
      "Uji koneksi tidak dijalankan: kunci DeepInfra belum terpasang di penyimpanan platform.";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "kunci_belum_terpasang",
      detail,
    });
    return {
      ok: false,
      status: "kunci_belum_terpasang",
      latencyMs: 0,
      ...zero,
      detail,
    };
  }

  const started = Date.now();
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await globalThis.fetch(DEEPINFRA_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: args.model,
          messages: [
            {
              role: "user",
              content: "Uji koneksi. Balas dengan satu kata saja: siap.",
            },
          ],
          max_tokens: 16,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const timedOut =
      typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
    const detail = timedOut
      ? `Timeout ${REQUEST_TIMEOUT_MS / 1000} detik menunggu respons DeepInfra saat uji koneksi.`
      : "Gagal menghubungi DeepInfra saat uji koneksi (error jaringan).";
    const latencyMs = Date.now() - started;
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "gagal",
      detail,
    });
    return { ok: false, status: "gagal", latencyMs, ...zero, detail };
  }

  const latencyMs = Date.now() - started;

  if (!response.ok) {
    const detail = `${await readProviderErrorDetail(response)} (uji koneksi model ${args.model})`;
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "gagal",
      detail,
    });
    return { ok: false, status: "gagal", latencyMs, ...zero, detail };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const detail = "Respons DeepInfra saat uji koneksi bukan JSON yang valid.";
    await logAiUsage(args.db, {
      ...baseLog,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: "gagal",
      detail,
    });
    return { ok: false, status: "gagal", latencyMs, ...zero, detail };
  }

  const root = (payload ?? {}) as {
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const inputTokens =
    typeof root.usage?.prompt_tokens === "number"
      ? root.usage.prompt_tokens
      : estimateTokens("Uji koneksi. Balas dengan satu kata saja: siap.");
  const outputTokens =
    typeof root.usage?.completion_tokens === "number"
      ? root.usage.completion_tokens
      : 0;
  const costUsd =
    (inputTokens * prices.inputPriceUsd + outputTokens * prices.outputPriceUsd) /
    1_000_000;
  await logAiUsage(args.db, {
    ...baseLog,
    inputTokens,
    outputTokens,
    latencyMs,
    status: "sukses",
    detail: "Uji koneksi dari panel admin.",
  });
  return {
    ok: true,
    status: "sukses",
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd,
    detail: "",
  };
}

// Jalankan satu tahap pipeline dengan aturan fallback G5-A: model utama
// dicoba satu kali; kegagalan apa pun (termasuk tahap dinonaktifkan di
// registry) memicu SATU percobaan model fallback tahap itu. Kunci belum
// terpasang dilempar apa adanya (AiKeyMissingError) tanpa percobaan model
// dan tanpa fallback. Bila keduanya gagal, AiModelError terakhir dilempar.
export async function runAiStage<T>(args: {
  db: AiDb;
  stage: AiStageKey;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  structureHint?: string;
  userId: number | null;
  projectId: number | null;
}): Promise<{ data: T; modelUsed: string; usedFallback: boolean }> {
  const cfg = await getStageModel(args.db, args.stage);
  if (!cfg) {
    throw new AiModelError(
      `Registry model untuk tahap "${args.stage}" tidak ditemukan.`,
    );
  }

  if (!cfg.isActive) {
    // Tahap dinonaktifkan di registry = kegagalan model utama yang
    // tercatat, lalu fallback tetap dicoba satu kali (aturan poin 6).
    await logAiUsage(args.db, {
      provider: cfg.provider,
      model: cfg.primaryModel,
      stage: args.stage,
      projectId: args.projectId,
      userId: args.userId,
      inputTokens: 0,
      outputTokens: 0,
      inputPriceUsd: cfg.inputPriceUsd,
      outputPriceUsd: cfg.outputPriceUsd,
      latencyMs: 0,
      status: "gagal",
      detail: `Tahap ${args.stage} dinonaktifkan di registry model; model utama tidak dipanggil, langsung mencoba fallback.`,
    });
  } else {
    try {
      const res = await complete<T>({
        db: args.db,
        provider: cfg.provider,
        stage: args.stage,
        model: cfg.primaryModel,
        messages: args.messages,
        schema: args.schema,
        structureHint: args.structureHint,
        userId: args.userId,
        projectId: args.projectId,
        inputPriceUsd: cfg.inputPriceUsd,
        outputPriceUsd: cfg.outputPriceUsd,
      });
      return { data: res.data, modelUsed: res.model, usedFallback: false };
    } catch (e) {
      if (isAiKeyMissing(e)) throw e;
      // Jatuh ke fallback di bawah.
    }
  }

  try {
    const res = await complete<T>({
      db: args.db,
      provider: cfg.provider,
      stage: args.stage,
      model: cfg.fallbackModel,
      messages: args.messages,
      schema: args.schema,
      structureHint: args.structureHint,
      userId: args.userId,
      projectId: args.projectId,
      inputPriceUsd: cfg.fallbackInputPriceUsd,
      outputPriceUsd: cfg.fallbackOutputPriceUsd,
    });
    return { data: res.data, modelUsed: res.model, usedFallback: true };
  } catch (e) {
    if (isAiKeyMissing(e)) throw e;
    throw new AiModelError(
      e instanceof Error
        ? e.message
        : `Model utama dan fallback tahap ${args.stage} gagal.`,
    );
  }
}
