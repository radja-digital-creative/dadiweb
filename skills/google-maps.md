---
name: google-maps
version: 1.0.0
family: integrasi
title: Google Maps — Peta Lokasi, Alamat, dan Titik Cabang dengan Tautan Navigasi
triggers: [google maps, maps, peta lokasi, peta, lokasi, alamat, titik cabang, cabang, navigasi, rute ke lokasi, embed peta]
requires: [desain-ui]
optional: []
credit_profile: standard
outputs: [embed peta lokasi, daftar alamat dan titik cabang, tautan navigasi google maps, penanda lokasi di company profile dan toko]
---

# Google Maps — Peta Lokasi, Alamat, dan Titik Cabang dengan Tautan Navigasi

Skill pendukung family integrasi. Menampilkan lokasi usaha di proyek: embed peta Google Maps, alamat tertulis, titik-titik cabang (misalnya pada company-profile atau toko), dan tautan "Petunjuk Arah" yang membuka navigasi Google Maps. Skill ini menampilkan lokasi yang DIBERIKAN pemilik — bukan mencari/mengarang alamat.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek perlu menunjukkan alamat/cabang di peta: company profile, toko, restoran, klinik.
- Prompt menyebut Google Maps, peta lokasi, titik cabang, atau tautan navigasi.

TIDAK dipakai ketika:

- Alamat cukup sebagai teks tanpa peta → skill domain cukup menampilkan teks alamat.
- Pelacakan lokasi real-time/pengiriman → di luar cakupan skill ini.

## 2. Pertanyaan penjernih

1. Alamat dan titik peta lokasi utamanya apa? Wajib dari pemilik; jangan mengarang alamat/koordinat.
2. Ada berapa cabang/titik? Default: satu lokasi utama.
3. Tautan navigasi membuka Google Maps di perangkat pengunjung? Default: ya (tautan universal Maps).

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Kumpulkan lokasi dari pemilik: nama tempat, alamat tertulis, tautan/koordinat Maps bila ada.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang blok lokasi: embed peta, alamat, jam buka (bila diberikan), tombol Petunjuk Arah, daftar cabang.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan embed Maps dari tautan/tempat yang diberikan pemilik dan tautan navigasi universal; daftar cabang dari data proyek.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji embed tampil, tautan navigasi membuka lokasi yang benar, dan halaman tetap utuh bila embed gagal dimuat.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki embed/tautan yang gagal tanpa mengganti lokasi dengan tebakan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/maps/blok-lokasi.tsx` — embed peta + alamat + tombol navigasi.
- `src/maps/cabang.tsx` — daftar titik cabang.
- `db/migrations/NNNN_lokasi.sql` — tabel locations bila cabang dikelola dari admin.

Aturan bisnis wajib:

- Alamat, nama tempat, dan koordinat hanya dari pemilik; dilarang mengarang atau menebak lokasi usaha.
- Tautan navigasi memakai tautan universal Google Maps ke lokasi pemilik, bukan lokasi lain yang mirip namanya.
- Bila embed gagal dimuat (jaringan/kunci), alamat tertulis dan tombol navigasi tetap tampil — halaman tidak boleh kosong.
- Kunci API Maps (bila dipakai di produksi) adalah milik pemilik proyek, dipasang lewat integrasi, hanya tampil 4 karakter terakhir.

## 5. Skema database baku

Tabel `locations` (bila cabang dikelola pemilik lewat admin, lewat database-designer): id, name, address, maps_url (tautan tempat Google Maps dari pemilik), latitude nullable, longitude nullable, is_primary boolean, created_at, updated_at. Tanpa pengelolaan cabang, lokasi cukup menjadi pengaturan proyek (satu lokasi utama) tanpa tabel baru.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Blok lokasi: embed peta dengan tinggi wajar, tidak menguasai seluruh halaman di ponsel.
- Di bawah peta: alamat tertulis lengkap, tombol "Petunjuk Arah" yang jelas.
- Banyak cabang: daftar kartu cabang; memilih cabang mengganti peta dan tautan navigasinya.
- Keadaan tanpa embed: kartu alamat + tombol navigasi tetap lengkap.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menebak koordinat/alamat dari nama usaha yang mirip, dan dilarang menampilkan lokasi pihak lain sebagai lokasi pemilik.
7. Khusus skill ini: kunci API Maps tidak pernah ditulis ke file/log/prompt; di UI hanya 4 karakter terakhir (aturan platform).

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Embed peta menampilkan lokasi yang diberikan pemilik.
- [ ] Tombol Petunjuk Arah membuka lokasi yang sama di Google Maps.
- [ ] Cabang lain mengganti peta dan navigasi dengan benar.
- [ ] Bila embed gagal, alamat + tombol navigasi tetap tampil.
- [ ] Tidak ada alamat/koordinat karangan di proyek.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Tambahkan Google Maps di company profile kami: peta kantor pusat dan dua cabang dengan tombol petunjuk arah."
- "Toko saya perlu peta lokasi dan alamat lengkap dengan tautan navigasi untuk pembeli."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik hanya memberi nama jalan tanpa titik Maps: tampilkan alamat tertulis + tautan pencarian Maps dari alamat itu dan catat bahwa titik persis menunggu tautan pemilik — jangan menebak pin.
- Nama usaha sama dengan usaha lain di kota lain: gunakan hanya tautan/alamat pemilik; bila ambigu, minta klarifikasi, jangan memilih sendiri.
