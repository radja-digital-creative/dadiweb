// G8 — Lapisan OAuth Google Dadiweb (server-side saja).
//
// Aturan yang ditegakkan di sini:
// - Kredensial (Client ID, Client Secret, Redirect URI) disimpan di tabel
//   google_oauth_settings. Client Secret disimpan TERENKRIPSI AES-256-GCM
//   dengan helper enkripsi persis kunci DeepInfra (G5) — provider
//   "google" memberi salt HKDF berbeda, jadi kunci turunannya berbeda
//   dari kunci DeepInfra. Yang keluar dari modul ini hanya petunjuk 4
//   karakter terakhir; plaintext secret hanya hidup sesaat di memori
//   server saat penukaran code, dan tidak pernah dicatat, dikembalikan
//   aksi, atau dikirim ke browser.
// - State OAuth acak sekali pakai, kedaluwarsa 10 menit, disimpan
//   server-side di google_oauth_states dan divalidasi di callback.
//   State yang sudah dipakai/kedaluwarsa ditolak.
// - Penukaran code → token dan pengambilan profil terjadi di server
//   (fetch langsung ke Google). Token akses/refresh Google TIDAK
//   disimpan — login hanya butuh profil (sub + email terverifikasi).
// - Kegagalan di tahap mana pun melempar GoogleOAuthError dengan pesan
//   jujur; pemanggil (aksi) wajib memastikan tidak ada sesi dan tidak
//   ada pengguna baru setengah jadi.
//
// Mekanisme callback (dipilih builder, lihat laporan G8): AKSI
// `completeGoogleOAuth`, bukan route HTTP kustom. Alasannya: runtime
// artifact ini hanya melayani actions + SPA statis — tidak ada lapisan
// route HTTP server yang bisa meng-host `/oauth/google/callback`.
// Redirect URI yang didaftarkan ke Google adalah URL dasar aplikasi;
// saat Google mengembalikan pengguna ke URL itu dengan `code`+`state`
// di query string, SPA membaca query string tersebut dan memanggil
// aksi complete — penukaran code tetap terjadi server-side di sini.

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
export type GoogleOAuthDb = ReturnType<typeof dbOf>;

const GOOGLE_PROVIDER = "google";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_TIMEOUT_MS = 30_000;

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOAuthError";
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

export interface GoogleOAuthSettingsStatus {
  configured: boolean;
  clientId: string;
  redirectUri: string;
  secretConfigured: boolean;
  secretHint: string;
  // Bagian konfigurasi yang masih kosong, untuk pesan error jujur yang
  // menyebut langkah yang kurang (bukan pesan generik).
  missing: Array<"clientId" | "clientSecret" | "redirectUri">;
}

export async function getGoogleOAuthSettingsStatus(
  db: GoogleOAuthDb,
): Promise<GoogleOAuthSettingsStatus> {
  const rows = await db
    .select()
    .from(schema.googleOAuthSettings)
    .where(eq(schema.googleOAuthSettings.id, 1));
  const row = rows[0];
  const missing: GoogleOAuthSettingsStatus["missing"] = [];
  if (!row || !row.clientId.trim()) missing.push("clientId");
  if (!row || !row.secretCiphertext.trim()) missing.push("clientSecret");
  if (!row || !row.redirectUri.trim()) missing.push("redirectUri");
  return {
    configured: missing.length === 0,
    clientId: row?.clientId ?? "",
    redirectUri: row?.redirectUri ?? "",
    secretConfigured: !!row && row.secretCiphertext.trim() !== "",
    secretHint: row?.secretHint ?? "",
    missing,
  };
}

// Simpan kredensial Google. Mengembalikan status saja — secret utuh tidak
// pernah dikembalikan. Validasi bentuk redirect URI dilakukan di aksi
// (harus https, kecuali localhost untuk pengembangan lokal).
export async function setGoogleOAuthSettings(
  db: GoogleOAuthDb,
  args: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<GoogleOAuthSettingsStatus> {
  const clientId = args.clientId.trim();
  const secret = args.clientSecret.trim();
  const redirectUri = args.redirectUri.trim();
  const ciphertext = await encryptProviderSecret(GOOGLE_PROVIDER, secret);
  const hint = `••••${secret.slice(-4)}`;
  // Verifikasi integritas internal: ciphertext harus bisa dibuka kembali
  // server-side sebelum dinyatakan tersimpan (pola yang sama seperti
  // setProviderKey DeepInfra).
  const roundtrip = await decryptProviderSecret(GOOGLE_PROVIDER, ciphertext);
  if (roundtrip !== secret) {
    throw new GoogleOAuthError(
      "Verifikasi enkripsi Client Secret Google gagal; kredensial tidak disimpan.",
    );
  }
  const existing = await db
    .select()
    .from(schema.googleOAuthSettings)
    .where(eq(schema.googleOAuthSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(schema.googleOAuthSettings).values({
      id: 1,
      clientId,
      secretCiphertext: ciphertext,
      secretHint: hint,
      redirectUri,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.googleOAuthSettings)
      .set({
        clientId,
        secretCiphertext: ciphertext,
        secretHint: hint,
        redirectUri,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleOAuthSettings.id, 1));
  }
  return getGoogleOAuthSettingsStatus(db);
}

export async function clearGoogleOAuthSettings(
  db: GoogleOAuthDb,
): Promise<void> {
  await db
    .delete(schema.googleOAuthSettings)
    .where(eq(schema.googleOAuthSettings.id, 1));
}

// Secret plaintext hanya untuk penukaran code di dalam completeGoogleOAuth
// di bawah; tidak pernah dicatat atau dikembalikan oleh fungsi lain.
async function loadGoogleOAuthSecret(
  db: GoogleOAuthDb,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.googleOAuthSettings)
    .where(eq(schema.googleOAuthSettings.id, 1));
  const row = rows[0];
  if (!row || !row.secretCiphertext) return null;
  return decryptProviderSecret(GOOGLE_PROVIDER, row.secretCiphertext);
}

// ---------------------------------------------------------------------------
// State sekali pakai
// ---------------------------------------------------------------------------

export async function createOAuthState(db: GoogleOAuthDb): Promise<string> {
  const now = Date.now();
  // Bersihkan state kedaluwarsa agar tabel tidak menumpuk.
  await db
    .delete(schema.googleOAuthStates)
    .where(lt(schema.googleOAuthStates.expiresAt, new Date(now)));
  const state = randomState();
  await db.insert(schema.googleOAuthStates).values({
    state,
    createdAt: new Date(now),
    expiresAt: new Date(now + STATE_TTL_MS),
    consumed: false,
  });
  return state;
}

// Validasi + konsumsi state dalam satu langkah: state yang lolos di sini
// langsung ditandai consumed sehingga tidak bisa dipakai dua kali, bahkan
// bila penukaran code sesudahnya gagal (code Google sendiri sekali pakai).
export async function consumeOAuthState(
  db: GoogleOAuthDb,
  state: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.googleOAuthStates)
    .where(eq(schema.googleOAuthStates.state, state));
  const row = rows[0];
  if (!row || row.consumed) return false;
  if (row.expiresAt.getTime() < Date.now()) return false;
  await db
    .update(schema.googleOAuthStates)
    .set({ consumed: true })
    .where(eq(schema.googleOAuthStates.state, state));
  return true;
}

// ---------------------------------------------------------------------------
// Alur OAuth
// ---------------------------------------------------------------------------

export function buildGoogleAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: args.state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
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

// Baca isi balasan error Google secukupnya untuk diagnosis (jenis error
// saja); body dipotong dan tidak pernah memuat secret (secret hanya ada
// di body request penukaran, bukan di respons).
async function readGoogleErrorDetail(
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
    ? `Google menjawab HTTP ${response.status} saat ${context}: ${body}`
    : `Google menjawab HTTP ${response.status} saat ${context} (tanpa isi balasan).`;
}

// Tukar authorization code menjadi token di server, lalu ambil profil.
// Melempar GoogleOAuthError bila tahap mana pun gagal — pemanggil tidak
// boleh membuat pengguna/sesi dari hasil parsial.
export async function exchangeCodeForProfile(
  db: GoogleOAuthDb,
  args: { code: string; redirectUri: string },
): Promise<GoogleProfile> {
  const status = await getGoogleOAuthSettingsStatus(db);
  if (!status.configured) {
    throw new GoogleOAuthError(
      "Login Google belum diaktifkan: kredensial Google belum lengkap di panel admin.",
    );
  }
  const secret = await loadGoogleOAuthSecret(db);
  if (!secret) {
    throw new GoogleOAuthError(
      "Login Google belum diaktifkan: Client Secret Google belum terpasang.",
    );
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: args.code,
        client_id: status.clientId,
        client_secret: secret,
        redirect_uri: args.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (e) {
    const timedOut =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    throw new GoogleOAuthError(
      timedOut
        ? "Timeout 30 detik menunggu Google saat menukar kode login."
        : "Gagal menghubungi Google saat menukar kode login (error jaringan).",
    );
  }
  if (!tokenResponse.ok) {
    throw new GoogleOAuthError(
      await readGoogleErrorDetail(tokenResponse, "menukar kode login"),
    );
  }
  let tokenPayload: unknown;
  try {
    tokenPayload = await tokenResponse.json();
  } catch {
    throw new GoogleOAuthError(
      "Respons Google saat menukar kode login bukan JSON yang valid.",
    );
  }
  const accessToken = (tokenPayload as { access_token?: unknown })
    .access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new GoogleOAuthError(
      "Google tidak mengembalikan token akses saat menukar kode login.",
    );
  }

  let userinfoResponse: Response;
  try {
    userinfoResponse = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    const timedOut =
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError";
    throw new GoogleOAuthError(
      timedOut
        ? "Timeout 30 detik menunggu Google saat mengambil profil."
        : "Gagal menghubungi Google saat mengambil profil (error jaringan).",
    );
  }
  if (!userinfoResponse.ok) {
    throw new GoogleOAuthError(
      await readGoogleErrorDetail(userinfoResponse, "mengambil profil"),
    );
  }
  let profile: unknown;
  try {
    profile = await userinfoResponse.json();
  } catch {
    throw new GoogleOAuthError(
      "Respons profil Google bukan JSON yang valid.",
    );
  }
  const p = profile as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };
  if (typeof p.sub !== "string" || p.sub === "") {
    throw new GoogleOAuthError(
      "Profil Google tidak memuat pengenal pengguna (sub).",
    );
  }
  if (typeof p.email !== "string" || !p.email.includes("@")) {
    throw new GoogleOAuthError(
      "Profil Google tidak memuat email yang valid.",
    );
  }
  return {
    sub: p.sub,
    email: p.email.trim().toLowerCase(),
    emailVerified: p.email_verified === true,
    name:
      typeof p.name === "string" && p.name.trim() !== ""
        ? p.name.trim()
        : p.email.split("@")[0] ?? "Pengguna Google",
  };
}
