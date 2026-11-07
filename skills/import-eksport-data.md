---
name: import-eksport-data
version: 1.0.0
family: data-backend
title: Impor & Ekspor Data — Impor/Ekspor CSV Selaras Fitur Database dengan Validasi dan Laporan Gagal
triggers: [impor data, ekspor data, import csv, export csv, impor csv, ekspor csv, csv, unggah data, unduh data, template csv, migrasi data]
requires: [database-designer]
optional: []
credit_profile: standard
outputs: [impor csv per tabel dengan validasi kolom, ekspor csv per tabel, laporan baris gagal, template csv per tabel]
---

# Impor & Ekspor Data — Impor/Ekspor CSV Selaras Fitur Database dengan Validasi dan Laporan Gagal

Skill pendukung family data-backend. Impor/ekspor CSV yang selaras dengan fitur Database prototipe: ekspor tabel proyek menjadi CSV, impor CSV dengan validasi kolom, laporan baris yang gagal beserta alasannya, dan template CSV kosong per tabel.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemilik ingin memasukkan data banyak sekaligus dari spreadsheet atau memindahkan data keluar sebagai CSV.
- Prompt menyebut impor/ekspor, CSV, migrasi data awal, atau template CSV.

TIDAK dipakai ketika:

- Memasukkan beberapa baris saja lewat formulir biasa → fitur Database standar cukup.
- Format selain CSV (Excel biner, JSON massal) → nyatakan belum didukung skill ini, jangan mengarang konversi.

## 2. Pertanyaan penjernih

1. Tabel mana yang diimpor/diekspor? Default: tabel yang disebut prompt.
2. Baris gagal saat impor: dilewati dengan laporan, atau seluruh impor batal? Default: baris sah masuk, baris gagal dilewati dan dilaporkan per baris.
3. Impor menambah data baru atau memperbarui baris berdasarkan kolom kunci? Default: menambah baru; pembaruan hanya bila kolom kunci disebut eksplisit.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Petakan kolom CSV ke kolom tabel; kolom tak dikenal ditolak sejak rencana.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang alur unggah → pratinjau pemetaan kolom → jalankan → laporan hasil (berhasil/gagal per baris).

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan parser CSV (kutip, escape, CRLF), validasi tipe per kolom, hitung total byte impor untuk kuota SEBELUM menulis, dan hasilkan template CSV per tabel.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji CSV berisi baris sah, baris salah tipe, kolom hilang, dan file melebihi kuota.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki validasi/laporan yang gagal tanpa memasukkan baris gagal diam-diam.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/data/impor-csv.ts` — parser + validasi + laporan baris gagal.
- `src/data/ekspor-csv.ts` — ekspor tabel menjadi CSV.
- `src/data/template-csv.ts` — pembuat template CSV kosong per tabel.
- Halaman Database proyek memakai alur ini (selaras fitur Database prototipe).

Aturan bisnis wajib:

- Hanya kolom tabel proyek yang diterima; kolom asing diabaikan/ditolak sesuai laporan, tidak disimpan.
- Setiap baris gagal dilaporkan nomor baris + kolom + alasannya; baris gagal TIDAK masuk database.
- Total ukuran impor dihitung dan diperiksa ke kuota Executor SEBELUM penulisan; melebihi kuota = ditolak sebelum menulis.
- Ekspor hanya berisi data proyek pemiliknya, lewat pemeriksaan kepemilikan.
- Batas baris per impor mengikuti batas fitur Database prototipe (maks 500 baris per impor) dan dinyatakan di UI.

## 5. Skema database baku

Skill ini tidak membuat tabel bisnis baru; ia bekerja di atas tabel proyek yang ada dari database-designer. Laporan impor adalah artefak hasil (daftar baris gagal) yang ditampilkan ke pemilik dan dapat diunduh — bukan tabel bisnis baru, kecuali proyek memang meminta riwayat impor disimpan.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Alur impor: pilih tabel → unggah CSV → lihat pemetaan kolom → jalankan → laporan berhasil/gagal per baris dengan tombol unduh laporan.
- Template CSV bisa diunduh per tabel dari halaman Database.
- Ekspor: satu tombol per tabel, nama file menyebut nama tabel dan tanggal.
- Pesan kuota/batas baris tampil sebelum pengguna menjalankan impor besar.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang memasukkan baris yang gagal validasi secara diam-diam atau memotong laporan kegagalan.
7. Khusus skill ini: ekspor lintas proyek/platform dilarang; file CSV hasil ekspor adalah data pemilik proyek itu saja.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Baris sah masuk, baris gagal tidak masuk dan tercatat di laporan dengan alasan per kolom.
- [ ] Kolom asing tidak tersimpan ke database.
- [ ] Impor melebihi kuota/batas baris ditolak sebelum menulis.
- [ ] Ekspor hanya berisi data proyek pemiliknya dan bisa dibuka sebagai CSV sah.
- [ ] Template CSV cocok persis dengan kolom tabelnya.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Saya mau impor 300 produk dari file CSV ke tabel produk, kalau ada baris salah kasih laporan baris mana yang gagal."
- "Tambahkan ekspor CSV untuk semua tabel proyek saya lengkap dengan template CSV kosongnya."

## 10. Kasus tepi & cara gagal yang jujur

- File bukan CSV sah (biner Excel diganti nama): parser menolak dengan pesan format, bukan mencoba menebak.
- CSV dengan kolom kunci ganda pada mode perbarui: baris ganda dilaporkan sebagai gagal, pengguna yang memutuskan.
- Impor separuh jalan gagal karena kuota: tidak ada baris yang tertulis (penolakan sebelum menulis), laporan menyebut kuota sebagai penyebab.
