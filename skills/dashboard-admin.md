---
name: dashboard-admin
version: 1.0.0
family: aplikasi-android
title: Dashboard Admin — Panel Ringkasan, Grafik, dan CRUD Data Proyek
triggers: [dashboard, admin, panel admin, manajemen, statistik, crm, kelola data, manajemen pengguna, panel kelola, laporan]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [seo-performa]
credit_profile: standard
outputs: [panel ringkasan dan grafik, crud semua tabel proyek, pengelolaan peran pengguna, filter dan pencarian data]
---

# Dashboard Admin — Panel Ringkasan, Grafik, dan CRUD Data Proyek

Skill domain family aplikasi-android (panel pengelolaan aplikasi). Skill
ini membangun panel admin untuk sebuah proyek: ringkasan angka penting,
grafik sederhana, CRUD atas tabel-tabel yang SUDAH dimiliki proyek, dan
pengelolaan pengguna/peran. Dashboard membaca dan mengelola data proyek
yang ada — ia tidak menciptakan model bisnis baru.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemilik butuh mengelola data proyeknya dari satu panel: melihat
  pesanan, booking, produk, pengguna, dan mengubahnya dengan aman.
- Prompt menyebut dashboard, panel admin, kelola data, statistik, CRM
  sederhana, atau "bisa saya pantau dari HP".
- Skill domain lain (toko-online, booking, pos) sudah menetapkan tabel;
  dashboard menjadi rumah pengelolaannya.

TIDAK dipakai ketika:

- Yang dibutuhkan hanya halaman publik perusahaan → company-profile.
- Belum ada data/tabel apa pun di proyek dan tidak ada yang akan dikelola:
  dashboard kosong tanpa sumber data adalah karangan — klarifikasi dulu
  data apa yang mau dikelola.
- Mengelola platform Dadiweb itu sendiri (semua pengguna/platform): itu
  wilayah Admin Panel platform, bukan skill proyek.

## 2. Pertanyaan penjernih

1. Data apa yang paling penting dipantau di ringkasan? Default: mengikuti
   domain proyek (toko: pesanan & pendapatan; booking: booking hari ini;
   pos: penjualan harian; umum: jumlah baris per tabel utama).
2. Siapa saja yang boleh masuk panel: hanya admin, atau kasir/staf dengan
   hak terbatas? Default: hanya peran admin; peran lain ditolak.
3. Tabel mana yang boleh dihapus barisnya dari panel, dan mana yang hanya
   boleh dilihat/diubah? Default: tabel bukti transaksi (pembayaran,
   transaksi, movement) tidak bisa dihapus dari panel — mengikuti aturan
   skill domain pemilik tabelnya.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Inventarisasi tabel proyek yang sudah ada (dari database-designer dan
   skill domain proyek) — dashboard hanya memakai daftar ini.
2. Tetapkan kartu ringkasan dan grafik dari data yang benar-benar ada:
   hitungan baris, jumlah nilai uang, dan deret waktu (per hari/minggu).
3. Tetapkan hak per peran bersama auth-pengguna.

Designer:

4. Rancang tata letak panel: bilah sisi (desktop) / menu bawah (mobile),
   kartu ringkasan di atas, grafik, lalu tabel data dengan pencarian dan
   saring.
5. Pastikan panel nyaman di ponsel — pemilik memantau dari HP; target
   sentuh besar dan tabel berubah menjadi kartu di layar kecil.

Coder:

6. Implementasikan ringkasan: agregat dihitung di server dari tabel
   proyek (COUNT, SUM, kelompok per tanggal), bukan dari data yang dikirim
   browser.
7. Implementasikan CRUD generik per tabel mengikuti definisi kolom
   database-designer: daftar berhalaman, cari, tambah, ubah, hapus —
   dengan validasi kolom yang sama seperti formulir publiknya.
8. Hormati aturan domain pemilik tabel: transaksi pos tidak bisa diedit
   (hanya void), pembayaran tidak bisa ditandai lunas manual, stok hanya
   berubah lewat stock_movements. Panel menonaktifkan aksi yang dilarang
   dan menjelaskan kenapa.
9. Implementasikan kelola pengguna: daftar pengguna proyek, ubah peran,
   aktif/nonaktifkan — hanya untuk admin, dan admin tidak bisa
   menonaktifkan dirinya sendiri terakhir.

Builder & Tester:

10. Uji hak akses: bukan admin ditolak dari semua halaman panel.
11. Uji agregat: angka ringkasan cocok dengan isi tabel sebenarnya.
12. Uji CRUD pada satu tabel biasa (tambah/ubah/hapus) dan uji penolakan
    pada tabel yang dilindungi aturan domain.

Fixer:

13. Perbaiki tahap gagal dengan skill ini; jangan melonggarkan aturan
    domain atau peran demi membuat uji lulus.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/admin/layout.tsx` — rangka panel (navigasi + area konten).
- `src/admin/ringkasan.tsx` — kartu angka dan grafik.
- `src/admin/tabel.tsx` — komponen CRUD generik per tabel.
- `src/admin/pengguna.tsx` — kelola pengguna dan peran.
- `src/admin/agregat.ts` — perhitungan ringkasan di server.

Aturan bisnis wajib:

- Dashboard TIDAK membuat tabel bisnis baru. Satu-satunya data yang boleh
  ia kelola adalah tabel yang sudah dirancang database-designer/skill
  domain, plus tabel users/sessions milik auth-pengguna.
- Semua angka ringkasan dan grafik dihitung server dari data asli;
  dilarang angka contoh, angka acak, atau "data demo" di panel produksi
  proyek.
- Setiap aksi ubah/hapus lewat panel memeriksa peran di server.
- Hapus baris mengikuti aturan hapus tabelnya (restrict/cascade/soft
  delete dari database-designer) dan selalu berkonfirmasi.
- Panel selalu berada di jalur terpisah (misalnya /admin) dan bertanda
  noindex mengikuti seo-performa.
- Ekspor data (CSV) bila disediakan mengikuti kepemilikan: hanya data
  proyek itu, hanya untuk admin.

## 5. Skema database baku

Skill ini tidak mendefinisikan tabel bisnis. Ia membaca skema yang sudah
ada:

- Tabel domain proyek (products, orders, bookings, transactions, dan
  lainnya) sebagaimana dirancang database-designer dan skill domainnya.
- Tabel `users` dan `sessions` dari auth-pengguna untuk kelola peran dan
  status aktif.
- Tidak ada tabel "dashboard" atau tabel statistik: agregat dihitung saat
  diminta dari data asli, agar angka tidak pernah basi atau berbeda dari
  sumbernya.

Bila proyek belum punya tabel apa pun, skill ini berhenti dan meminta
klarifikasi data apa yang akan dikelola (lihat bagian 10).

## 6. Aturan UI & komponen

- Kartu ringkasan: label, angka besar, dan perubahan sederhana (misalnya
  "hari ini" vs "kemarin") hanya bila datanya ada.
- Grafik memakai grafik batang/garis sederhana dari deret waktu asli,
  dengan label sumbu dan satuan yang jelas (Rp, jumlah).
- Tabel data: pencarian teks, saring per status/kolom kunci, halaman
  (pagination), dan aksi per baris (lihat/ubah/hapus sesuai aturan).
- Formulir ubah memakai komponen yang sama dengan formulir domainnya;
  kolom yang tidak boleh diubah tampil baca-saja dengan penjelasan.
- Keadaan kosong panel jujur: "Belum ada pesanan" — bukan grafik contoh.
- Mode gelap mengikuti token desain-ui proyek bila tersedia.

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
3. Rahasia dan kunci — termasuk hash kata sandi — TIDAK PERNAH ditulis ke
   file proyek, log pipeline, atau ditampilkan di panel; di UI rahasia
   hanya tampil 4 karakter terakhir bila memang harus dirujuk.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menampilkan data proyek lain atau data
   platform di panel proyek, dan dilarang membuat tabel bisnis baru atas
   nama dashboard.
7. Khusus skill ini: dilarang melewati aturan domain pemilik tabel (edit
   transaksi berbayar, ubah stok langsung, lunas manual) lewat panel —
   panel adalah jendela ke aturan yang sama, bukan jalan pintas.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Bukan admin tidak bisa membuka satu pun halaman panel.
- [ ] Angka ringkasan cocok dengan hitungan manual dari tabel sumber.
- [ ] CRUD tabel biasa bekerja dengan validasi dan konfirmasi hapus.
- [ ] Aksi terlarang domain (edit transaksi, ubah stok langsung, lunas
      manual) tidak tersedia/ditolak di panel dengan penjelasan.
- [ ] Kelola pengguna: ubah peran dan nonaktif bekerja; admin terakhir
      tidak bisa menonaktifkan dirinya.
- [ ] Panel bertanda noindex dan nyaman dipakai di ponsel.
- [ ] Tidak ada angka contoh/demo di panel; keadaan kosong tampil jujur.

Hasil yang diharapkan: pemilik mengelola seluruh proyeknya dari satu
panel yang angkanya selalu benar karena dihitung dari data asli, dan
tidak satu pun aturan bisnis domainnya bisa ditembus lewat panel.

## 9. Contoh prompt baik

- "Buatkan dashboard admin untuk toko online saya: lihat pesanan masuk,
  ubah statusnya, kelola produk dan harganya."
- "Panel admin untuk aplikasi booking salon: booking hari ini, daftar
  pelanggan, dan grafik booking per minggu."
- "Dashboard untuk memantau penjualan kasir semua cabang kecil saya:
  omzet harian per kasir dan daftar pembatalan."

## 10. Kasus tepi & cara gagal yang jujur

- Proyek belum punya tabel apa pun: hentikan dengan needs_clarification —
  tanyakan data apa yang mau dikelola; jangan mengarang tabel contoh.
- Tabel sangat besar (puluhan ribu baris): daftar wajib berhalaman dan
  agregat dibatasi rentang waktu; jangan memuat semua baris ke browser.
- Dua admin mengubah baris yang sama bersamaan: perubahan terakhir menang
  dengan updated_at terbaru, dan panel menampilkan waktu ubah terakhir
  agar konflik terlihat — bukan diklaim tidak pernah terjadi.
- Pemilik meminta panel bisa menghapus riwayat transaksi "agar bersih":
  ditolak; riwayat adalah bukti audit. Tawarkan arsip/tandai nonaktif
  sesuai aturan domainnya.
- Grafik diminta untuk data yang tidak punya dimensi waktu: tampilkan
  ringkasan angka saja dan jelaskan datanya belum cukup untuk grafik —
  jangan membuat deret waktu karangan.
