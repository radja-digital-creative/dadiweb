---
name: company-profile
version: 1.0.0
family: web-konten
title: Company Profile — Situs Profil Perusahaan 4–6 Halaman
triggers: [company profile, profil perusahaan, profil bisnis, perusahaan, portofolio, tentang kami, jasa konstruksi, klien korporat, website perusahaan]
requires: [desain-ui]
optional: [database-designer, seo-performa]
credit_profile: standard
outputs: [halaman beranda tentang layanan portofolio tim kontak, tabel services dan portfolios, peta lokasi, formulir kontak]
---

# Company Profile — Situs Profil Perusahaan 4–6 Halaman

Skill domain family web-konten. Situs profil resmi perusahaan/usaha:
menjelaskan siapa kami, layanan apa yang ditawarkan, bukti karya lewat
portofolio, siapa timnya, dan cara menghubungi — dalam 4–6 halaman yang
rapi dan meyakinkan untuk klien korporat maupun pelanggan umum.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Usaha butuh wajah resmi di internet: profil perusahaan, CV, firma,
  agensi, kontraktor, konsultan, klinik, sekolah, dan sejenisnya.
- Prompt menyebut company profile, profil perusahaan, website perusahaan,
  atau meminta halaman tentang/layanan/portofolio/kontak.
- Tujuannya kredibilitas dan kontak masuk, bukan transaksi langsung.

TIDAK dipakai ketika:

- Ada penjualan dengan keranjang/checkout → toko-online.
- Fokusnya satu tawaran dan satu CTA → landing-page.
- Ada jadwal/slot yang dipesan → booking-reservasi (layanan di sini hanya
  ditampilkan, bukan dipesan per slot).
- Pengguna butuh panel kelola internal → dashboard-admin.

## 2. Pertanyaan penjernih

1. Nama resmi usaha dan bidangnya apa, kota basisnya di mana?
2. Layanan utamanya apa saja (3–8 layanan)? Ditulis dari jawaban pengguna;
   sisanya tidak dikarang.
3. Halaman mana yang dipakai: Beranda, Tentang, Layanan, Portofolio, Tim,
   Kontak? Default: keenamnya kecuali Tim bila timnya belum diberikan.
4. Kontak resmi: nomor WhatsApp, email, alamat — yang belum diberikan
   memakai penanda jelas di Editor, bukan karangan.
5. Portofolio awal: proyek/karya apa yang ditampilkan? Bila belum ada,
   seksi portofolio dibuat dengan keadaan kosong yang rapi.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan daftar halaman (4–6) dan isi wajib per halaman dari prompt dan
   klarifikasi.
2. Serahkan tabel services dan portfolios ke database-designer agar
   pemilik bisa mengubah layanan dan portofolio dari panel kelola proyek.
3. Catat fakta perusahaan yang diberikan pengguna sebagai satu-satunya
   sumber teks profil (tahun berdiri, jumlah proyek, klien, sertifikasi).

Designer:

4. Terapkan desain-ui dengan kesan formal dan tepercaya: tipografi tegas,
   ruang lega, warna merek perusahaan.
5. Rancang templat halaman layanan dan portofolio agar setiap entri tampil
   konsisten.

Coder:

6. Bangun halaman: Beranda (hero + ringkasan + layanan unggulan + CTA),
   Tentang (cerita, visi-misi bila diberikan, nilai), Layanan (daftar dari
   tabel services), Portofolio (galeri dari tabel portfolios + halaman
   detail), Tim (bila ada data), Kontak (info + peta + formulir).
7. Halaman Kontak memakai peta tertanam dari alamat yang diberikan
   pengguna dan formulir pesan sederhana.
8. Formulir kontak menyimpan pesan atau meneruskannya ke WhatsApp/email
   resmi sesuai pilihan pemilik — nyatakan jalurnya dengan jujur.

Builder & Tester:

9. Jalankan seo-performa per halaman: judul/meta unik per halaman (nama
   layanan masuk judul halaman Layanan, dst.), sitemap lengkap.
10. Uji semua tautan navigasi antar halaman dan formulir kontak.
11. Uji tampilan ponsel untuk galeri portofolio dan peta.

Fixer:

12. Perbaiki halaman yang gagal (tautan mati, peta tidak tampil) tanpa
    mengubah fakta perusahaan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — Beranda.
- `src/pages/tentang.tsx` — Tentang kami.
- `src/pages/layanan.tsx` dan `src/pages/layanan-detail.tsx` — Layanan.
- `src/pages/portofolio.tsx` dan `src/pages/portofolio-detail.tsx`.
- `src/pages/tim.tsx` — Tim (bila datanya ada).
- `src/pages/kontak.tsx` — Kontak + peta + formulir.
- `src/data/services.ts`, `src/data/portfolios.ts` — akses data tabel.
- `db/migrations/NNNN_company_profile.sql` — tabel services, portfolios.

Aturan bisnis wajib:

- Fakta perusahaan hanya dari pengguna: tahun berdiri, jumlah klien,
  sertifikasi, penghargaan — tidak satu pun dikarang.
- Nama klien/logo klien hanya ditampilkan bila pengguna memberikan izin
  dan datanya; jangan menampilkan logo merek terkenal sebagai "klien".
- Layanan dan portofolio dikelola sebagai data (tabel), bukan teks keras
  di halaman, agar pemilik bisa mengubah tanpa mengedit kode.
- Alamat, telepon, dan email konsisten di semua halaman dan bersumber dari
  satu definisi kontak proyek.
- Bahasa situs Bahasa Indonesia kecuali pengguna meminta bahasa lain.

## 5. Skema database baku

Tabel `services`:

- `id` — integer, primary key, auto increment.
- `name` — teks, nama layanan.
- `description` — teks, penjelasan layanan.
- `icon` — teks, nama ikon tampilan (opsional).
- `sort_order` — integer, urutan tampil.
- `is_active` — integer boolean, default 1.
- `created_at`, `updated_at` — timestamp baku.

Tabel `portfolios`:

- `id` — integer, primary key, auto increment.
- `title` — teks, judul karya/proyek.
- `client_name` — teks nullable, nama klien (hanya bila diizinkan).
- `description` — teks, cerita singkat karya.
- `image_url` — teks nullable, gambar karya dari pemilik.
- `year` — integer nullable, tahun pengerjaan.
- `sort_order` — integer, urutan tampil.
- `created_at`, `updated_at` — timestamp baku.

Pesan formulir kontak, bila disimpan, memakai tabel pesan sederhana dari
database-designer; bila diteruskan ke WhatsApp, tidak ada tabel pesan.

## 6. Aturan UI & komponen

- Navigasi atas tetap (sticky) dengan nama/logo usaha dan menu halaman;
  di ponsel menjadi menu hamburger.
- Beranda menjawab tiga hal dalam satu layar gulir pertama: siapa kami,
  apa yang kami kerjakan, bagaimana menghubungi kami.
- Kartu layanan seragam: ikon, nama, dua-tiga kalimat, tautan detail.
- Portofolio berbentuk galeri kartu dengan gambar, judul, dan tahun;
  detail membuka halaman sendiri.
- Halaman Kontak: info kontak dengan ikon, peta tertanam yang bisa
  ditekan untuk membuka aplikasi peta, dan formulir (nama, kontak balik,
  pesan) dengan pesan sukses yang jelas.
- Footer konsisten: nama usaha, alamat singkat, tautan halaman, dan tahun
  hak cipta berjalan.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt
pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill
   hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan
   Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum
   menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/.
   Executor menolak ../, path absolut, symlink yang keluar dari pohon
   tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci TIDAK PERNAH ditulis ke file proyek, log pipeline,
   atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengarang fakta perusahaan — tahun berdiri,
   jumlah klien/proyek, sertifikasi, penghargaan, dan nama klien — serta
   dilarang memakai logo perusahaan lain sebagai "klien kami".
7. Khusus skill ini: foto tim dan portofolio hanya dari pemilik; dilarang
   memakai foto stok orang dan menyajikannya sebagai tim/karya asli.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] 4–6 halaman sesuai rencana, semua tautan navigasi bekerja.
- [ ] Layanan tampil dari tabel services; portofolio dari tabel portfolios.
- [ ] Tidak ada fakta perusahaan yang tidak diberikan pengguna.
- [ ] Peta menunjuk alamat yang diberikan dan bisa dibuka di aplikasi peta.
- [ ] Formulir kontak terkirim/ tersimpan sesuai jalur yang dinyatakan.
- [ ] Judul/meta unik per halaman lulus checklist seo-performa.
- [ ] Kontak (WA/email/alamat) konsisten di semua halaman dan footer.

Hasil yang diharapkan: situs profil yang meyakinkan karena faktual —
pemilik bisa mengganti layanan dan portofolio dari data tanpa menyentuh
kode, dan tidak ada klaim yang tidak bisa dibuktikan pemiliknya.

## 9. Contoh prompt baik

- "Buatkan company profile untuk PT konstruksi di Semarang: layanan
  renovasi, bangun baru, dan interior; ada halaman portofolio proyek kami."
- "Website profil untuk biro konsultan pajak: tentang, layanan, tim
  partner, dan kontak dengan peta kantor."
- "Profil usaha catering rumahan yang mulai serius: layanan paket acara,
  galeri hasil acara, dan kontak WhatsApp."

## 10. Kasus tepi & cara gagal yang jujur

- Pengguna belum punya daftar layanan/portofolio: buat struktur halaman
  dengan keadaan kosong yang rapi dan contoh format isian di Editor —
  bukan mengisi karya fiktif.
- Pengguna meminta menampilkan klien terkenal yang belum tentu kliennya:
  tampilkan hanya bila pengguna menegaskan itu kliennya; catat bahwa
  kebenaran klaim adalah tanggung jawab pemilik situs.
- Alamat tidak ditemukan oleh layanan peta: tampilkan alamat teks dan
  tautan pencarian peta; jangan menjatuhkan pin di lokasi tebakan.
- Tim sangat besar (50+ orang): tampilkan pimpinan dan perwakilan divisi,
  sisanya diringkas per divisi agar halaman tetap ringan.
- Pengguna meminta harga paket layanan ditampilkan padahal belum
  menentukan harga: tampilkan layanan tanpa harga dan tombol konsultasi;
  jangan mengarang angka.
