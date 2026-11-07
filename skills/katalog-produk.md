---
name: katalog-produk
version: 1.0.0
family: web-konten
title: Katalog Produk — Etalase Tanpa Transaksi dengan Tombol Pesan WhatsApp
triggers: [katalog, etalase, etalase produk, katalog digital, katalog tanpa transaksi, tanpa checkout, tanpa keranjang, hanya katalog, pesan via whatsapp, katalog whatsapp, daftar produk, showroom produk]
requires: [database-designer, desain-ui]
optional: [whatsapp-api, google-maps]
credit_profile: standard
outputs: [etalase produk berkategori, halaman detail produk, tombol pesan via whatsapp, tabel products categories]
---

# Katalog Produk — Etalase Tanpa Transaksi dengan Tombol Pesan WhatsApp

Skill domain family web-konten. Katalog/etalase TANPA transaksi: produk ditampilkan rapi berkategori, pengunjung bertanya/memesan lewat tombol WhatsApp — tidak ada keranjang, checkout, atau pembayaran di dalam situs. Beda tegas dengan toko-online (satu penjual dengan checkout) dan marketplace (banyak penjual).

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemilik hanya ingin menampilkan produk dan dihubungi via WhatsApp.
- Prompt menyebut katalog, etalase, daftar produk, atau "tanpa checkout/tanpa keranjang".

TIDAK dipakai ketika:

- Ada keranjang/checkout/pembayaran → toko-online (satu penjual) atau marketplace (banyak penjual).
- Transaksi di tempat dengan struk/stok kasir → pos-kasir.

## 2. Pertanyaan penjernih

1. Kategori produk apa saja? Default dari prompt.
2. Nomor WhatsApp tujuan pesan berapa? Bila belum ada, pakai penanda mencolok "GANTI NOMOR WA" — jangan mengarang nomor.
3. Harga ditampilkan atau hanya "tanya via WhatsApp"? Default: tampilkan harga hanya bila diberikan pemilik.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tegaskan TIDAK ada checkout: seluruh aksi beli diarahkan ke WhatsApp.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang etalase grid produk, filter kategori, pencarian produk, dan tombol WhatsApp per produk.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan tautan wa.me dengan pesan terisi nama produk; kelola produk/kategori untuk pemilik.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji tombol WhatsApp membuka nomor benar dengan pesan produk yang benar.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki tautan/kategori yang gagal tanpa menambahkan checkout diam-diam.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — etalase (hero singkat + grid produk).
- `src/pages/produk-detail.tsx` — detail produk + tombol WhatsApp.
- `src/admin/produk.tsx` — kelola produk dan kategori.
- `db/migrations/NNNN_katalog.sql` — products, categories.

Aturan bisnis wajib:

- TIDAK ada keranjang, checkout, pembayaran, atau status pesanan di skill ini.
- Harga dan stok hanya dari pemilik; dilarang mengarang harga/diskon.
- Pesan WhatsApp terisi otomatis menyebut nama produk yang dilihat pengunjung.
- Produk tidak aktif tidak tampil di etalase.

## 5. Skema database baku

Tabel `categories`: id, name, slug, created_at, updated_at.

Tabel `products`:
- `id`, `category_id` (FK categories), `name`, `description`, `price_idr` integer nullable (kosong = tanya via WhatsApp), `image_url` nullable, `is_active` boolean, `created_at`, `updated_at`.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Etalase: pencarian + filter kategori di atas grid produk.
- Kartu produk: gambar, nama, harga (bila ada), tombol "Pesan via WhatsApp".
- Detail produk: galeri sederhana, deskripsi, tombol WhatsApp besar.
- Tidak ada ikon keranjang di header — menghindari kesan bisa checkout.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menambahkan checkout/keranjang diam-diam; bila pemilik meminta checkout, arahkan ke toko-online lewat klarifikasi.
7. Khusus skill ini: nomor WhatsApp tidak boleh dikarang; penanda sementara wajib mencolok di Editor.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Tidak ada keranjang/checkout/pembayaran di seluruh halaman.
- [ ] Tombol WhatsApp per produk membuka nomor pemilik dengan pesan berisi nama produk.
- [ ] Filter kategori dan pencarian produk bekerja.
- [ ] Produk nonaktif tidak tampil.
- [ ] Harga hanya tampil bila diberikan pemilik.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan katalog produk untuk toko furnitur, hanya etalase tanpa checkout, setiap produk ada tombol pesan via WhatsApp."
- "Etalase produk skincare dengan kategori, pembeli tanya dan pesan lewat WhatsApp saja."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik belum memberi nomor WhatsApp: katalog tetap dibuat dengan penanda mencolok, status partial pada tombol pesan.
- Prompt berkembang meminta pembayaran online: klarifikasi beralih ke toko-online, jangan menambal katalog menjadi toko setengah jadi.
