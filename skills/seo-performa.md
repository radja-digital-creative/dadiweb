---
name: seo-performa
version: 1.0.0
family: platform-kualitas
title: SEO & Performa — Judul/Meta, Sitemap, dan Kecepatan Muat Web
triggers: [seo, google, pencarian, meta, sitemap, cepat, performa, loading, ditemukan di google]
requires: []
optional: [desain-ui]
credit_profile: standard
outputs: [judul dan meta per halaman, sitemap.xml, robots.txt, laporan checklist seo per halaman, laporan skor muat]
---

# SEO & Performa — Judul/Meta, Sitemap, dan Kecepatan Muat Web

Skill pendukung family platform-kualitas. Skill ini dipakai pada tahap
Builder & Tester untuk semua proyek web: memastikan setiap halaman punya
judul dan meta yang benar, situs punya sitemap, gambar terkompresi, dan
kecepatan muat terukur — dengan checklist lulus/gagal per halaman yang
jujur, bukan janji peringkat Google.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Semua proyek web yang akan tayang publik (landing page, company profile,
  toko online, booking) pada tahap Builder & Tester.
- Pengguna menyebut SEO, "ditemukan di Google", atau keluhan situs lambat.

TIDAK dipakai ketika:

- Halaman yang memang tidak boleh terindeks: panel admin, halaman kasir,
  halaman akun — halaman ini justru wajib ditandai noindex.
- Aplikasi Android (wilayah android-developer); SEO web tidak berlaku di
  sana kecuali halaman web pendampingnya.
- Janji peringkat: skill ini tidak pernah menjanjikan posisi di Google;
  ia hanya memastikan prasyarat teknisnya benar.

## 2. Pertanyaan penjernih

1. Kata kunci utama bisnisnya apa dan kota/wilayah layanannya? Default:
   diturunkan dari nama bisnis dan jenis proyek di prompt, dinyatakan
   sebagai asumsi yang bisa diubah pemilik.
2. Domain final proyek apa? Default: subdomain proyek di platform; sitemap
   dan URL kanonis mengikuti domain yang aktif saat deploy.
3. Ada halaman yang tidak boleh muncul di Google (misalnya halaman harga
   khusus member)? Default: hanya halaman akun/admin/kasir yang noindex.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Catat halaman publik proyek dari rencana skill domain dan kata kunci
   utama per halaman (satu fokus per halaman).

Designer:

2. Pastikan struktur judul halaman sehat: satu H1 berisi topik halaman,
   subjudul H2/H3 berurutan, teks tombol menjelaskan aksi (bukan "klik di
   sini").

Coder:

3. Hasilkan judul (maks ±60 karakter) dan meta description (maks ±160
   karakter) unik per halaman publik, Bahasa Indonesia, memuat kata kunci
   halaman itu secara wajar.
4. Hasilkan tag Open Graph dasar (judul, deskripsi, gambar utama) agar
   tautan yang dibagikan tampil rapi.
5. Tandai halaman non-publik dengan meta robots noindex.

Builder & Tester:

6. Hasilkan `sitemap.xml` berisi semua halaman publik dengan URL domain
   aktif, dan `robots.txt` yang mengizinkan perayapan halaman publik serta
   menunjuk sitemap.
7. Kompresi gambar: ubah gambar halaman ke format web modern (WebP bila
   memungkinkan), batasi lebar sesuai kebutuhan tampil, dan pastikan
   ukuran berkas gambar hero tidak berlebihan.
8. Ukur skor muat per halaman (perkiraan waktu muat dan ukuran total) dan
   nilai checklist SEO per halaman: judul ada, meta ada, H1 tunggal,
   gambar punya teks alternatif, tautan internal sehat.
9. Halaman yang gagal checklist diperbaiki sekali oleh Fixer; yang tetap
   gagal dilaporkan apa adanya di hasil generate.

Fixer:

10. Perbaiki kegagalan spesifik per halaman (judul ganda, gambar terlalu
    besar, H1 ganda) tanpa mengubah konten bisnis halaman.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `public/sitemap.xml` — daftar URL publik.
- `public/robots.txt` — aturan perayapan + lokasi sitemap.
- `seo/laporan-seo.md` — checklist lulus/gagal per halaman dan skor muat.
- `src/seo/meta.ts` — judul, deskripsi, dan Open Graph per halaman.

Aturan bisnis wajib:

- Judul dan meta description unik per halaman; dilarang menyalin satu
  judul ke semua halaman.
- URL memakai slug huruf kecil berstrip yang terbaca manusia.
- Gambar wajib punya teks alternatif yang menjelaskan isi gambar; gambar
  dekoratif memakai teks alternatif kosong.
- Halaman admin, kasir, akun, dan pembayaran selalu noindex.
- Sitemap hanya memuat halaman publik yang benar-benar ada dan tayang.
- Skor muat dilaporkan apa adanya; angka tidak dibulatkan ke atas dan
  tidak dibandingkan dengan situs lain.

## 5. Skema database baku

Skill ini tidak membuat tabel. Hasilnya adalah berkas statis (sitemap,
robots) dan laporan. Bila proyek memakai database-designer, daftar halaman
publik dibaca dari rencana proyek — bukan dari tabel baru. Riwayat skor
muat disimpan sebagai berkas `seo/laporan-seo.md` yang ditimpa setiap
build, bukan sebagai data bisnis.

## 6. Aturan UI & komponen

Skill ini tidak menghasilkan halaman untuk pengunjung; hasil UI-nya adalah
bagian laporan di Editor/hasil generate:

- Tabel checklist per halaman: nama halaman, status Lulus/Gagal per butir,
  dan skor muat.
- Kegagalan ditulis dengan bahasa sebab-akibat ("gambar hero 1,8 MB —
  kompres ke WebP") agar pemilik proyek paham tanpa ilmu teknis.
- Tidak ada lencana "SEO 100%" palsu; yang ditampilkan adalah jumlah butir
  lulus dari total butir per halaman.

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
6. Khusus skill ini: dilarang menjanjikan peringkat atau trafik Google,
   dilarang isian kata kunci berlebihan (keyword stuffing), tautan
   tersembunyi, dan teks tersembunyi untuk mesin pencari.
7. Khusus skill ini: dilarang menghapus noindex dari halaman admin/kasir/
   pembayaran demi "SEO" — keamanan dan privasi menang.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Setiap halaman publik punya judul dan meta unik dalam batas karakter.
- [ ] Setiap halaman publik punya tepat satu H1.
- [ ] sitemap.xml valid dan hanya berisi halaman publik yang tayang.
- [ ] robots.txt menunjuk sitemap dan tidak memblokir halaman publik.
- [ ] Halaman admin/kasir/akun/pembayaran bertanda noindex.
- [ ] Semua gambar punya teks alternatif; hero terkompresi ke format web.
- [ ] Laporan per halaman menunjukkan butir lulus/gagal dan skor muat
      apa adanya.

Hasil yang diharapkan: situs siap dirayapi mesin pencari secara teknis,
muat cepat di ponsel, dan pemilik proyek menerima laporan yang jujur —
termasuk halaman yang belum lulus.

## 9. Contoh prompt baik

- "Buatkan landing page untuk jasa cuci AC di Surabaya, supaya mudah
  ditemukan orang yang mencari di Google."
- "Company profile untuk kontraktor di Jakarta; halaman layanan masing-
  masing sendiri supaya jelas di hasil pencarian."
- "Toko online batik, foto produk banyak — pastikan tetap cepat dibuka
  di HP."

## 10. Kasus tepi & cara gagal yang jujur

- Proyek satu halaman (landing page): sitemap berisi satu URL; itu sah dan
  dilaporkan apa adanya, bukan dibuat seolah banyak halaman.
- Pemilik belum punya domain final: sitemap memakai subdomain platform
  dan laporan mencatat URL akan berubah saat domain custom dipasang.
- Gambar dari pengguna berukuran sangat besar dan tidak bisa dikompresi
  otomatis tanpa merusak kualitas (misalnya foto portofolio detail):
  tampilkan versi terkompresi untuk web, simpan catatan di laporan, dan
  jangan mengklaim skor muat yang tidak terukur.
- Kata kunci yang diminta tidak sesuai isi bisnis (misalnya meminta kata
  kunci merek pesaing): ditolak; SEO mengikuti isi sebenarnya.
- Halaman gagal checklist setelah satu putaran Fixer: status partial
  dengan daftar kegagalan yang spesifik — bukan diluluskan diam-diam.
