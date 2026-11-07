// Server staging Dadiweb G13 (Bun) — paket pasca-G12 (G13 video fal.ai:
// provider + setting admin, job video + proyek, UI pill Coder/Video,
// kredit video rumus terkunci). Staging glue dari paket G12 dipertahankan
// (server/index.ts + sdk-shim.ts + package.json dengan "start"),
// DITAMBAH G13: ctx.blobs disk-lokal (sdk-shim.ts) + route GET /blobs/*
// (di bawah) agar MP4 video bisa disimpan dan diputar di staging.
// Prototipe TIDAK diubah: server/src/*.ts disalin verbatim kecuali impor
// "@hatch/space-sdk" yang diganti "./sdk-shim" (pola paket G12).
//
// G12 di paket ini: scripts/materialize-site-files.ts menulis file fisik, dan route /site-files/<slug>/snapshots/
// <deploymentId>/index.html di bawah melayani HANYA snapshot deployment live (DB-gated). Migrasi BARU: 0020
// (deployments.site_snapshot_spec) — WAJIB diterapkan manual PM, server tidak auto-migrate. Folder site-files/
// WAJIB dipertahankan saat swap code, seperti set WAL (lihat README paket G12).
//
// Menjalankan prototipe Dadiweb terkini tanpa runtime Muse:
//  - menyajikan hasil build client dari `client/dist/`
//  - menangani POST /actions dengan mendispatch ke `Actions` yang sama
//    persis dengan prototipe (server/src/actions.ts tidak diubah, kecuali
//    impor SDK-nya yang diganti `server/src/sdk-shim.ts`)
//  - konteks handler: drizzle + bun:sqlite di atas `app.db` di root proyek
//    (ATAU path dari env DADIWEB_DB — dipakai untuk pengujian lokal
//    dengan DB uji terpisah)
//
// GENERATE — TIDAK ADA INTERSEPSI DI SINI (beda dari paket staging
// sebelumnya):
// `generateWebsite` DITERUSKAN ke handler aslinya persis seperti
// prototipe, tanpa cabang khusus apa pun di `dispatch` di bawah.
// Sama halnya `sendChatMessage` (G7: klasifikasi sapaan/tanya/diskusi
// lewat responder dengan tarif 5 kredit per balasan assistant, batas
// MAKSIMAL 2 putaran pertanyaan detail lalu build otomatis dari planner
// MD, ganti nama proyek otomatis dari nama usaha yang dinyatakan,
// build lewat pipeline spesialis 300 kredit bila sukses) dan
// `iterateProject` — semuanya lewat handler asli, tanpa intersepsi.
// Keputusannya ada di handler itu sendiri:
//  - bila kunci DeepInfra belum terpasang -> handler mengembalikan stub
//    jujur `ok:false`, `routeStatus: "ai_not_active"`, tanpa proyek baru
//    dan tanpa potongan kredit (plus satu baris `ai_usage_log`
//    berstatus `kunci_belum_terpasang` — bukti jalurnya lewat handler);
//  - bila kunci terpasang -> handler menjalankan pipeline DeepInfra
//    sungguhan (Planner/Designer/Coder/Fixer + Builder Executor),
//    persis seperti prototipe pasca-perbaikan G5-D (timeout per tahap,
//    payload sadar-model, pencatatan isi balasan error).
//
// PERINGATAN DEPLOY — BACA README: deploy paket ini ke server staging
// HARUS MEMPERTAHANKAN `/var/www/dadiweb/app.db` + `app.db-wal` +
// `app.db-shm` yang sudah ada di server (kunci DeepInfra + data staging;
// server memakai WAL sehingga kunci bisa masih berada di file -wal yang
// belum ter-checkpoint). Paket ini TIDAK membawa `app.db`; hanya kode,
// client, skills, dan migrasi yang diganti. WAJIB: terapkan
// `drizzle/0016_g8_google_oauth.sql, 0017_g9_github_oauth.sql, 0018_suffix_deploy_dadiweb_id.sql, 0019_g10_cloudflare.sql` ke app.db staging dalam
// keadaan service berhenti sebelum service di-start ulang, karena server
// staging TIDAK auto-migrate (0014 sudah diterapkan di deploy G6;
// tidak ada migrasi terpisah untuk kind ledger "chat" karena kolom kind
// di SQLite tidak memakai CHECK constraint — dibuktikan di README).
//
// Jalankan di server:  bun install && bun run start
// Lalu buka: http://IP-SERVER:3000  (port bisa diubah lewat env PORT;
// secara default server mengikat 0.0.0.0 agar bisa diakses dari luar
// mesin itu — atur HOST=127.0.0.1 bila hanya ingin akses lokal.)

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { join, resolve, sep } from "node:path";
import { Actions } from "./src/actions";
import * as schema from "./src/schema";
import { createLocalBlobStore, type Ctx } from "./src/sdk-shim";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "client", "dist");
const DB_PATH =
  process.env.DADIWEB_DB ?? join(ROOT, "app.db");
// G12 — folder file situs fisik (lihat scripts/materialize-site-files.ts).
// WAJIB dipertahankan saat swap code, seperti set WAL (lihat README).
const SITE_FILES_ROOT =
  process.env.SITE_FILES_ROOT ?? join(ROOT, "site-files");
// G13 — file MP4 video (lihat server/src/video-jobs.ts: playbackUrl
// "./blobs/..."). Folder blobs/ adalah data runtime seperti site-files/ —
// dipertahankan saat swap code, JANGAN ikut paket.
const BLOBS_ROOT = process.env.BLOBS_ROOT ?? join(ROOT, "blobs");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite, { schema });

const ctx: Ctx = {
  db: () => db as never,
  inference: {
    complete: async () => {
      // Penjaga jalur-mati (BUKAN stub generate): tidak ada aksi di
      // actions.ts saat ini yang memanggil ctx.inference — pipeline AI
      // berjalan lewat klien DeepInfra di server/src/ai-provider.ts.
      // Bila suatu jalur tak terduga memanggilnya, gagal dengan jujur
      // daripada berpura-pura sukses.
      throw new Error(
        "ctx.inference tidak tersedia di server staging; pipeline AI " +
          "berjalan lewat klien DeepInfra (server/src/ai-provider.ts).",
      );
    },
  },
  invalidateQueries: () => {
    // No-op di staging: client me-refresh lewat react-query-nya sendiri.
  },
  // G13 — penyimpanan file MP4 video (disk lokal, lihat sdk-shim.ts).
  blobs: createLocalBlobStore(BLOBS_ROOT),
};

async function dispatch(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // TIDAK ADA cabang khusus untuk generateWebsite di sini: semua aksi,
  // termasuk generateWebsite, diteruskan ke handler aslinya.
  const action = (Actions as Record<string, any>)[name];
  if (!action || typeof action.handler !== "function") {
    throw new Error(`Action tidak dikenal: ${name}`);
  }
  const parsed = action.request.parse(args ?? {});
  return await action.handler(ctx, parsed);
}

// G12 — serving file situs fisik, HANYA snapshot deployment live.
// Route ini TIDAK PERNAH melayani working copy (site-files/<slug>/
// index.html) secara publik: working copy berubah tiap edit spec dan
// hanya untuk referensi internal. Yang boleh dilayani publik adalah
// site-files/<slug>/snapshots/<deploymentId>/index.html, DAN hanya bila
// deployment itu saat ini berstatus "live" untuk slug itu di DB
// (pengecekan DB di setiap request, jadi file basi dari deployment
// yang sudah superseded/rollback tidak akan tayang walau masih ada
// di disk). Bila file snapshot belum dimaterialisasi (skrip belum
// dijalankan setelah deploy/rollback), jawab 404 jujur — jangan
// fallback diam-diam ke renderer aksi, supaya PM tahu skripnya
// belum dijalankan. Tanpa data pemilik, tanpa token, tanpa traversal:
// pola regex di bawah hanya menerima slug [a-z0-9-] dan id numerik.
async function serveSiteSnapshot(urlPath: string): Promise<Response | null> {
  const clean = decodeURIComponent(urlPath).split("?")[0];
  // Working copy yang diminta langsung: tolak eksplisit (jangan jatuh
  // ke fallback SPA aplikasi, supaya tidak dikira situs publik).
  if (/^\/site-files\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/index\.html$/.test(clean)) {
    return new Response(
      "Working copy proyek tidak dilayani publik — hanya snapshot deployment live yang dilayani di /site-files/<slug>/snapshots/<id>/index.html.",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  const m = /^\/site-files\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/snapshots\/(\d+)\/index\.html$/.exec(clean);
  if (!m) return null;
  const slug = m[1]!;
  const deploymentId = Number(m[2]);
  const row = sqlite
    .query(
      "SELECT d.id FROM deployments d JOIN projects p ON p.id = d.project_id " +
        "WHERE d.id = ? AND d.status = 'live' AND p.slug = ?",
    )
    .get(deploymentId, slug) as { id: number } | null;
  if (!row) {
    return new Response("Situs tidak ditemukan atau belum diterbitkan.", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const candidate = resolve(SITE_FILES_ROOT, slug, "snapshots", String(deploymentId), "index.html");
  if (candidate !== SITE_FILES_ROOT && !candidate.startsWith(SITE_FILES_ROOT + sep)) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(candidate);
  if (!(await file.exists())) {
    return new Response(
      "Situs belum dimaterialisasi — jalankan scripts/materialize-site-files.ts di server staging, lalu muat ulang.",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  return new Response(file, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// G13 — melayani file MP4 video dari blobs/ (disk lokal, ditulis
// ctx.blobs saat job video selesai). HANYA pola
// video-files/<slug>/<id>.mp4 yang dilayani; pola lain (termasuk
// traversal) dijawab 404. File yang belum ada dijawab 404 jujur —
// jangan fallback ke SPA, supaya client tidak mengira video ada.
async function serveBlobs(urlPath: string): Promise<Response | null> {
  const clean = decodeURIComponent(urlPath).split("?")[0];
  if (!clean.startsWith("/blobs/")) return null;
  const key = clean.slice("/blobs/".length);
  if (!/^video-files\/[a-z0-9-]+\/\d+\.mp4$/.test(key)) {
    return new Response("Not found", { status: 404 });
  }
  const candidate = resolve(BLOBS_ROOT, key);
  if (candidate !== BLOBS_ROOT && !candidate.startsWith(BLOBS_ROOT + sep)) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(candidate);
  if (!(await file.exists())) {
    return new Response("Video belum tersedia.", { status: 404 });
  }
  return new Response(file, {
    headers: {
      "content-type": "video/mp4",
      "cache-control": "private, max-age=3600",
    },
  });
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot) : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function serveStatic(urlPath: string): Promise<Response | null> {
  const clean = decodeURIComponent(urlPath).split("?")[0];
  const rel = clean.replace(/^\//, "");
  const candidate = resolve(DIST, rel === "" ? "index.html" : rel);
  // Cegah path traversal keluar dari client/dist.
  if (candidate !== DIST && !candidate.startsWith(DIST + sep)) {
    return new Response("Not found", { status: 404 });
  }
  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "content-type": contentTypeFor(candidate) },
    });
  }
  // Fallback SPA: halaman lain dilayani index.html (aplikasi satu halaman).
  const index = Bun.file(join(DIST, "index.html"));
  if (await index.exists()) {
    return new Response(index, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return null;
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/actions") {
      try {
        const body = (await req.json()) as {
          action?: unknown;
          args?: Record<string, unknown>;
        };
        if (typeof body.action !== "string" || body.action.length === 0) {
          return Response.json(
            { error: "Permintaan tidak valid: field action hilang." },
            { status: 400 },
          );
        }
        const result = await dispatch(body.action, body.args ?? {});
        return Response.json({ data: result });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Terjadi kesalahan server.";
        return Response.json({ error: message });
      }
    }
    if (url.pathname === "/actions") {
      return Response.json(
        { error: "Gunakan POST /actions dengan {action, args}." },
        { status: 405 },
      );
    }
    if (req.method === "GET") {
      // G13: file MP4 video didahulukan (pola ketat di serveBlobs) —
      // pola lain tetap jatuh ke site-files / SPA di bawah.
      const blobRes = await serveBlobs(url.pathname);
      if (blobRes) return blobRes;
      // G12: file snapshot situs fisik didahulukan atas SPA, tapi
      // hanya untuk pola snapshot live di atas — pola lain tetap
      // jatuh ke serveStatic (aplikasi utama) di bawah.
      const siteRes = await serveSiteSnapshot(url.pathname);
      if (siteRes) return siteRes;
      const res = await serveStatic(url.pathname);
      if (res) return res;
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dadiweb staging G13 berjalan di http://${HOST}:${PORT}`);
console.log(`Site files (fisik, snapshot live saja): ${SITE_FILES_ROOT}`);
console.log(`Blobs video (disk lokal, G13): ${BLOBS_ROOT}`);
console.log(`Database: ${DB_PATH}`);
console.log(
  "Generate AI: mengikuti handler asli — tanpa kunci -> stub jujur " +
    "ai_not_active; dengan kunci -> pipeline DeepInfra sungguhan.",
);
console.log(`Server: ${server.hostname}:${server.port}`);
