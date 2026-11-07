---
name: saas-platform
version: 1.0.0
family: aplikasi-android
title: SaaS Platform — Produk Berlangganan Multi-Tenant Sederhana dengan Paket, Kuota, dan Billing Dasar
triggers: [saas, platform berlangganan, multi-tenant, multitenant, tenant, paket berlangganan, kuota pengguna, billing, produk saas, aplikasi berlangganan, subscription, layanan berlangganan]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [bayar-doku, email-service, laporan-analitik]
credit_profile: standard
outputs: [daftar paket dan kuota, pendaftaran tenant, langganan dan status billing dasar, panel tenant dan admin platform, tabel plans subscriptions tenants]
---

# SaaS Platform — Produk Berlangganan Multi-Tenant Sederhana dengan Paket, Kuota, dan Billing Dasar

Skill domain family aplikasi-android (sesuai pengelompokan katalog: produk aplikasi berlangganan). Produk SaaS multi-tenant sederhana: banyak tenant (organisasi pelanggan) memakai satu produk, tiap tenant memilih paket dengan kuota, dan ada billing dasar (status langganan dan tagihan). Ini skill untuk MEMBANGUN produk SaaS milik pengguna — bukan mengubah tarif/kuota platform Dadiweb itu sendiri.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pengguna membangun produk berlangganan untuk pelanggannya sendiri: ada tenant, paket, kuota, billing.
- Prompt menyebut SaaS, multi-tenant, paket berlangganan produk, atau kuota per pelanggan.

TIDAK dipakai ketika:

- Langganan/kredit platform Dadiweb itu sendiri → wilayah platform, bukan proyek.
- Toko/marketplace tanpa model tenant berlangganan → toko-online/marketplace.

## 2. Pertanyaan penjernih

1. Paket apa saja dan kuotanya (pengguna, proyek, penyimpanan)? Default: paket diisi pemilik produk di admin; jangan mengarang harga paket sebagai harga final.
2. Masa percobaan gratis ada? Berapa lama? Default: tanpa percobaan kecuali disebut.
3. Tenant terisolasi datanya per tenant? Default WAJIB: ya, setiap data bisnis bertanda tenant_id dan ditegakkan di server.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan model tenant, paket, kuota, dan status langganan baku.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang halaman paket publik, pendaftaran tenant, panel tenant (pemakaian kuota), dan admin platform produk.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan tenant_id pada data bisnis, penegakan kuota di server sebelum aksi yang memakai kuota, dan status langganan.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji isolasi antar tenant dan penolakan kuota penuh sebelum aksi berjalan.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki isolasi/kuota yang gagal; jangan melonggarkan tenant_id demi uji.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/paket.tsx` — daftar paket produk untuk calon tenant.
- `src/tenant/` — panel tenant: pemakaian, paket saya, tagihan.
- `src/admin-platform/` — kelola plans, tenants, subscriptions.
- `db/migrations/NNNN_saas.sql` — plans, subscriptions, tenants.

Aturan bisnis wajib:

- Setiap data bisnis tenant WAJIB punya tenant_id; query tanpa tenant_id dari sesi tenant adalah pelanggaran.
- Kuota ditegakkan di server SEBELUM pemakaian, bukan sekadar tampilan peringatan.
- Harga paket hanya dari pemilik produk; skill tidak menetapkan harga final dan tidak mengubah harga platform Dadiweb.
- Status langganan baku: percobaan | aktif | lewat_jatuh_tempo | berhenti; akses tenant berhenti mengikuti aturan pemilik produk yang tercatat.

## 5. Skema database baku

Tabel `plans`: id, name, price_idr nullable, quota_users integer, quota_storage_mb integer, features (teks/JSON ringkas), created_at, updated_at.

Tabel `tenants`: id, name, owner_user_id, plan_id (FK plans), status, created_at, updated_at.

Tabel `subscriptions`: id, tenant_id (FK tenants), plan_id (FK plans), status enum di atas, period_start, period_end, amount_idr nullable, created_at, updated_at.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Halaman paket: perbandingan paket jujur dari tabel plans, tanpa harga karangan.
- Panel tenant: pemakaian vs kuota tampil sebagai bilah yang jelas.
- Admin platform produk: daftar tenant, paketnya, status langganan, dan tombol kelola paket.
- Peringatan kuota hampir penuh tampil sebelum kuota benar-benar habis.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mencampur data antar tenant dalam keadaan apa pun; kebocoran lintas tenant adalah pelanggaran keras.
7. Khusus skill ini: skill membuat produk SaaS milik pengguna — dilarang mengubah tarif, kredit, atau harga paket platform Dadiweb dari dalam proyek.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Data tenant A tidak bisa dibaca/diubah tenant B (uji server).
- [ ] Kuota penuh menolak aksi sebelum pemakaian bertambah.
- [ ] Ganti paket memperbarui kuota dan tercatat di subscriptions.
- [ ] Harga paket hanya dari tabel plans milik pemilik produk.
- [ ] Status langganan berhenti membatasi akses sesuai aturan tercatat.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan produk SaaS untuk manajemen kos: multi-tenant, ada paket basic dan pro dengan kuota unit, billing dasar per bulan."
- "Platform berlangganan untuk klinik kecil dengan tenant per cabang dan kuota pengguna per paket."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik belum menetapkan harga paket: halaman paket tampil dengan penanda harga belum ditetapkan di admin, bukan angka karangan.
- Tenant melewati jatuh tempo: status berubah lewat_jatuh_tempo dan aturan akses yang tercatat diterapkan — tidak menghapus data tenant diam-diam.
