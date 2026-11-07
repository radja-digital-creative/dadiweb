// G13-A — Klien queue fal.ai + settings video Dadiweb (server-side saja).
//
// Aturan yang ditegakkan di sini (pola persis DeepInfra G5 / OAuth G8-G9 /
// Cloudflare G10):
// - Kunci API fal.ai disimpan di tabel fal_video_settings (satu baris
//   id=1), TERENKRIPSI AES-256-GCM dengan helper persis kunci DeepInfra
//   (salt provider "fal"). Yang keluar hanya petunjuk 4 karakter terakhir;
//   plaintext kunci hanya hidup sesaat di memori server saat memanggil
//   fal.ai, tidak pernah dicatat, dikembalikan aksi, atau dikirim ke
//   browser. Kunci BOLEH kosong — belum terpasang adalah keadaan normal
//   sampai Eka memasang kunci asli lewat panel admin.
// - Klien queue memakai fetch langsung ke https://queue.fal.run (JANGAN
//   route sync fal.run untuk video — ia memblokir dan akan timeout).
//   Submit → 202 {request_id, status_url, response_url, cancel_url};
//   poll status IN_QUEUE → IN_PROGRESS → COMPLETED; hasil di
//   result.data.video.url. Transport bisa di-mock lewat opsi fetchFn /
//   baseUrl — HANYA untuk skrip uji; kode produksi selalu memanggil
//   fal.ai sungguhan.
// - Pesan error TIDAK PERNAH memuat kunci, header Authorization, atau
//   respons mentah — hanya status HTTP dan pesan singkat yang aman.
// - Registry model video (video_models) adalah sumber kebenaran harga
//   dan batas durasi; estimasi biaya dihitung dari rumus terkunci di
//   video-credits.ts, bukan dari tabel tarif mati.

import { eq } from "drizzle-orm";
import type { Ctx } from "./sdk-shim";
import * as schema from "./schema";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "./ai-provider";
import { calcVideoCredits, DEFAULT_VIDEO_TARIFF } from "./video-credits";

function dbOf(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
export type FalVideoDb = ReturnType<typeof dbOf>;

const FAL_PROVIDER = "fal";
export const FAL_QUEUE_BASE_URL = "https://queue.fal.run";
const FAL_API_BASE_URL = "https://api.fal.ai";
const FAL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type FalVideoErrorKind =
  | "kunci_belum_terpasang"
  | "kunci_salah"
  | "validasi"
  | "rate_limit"
  | "server"
  | "jaringan"
  | "respons_tidak_valid";

export class FalVideoError extends Error {
  readonly kind: FalVideoErrorKind;
  readonly httpStatus?: number;
  constructor(kind: FalVideoErrorKind, message: string, httpStatus?: number) {
    super(message);
    this.name = "FalVideoError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export function isFalKeyMissing(e: unknown): e is FalVideoError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { kind?: unknown }).kind === "kunci_belum_terpasang"
  );
}

// ---------------------------------------------------------------------------
// Klien queue fal.ai (fetch langsung, transport bisa di-mock untuk uji)
// ---------------------------------------------------------------------------

export type FalFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface FalClientOptions {
  // Override fetch (skrip uji saja). Default: globalThis.fetch.
  fetchFn?: FalFetch;
  // Override host queue (skrip uji saja). Default: https://queue.fal.run.
  baseUrl?: string;
  // Batas waktu per panggilan (default 30 detik).
  timeoutMs?: number;
}

export interface FalSubmitResult {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
  queuePosition?: number;
}

export type FalQueueStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export interface FalStatusResult {
  status: FalQueueStatus;
  queuePosition?: number;
  // Bila status COMPLETED tetapi job gagal di sisi fal.ai.
  error?: string;
}

export interface FalVideoResult {
  videoUrl: string;
  requestId: string;
}

function resolveFetch(opts?: FalClientOptions): FalFetch {
  return opts?.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
}

function resolveBaseUrl(opts?: FalClientOptions): string {
  return (opts?.baseUrl ?? FAL_QUEUE_BASE_URL).replace(/\/+$/, "");
}

async function fetchWithTimeout(
  fetchFn: FalFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Baca isi balasan error fal.ai secukupnya untuk diagnosis (jenis error
// saja, dipotong 400 karakter). Kunci tidak pernah ada di balasan error
// (hanya di header request), jadi aman dicatat.
async function readFalErrorDetail(
  response: Response,
  context: string,
): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    body = "";
  }
  return body
    ? `fal.ai menjawab HTTP ${response.status} saat ${context}: ${body}`
    : `fal.ai menjawab HTTP ${response.status} saat ${context} (tanpa isi balasan).`;
}

function falHttpError(
  status: number,
  detail: string,
): FalVideoError {
  if (status === 401 || status === 403) {
    return new FalVideoError(
      "kunci_salah",
      `Kunci API fal.ai ditolak fal.ai (HTTP ${status}). Periksa / pasang ulang kunci di panel admin.`,
      status,
    );
  }
  if (status === 422) {
    return new FalVideoError(
      "validasi",
      `fal.ai menolak input video (HTTP 422). ${detail}`,
      status,
    );
  }
  if (status === 429) {
    return new FalVideoError(
      "rate_limit",
      "fal.ai membatasi laju permintaan (HTTP 429). Coba lagi sebentar lagi.",
      status,
    );
  }
  if (status >= 500) {
    return new FalVideoError(
      "server",
      `fal.ai gagal di sisi server (HTTP ${status}). ${detail}`,
      status,
    );
  }
  return new FalVideoError("server", detail, status);
}

function toNetworkError(e: unknown, timeoutMs: number): FalVideoError {
  const timedOut =
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AbortError";
  return new FalVideoError(
    "jaringan",
    timedOut
      ? `Timeout ${timeoutMs / 1000} detik menunggu fal.ai.`
      : "Gagal menghubungi fal.ai (error jaringan).",
  );
}

async function parseJsonSafe(
  response: Response,
): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Submit job video ke queue. Input diteruskan apa adanya ke endpoint
// model (mis. {prompt, duration, resolution} atau {prompt,
// start_image_url, ...} untuk image-to-video — nama parameter gambar
// per model dipetakan di IMAGE_INPUT_PARAM di video-jobs.ts) — G13-B
// yang membangun input per model; di sini hanya transport + validasi
// bentuk respons 202.
export async function submitVideo(
  apiKey: string,
  args: { modelEndpoint: string; input: Record<string, unknown> },
  opts?: FalClientOptions,
): Promise<FalSubmitResult> {
  const fetchFn = resolveFetch(opts);
  const baseUrl = resolveBaseUrl(opts);
  const timeoutMs = opts?.timeoutMs ?? FAL_TIMEOUT_MS;
  const endpoint = args.modelEndpoint.replace(/^\/+/, "");
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}/${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify(args.input),
      },
      timeoutMs,
    );
  } catch (e) {
    throw toNetworkError(e, timeoutMs);
  }
  if (!response.ok) {
    throw falHttpError(
      response.status,
      await readFalErrorDetail(response, "mengirim job video"),
    );
  }
  const payload = await parseJsonSafe(response);
  const p = (payload ?? {}) as {
    request_id?: unknown;
    status_url?: unknown;
    response_url?: unknown;
    cancel_url?: unknown;
    queue_position?: unknown;
  };
  if (
    typeof p.request_id !== "string" ||
    p.request_id === "" ||
    typeof p.status_url !== "string" ||
    p.status_url === "" ||
    typeof p.response_url !== "string" ||
    p.response_url === "" ||
    typeof p.cancel_url !== "string" ||
    p.cancel_url === ""
  ) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Respons submit fal.ai tidak memuat request_id / status_url / response_url / cancel_url.",
    );
  }
  return {
    requestId: p.request_id,
    statusUrl: p.status_url,
    responseUrl: p.response_url,
    cancelUrl: p.cancel_url,
    queuePosition:
      typeof p.queue_position === "number" ? p.queue_position : undefined,
  };
}

// Poll status job. statusUrl diambil dari hasil submit (sumber kebenaran
// URL); bila tidak ada, URL dibangun dari endpoint + requestId.
export async function getVideoStatus(
  apiKey: string,
  args: {
    requestId: string;
    statusUrl?: string;
    modelEndpoint?: string;
  },
  opts?: FalClientOptions,
): Promise<FalStatusResult> {
  const fetchFn = resolveFetch(opts);
  const baseUrl = resolveBaseUrl(opts);
  const timeoutMs = opts?.timeoutMs ?? FAL_TIMEOUT_MS;
  const url =
    args.statusUrl ??
    (args.modelEndpoint
      ? `${baseUrl}/${args.modelEndpoint.replace(/^\/+/, "")}/requests/${args.requestId}/status`
      : "");
  if (!url) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Status video tidak bisa dicek: tidak ada status_url maupun endpoint model.",
    );
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      url,
      {
        method: "GET",
        headers: { Authorization: `Key ${apiKey}` },
      },
      timeoutMs,
    );
  } catch (e) {
    throw toNetworkError(e, timeoutMs);
  }
  if (!response.ok) {
    throw falHttpError(
      response.status,
      await readFalErrorDetail(response, "mengecek status job video"),
    );
  }
  const payload = await parseJsonSafe(response);
  const p = (payload ?? {}) as {
    status?: unknown;
    queue_position?: unknown;
    error?: unknown;
  };
  if (
    p.status !== "IN_QUEUE" &&
    p.status !== "IN_PROGRESS" &&
    p.status !== "COMPLETED"
  ) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Respons status fal.ai tidak memuat status job yang dikenal (IN_QUEUE / IN_PROGRESS / COMPLETED).",
    );
  }
  return {
    status: p.status,
    queuePosition:
      typeof p.queue_position === "number" ? p.queue_position : undefined,
    error: typeof p.error === "string" ? p.error : undefined,
  };
}

// Ambil hasil job yang sudah COMPLETED. responseUrl diambil dari hasil
// submit; bila tidak ada, URL dibangun dari endpoint + requestId.
export async function getVideoResult(
  apiKey: string,
  args: {
    requestId: string;
    responseUrl?: string;
    modelEndpoint?: string;
  },
  opts?: FalClientOptions,
): Promise<FalVideoResult> {
  const fetchFn = resolveFetch(opts);
  const baseUrl = resolveBaseUrl(opts);
  const timeoutMs = opts?.timeoutMs ?? FAL_TIMEOUT_MS;
  const url =
    args.responseUrl ??
    (args.modelEndpoint
      ? `${baseUrl}/${args.modelEndpoint.replace(/^\/+/, "")}/requests/${args.requestId}/response`
      : "");
  if (!url) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Hasil video tidak bisa diambil: tidak ada response_url maupun endpoint model.",
    );
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      url,
      {
        method: "GET",
        headers: { Authorization: `Key ${apiKey}` },
      },
      timeoutMs,
    );
  } catch (e) {
    throw toNetworkError(e, timeoutMs);
  }
  if (!response.ok) {
    throw falHttpError(
      response.status,
      await readFalErrorDetail(response, "mengambil hasil job video"),
    );
  }
  const payload = await parseJsonSafe(response);
  const p = (payload ?? {}) as {
    data?: { video?: { url?: unknown } };
    video?: { url?: unknown };
  };
  const videoUrl = p.data?.video?.url ?? p.video?.url;
  if (typeof videoUrl !== "string" || videoUrl === "") {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Respons hasil fal.ai tidak memuat URL video (data.video.url).",
    );
  }
  return { videoUrl, requestId: args.requestId };
}

// Batalkan job yang masih antre/berjalan. cancelUrl diambil dari hasil
// submit; bila tidak ada, URL dibangun dari endpoint + requestId.
export async function cancelVideo(
  apiKey: string,
  args: {
    requestId: string;
    cancelUrl?: string;
    modelEndpoint?: string;
  },
  opts?: FalClientOptions,
): Promise<{ ok: boolean; detail: string }> {
  const fetchFn = resolveFetch(opts);
  const baseUrl = resolveBaseUrl(opts);
  const timeoutMs = opts?.timeoutMs ?? FAL_TIMEOUT_MS;
  const url =
    args.cancelUrl ??
    (args.modelEndpoint
      ? `${baseUrl}/${args.modelEndpoint.replace(/^\/+/, "")}/requests/${args.requestId}/cancel`
      : "");
  if (!url) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Job video tidak bisa dibatalkan: tidak ada cancel_url maupun endpoint model.",
    );
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      url,
      {
        method: "PUT",
        headers: { Authorization: `Key ${apiKey}` },
      },
      timeoutMs,
    );
  } catch (e) {
    throw toNetworkError(e, timeoutMs);
  }
  if (!response.ok) {
    throw falHttpError(
      response.status,
      await readFalErrorDetail(response, "membatalkan job video"),
    );
  }
  const payload = await parseJsonSafe(response);
  const p = (payload ?? {}) as { status?: unknown };
  return {
    ok: true,
    detail:
      typeof p.status === "string" ? p.status : "OK",
  };
}

// ---------------------------------------------------------------------------
// Settings (admin) + registry model
// ---------------------------------------------------------------------------

export interface VideoModelResolution {
  resolution: string;
  pricePerSecUsd: number;
}

export interface VideoModelInfo {
  key: string;
  label: string;
  endpointT2v: string;
  endpointI2v: string;
  minDuration: number;
  maxDuration: number;
  resolutions: VideoModelResolution[];
  isActive: boolean;
  isDefault: boolean;
}

export interface FalVideoTariffParams {
  creditValueRp: number;
  markupX100: number;
  exchangeRateRpPerUsd: number;
  roundingStep: number;
}

export interface FalVideoSettingsStatus {
  configured: boolean;
  // Hanya 4 karakter terakhir kunci (••••abcd); "" bila belum terpasang.
  hint: string;
  tariff: FalVideoTariffParams;
  models: VideoModelInfo[];
}

export const VIDEO_MODEL_DEFAULTS: Array<{
  key: string;
  label: string;
  endpointT2v: string;
  endpointI2v: string;
  minDuration: number;
  maxDuration: number;
  resolutions: VideoModelResolution[];
  isDefault: boolean;
}> = [
  {
    key: "wan-3.0",
    label: "Wan 3.0",
    endpointT2v: "alibaba/wan-3.0/text-to-video",
    endpointI2v: "alibaba/wan-3.0/image-to-video",
    minDuration: 2,
    maxDuration: 30,
    resolutions: [
      { resolution: "480p", pricePerSecUsd: 0.05 },
      { resolution: "720p", pricePerSecUsd: 0.1 },
      { resolution: "1080p", pricePerSecUsd: 0.2 },
    ],
    isDefault: true,
  },
  {
    key: "kling-4.0",
    label: "Kling 4.0",
    endpointT2v: "kling/v4/text-to-video",
    endpointI2v: "kling/v4/image-to-video",
    minDuration: 3,
    maxDuration: 30,
    resolutions: [
      { resolution: "720p", pricePerSecUsd: 0.157 },
      { resolution: "1080p", pricePerSecUsd: 0.235 },
    ],
    isDefault: false,
  },
];

function parseResolutions(raw: string): VideoModelResolution[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is VideoModelResolution =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as { resolution?: unknown }).resolution === "string" &&
          typeof (r as { pricePerSecUsd?: unknown }).pricePerSecUsd ===
            "number",
      )
      .map((r) => ({
        resolution: r.resolution,
        pricePerSecUsd: r.pricePerSecUsd,
      }));
  } catch {
    return [];
  }
}

function toModelInfo(
  row: typeof schema.videoModels.$inferSelect,
): VideoModelInfo {
  return {
    key: row.key,
    label: row.label,
    endpointT2v: row.endpointT2v,
    endpointI2v: row.endpointI2v,
    minDuration: row.minDuration,
    maxDuration: row.maxDuration,
    resolutions: parseResolutions(row.resolutions),
    isActive: row.isActive,
    isDefault: row.isDefault,
  };
}

// Isi registry dari VIDEO_MODEL_DEFAULTS bila tabel kosong per key
// (insert-if-missing, jadi baris yang sudah diubah admin tidak pernah
// ditimpa). Dipanggil setiap kali settings dibaca.
export async function ensureVideoModels(db: FalVideoDb): Promise<void> {
  const existing = await db.select().from(schema.videoModels);
  const have = new Set(existing.map((r) => r.key));
  for (const def of VIDEO_MODEL_DEFAULTS) {
    if (have.has(def.key)) continue;
    await db.insert(schema.videoModels).values({
      key: def.key,
      label: def.label,
      endpointT2v: def.endpointT2v,
      endpointI2v: def.endpointI2v,
      minDuration: def.minDuration,
      maxDuration: def.maxDuration,
      resolutions: JSON.stringify(def.resolutions),
      isActive: true,
      isDefault: def.isDefault,
    });
  }
}

export async function getVideoModels(
  db: FalVideoDb,
): Promise<VideoModelInfo[]> {
  await ensureVideoModels(db);
  const rows = await db.select().from(schema.videoModels);
  return rows.map(toModelInfo);
}

async function ensureFalVideoSettingsRow(
  db: FalVideoDb,
): Promise<typeof schema.falVideoSettings.$inferSelect> {
  const rows = await db
    .select()
    .from(schema.falVideoSettings)
    .where(eq(schema.falVideoSettings.id, 1));
  if (rows.length > 0) return rows[0]!;
  const inserted = await db
    .insert(schema.falVideoSettings)
    .values({
      id: 1,
      falKeyEncrypted: "",
      falKeyHint: "",
      creditValueRp: DEFAULT_VIDEO_TARIFF.creditValueRp,
      markupX100: DEFAULT_VIDEO_TARIFF.markupX100,
      exchangeRateRpPerUsd: DEFAULT_VIDEO_TARIFF.exchangeRateRpPerUsd,
      roundingStep: DEFAULT_VIDEO_TARIFF.roundingStep,
      updatedAt: new Date(),
    })
    .returning();
  return inserted[0]!;
}

export async function getFalVideoSettingsStatus(
  db: FalVideoDb,
): Promise<FalVideoSettingsStatus> {
  const row = await ensureFalVideoSettingsRow(db);
  const models = await getVideoModels(db);
  return {
    configured: row.falKeyEncrypted.trim() !== "",
    hint: row.falKeyHint,
    tariff: {
      creditValueRp: row.creditValueRp,
      markupX100: row.markupX100,
      exchangeRateRpPerUsd: row.exchangeRateRpPerUsd,
      roundingStep: row.roundingStep,
    },
    models,
  };
}

// Simpan kunci fal.ai terenkripsi. String kosong = hapus kunci (clear).
// Mengembalikan status saja — kunci utuh tidak pernah dikembalikan.
export async function setFalVideoKey(
  db: FalVideoDb,
  key: string,
): Promise<FalVideoSettingsStatus> {
  const trimmed = key.trim();
  if (trimmed === "") {
    await clearFalVideoKey(db);
    return getFalVideoSettingsStatus(db);
  }
  const ciphertext = await encryptProviderSecret(FAL_PROVIDER, trimmed);
  const hint = `••••${trimmed.slice(-4)}`;
  // Verifikasi integritas internal: ciphertext harus bisa dibuka kembali
  // server-side sebelum dinyatakan tersimpan (pola yang sama seperti
  // setProviderKey DeepInfra).
  const roundtrip = await decryptProviderSecret(FAL_PROVIDER, ciphertext);
  if (roundtrip !== trimmed) {
    throw new FalVideoError(
      "respons_tidak_valid",
      "Verifikasi enkripsi kunci fal.ai gagal; kunci tidak disimpan.",
    );
  }
  await ensureFalVideoSettingsRow(db);
  await db
    .update(schema.falVideoSettings)
    .set({ falKeyEncrypted: ciphertext, falKeyHint: hint, updatedAt: new Date() })
    .where(eq(schema.falVideoSettings.id, 1));
  return getFalVideoSettingsStatus(db);
}

export async function clearFalVideoKey(db: FalVideoDb): Promise<void> {
  await ensureFalVideoSettingsRow(db);
  await db
    .update(schema.falVideoSettings)
    .set({ falKeyEncrypted: "", falKeyHint: "", updatedAt: new Date() })
    .where(eq(schema.falVideoSettings.id, 1));
}

// Kunci plaintext hanya untuk dipakai klien fal.ai di dalam modul ini;
// tidak pernah dicatat atau dikembalikan oleh fungsi lain.
export async function loadFalVideoKey(
  db: FalVideoDb,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.falVideoSettings)
    .where(eq(schema.falVideoSettings.id, 1));
  const row = rows[0];
  if (!row || !row.falKeyEncrypted) return null;
  return decryptProviderSecret(FAL_PROVIDER, row.falKeyEncrypted);
}

export async function setFalVideoTariff(
  db: FalVideoDb,
  tariff: FalVideoTariffParams,
): Promise<FalVideoSettingsStatus> {
  await ensureFalVideoSettingsRow(db);
  await db
    .update(schema.falVideoSettings)
    .set({
      creditValueRp: tariff.creditValueRp,
      markupX100: tariff.markupX100,
      exchangeRateRpPerUsd: tariff.exchangeRateRpPerUsd,
      roundingStep: tariff.roundingStep,
      updatedAt: new Date(),
    })
    .where(eq(schema.falVideoSettings.id, 1));
  return getFalVideoSettingsStatus(db);
}

// ---------------------------------------------------------------------------
// Estimasi biaya (pengguna login; TIDAK butuh kunci fal.ai)
// ---------------------------------------------------------------------------

export interface VideoCostEstimate {
  modelKey: string;
  modelLabel: string;
  resolution: string;
  durationSec: number;
  minDuration: number;
  maxDuration: number;
  pricePerSecUsd: number;
  apiCostUsd: number;
  apiCostRp: number;
  credits: number;
}

export class VideoEstimateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoEstimateError";
  }
}

export async function estimateVideoCostFor(
  db: FalVideoDb,
  args: { modelKey: string; durationSec: number; resolution: string },
): Promise<VideoCostEstimate> {
  const models = await getVideoModels(db);
  const model = models.find((m) => m.key === args.modelKey);
  if (!model) {
    throw new VideoEstimateError(
      `Model video "${args.modelKey}" tidak ditemukan. Model yang tersedia: ${models.map((m) => m.key).join(", ") || "(belum ada)"}.`,
    );
  }
  if (!model.isActive) {
    throw new VideoEstimateError(
      `Model video "${model.label}" sedang nonaktif.`,
    );
  }
  if (
    !Number.isInteger(args.durationSec) ||
    args.durationSec < model.minDuration ||
    args.durationSec > model.maxDuration
  ) {
    throw new VideoEstimateError(
      `Durasi ${args.durationSec} detik di luar batas ${model.label}: ${model.minDuration}–${model.maxDuration} detik.`,
    );
  }
  const res = model.resolutions.find(
    (r) => r.resolution === args.resolution,
  );
  if (!res) {
    throw new VideoEstimateError(
      `Resolusi "${args.resolution}" tidak didukung ${model.label}. Resolusi yang tersedia: ${model.resolutions.map((r) => r.resolution).join(", ") || "(belum ada)"}.`,
    );
  }
  const row = await ensureFalVideoSettingsRow(db);
  const calc = calcVideoCredits({
    pricePerSecUsd: res.pricePerSecUsd,
    durationSec: args.durationSec,
    exchangeRateRpPerUsd: row.exchangeRateRpPerUsd,
    creditValueRp: row.creditValueRp,
    markupX100: row.markupX100,
    roundingStep: row.roundingStep,
  });
  return {
    modelKey: model.key,
    modelLabel: model.label,
    resolution: res.resolution,
    durationSec: args.durationSec,
    minDuration: model.minDuration,
    maxDuration: model.maxDuration,
    pricePerSecUsd: res.pricePerSecUsd,
    apiCostUsd: calc.apiCostUsd,
    apiCostRp: calc.apiCostRp,
    credits: calc.credits,
  };
}

// ---------------------------------------------------------------------------
// Uji koneksi (admin): GET pricing fal.ai dengan kunci tersimpan.
// Tanpa kunci → gagal bersih "kunci belum terpasang" (bukan crash, tanpa
// request HTTP apa pun). Dengan kunci → 401/403 = kunci salah, dilaporkan
// jujur; sukses = endpoint pricing menjawab 200.
// ---------------------------------------------------------------------------

export interface FalConnectionTestResult {
  ok: boolean;
  status: "sukses" | "gagal" | "kunci_belum_terpasang";
  latencyMs: number;
  detail: string;
}

export async function testFalVideoConnection(
  db: FalVideoDb,
  opts?: FalClientOptions & { apiBaseUrl?: string },
): Promise<FalConnectionTestResult> {
  const key = await loadFalVideoKey(db);
  if (!key) {
    return {
      ok: false,
      status: "kunci_belum_terpasang",
      latencyMs: 0,
      detail:
        "Uji koneksi tidak dijalankan: kunci API fal.ai belum terpasang di panel admin.",
    };
  }
  const models = await getVideoModels(db);
  const def = models.find((m) => m.isDefault) ?? models[0];
  const endpointId = def?.endpointT2v ?? "alibaba/wan-3.0/text-to-video";
  const apiBase = (opts?.apiBaseUrl ?? FAL_API_BASE_URL).replace(/\/+$/, "");
  const fetchFn = resolveFetch(opts);
  const timeoutMs = opts?.timeoutMs ?? FAL_TIMEOUT_MS;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      `${apiBase}/v1/models/pricing?endpoint_id=${encodeURIComponent(endpointId)}`,
      {
        method: "GET",
        headers: { Authorization: `Key ${key}` },
      },
      timeoutMs,
    );
  } catch (e) {
    const err = toNetworkError(e, timeoutMs);
    return {
      ok: false,
      status: "gagal",
      latencyMs: Date.now() - started,
      detail: err.message,
    };
  }
  const latencyMs = Date.now() - started;
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: "gagal",
      latencyMs,
      detail: `Kunci API fal.ai ditolak fal.ai (HTTP ${response.status}). Periksa / pasang ulang kunci di panel admin.`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: "gagal",
      latencyMs,
      detail: await readFalErrorDetail(response, "uji koneksi fal.ai"),
    };
  }
  return {
    ok: true,
    status: "sukses",
    latencyMs,
    detail: `fal.ai menjawab 200 untuk endpoint ${endpointId} (${latencyMs} ms).`,
  };
}
