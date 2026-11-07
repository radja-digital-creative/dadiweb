---
name: desain-ui
version: 1.0.1
family: platform-kualitas
title: Desain UI — Sistem Desain per Proyek (Token, Komponen, Responsif)
triggers: [desain, tampilan, warna, tema, gaya, ui, responsif, mode gelap, gelap, terang]
requires: []
optional: [seo-performa]
credit_profile: standard
outputs: [token desain proyek, komponen baku, aturan responsif, palet warna dan tipografi]
---

# Desain UI — Sistem Desain per Proyek (Token, Komponen, Responsif)

Skill pendukung family platform-kualitas. Skill ini dipakai pada tahap
Designer untuk SEMUA proyek: ia menetapkan sistem desain proyek — warna,
tipografi, komponen, perilaku responsif — agar seluruh halaman yang dibuat
skill domain terasa satu produk, bukan tempelan halaman yang berbeda gaya.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Setiap generate proyek baru: tahap Designer selalu menjalankan skill ini
  bersama skill domain utama.
- Pengguna menyebut warna merek, gaya (minimalis, playful, elegan), font,
  mode gelap, atau contoh tampilan yang disukai.
- Fixer memperbaiki tahap Designer yang gagal uji tampilan.

TIDAK dipakai ketika:

- Perubahan murni logika data tanpa dampak tampilan (wilayah Coder/domain).
- Pengguna meminta meniru persis tampilan merek terkenal termasuk logo dan
  aset berhak cipta: ambil inspirasinya (palet, kesan), jangan menyalin
  aset dan identitasnya.
- Mendesain ulang platform Dadiweb itu sendiri — skill ini hanya untuk
  proyek hasil generate.

## 2. Pertanyaan penjernih

1. Warna utama merek proyek apa? Default: biru profesional untuk bisnis,
   hijau untuk kuliner/kesehatan, oranye untuk retail — selalu dinyatakan
   sebagai pilihan yang bisa diganti di Editor.
2. Kesan yang diinginkan: formal, santai, atau playful? Default mengikuti
   jenis proyek (company profile = formal; landing page kuliner = santai).
3. Mode gelap dibutuhkan? Default: mode terang saja; mode gelap hanya bila
   diminta atau jenis proyeknya aplikasi malam (misalnya dashboard admin
   boleh menawarkan keduanya).

Pertanyaan hanya diajukan bila prompt sama sekali tidak memberi sinyal gaya
dan jenis proyeknya ambigu; selain itu pakai default dan lanjut.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Catat sinyal gaya dari prompt: warna yang disebut, jenis usaha, target
   pengunjung, mode gelap/terang, bahasa tampilan.
2. Serahkan sinyal itu ke tahap Designer sebagai batasan, bukan tebakan
   bebas.

Designer:

3. Tetapkan token desain: warna utama, warna pendukung, warna status
   (sukses/peringatan/bahaya), latar, permukaan, teks, dan border.
4. Tetapkan tipografi: satu font judul dan satu font isi (atau satu font
   untuk keduanya), skala ukuran yang konsisten, ketebalan judul.
5. Tetapkan komponen baku: tombol utama/sekunder, kartu, formulir (input,
   label, pesan error), tabel, label status, navigasi, modal, dan keadaan
   kosong (empty state).
6. Tetapkan aturan responsif mobile-first (wajib, lihat §6): tata letak
   mobile satu kolom, target sentuh minimal 44px, navigasi bawah atau
   hamburger di mobile, tabel menjadi kartu di layar kecil, dan header
   yang TIDAK PERNAH menumpuk logo dengan nav di layar sempit.
7. Bila mode gelap diminta: tetapkan pasangan token gelap untuk semua
   token di atas, bukan sekadar membalik warna.

Coder:

8. Terapkan token sebagai variabel tema terpusat; halaman tidak boleh
   menulis warna mentah di luar token kecuali warna status baku.
9. Bangun komponen dari definisi baku skill ini, lalu skill domain mengisi
   kontennya.

Builder & Tester:

10. Periksa setiap halaman pada lebar ponsel sempit (±360px), ponsel
    (±390px), dan desktop (±1280px): tidak ada teks terpotong, tumpang
    tindih, atau gulir horizontal. Header diperiksa KHUSUS: logo dan
    tautan nav tidak boleh saling menumpuk atau terpotong di 360px.
11. Periksa kontras teks terhadap latar memenuhi keterbacaan (teks isi
    minimal rasio 4,5:1).
12. Periksa mode gelap (bila ada) pada semua halaman, bukan hanya beranda.

Fixer:

13. Perbaikan tampilan tetap memakai token; dilarang menambal dengan warna
    sekali pakai yang merusak sistem.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/theme/tokens.css` — seluruh token warna, tipografi, radius, bayangan.
- `src/theme/komponen.tsx` — komponen baku: tombol, kartu, input, label
  status, modal, keadaan kosong.
- `src/theme/desain.md` — dokumentasi keputusan desain proyek (palet,
  font, alasan pilihan) agar bisa diubah sadar di Editor.

Aturan bisnis wajib:

- Satu sumber kebenaran: semua halaman memakai token; mengganti warna
  utama cukup dari tokens.css.
- Maksimal dua font per proyek; font dimuat dari pustaka font publik.
- Warna status konsisten lintas proyek: hijau sukses, kuning menunggu/
  peringatan, merah gagal/bahaya, biru informasi.
- Radius sudut dan jarak (spacing) memakai skala tetap, bukan angka acak
  per komponen.
- Logo dan gambar merek berasal dari pengguna; skill tidak mengarang logo
  merek sungguhan milik pihak lain.
- Desain harus tetap utuh tanpa gambar: bila aset gambar gagal dimuat,
  tata letak tidak runtuh.

## 5. Skema database baku

Skill ini tidak membuat tabel bisnis. Satu-satunya data yang mungkin
disimpan adalah preferensi tampilan per pengguna proyek (misalnya pilihan
mode gelap), dan itu mengikuti tabel yang sudah ada milik auth-pengguna
atau pengaturan proyek — skill ini TIDAK membuat tabel sendiri. Bila proyek
tidak punya akun pengguna, preferensi tampilan cukup disimpan di perangkat
pengunjung (localStorage), bukan di database.

## 6. Aturan UI & komponen

- Hirarki judul jelas: satu H1 per halaman, ukuran menurun konsisten.
- Tombol aksi utama satu per layar; aksi sekunder tampil lebih tenang.
- Formulir: label selalu terlihat (bukan hanya placeholder), pesan error
  di bawah kolom yang salah, tombol kirim menonaktifkan diri saat proses.
- Keadaan kosong dirancang, bukan dibiarkan blank: ikon sederhana, satu
  kalimat penjelasan, satu tombol aksi berikutnya.
- Keadaan memuat (loading) memakai kerangka (skeleton) seukuran konten
  aslinya agar tata letak tidak melompat.
- Sentuh dulu: semua target interaktif minimal 44×44px, jarak antar tombol
  cukup untuk ibu jari.
- Mobile-first untuk header dan navigasi (aturan keras, berlaku untuk
  SEMUA halaman, termasuk yang dibuat skill domain):
  - Di bawah breakpoint (±768px), header TIDAK BOLEH menaruh logo dan
    daftar nav dalam satu baris horizontal bila tidak muat: susun
    vertikal (logo di atas, nav di bawah) ATAU pakai hamburger (menu
    ciut). Logo dan tautan nav tidak boleh saling tumpang-tindih dalam
    kondisi apa pun — ini cacat, bukan soal selera.
  - Larang lebar piksel tetap (mis. width: 1200px, min-width besar,
    kolom px kaku) yang memaksa overflow horizontal; pakai lebar fluid
    (width: 100% + max-width, grid auto-fit/minmax, flex-wrap).
  - Grid fluid: kolom runtuh ke satu kolom di layar sempit; kartu
    mengisi lebar penuh; tabel menjadi kartu (lihat kasus tepi §10).
  - Teks terbaca di lebar 360px tanpa zoom dan tanpa gulir horizontal;
    ukuran font isi tidak mengecil demi memuat baris yang terlalu lebar.
  - `overflow-x: hidden` DILARANG sebagai penambal: overflow harus
    diselesaikan di tata letak (lebar fluid, wrap, susun ulang), bukan
    disembunyikan.
- Animasi halus dan singkat (≤300ms), dimatikan bila pengguna mengaktifkan
  pengurangan gerak (prefers-reduced-motion).

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt
pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill
   hanya menghasilkan rencana dan artefak (token, komponen); penulisan
   hanya dilakukan Executor di server yang memvalidasi path, kepemilikan,
   dan kuota sebelum menulis.
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
6. Khusus skill ini: dilarang menyalin logo, ikon bermerek, atau aset
   berhak cipta milik merek lain ke dalam proyek.
7. Khusus skill ini: dilarang menyembunyikan aksi penting demi estetika
   (misalnya tombol bayar atau keluar yang tidak terlihat) dan dilarang
   memakai teks abu-abu terlalu muda yang tidak terbaca demi gaya.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Semua halaman memakai token dari tokens.css; tidak ada warna liar.
- [ ] Tampilan ponsel dan desktop lulus tanpa gulir horizontal.
- [ ] Render 360px: tidak ada overflow-x dan tidak ada elemen yang
      saling menumpuk — header diperiksa khusus (logo vs nav).
- [ ] Tidak ada lebar piksel tetap yang memaksa overflow; grid fluid.
- [ ] Kontras teks isi memenuhi keterbacaan pada mode terang (dan gelap
      bila ada).
- [ ] Komponen baku konsisten: tombol, kartu, formulir, label status.
- [ ] Keadaan kosong dan keadaan memuat tampil rapi di halaman data.
- [ ] Target sentuh ≥44px pada semua aksi utama di mobile.
- [ ] desain.md mencatat palet, font, dan alasan pilihannya.

Hasil yang diharapkan: proyek terasa satu produk yang utuh di semua
halaman dan ukuran layar, dan pemilik proyek bisa mengganti warna utama
dari satu file token.

## 9. Contoh prompt baik

- "Buatkan company profile untuk firma hukum, tampilannya formal, warna
  utama biru tua dan emas, font serif untuk judul."
- "Landing page untuk kedai kopi, gaya santai dan hangat, warna cokelat
  dan krem, enak dibaca di HP."
- "Dashboard admin untuk gudang, mode gelap, padat data tapi tetap jelas."

## 10. Kasus tepi & cara gagal yang jujur

- Pengguna meminta warna yang membuat teks tidak terbaca (kuning di atas
  putih): terapkan warna itu sebagai aksen, bukan warna teks; jelaskan
  penyesuaiannya, jangan diam-diam mengganti mereknya.
- Pengguna meminta font khusus berbayar yang tidak tersedia: pakai font
  publik terdekat dan nyatakan penggantiannya di desain.md.
- Proyek dengan data sangat padat (tabel 20 kolom): di mobile tampilkan
  kolom prioritas sebagai kartu dan sisanya di halaman detail; jangan
  memaksakan gulir horizontal.
- Mode gelap diminta di tengah proyek yang sudah jadi: hasilkan token
  gelap sebagai tambahan dan tandai halaman yang belum diperiksa sebagai
  partial, bukan mengklaim semua selesai.
- Prompt tidak menyebut gaya sama sekali: pakai default per jenis proyek
  dan catat sebagai keputusan default di desain.md, bukan karangan diam-diam.
