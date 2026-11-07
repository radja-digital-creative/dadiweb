// G9 — Lapisan OAuth GitHub Dadiweb (server-side saja).
//
// Pola yang sama persis seperti Google (G8), hanya endpoint dan detail
// profilnya berbeda:
// - Kredensial (Client ID, Client Secret, Callback URL) disimpan di tabel
//   github_oauth_settings. Client Secret disimpan TERENKRIPSI AES-256-GCM
//   dengan helper enkripsi persis kunci DeepInfra (G5) — provider
//   "github" memberi salt HKDF berbeda, jadi kunci turunannya berbeda
//   dari kunci DeepInfra maupun Google. Yang keluar dari modul ini hanya
//   petunjuk 4 karakter terakhir; plaintext secret hanya hidup sesaat
//   di memori server saat penukaran code, dan tidak pernah dicatat,
//   dikembalikan aksi, atau dikirim ke browser.
// - State OAuth acak sekali pakai, kedaluwarsa 10 menit, disimpan
//   server-side di github_oauth_states dan divalidasi di callback.
//   State yang sudah dipakai/kedaluwarsa ditolak.
// - Penukaran code → token dan pengambilan profil terjadi di server
//   (fetch langsung ke GitHub). Token akses GitHub TIDAK disimpan —
//   login hanya butuh profil (id + email terverifikasi).
// - Email GitHub bisa privat sehingga profil /user saja tidak cukup:
//   email diambil dari /user/emails dan yang dipakai adalah yang
//   primary + verified; bila tidak ada email terverifikasi sama sekali,
//   login ditolak bersih (tidak bisa membuat akun tanpa email).
// - Kegagalan di tahap mana pun melempar GitHubOAuthError dengan pesan
//   jujur; pemanggil (aksi) wajib memastikan tidak ada sesi dan tidak
//   ada pengguna baru setengah jadi.
//
// Mekanisme callback (sama seperti G8): AKSI `completeGitHubOAuth`,
// bukan route HTTP kustom — runtime artifact ini hanya melayani actions
// + SPA statis. Callback URL yang didaftarkan ke GitHub adalah URL dasar
// aplikasi; saat GitHub mengembalikan pengguna ke URL itu dengan
// `code`+`state` di query string, SPA membaca query string tersebut dan
// memanggil aksi complete — penukaran code tetap terjadi server-side
// di sini. Untuk membedakan callback GitHub dari callback Google (keduanya
// memakai ?code=&state= di URL yang sama), SPA menyimpan penanda provider
// di sessionStorage sebelum redirect, dengan fallback mencoba Google dulu
// lalu GitHub bila penanda hilang (aman: consume state yang salah tabel
// gagal tanpa efek samping).

import { eq, lt } from "drizzle-orm";
import type { Ctx } from "./sdk-shim";
import * as schema from "./schema";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "./ai-provider";

// Tipe database yang dipakai modul ini — persis pola AiDb di ai-provider
// (hasil ctx.db() yang terikat ke skema), agar nilai db dari handler aksi
// bisa diteruskan tanpa konversi.
function dbOf(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
export type GitHubOAuthDb = ReturnType<typeof dbOf>;

const GITHUB_PROVIDER = "github";
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_TIMEOUT_MS = 30_000;

export class GitHubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOAuthError";
  }
}

function randomState(): string {
  const buf = new Uint8Array(32);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Pengaturan (admin)
// ---------------------------------------------------------------------------

export interface GitHubOAuthSettingsStatus {
  configured: boolean;
  clientId: string;
  callbackUrl: string;
  secretConfigured: boolean;
  secretHint: string;
  // Bagian konfigurasi yang masih kosong, untuk pesan error jujur yang
  // menyebut langkah yang kurang (bukan pesan generik).
  missing: Array<"clientId" | "clientSecret" | "callbackUrl">;
}

export async function getGitHubOAuthSettingsStatus(
  db: GitHubOAuthDb,
): Promise<GitHubOAuthSettingsStatus> {
  const rows = await db
    .select()
    .from(schema.githubOAuthSettings)
    .where(eq(schema.githubOAuthSettings.id, 1));
  const row = rows[0];
  const missing: GitHubOAuthSettingsStatus["missing"] = [];
  if (!row || !row.clientId.trim()) missing.push("clientId");
  if (!row || !row.secretCiphertext.trim()) missing.push("clientSecret");
  if (!row || !row.callbackUrl.trim()) missing.push("callbackUrl");
  return {
    configured: missing.length === 0,
    clientId: row?.clientId ?? "",
    callbackUrl: row?.callbackUrl ?? "",
    secretConfigured: !!row && row.secretCiphertext.trim() !== "",
    secretHint: row?.secretHint ?? "",
    missing,
  };
}

// Simpan kredensial GitHub. Mengembalikan status saja — secret utuh tidak
// pernah dikembalikan. Validasi bentuk callback URL dilakukan di aksi
// (harus https, kecuali localhost untuk pengembangan lokal).
export async function setGitHubOAuthSettings(
  db: GitHubOAuthDb,
  args: { clientId: string; clientSecret: string; callbackUrl: string },
): Promise<GitHubOAuthSettingsStatus> {
  const clientId = args.clientId.trim();
  const secret = args.clientSecret.trim();
  const callbackUrl = args.callbackUrl.trim();
  const ciphertext = await encryptProviderSecret(GITHUB_PROVIDER, secret);
  const hint = `••••${secret.slice(-4)}`;
  // Verifikasi integritas internal: ciphertext harus bisa dibuka kembali
  // server-side sebelum dinyatakan tersimpan (pola yang sama seperti
  // setProviderKey DeepInfra dan setGoogleOAuthSettings).
  const roundtrip = await decryptProviderSecret(GITHUB_PROVIDER, ciphertext);
  if (roundtrip !== secret) {
    throw new GitHubOAuthError(
      "Verifikasi enkripsi Client Secret GitHub gagal; kredensial tidak disimpan.",
    );
  }
  const existing = await db
    .select()
    .from(schema.githubOAuthSettings)
    .where(eq(schema.githubOAuthSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(schema.githubOAuthSettings).values({
      id: 1,
      clientId,
      secretCiphertext: ciphertext,
      secretHint: hint,
      callbackUrl,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.githubOAuthSettings)
      .set({
        clientId,
        secretCiphertext: ciphertext,
        secretHint: hint,
        callbackUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.githubOAuthSettings.id, 1));
  }
  return getGitHubOAuthSettingsStatus(db);
}

export async function clearGitHubOAuthSettings(
  db: GitHubOAuthDb,
): Promise<void> {
  await db
    .delete(schema.githubOAuthSettings)
    .where(eq(schema.githubOAuthSettings.id, 1));
}

// Secret plaintext hanya untuk penukaran code di dalam completeGitHubOAuth
// di bawah; tidak pernah dicatat atau dikembalikan oleh fungsi lain.
async function loadGitHubOAuthSecret(
  db: GitHubOAuthDb,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.githubOAuthSettings)
    .where(eq(schema.githubOAuthSettings.id, 1));
  const row = rows[0];
  if (!row || !row.secretCiphertext) return null;
  return decryptProviderSecret(GITHUB_PROVIDER, row.secretCiphertext);
}

// ---------------------------------------------------------------------------
// State sekali pakai
// ---------------------------------------------------------------------------

export async function createGitHubOAuthState(
  db: GitHubOAuthDb,
): Promise<string> {
  const now = Date.now();
  // Bersihkan state kedaluwarsa agar tabel tidak menumpuk.
  await db
    .delete(schema.githubOAuthStates)
    .where(lt(schema.githubOAuthStates.expiresAt, new Date(now)));
  const state = randomState();
  await db.insert(schema.githubOAuthStates).values({
    state,
    createdAt: new Date(now),
    expiresAt: new Date(now + STATE_TTL_MS),
    consumed: false,
  });
  return state;
}

// Validasi + konsumsi state dalam satu langkah: state yang lolos di sini
// langsung ditandai consumed sehingga tidak bisa dipakai dua kali, bahkan
// bila penukaran code sesudahnya gagal (code GitHub sendiri sekali pakai).
export async function consumeGitHubOAuthState(
  db: GitHubOAuthDb,
  state: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.githubOAuthStates)
    .where(eq(schema.githubOAuthStates.state, state));
  const row = rows[0];
  if (!row || row.consumed) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  await db
    .update(schema.githubOAuthStates)
    .set({ consumed: true })
    .where(eq(schema.githubOAuthStates.state, state));
  return true;
}

// ---------------------------------------------------------------------------
// Alur OAuth
// ---------------------------------------------------------------------------

export function buildGitHubAuthUrl(args: {
  clientId: string;
  callbackUrl: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.callbackUrl,
    scope: "read:user user:email",
    state: args.state,
  });
  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

export interface GitHubProfile {
  // ID numerik GitHub, disimpan sebagai teks di users.github_id.
  id: string;
  login: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);
  try {
    return await globalThis.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Baca isi balasan error GitHub secukupnya untuk diagnosis (jenis error
// saja); body dipotong dan tidak pernah memuat secret (secret hanya ada
// di body request penukaran, bukan di respons).
async function readGitHubErrorDetail(
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
    ? `GitHub menjawab HTTP ${response.status} saat ${context}: ${body}`
    : `GitHub menjawab HTTP ${response.status} saat ${context} (tanpa isi balasan).`;
}

function networkError(e: unknown, context: string): GitHubOAuthError {
  const timedOut =
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "AbortError";
  return new GitHubOAuthError(
    timedOut
      ? `Timeout 30 detik menunggu GitHub saat ${context}.`
      : `Gagal menghubungi GitHub saat ${context} (error jaringan).`,
  );
}

// Tukar authorization code menjadi token di server, lalu ambil profil +
// email. Melempar GitHubOAuthError bila tahap mana pun gagal — pemanggil
// tidak boleh membuat pengguna/sesi dari hasil parsial.
export async function exchangeCodeForProfile(
  db: GitHubOAuthDb,
  args: { code: string; callbackUrl: string },
): Promise<GitHubProfile> {
  const status = await getGitHubOAuthSettingsStatus(db);
  if (!status.configured) {
    throw new GitHubOAuthError(
      "Login GitHub belum diaktifkan: kredensial GitHub belum lengkap di panel admin.",
    );
  }
  const secret = await loadGitHubOAuthSecret(db);
  if (!secret) {
    throw new GitHubOAuthError(
      "Login GitHub belum diaktifkan: Client Secret GitHub belum terpasang.",
    );
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchWithTimeout(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Dadiweb",
      },
      body: JSON.stringify({
        client_id: status.clientId,
        client_secret: secret,
        code: args.code,
        redirect_uri: args.callbackUrl,
      }),
    });
  } catch (e) {
    throw networkError(e, "menukar kode login");
  }
  if (!tokenResponse.ok) {
    throw new GitHubOAuthError(
      await readGitHubErrorDetail(tokenResponse, "menukar kode login"),
    );
  }
  let tokenPayload: unknown;
  try {
    tokenPayload = await tokenResponse.json();
  } catch {
    throw new GitHubOAuthError(
      "Respons GitHub saat menukar kode login bukan JSON yang valid.",
    );
  }
  const tp = tokenPayload as {
    access_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  };
  // GitHub mengembalikan error OAuth di body JSON 200 (mis.
  // bad_verification_code untuk code invalid) — bukan HTTP error.
  if (typeof tp.error === "string" && tp.error !== "") {
    throw new GitHubOAuthError(
      `GitHub menolak penukaran kode login (${tp.error}${typeof tp.error_description === "string" && tp.error_description !== "" ? `: ${tp.error_description}` : ""}).`,
    );
  }
  const accessToken = tp.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new GitHubOAuthError(
      "GitHub tidak mengembalikan token akses saat menukar kode login.",
    );
  }

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Dadiweb",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let userResponse: Response;
  try {
    userResponse = await fetchWithTimeout(GITHUB_USER_URL, {
      method: "GET",
      headers: authHeaders,
    });
  } catch (e) {
    throw networkError(e, "mengambil profil");
  }
  if (!userResponse.ok) {
    throw new GitHubOAuthError(
      await readGitHubErrorDetail(userResponse, "mengambil profil"),
    );
  }
  let userPayload: unknown;
  try {
    userPayload = await userResponse.json();
  } catch {
    throw new GitHubOAuthError("Respons profil GitHub bukan JSON yang valid.");
  }
  const u = userPayload as {
    id?: unknown;
    login?: unknown;
    name?: unknown;
    email?: unknown;
  };
  if (typeof u.id !== "number" || !Number.isFinite(u.id)) {
    throw new GitHubOAuthError(
      "Profil GitHub tidak memuat pengenal pengguna (id).",
    );
  }
  const login =
    typeof u.login === "string" && u.login.trim() !== "" ? u.login.trim() : "";
  const name =
    typeof u.name === "string" && u.name.trim() !== ""
      ? u.name.trim()
      : login !== ""
        ? login
        : "Pengguna GitHub";

  // Email bisa privat: /user sering mengembalikan null. Ambil dari
  // /user/emails dan pilih yang primary + verified; bila tidak ada yang
  // primary, pakai verified pertama. Tanpa email terverifikasi, login
  // ditolak — tidak bisa membuat akun tanpa email.
  let emailsResponse: Response;
  try {
    emailsResponse = await fetchWithTimeout(GITHUB_EMAILS_URL, {
      method: "GET",
      headers: authHeaders,
    });
  } catch (e) {
    throw networkError(e, "mengambil email");
  }
  if (!emailsResponse.ok) {
    throw new GitHubOAuthError(
      await readGitHubErrorDetail(emailsResponse, "mengambil email"),
    );
  }
  let emailsPayload: unknown;
  try {
    emailsPayload = await emailsResponse.json();
  } catch {
    throw new GitHubOAuthError("Respons email GitHub bukan JSON yang valid.");
  }
  const emails = Array.isArray(emailsPayload) ? emailsPayload : [];
  const verified = emails.filter(
    (e): e is { email: string; verified: boolean; primary: boolean } =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as { email?: unknown }).email === "string" &&
      (e as { verified?: unknown }).verified === true,
  );
  const chosen =
    verified.find((e) => e.primary === true) ?? verified[0];
  if (!chosen) {
    throw new GitHubOAuthError(
      "GitHub tidak mengembalikan email terverifikasi untuk akun ini, jadi tidak bisa dipakai untuk masuk.",
    );
  }
  return {
    id: String(u.id),
    login,
    name,
    email: chosen.email.trim().toLowerCase(),
    emailVerified: true,
  };
}
