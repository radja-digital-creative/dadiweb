// G10 — Integrasi Cloudflare Dadiweb (server-side saja).
//
// Aturan yang ditegakkan di sini (pola persis OAuth G8/G9 + DeepInfra G5):
// - Settings disimpan di tabel cloudflare_settings (satu baris id=1).
//   Account ID & Zone ID bukan rahasia (boleh tampil penuh di panel
//   admin); API token disimpan TERENKRIPSI AES-256-GCM dengan helper
//   persis kunci DeepInfra, salt provider "cloudflare", sehingga kunci
//   turunannya berbeda dari kunci DeepInfra/OAuth. Yang keluar dari
//   modul ini hanya petunjuk 4 karakter terakhir; plaintext token hanya
//   hidup sesaat di memori server saat memanggil API Cloudflare, dan
//   tidak pernah dicatat, dikembalikan aksi, atau dikirim ke browser.
// - Pesan error dari modul ini TIDAK PERNAH memuat token, header
//   Authorization, atau respons mentah API — hanya status HTTP dan,
//   bila ada, pesan error pertama dari API Cloudflare (pesan itu tidak
//   memuat kredensial).
// - Mode record default "dns_only": sama dengan domain utama dadiweb.id
//   saat ini (DNS only, Apache yang mengakhiri TLS Let's Encrypt di
//   origin), sehingga perilaku DNS tidak berubah diam-diam dan IP
//   origin tetap eksplisit di record A. Admin boleh mengubah ke
//   "proxied" bila menginginkan SSL tepi + perlindungan Cloudflare;
//   konsekuensinya (origin tetap harus melayani HTTP/HTTPS di balik
//   proxy, dan akses HTTPS subdomain sungguhan tetap menunggu vhost
//   wildcard + SSL di staging) dicatat di laporan G10, bukan disembunyikan.
// - Uji sandbox: jalur sukses diuji dengan menambal global fetch di
//   skrip uji saja (mock di kode UJI, bukan di kode produksi ini).
//   Kode produksi ini selalu memanggil api.cloudflare.com sungguhan.

import { eq } from "drizzle-orm";
import type { Ctx } from "./sdk-shim";
import * as schema from "./schema";
import {
  decryptProviderSecret,
  encryptProviderSecret,
} from "./ai-provider";

function dbOf(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
export type CloudflareDb = ReturnType<typeof dbOf>;

const CLOUDFLARE_PROVIDER = "cloudflare";
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_TIMEOUT_MS = 30_000;
export const DEFAULT_SERVER_IP = "82.25.62.243";

export type CloudflareRecordMode = "dns_only" | "proxied";
export type CloudflareMissingField =
  | "accountId"
  | "zoneId"
  | "apiToken"
  | "serverIp";

export const CLOUDFLARE_MISSING_LABELS: Record<
  CloudflareMissingField,
  string
> = {
  accountId: "Account ID Cloudflare",
  zoneId: "Zone ID (zone dadiweb.id)",
  apiToken: "API Token Cloudflare",
  serverIp: "IP server (server_ip)",
};

export interface CloudflareSettingsStatus {
  configured: boolean;
  accountId: string;
  zoneId: string;
  serverIp: string;
  recordMode: CloudflareRecordMode;
  tokenConfigured: boolean;
  tokenHint: string;
  missing: CloudflareMissingField[];
}

export class CloudflareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareError";
  }
}

export async function getCloudflareSettingsStatus(
  db: CloudflareDb,
): Promise<CloudflareSettingsStatus> {
  const rows = await db
    .select()
    .from(schema.cloudflareSettings)
    .where(eq(schema.cloudflareSettings.id, 1));
  const row = rows[0];
  const missing: CloudflareMissingField[] = [];
  if (!row || !row.accountId.trim()) missing.push("accountId");
  if (!row || !row.zoneId.trim()) missing.push("zoneId");
  if (!row || !row.tokenCiphertext.trim()) missing.push("apiToken");
  if (!row || !row.serverIp.trim()) missing.push("serverIp");
  return {
    configured: missing.length === 0,
    accountId: row?.accountId ?? "",
    zoneId: row?.zoneId ?? "",
    serverIp: row?.serverIp ?? DEFAULT_SERVER_IP,
    recordMode: (row?.recordMode ?? "dns_only") as CloudflareRecordMode,
    tokenConfigured: !!row && row.tokenCiphertext.trim() !== "",
    tokenHint: row?.tokenHint ?? "",
    missing,
  };
}

export async function setCloudflareSettings(
  db: CloudflareDb,
  args: {
    accountId: string;
    zoneId: string;
    apiToken: string;
    serverIp: string;
    recordMode: CloudflareRecordMode;
  },
): Promise<CloudflareSettingsStatus> {
  const accountId = args.accountId.trim();
  const zoneId = args.zoneId.trim();
  const token = args.apiToken.trim();
  const serverIp = args.serverIp.trim() || DEFAULT_SERVER_IP;
  const ciphertext = await encryptProviderSecret(CLOUDFLARE_PROVIDER, token);
  const hint = `••••${token.slice(-4)}`;
  const roundtrip = await decryptProviderSecret(
    CLOUDFLARE_PROVIDER,
    ciphertext,
  );
  if (roundtrip !== token) {
    throw new CloudflareError(
      "Verifikasi enkripsi API Token Cloudflare gagal; settings tidak disimpan.",
    );
  }
  const existing = await db
    .select()
    .from(schema.cloudflareSettings)
    .where(eq(schema.cloudflareSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(schema.cloudflareSettings).values({
      id: 1,
      accountId,
      zoneId,
      tokenCiphertext: ciphertext,
      tokenHint: hint,
      serverIp,
      recordMode: args.recordMode,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(schema.cloudflareSettings)
      .set({
        accountId,
        zoneId,
        tokenCiphertext: ciphertext,
        tokenHint: hint,
        serverIp,
        recordMode: args.recordMode,
        updatedAt: new Date(),
      })
      .where(eq(schema.cloudflareSettings.id, 1));
  }
  return getCloudflareSettingsStatus(db);
}

export async function clearCloudflareSettings(
  db: CloudflareDb,
): Promise<void> {
  await db
    .delete(schema.cloudflareSettings)
    .where(eq(schema.cloudflareSettings.id, 1));
}

// Plaintext token hanya untuk pemanggilan API di dalam ensureDnsRecord;
// tidak pernah dicatat atau dikembalikan oleh fungsi lain.
async function loadCloudflareToken(
  db: CloudflareDb,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(schema.cloudflareSettings)
    .where(eq(schema.cloudflareSettings.id, 1));
  const row = rows[0];
  if (!row || !row.tokenCiphertext) return null;
  return decryptProviderSecret(CLOUDFLARE_PROVIDER, row.tokenCiphertext);
}

export async function loadCloudflareSettingsForDeploy(
  db: CloudflareDb,
): Promise<
  | { ok: true; status: CloudflareSettingsStatus; token: string }
  | { ok: false; status: CloudflareSettingsStatus; token: null }
> {
  const status = await getCloudflareSettingsStatus(db);
  if (!status.configured) return { ok: false, status, token: null };
  const token = await loadCloudflareToken(db);
  if (!token) return { ok: false, status, token: null };
  return { ok: true, status, token };
}

// ---------------------------------------------------------------------------
// API Cloudflare — DNS records
// ---------------------------------------------------------------------------

interface CloudflareApiResult {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
}

async function cloudflareFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; result: unknown; apiMessage: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS);
  try {
    const res = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    const errors = Array.isArray(json.errors) ? json.errors : [];
    const first = errors[0] as { message?: unknown } | undefined;
    const apiMessage =
      typeof first?.message === "string" ? first.message : "";
    return {
      ok: res.ok && json.success === true,
      status: res.status,
      result: json.result ?? null,
      apiMessage,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new CloudflareError(
        "API Cloudflare tidak merespons dalam 30 detik — deploy dibatalkan, tidak ada kredit terpotong.",
      );
    }
    throw new CloudflareError(
      "Tidak dapat menghubungi API Cloudflare — deploy dibatalkan, tidak ada kredit terpotong.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function toApiError(status: number, apiMessage: string): CloudflareError {
  const detail = apiMessage ? ` (${apiMessage})` : "";
  return new CloudflareError(
    `Cloudflare menolak permintaan DNS (HTTP ${status})${detail} — deploy dibatalkan, tidak ada kredit terpotong. Periksa Zone ID dan izin token (DNS:Edit untuk zone dadiweb.id), lalu coba lagi.`,
  );
}

// Buat atau pakai kembali record A untuk satu subdomain.
// - Bila record A dengan nama yang sama sudah ada: UPDATE isinya ke
//   server_ip + mode yang berlaku, kembalikan id yang sama (reused).
// - Bila belum ada: POST record baru.
// Mengembalikan record_id + apakah record dipakai ulang. Melempar
// CloudflareError (pesan bersih, tanpa token) bila API gagal.
export async function ensureDnsRecord(args: {
  token: string;
  zoneId: string;
  name: string;
  content: string;
  proxied: boolean;
}): Promise<{ recordId: string; reused: boolean }> {
  const zone = encodeURIComponent(args.zoneId);
  const list = await cloudflareFetch(
    args.token,
    `/zones/${zone}/dns_records?name=${encodeURIComponent(args.name)}&type=A&per_page=10`,
  );
  if (!list.ok) throw toApiError(list.status, list.apiMessage);
  const existing = Array.isArray(list.result)
    ? (list.result as CloudflareApiResult[]).find((r) => r.name === args.name)
    : undefined;
  if (existing) {
    const updated = await cloudflareFetch(args.token, `/zones/${zone}/dns_records/${encodeURIComponent(existing.id)}`, {
      method: "PUT",
      body: {
        type: "A",
        name: args.name,
        content: args.content,
        proxied: args.proxied,
        ttl: 1,
      },
    });
    if (!updated.ok) throw toApiError(updated.status, updated.apiMessage);
    return { recordId: existing.id, reused: true };
  }
  const created = await cloudflareFetch(args.token, `/zones/${zone}/dns_records`, {
    method: "POST",
    body: {
      type: "A",
      name: args.name,
      content: args.content,
      proxied: args.proxied,
      ttl: 1,
    },
  });
  if (!created.ok) throw toApiError(created.status, created.apiMessage);
  const result = created.result as CloudflareApiResult | null;
  if (!result?.id) {
    throw new CloudflareError(
      "Cloudflare tidak mengembalikan ID record DNS — deploy dibatalkan, tidak ada kredit terpotong.",
    );
  }
  return { recordId: result.id, reused: false };
}
