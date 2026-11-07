---
name: portfolio
version: 1.0.0
family: web-konten
title: Portfolio — Portofolio Personal, Galeri Karya, dan CV yang Bisa Diunduh
triggers: [portfolio, portofolio personal, galeri karya, karya kreatif, cv online, resume online, portofolio desainer, showcase karya, personal branding, portofolio fotografer]
requires: [desain-ui]
optional: [seo-performa, google-maps]
credit_profile: standard
outputs: [halaman portofolio personal, galeri karya, halaman tentang dan keahlian, cv yang bisa diunduh, formulir kontak, tabel works]
---

# Portfolio — Portofolio Personal, Galeri Karya, dan CV yang Bisa Diunduh

Skill domain family web-konten. Portofolio personal/kreatif untuk desainer, fotografer, ilustrator, penulis, pengembang, dan pekerja lepas: menampilkan karya terbaik, keahlian, tentang pemilik, dan CV yang bisa diunduh — bukan profil perusahaan dan bukan toko.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemiliknya adalah individu atau studio kecil yang menampilkan karya pribadinya.
- Prompt menyebut portfolio, portofolio personal, galeri karya, showcase, atau CV online.
- Tujuan utamanya mendapat klien/pekerjaan lewat bukti karya, bukan menjual produk langsung.

TIDAK dipakai ketika:

- Profil perusahaan dengan banyak halaman layanan dan tim → company-profile.
- Ada keranjang dan checkout → toko-online; hanya etalase tanpa transaksi → katalog-produk.
- Artikel berkala sebagai isi utama → blog-majalah.

## 2. Pertanyaan penjernih

1. Profesi/karya apa yang ditampilkan (desain, foto, tulisan, kode)? Default mengikuti prompt.
2. CV perlu tombol unduh? Default: ya, bila pemilik menyediakan file CV; tanpa file, tampilkan penanda jelas.
3. Kontak utama: WhatsApp, email, atau formulir? Default: formulir + tautan email.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan kategori karya dan urutan karya unggulan dari data pemilik; jangan mengarang karya/klien.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang galeri yang menonjolkan karya: grid besar, detail karya sebagai modal/halaman tersendiri.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan filter kategori galeri, halaman detail karya, dan tombol unduh CV dari file milik pemilik.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji filter galeri, unduhan CV, dan formulir kontak; periksa gambar karya tidak terdistorsi.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki galeri/detail yang gagal tanpa menambahkan karya karangan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — beranda portofolio (hero personal + karya unggulan).
- `src/pages/karya.tsx` dan `src/pages/karya-detail.tsx` — galeri dan detail karya.
- `src/pages/tentang.tsx` — tentang pemilik, keahlian, pengalaman.
- `src/components/galeri.tsx` — grid karya + filter kategori.
- `db/migrations/NNNN_portfolio.sql` — tabel works.

Aturan bisnis wajib:

- Karya hanya dari pemilik; dilarang mengarang karya, klien, penghargaan, atau jumlah proyek.
- File CV hanya yang disediakan pemilik; tanpa file, tombol unduh diganti penanda "CV belum tersedia".
- Gambar karya wajib punya teks alternatif yang menjelaskan karya itu.
- Formulir kontak menyimpan pesan sebagai lead proyek ini saja, tidak dibagikan lintas proyek.

## 5. Skema database baku

Tabel `works`:

- `id` — integer, primary key.
- `title` — teks, judul karya.
- `category` — teks, kategori karya (desain, foto, tulisan, dsb.).
- `description` — teks, deskripsi karya.
- `image_url` — teks nullable, rujukan gambar karya milik pemilik.
- `project_url` — teks nullable, tautan karya live bila ada.
- `is_featured` — integer boolean, karya unggulan.
- `sort_order` — integer, urutan tampil.
- `created_at`, `updated_at` — timestamp baku.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Hero personal: nama, profesi, satu kalimat nilai, foto/avatar pemilik bila ada, CTA "Lihat Karya" dan "Hubungi Saya".
- Galeri: grid responsif, filter kategori, kartu karya dengan gambar, judul, kategori.
- Detail karya: gambar besar, deskripsi, peran pemilik, tautan live bila ada.
- Keahlian tampil sebagai daftar/tag, bukan grafik persen karangan.
- Mobile-first: galeri satu kolom lalu dua kolom, target sentuh minimal 44px.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengarang karya, klien, testimoni, atau penghargaan yang tidak diberikan pemilik.
7. Khusus skill ini: file CV dan foto pemilik adalah data pemilik proyek — tidak boleh dipakai di proyek lain.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Galeri menampilkan hanya karya dari tabel works milik proyek ini.
- [ ] Filter kategori bekerja dan keadaan kosong tampil rapi.
- [ ] Tombol unduh CV mengunduh file pemilik, atau penanda jujur bila belum ada.
- [ ] Tidak ada karya/klien/testimoni karangan.
- [ ] Tampilan ponsel dan desktop tanpa gulir horizontal.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan portfolio untuk desainer grafis freelance, galeri karya logo dan branding, ada CV yang bisa diunduh dan formulir kontak."
- "Portofolio fotografer pernikahan dengan galeri per kategori dan halaman tentang saya."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik belum punya karya: hasilkan struktur galeri kosong dengan keadaan kosong yang jelas, status partial — bukan karya contoh karangan yang diklaim asli.
- File CV belum disediakan: tampilkan penanda, jangan membuat file CV berisi data karangan.
- Prompt ternyata profil perusahaan multi-halaman: arahkan ke company-profile lewat klarifikasi.
