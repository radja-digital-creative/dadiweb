# Panduan Kolaborasi Dadiweb

Repo ini privat. Jangan dijadikan publik, jangan di-fork ke akun
publik, dan jangan membagikan isinya ke luar tim tanpa izin
pengelola repo.

## 1. Gambaran singkat

- **Produk:** Dadiweb, platform Website & App Builder with AI —
  pengguna mengetik prompt, AI membuat website/aplikasi/sistem bisnis.
- **Stack:** Bun 1.4.4, TypeScript, React, SQLite lokal (`app.db`).
- **Server:** `server/index.ts` menyajikan `client/dist/` dan menangani
  `POST /actions` (semua aksi aplikasi ada di `server/src/actions.ts`).
- **Client:** `client/src/` (React). Perubahan di `client/src/` wajib
  diikuti rebuild: `bun run build` (hasilnya di `client/dist/`).
- **Skill AI:** `skills/` (30 skill, format SKILL.md).
- **Migrasi DB:** `drizzle/0001–0020` (terakhir: 0020, snapshot deploy G12).
- **Situs proyek (G12):** satu renderer statis tunggal
  (`server/src/site-render.ts`) spec → HTML, folder file per proyek
  di `site-files/` (di-generate server, tidak ikut repo),
  deploy membuat snapshot, rollback kembali ke snapshot lama.
- **Staging:** https://dadiweb.id (service `dadiweb-staging`,
  port internal 3002, Apache mem-proxy domain ke sana).
- **Branch utama:** `main`. Setiap merge ke `main` memicu auto-deploy
  ke staging (lihat bagian 4).

## 2. Cara kerja lokal

```sh
git clone https://github.com/radja-digital-creative/dadiweb.git
cd dadiweb
bun install
bun run typecheck
PORT=3002 HOST=127.0.0.1 bun run start
```

- Database lokal dibuat sendiri saat pertama jalan. Jangan pernah
  memakai `app.db` dari server staging di mesin lokal.
- Jangan pernah meng-commit `app.db`, `app.db-wal`, `app.db-shm`,
  `node_modules/`, atau `site-files/` — semuanya sudah di-`.gitignore`.
- Jangan pernah meng-commit secret apa pun: token, kunci API, password,
  Client Secret OAuth, token Cloudflare, private key SSH, dan sejenisnya.
  Semua kredensial dipasang lewat panel admin Dadiweb
  (`https://dadiweb.id/#/admin`), bukan lewat file, chat, atau commit.
- Kalau secret tidak sengaja ter-commit, segera kabari pengelola repo.
  Menghapus commit saja tidak cukup, karena history Git tetap
  menyimpannya sampai di-rewrite.

## 3. Alur kerja yang seharusnya dan wajib

Alur ini wajib diikuti oleh semua kontributor, tanpa pengecualian
kecuali disepakati bersama pengelola repo:

1. **Wajib** bekerja di branch, misal `fix/nama-perbaikan` atau
   `feat/nama-fitur`. Jangan commit langsung ke `main`.
2. **Wajib** mengubah kode seperlunya saja. Tarif (generate 300,
   deploy 25, chat 5, Android 150), skill, OAuth, dan DNS Cloudflare
   tidak boleh diubah tanpa diskusi dulu dengan pengelola repo.
3. **Wajib** menjalankan `bun run typecheck` sebelum push.
   Kalau mengubah client, **wajib** juga menjalankan `bun run build`
   dan meng-commit hasil `client/dist/`-nya.
4. **Wajib** push branch dan buat Pull Request (PR) ke `main`,
   dengan isi PR: apa yang diubah, kenapa diubah, dan bagaimana
   cara mengujinya.
5. **Wajib** menunggu review dan persetujuan sebelum merge.
   Yang me-merge adalah pengelola repo (atau reviewer yang ditunjuk).
6. **Wajib** memeriksa `git status` sebelum commit: tidak ada
   `app.db`, secret, token, atau `site-files/` yang ikut ter-commit.

Merge ke `main` = deploy ke staging. Jadi PR yang di-merge harus
sudah benar-benar siap deploy, bukan sekadar "sudah bisa jalan
di lokal".

## 4. Auto-deploy ke staging pakai workflow

Auto-deploy berjalan lewat workflow GitHub Actions
`.github/workflows/deploy-staging.yml`, dengan pemicu:

- Push ke branch `main`, atau
- Jalankan manual dari tab Actions → Deploy Staging → Run workflow.

Urutan yang dijalankan workflow (user SSH khusus deploy
`github-deploy`, bukan akun utama server):

```sh
# 1. Hentikan service: sudo systemctl stop dadiweb-staging
#    (user deploy hanya boleh sudo untuk perintah systemctl
#    stop/start/restart/status service ini saja)
# 2. Cadangkan folder live ke /var/www/dadiweb-lama-<waktu>-auto/
#    (termasuk app.db set + site-files/)
# 3. git pull --ff-only (hanya kode; app.db dan site-files/
#    tidak ikut repo, jadi tidak tertimpa)
# 4. bun install
# 5. Start service: sudo systemctl start dadiweb-staging
#    (kalau ada langkah yang gagal, service tetap di-start ulang
#    lewat trap, supaya staging tidak tertinggal dalam keadaan mati)
# 6. bun ./scripts/materialize-site-files.ts
#    (WAJIB setelah deploy/rollback — sinkronisasi file fisik
#    di staging masih script-driven, bukan otomatis)
# 7. Verifikasi: GET http://127.0.0.1:3002/ 200,
#    GET https://dadiweb.id/ 200, dan situs publik proyek live
#    mengembalikan HTML yang sama dengan file snapshot-nya.
```

Secrets yang dipakai workflow (`VPS_HOST`, `VPS_USER`, `VPS_PORT`,
`VPS_SSH_KEY`) sudah tersimpan di GitHub Secrets repo dan tidak
boleh ditulis di file, chat, atau PR mana pun.

**Migrasi database tidak auto-apply.** Kalau PR membawa file
`drizzle/` baru, deploy berhenti di tangan pengelola: migrasi
baru itu diterapkan manual saat service berhenti, baru service
di-start ulang. Jangan memaksa migrasi jalan otomatis di workflow.

## 5. Hal-hal yang harus diperhatikan

- **Database dan file situs staging tidak boleh tertimpa.**
  Jangan pernah menimpa/menghapus `app.db`, `app.db-wal`,
  `app.db-shm`, atau `site-files/` di server staging, baik lewat
  deploy, script, maupun perintah manual.
- **Repo privat, history bersih.** Jangan mempublikasikan repo,
  jangan membagikan token/key, dan jangan meng-commit hasil
  generate (`site-files/`) atau cache (`.bun-cache/`).
- **Deploy kode tidak memotong kredit** dan tidak mengubah saldo
  pengguna. Deploy kode juga tidak mengubah settings
  OAuth/Cloudflare/DOKU/email.
- **Ini hanya staging, bukan produksi.** Workflow ini hanya
  men-deploy ke `dadiweb.id` (staging). Tidak ada deploy produksi
  otomatis dari repo ini.
- **Fitur dinamis dari file statis terbatas.** Dari file HTML
  statis G12, formulir yang benar-benar mengirim, CRUD database,
  login, dan integrasi tidak berjalan — hanya tampilannya.
  Fungsi dinamis tetap lewat aksi aplikasi Dadiweb.
- **HTTPS subdomain masih pekerjaan terpisah.** Mode record
  Cloudflare saat ini `dns_only` + vhost wildcard HTTP saja.
- **Uji snapshot G12 tidak otomatis.** Alur deploy → edit →
  publik tetap versi lama → redeploy → berubah → rollback →
  kembali masih diuji manual dan butuh persetujuan pengelola,
  karena butuh redeploy sungguhan (-25 kredit) + edit spec sementara.
- **Kalau staging rusak setelah deploy:** cek dulu
  `systemctl status dadiweb-staging` dan log service, lalu
  laporkan commit terakhir yang di-deploy, pesan error persisnya,
  dan jam kejadiannya. Rollback dilakukan dengan mengembalikan
  folder dari cadangan `dadiweb-lama-<waktu>-auto/` (beserta
  `app.db` set + `site-files/`-nya), start ulang, jalankan ulang
  skrip materialisasi, lalu verifikasi lagi.

## 6. Blueprint kode & rencana

Bagian ini adalah peta kode supaya kontributor baru langsung paham
desainnya (arsitektur) dan rencananya (roadmap/status), tanpa harus
membaca seluruh repo dulu.

### 6.1 Struktur direktori

```text
.
├── client/                 # Aplikasi React (halaman pengguna + admin)
│   ├── src/
│   │   ├── App.tsx         # Routing utama (#/admin terpisah)
│   │   ├── views-main.tsx, views-projects.tsx
│   │   ├── views-project-chat.tsx   # Chat proyek (kiri) + Details/Preview (kanan)
│   │   ├── views-public.tsx         # Situs publik (iframe dari file snapshot)
│   │   ├── views-admin.tsx, views-manage.tsx, views-more.tsx
│   │   ├── views-auth.tsx, lib.tsx, api.ts, theme.css
│   └── dist/               # Hasil build — WAJIB ikut ter-commit kalau client diubah
├── server/
│   ├── index.ts            # Entry: sajikan client/dist + POST /actions
│   └── src/
│       ├── actions.ts      # Semua aksi aplikasi (satu pintu /actions)
│       ├── schema.ts       # Skema Drizzle/SQLite
│       ├── ai-provider.ts  # Provider AI (DeepInfra, OpenAI-compatible)
│       ├── site-render.ts  # SATU-SATUNYA renderer spec → HTML (G12)
│       ├── cloudflare.ts   # DNS Cloudflare untuk deploy
│       ├── google-oauth.ts, github-oauth.ts
│       └── skills-content.ts
├── skills/                 # 30 skill AI (format SKILL.md, isi Bahasa Indonesia)
├── drizzle/                # Migrasi 0001–0020 (tidak auto-migrate)
├── scripts/
│   └── materialize-site-files.ts  # Generate site-files/ fisik di staging
├── site-files/             # HASIL GENERATE, tidak ikut repo
│   └── <slug>/index.html              # Working copy (bukan versi publik)
│   └── <slug>/snapshots/<deploymentId>/index.html  # Versi publik live
└── .github/workflows/deploy-staging.yml
```

### 6.2 Blueprint arsitektur (lapisan)

```text
Pengguna (browser)
  → client/dist (React)
  → POST /actions (server/index.ts)
  → server/src/actions.ts
      ├── DB SQLite (app.db) via schema.ts
      ├── AI via ai-provider.ts + skills/ (Router memilih skill dari plan)
      ├── site-render.ts (spec → HTML statis, tanpa script/DB/fetch/secret)
      ├── cloudflare.ts (DNS deploy: A record subdomain .dadiweb.id)
      └── google-oauth.ts / github-oauth.ts (login OAuth, token tidak disimpan)
```

Aturan arsitektur yang tidak boleh dilanggar:

- **Satu renderer saja.** Preview panel, modal Tinjau Preview, dan
  situs publik WAJIB memakai HTML yang sama dari `site-render.ts`.
  Jangan membuat renderer kedua di client.
- **Satu pintu aksi.** Semua logika lewat `POST /actions` +
  `actions.ts`. Jangan menambah endpoint ad-hoc di luar pola ini
  tanpa diskusi dengan pengelola repo.
- **Isolasi data.** Data per proyek terisolasi (skema per proyek,
  path-guard, cek kepemilikan). Jangan membaca/menulis data proyek
  lain, dan jangan menonaktifkan cek kepemilikan/kuota.
- **Registry skill adalah snapshot.** Setiap edit `skills/*.md`
  WAJIB diikuti sinkron ulang registry router, kalau tidak router
  tetap memakai snapshot lama.

### 6.3 Alur end-to-end (blueprint proses)

1. **Generate (300 kredit, hanya dipotong bila sukses).**
   Prompt → pipeline 5 tahap: Planner → Designer → Coder →
   Builder & Tester → Fixer → `project.spec` tersimpan.
   Komposisi kredit admin: Planner 40 + Designer 60 + Coder 120 +
   Builder 50 + Fixer 30 = 300.
2. **Chat proyek (5 kredit per balasan assistant di luar build).**
   Responder menjawab pertanyaan teknis terkait proyek dan menulis
   diskusi ke dokumen planner proyek. Sapaan membuat draft gratis
   "Proyek Kustom". Pertanyaan detail maksimal ±2 putaran lalu
   auto-build; penolakan ("tidak usah", "simple saja") langsung
   build, bukan pertanyaan lanjutan.
3. **Preview.** Panel Preview + modal Tinjau Preview adalah iframe
   ke HTML dari `site-render.ts` (mode HP ~390px / Desktop).
   Preview memakai spec terkini, bukan snapshot deploy.
4. **Deploy (25 kredit).** Urutan wajib: DNS Cloudflare dulu,
   baru status live + potong kredit. Tanpa settings/API yang
   valid, deploy gagal bersih tanpa potongan dan tanpa status
   berubah. Deploy membuat snapshot spec; edit setelah deploy
   tidak mengubah situs live sampai redeploy.
5. **Situs publik.** Hanya melayani file snapshot deployment live
   (`site-files/<slug>/snapshots/<id>/index.html`). Working copy
   yang belum live sengaja mengembalikan 404 eksplisit.
6. **Rollback (gratis).** Kembali ke snapshot deployment lama,
   lalu jalankan ulang `materialize-site-files.ts` di staging.

### 6.3a Video generation (G13) — blueprint

Fitur video Dadiweb memakai provider **fal.ai** (khusus video;
DeepInfra tetap untuk website/aplikasi). Keputusan Eka 7 Nov 2026.

- **Provider + setting admin.** Kunci fal.ai tersimpan terenkripsi
  di panel admin (seperti kunci DeepInfra), boleh kosong sampai
  Eka memasangnya. Registry model video (ID endpoint fal.ai, tipe
  T2V/I2V, maks durasi, resolusi, harga/detik) + rumus tarif
  kredit disimpan sebagai setting admin, bukan hardcode.
  File: `server/src/fal-video.ts` (klien queue fal.ai),
  `server/src/video-credits.ts` (rumus tarif).
- **Job video (async).** Submit ke `POST https://queue.fal.run/{model_id}`
  (header `Authorization: Key <FAL_KEY>`) → 202 `request_id` →
  poll status `IN_QUEUE → IN_PROGRESS → COMPLETED` (atau webhook)
  → unduh MP4 hasil dan simpan di storage proyek. JANGAN pakai
  route sync `fal.run` untuk video; jangan link langsung ke
  fal.media (URL publik, kedaluwarsa ≥7 hari). Tabel baru:
  `video_jobs` (migrasi 0021).
- **Video masuk proyek.** Daftar video per proyek (player +
  unduh), hasil video tampil di chat proyek.
- **UI.** Di atas prompt ada pill **Coder** (perilaku seperti
  sekarang, jangan diubah) dan **Video** (prompt + lampirkan gambar
  untuk image-to-video + pilih model + pilih durasi 8/16/24/30
  detik default 8 + estimasi kredit tampil sebelum generate).
- **Tarif video DIKUNCI (7 Nov 2026 ~20:59 WIB).** kredit =
  ceil(biaya API Rp / Rp54 × markup 1,5), dibulatkan ke atas
  kelipatan 5. Contoh kunci: Wan 3.0 720p 8 detik = 370 kredit.
  Lineup awal: Wan 3.0 (default) + Kling 4.0 (premium), resolusi
  default 720p. Chat dulu 5 kredit/balasan; generate video
  dipotong HANYA bila sukses. **JANGAN pakai Veo 3.1**
  (di-deprecate 17 Nov 2026) dan **JANGAN pakai Sora 2** (sudah mati).

### 6.4 Rencana (roadmap & status)

**Sudah selesai dan live di staging — ditandai [SUDAH]:**

- [SUDAH] Fase 1–3: pipeline AI, Deploy Center (redeploy/rollback),
  domain custom, Database CRUD + CSV, Admin Panel, Android
  Builder, integrasi per proyek, forum Komunitas.
- [SUDAH] G0–G4: fondasi skill, katalog 30 skill, isolasi data.
- [SUDAH] G5: provider AI DeepInfra (Planner DeepSeek-V4-Flash,
  Designer/Coder/Fixer DeepSeek-V3.2, Builder Llama-3.3-70B,
  fallback Qwen3-32B).
- [SUDAH] G6–G7: chat perencana + iterasi proyek, desain mobile-first.
- [SUDAH] G8–G9: login Google + GitHub (OAuth sungguhan, settings lewat
  panel admin, redirect/callback ke `https://dadiweb.id/`).
- [SUDAH] G10: deploy Cloudflare + situs proyek tampil.
- [SUDAH] G11: perbaikan lookup slug duplikat (deployment live terbaru
  yang menang).
- [SUDAH] G12: model folder file per proyek + snapshot deploy.

**Belum selesai — ditandai [BELUM], jangan diklaim sudah jalan:**

- [BELUM] HTTPS subdomain (masih `dns_only` + wildcard HTTP).
- [BELUM] Uji snapshot G12 end-to-end di staging (deploy → edit →
  publik tetap lama → redeploy → berubah → rollback → kembali).
- [BELUM] Uji gerbang 10 pengguna asing (G4 Bagian B) — butuh lampu hijau
  terpisah dari pengelola repo, bukan sekadar kesiapan.
- [BELUM] Kredensial go-live yang tersisa: merchant DOKU, layanan
  pengirim email, akun Google Play + keystore.
- [BELUM] Harga paket (plan) final masih keputusan pengelola repo.
  Angka dari desain awal (misal Pro Rp 299.000/bulan) hanya
  usulan awal, bukan harga final — jangan menulisnya sebagai
  harga resmi di kode, dokumen, atau UI.
- [BELUM] G13: video generation (fal.ai) — pill Coder/Video di atas
  prompt, model Wan 3.0 + Kling 4.0, durasi 8/16/24/30 detik
  default 8, tarif video terkunci (rumus Rp54 × markup 1,5),
  video masuk proyek. Gelombang: G13-A provider+setting admin,
  G13-B job video+proyek, G13-C UI, G13-D kredit+audit+staging.
  (G13-E: 32 detik via jahitan, model tambahan — perlu keputusan
  terpisah.)

### 6.5 Aturan perubahan blueprint & plan — HANYA TAMBAH, TIDAK BOLEH TIMPA

> **PERINGATAN — BENANG MERAH PROYEK.** Bagian 6 ini (blueprint
> kode + plan) adalah benang merah Dadiweb: satu-satunya jejak
> yang menghubungkan desain, kode, dan rencana dari awal sampai
> sekarang. Kalau bagian ini di-overwrite, riwayat itu putus —
> kontributor tidak bisa lagi menelusuri kenapa sebuah keputusan
> diambil, apa yang sudah selesai, dan apa yang masih menggantung,
> dan pekerjaan bisa terulang atau bertabrakan tanpa sadar.
> Karena itu aturan di bawah ini tidak boleh dilonggarkan
> dengan alasan apa pun, termasuk "merapikan" dokumen.

Aturan ini wajib dan mengikat untuk semua kontributor:

1. **Fitur baru wajib ditulis di blueprint dulu.** Sebelum atau
   bersamaan dengan PR fitur baru, tambahkan ke bagian 6:
   struktur/file yang berubah, alur prosesnya, dan aturan
   arsitektur yang berlaku untuk fitur itu.
2. **Fitur baru wajib ditambahkan ke plan (bagian 6.4).**
   Tambahkan satu baris baru dengan tanda `[BELUM]`, lalu saat
   fitur itu selesai, tambahkan catatan perubahan ber-tanggal
   di bawah baris itu (misal: "Update 3 Nov 2026: menjadi
   [SUDAH], commit xxx") — jangan menghapus baris lamanya.
3. **Tidak boleh overwrite.** Dilarang menghapus, mengganti,
   atau menimpa baris/seksi plan atau blueprint yang sudah ada,
   termasuk riwayat status lama. Yang boleh hanya **add**:
   menambah baris/seksi baru, atau menambah catatan update
   ber-tanggal di bawah item yang bersangkutan.
4. **Kalau desain berubah total, tulis versi baru.**
   Jangan timpa versi lama — tambahkan seksi baru (misal
   "v2") di bawah versi lama, dengan tanggal dan alasan
   perubahannya, supaya riwayat desain tetap bisa dibaca.
5. **PR yang menambah fitur tanpa update blueprint + plan
   wajib ditolak di review,** sampai kedua update itu
   ditambahkan.
6. **Review wajib memeriksa diff bagian 6.** Kalau diff
   menunjukkan baris lama yang dihapus/diganti (bukan sekadar
   baris baru atau catatan update ber-tanggal yang ditambahkan),
   PR itu wajib ditolak dan diminta diperbaiki, apa pun
   alasannya.

## 7. Checklist wajib sebelum deploy

Checklist ini wajib terpenuhi **sebelum merge ke `main`**
(karena merge = deploy). Kalau satu saja belum terpenuhi,
jangan merge dulu.

- [ ] `bun run typecheck` lolos.
- [ ] Kalau mengubah client, `bun run build` sudah dijalankan dan
      `client/dist/` ikut ter-commit.
- [ ] `git status` sudah diperiksa: tidak ada `app.db`, secret,
      token, private key, `site-files/`, atau `.bun-cache/` yang
      ikut ter-commit.
- [ ] PR menjelaskan apa yang diubah, kenapa diubah, dan
      bagaimana cara mengujinya.
- [ ] Tidak mengubah tarif, OAuth, DNS, atau settings tanpa
      diskusi dengan pengelola repo.
- [ ] Kalau PR membawa migrasi `drizzle/` baru, sudah dikabari
      ke pengelola repo bahwa migrasi itu harus diterapkan
      manual di staging sebelum/saat deploy.
- [ ] Review dan persetujuan PR sudah didapat.
- [ ] Setelah merge, workflow Deploy Staging dipantau sampai
      selesai (status success di tab Actions), dan staging
      diverifikasi: `https://dadiweb.id` 200, situs publik
      proyek live tampil, dan `listSkills` tetap 30.
