# Dadiweb Staging G12 — model folder file per proyek (file fisik)

Paket code-only ini adalah salinan prototipe terkini pasca-submit G12
(2 Nov 2026), diadaptasi ke server Bun mandiri persis seperti paket
staging-g11, PLUS materialisasi file fisik di staging (ini yang
membedakan G12 staging dari prototipe, di mana folder hanya logis).

Isinya: seluruh aksi prototipe, katalog **30 skill**, isolasi G2,
panel Admin lengkap, tarif dinamis, Deploy Center, domain, Android
Builder, integrasi, komunitas, chat perencana G6/G7, OAuth Google G8,
OAuth GitHub G9, Cloudflare G10, lookup slug duplikat G11, **plus**:

- **G12 — Renderer statis tunggal**: `server/src/site-render.ts`
  (spec -> HTML lengkap, desain kanonik Preview: header latar
  primary, pill CTA accent di header, hero tengah + "Pelajari Dulu",
  kartu Fitur ikon huruf, footer gelap sections; semua string
  di-escape, warna divalidasi hex, tanpa script/DB/fetch/secret).
  Panel Preview + modal Tinjau Preview dan situs publik di client
  kini sama-sama `<iframe srcDoc>` dari aksi baru itu — bukan lagi
  dua komponen React berbeda (PublicSiteView lama dihapus dari
  jalur situs; `SitePreview` di `lib.tsx` hanya tersisa sebagai
  thumbnail compact di tab Preview Editor, dengan alasan tercatat).
- **G12 — Snapshot deploy**: migrasi **0020**
  (`deployments.site_snapshot_spec`). Deploy/redeploy merekam spec
  saat itu; rollback (pemilik + admin) kembali ke snapshot target.
  **Perubahan perilaku yang disengaja**: edit setelah deploy tidak
  mengubah situs live sampai redeploy. Pengecualian jujur: deployment
  pra-G12 snapshot-nya kosong, jadi sampai redeploy berikutnya situs
  publiknya masih memakai spec terkini (flag `snapshot:false` di
  aksi `getPublicSiteHtml`).
- **G12 — Aksi baru**: `buildSiteFiles` (pemilik/admin, idempotent,
  tanpa kredit, tanpa tulis DB — HTML working copy) dan
  `getPublicSiteHtml` (tanpa token, tanpa data pemilik — HTML dari
  snapshot deployment live, lewat resolver bersama G11: iterasi
  semua proyek berslug sama, deployment live terbaru, spec valid).
  `getPublicSite` lama dipertahankan untuk kompatibilitas lewat
  resolver yang sama.
- **G12 — File fisik di staging** (baru di paket ini, bukan di
  prototipe): `scripts/materialize-site-files.ts` + serving statis
  di `server/index.ts` (lihat bawah). Client/dist di paket ini
  **sudah di-rebuild dari client/src G12** (bundle baru
  `index-h7a9yxqr.js`, mengandung `getPublicSiteHtml` /
  `buildSiteFiles` / "Tinjau Preview"; bundle lama g11
  `index-rt9xyw64.js` TIDAK dipakai).

## ⚠️ PERINGATAN DEPLOY — BACA DULU, JANGAN DILEWAT

**DEPLOY PAKET INI HARUS MEMPERTAHANKAN, DI SERVER:**
1. `/var/www/dadiweb/app.db` + `app.db-wal` + `app.db-shm`
   (database staging yang hidup: kunci DeepInfra, settings OAuth/
   Cloudflare, data staging). **JANGAN menimpa/menghapusnya.**
   Paket ini TIDAK membawa `app.db`, `-wal`, `-shm`,
   `app.test.db*`, maupun `node_modules`.
2. **`/var/www/dadiweb/site-files/` — folder file situs fisik G12.**
   Ini sama pentingnya dengan set WAL: bila folder ini ikut
   terhapus saat swap code, situs publik file-fisik hilang walau
   database utuh, dan harus dimaterialisasi ulang (lihat bawah).
   Cadangkan folder ini bersama cadangan code lama
   (`/var/www/dadiweb-lama-<tanggal>-g12/`), lalu pulihkan ke
   folder live baru sebelum service di-start ulang.

## ⚠️ LANGKAH MIGRASI — WAJIB, KARENA SERVER TIDAK AUTO-MIGRATE

Server staging hanya membuka `app.db` tanpa menjalankan migrasi
apa pun. Migrasi **BARU di paket ini adalah 0020 saja**
(`ALTER TABLE deployments ADD COLUMN site_snapshot_spec`).
PM WAJIB menerapkannya secara manual, dalam keadaan service
**BERHENTI**, sebelum service di-start ulang (lewat Bun
`bun:sqlite`, seperti prosedur migrasi sebelumnya; server tidak
punya CLI `sqlite3`). Migrasi 0001–0019 sudah ada di `app.db`
staging dan tidak perlu diterapkan ulang (0018 idempotent).

Setelah menerapkan 0020, verifikasi kolomnya ada:
`site_snapshot_spec` di tabel `deployments` (default `''` untuk
baris lama = deployment pra-G12).

## ⚠️ MATERIALISASI FILE FISIK — WAJIB SETELAH SWAP CODE

Setelah swap code + migrasi 0020 + `bun install` + service
di-start ulang, jalankan (di server, di folder live):

```sh
cd /var/www/dadiweb
bun ./scripts/materialize-site-files.ts
```

Skrip ini membaca `app.db` **read-only** (tidak pernah menulis
DB, tidak memakai secret apa pun) dan menulis:

- Working copy: `site-files/<slug>/index.html` — dari spec
  terkini. **BUKAN versi publik**; server tidak pernah
  melayaninya secara publik (permintaan langsung ke working
  copy dijawab 404 eksplisit).
- Snapshot live: `site-files/<slug>/snapshots/<deploymentId>/index.html`
  — dari spec efektif deployment live (snapshot bila ada dan
  valid, atau spec terkini bila snapshot pra-G12 kosong, dengan
  label `snapshot:false` di ringkasan skrip). Slug draft tanpa
  deployment live TIDAK dibuatkan snapshot. Slug tidak valid
  (path-guard `[a-z0-9-]`, maks 100) dilewati; tidak ada
  traversal direktori.

Skrip mencetak ringkasan JSON (working, snapshots dengan flag
snapshot, skippedDraft, skippedInvalid). Bila sebuah situs
publik file-fisik menjawab 404 "belum dimaterialisasi", itu
artinya skrip belum dijalankan setelah deploy/rollback terakhir
— jalankan skrip, jangan mengubah kode.

### Serving statis snapshot (sudah di `server/index.ts` paket ini)

- Route: `GET /site-files/<slug>/snapshots/<id>/index.html`
  **hanya** untuk snapshot yang deployment-nya saat ini
  berstatus `live` untuk slug itu di DB (dicek di setiap
  request — file basi dari deployment yang sudah
  superseded/rollback tidak tayang walau masih ada di disk).
- Route ini **tidak** melayani working copy, tidak membocorkan
  data pemilik, dan tidak mengubah serving aplikasi utama,
  `POST /actions`, maupun vhost Apache yang sudah ada.
- Jalur situs publik lewat aplikasi (hostname subdomain /
  `?site=<slug>` -> iframe dari aksi `getPublicSiteHtml`) tetap
  jalan seperti di prototipe; route file-fisik ini adalah jalur
  tambahan yang membuktikan folder file benar-benar ada dan
  dilayani sebagai file statis, sesuai persetujuan staging G12.

## ⛔ BATAS JUJUR — SINKRONISASI FILE MASIH SCRIPT-DRIVEN

**Sinkronisasi file di staging ini BELUM otomatis di setiap
deploy/redeploy/rollback.** Aksi deploy di `actions.ts` merekam
snapshot spec ke DB (itu otomatis), tetapi file fisik di
`site-files/` baru diperbarui saat PM menjalankan skrip
materialisasi. Jadi prosedur baku staging G12 adalah:

1. Swap code (pertahankan WAL + `site-files/`) + migrasi 0020
   (hanya saat pertama kali G12).
2. Jalankan skrip materialisasi (lihat atas).
3. **Setelah setiap deploy / redeploy / rollback di staging
   yang berhasil, jalankan lagi skrip materialisasi** sebelum
   menyatakan situs publik sudah berubah — sampai ada
   gelombang berikutnya yang mengotomatisasi langkah ini di
   dalam handler deploy.
4. Verifikasi: `GET` file snapshot live 200 dengan headline
   snapshot (bukan headline edit setelah deploy), dan aksi
   `getPublicSiteHtml` mengembalikan HTML yang sama.

Batas lain yang tetap berlaku (bukan bagian G12):
- Dari file HTML statis, formulir yang benar-benar mengirim,
  database CRUD, login, dan integrasi **tidak berjalan** — file
  hanya menampilkan konten/seksi situs. Fungsi dinamis tetap
  lewat aplikasi Dadiweb (aksi API).
- Situs statis tidak merender blok per-section dan nav anchor
  (milik renderer lama yang dihapus); sections hanya di footer
  gelap, persis seperti Preview kanonik.
- **HTTPS subdomain tetap terpisah**: mode record Cloudflare
  saat ini `dns_only` + vhost wildcard hanya HTTP; perlu mode
  proxied atau sertifikat wildcard DNS-01 (langkah terpisah).
- DOKU, email asli, dan biner APK/AAB final tetap simulasi
  berlabel, sama seperti prototipe.

## Yang TIDAK berubah di G12

Pipeline AI 5 tahap, skill (30), tarif (generate 300, deploy 25,
chat 5, Android 150), OAuth Google/GitHub, DNS Cloudflare, dan
aksi lain — kecuali yang disebut di atas. Tidak ada secret /
kunci / token di paket ini (diverifikasi dengan grep: 0 pola
secret di luar komentar shim yang menyebut nama modul SDK lama).
Semua kredensial tetap dipasang Eka lewat panel admin di
`https://dadiweb.id/#/admin` setelah deploy, bukan lewat file/chat.

## Yang berbeda dari prototipe Muse (sama seperti paket g11)

- Server Bun mandiri (`server/index.ts`) menyajikan
  `client/dist/` dan menangani `POST /actions` dengan
  mendispatch ke `Actions` yang sama. Tanpa dependensi runtime
  Muse: impor `@hatch/space-sdk` di server diganti ke shim lokal
  `server/src/sdk-shim.ts` (hanya di paket ini, prototipe tidak
  diubah); impor `@hatch/space-sdk/client` di client diganti ke
  `client/src/local-sdk.ts`.
- Build client staging memakai `client/build.mjs` khusus staging
  — bundle di paket ini **sudah di-rebuild dari source G12**,
  jadi PM tidak perlu build ulang kecuali client diubah lagi.
- `ctx.inference.complete` di shim tetap penjaga jalur-mati
  (melempar error bila dipanggil); pipeline AI berjalan lewat
  DeepInfra di `server/src/ai-provider.ts`, tanpa intersepsi di
  `server/index.ts`.
- Tanpa intersepsi generate/chat/deploy: semua aksi diteruskan
  ke handler aslinya, termasuk `generateWebsite`,
  `iterateProject`, `sendChatMessage`, `deployProject`, dan
  aksi OAuth/Cloudflare baru.

## Prasyarat & cara menjalankan (persis seperti g11)

- Bun 1.3.10+ (diuji 1.4.4 di Linux), Linux, SQLite lokal
  (`app.db`). Port lewat `PORT` (staging live: **3002**, karena
  3000 dipakai aplikasi lain; service mengikat `HOST=127.0.0.1`
  dan Apache mem-proxy diam-diam dari `dadiweb.id`/`www`).

```sh
cd /var/www/dadiweb
# 1. Cadangkan folder lama (termasuk set WAL lengkap + site-files/)
# 2. Ganti isi folder KECUALI app.db + app.db-wal + app.db-shm + site-files/
# 3. Terapkan migrasi 0020 manual (service berhenti)
# 4. Jalankan skrip materialisasi (lihat atas)
bun install
PORT=3002 HOST=127.0.0.1 bun run start
```

Lalu verifikasi (PM): GET publik 200, aksi `getPublicSiteHtml`
/ `buildSiteFiles` sudah dikenal (bukan "Action tidak
dikenal"), baseline staging tidak berubah, file snapshot live
200, dan — setelah kredensial terpasang — uji login
Google/GitHub sungguhan dan uji deploy subdomain sungguhan
(termasuk alur deploy -> edit -> publik tetap snapshot lama ->
redeploy -> berubah -> rollback -> kembali, yang belum bisa
dibuktikan di prototipe karena settings Cloudflare prototipe
kosong).
