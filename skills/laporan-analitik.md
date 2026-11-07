---
name: laporan-analitik
version: 1.0.0
family: data-backend
title: Laporan & Analitik — Laporan Penjualan, Grafik Tren, Rekap Periode, dan Ekspor Laporan
triggers: [laporan analitik, laporan penjualan, analitik, grafik tren, tren penjualan, rekap periode, rekap, ekspor laporan, laporan, statistik penjualan, analisis data]
requires: [database-designer]
optional: [import-eksport-data]
credit_profile: standard
outputs: [laporan penjualan per periode, grafik tren, rekap periode, ekspor laporan, query agregasi read-only]
---

# Laporan & Analitik — Laporan Penjualan, Grafik Tren, Rekap Periode, dan Ekspor Laporan

Skill pendukung family data-backend. Laporan dan analitik dari data proyek itu sendiri: laporan penjualan, grafik tren, rekap per periode (harian/mingguan/bulanan), dan ekspor laporan. Semua query agregasi bersifat READ-ONLY — skill ini tidak pernah mengubah data bisnis.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemilik ingin melihat ringkasan/tren dari datanya: penjualan, booking, pendaftaran per periode.
- Prompt menyebut laporan, analitik, rekap, tren, grafik, atau ekspor laporan.

TIDAK dipakai ketika:

- Mengelola data mentahnya (CRUD) → dashboard-admin/skill domain.
- Laporan keuangan resmi/akuntansi berstandar → di luar cakupan; nyatakan batasnya dengan jujur.

## 2. Pertanyaan penjernih

1. Metrik utamanya apa (penjualan, pesanan, booking, pendaftaran)? Default mengikuti tabel bisnis utama proyek.
2. Periode baku: harian, mingguan, atau bulanan? Default: bulanan dengan pilihan harian/mingguan.
3. Ekspor laporan format apa? Default: CSV mengikuti import-eksport-data.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan metrik, dimensi (per produk/kategori/poli), dan periode dari tabel proyek yang ada.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang kartu ringkasan, grafik tren garis/batang dengan sumbu dan satuan yang jelas, dan tabel rekap.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan query agregasi read-only (SUM/COUNT/GROUP BY periode) di server, selalu terikat proyek pemilik.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji angka laporan cocok dengan hitung manual dari data contoh; uji periode kosong tampil nol, bukan error.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki agregasi yang salah tanpa mengubah data bisnis (read-only tetap dijaga).

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/laporan/agregasi.ts` — query agregasi read-only per metrik.
- `src/pages/laporan.tsx` — halaman laporan: kartu, grafik tren, tabel rekap, ekspor.
- `src/laporan/ekspor-laporan.ts` — ekspor rekap sebagai CSV.

Aturan bisnis wajib:

- Query laporan READ-ONLY: tidak ada INSERT/UPDATE/DELETE dari skill ini.
- Angka laporan harus bisa ditelusur ke data mentah proyek (periode dan filter tampil di halaman).
- Nilai uang dalam rupiah bilangan bulat; grafik wajib menyebut satuan dan periode.
- Data periode kosong tampil sebagai 0/kosong yang jujur, bukan diisi tebakan.

## 5. Skema database baku

Skill ini tidak membuat tabel bisnis baru dan tidak mengubah skema. Ia membaca tabel bisnis proyek yang ada (misalnya orders pada toko-online/pos-kasir, bookings pada booking-reservasi) dengan agregasi per kolom waktu (created_at/tanggal transaksi) dan status yang sah menurut skill domainnya.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Kartu ringkasan: total periode ini + perbandingan periode sebelumnya (hanya bila data sebelumnya ada).
- Grafik tren: sumbu waktu dan nilai berlabel, satuan jelas (Rp / jumlah), bisa dibaca di ponsel (tabel rekap menyertai grafik).
- Tabel rekap per periode di bawah grafik untuk angka persisnya.
- Tombol Ekspor Laporan (CSV) menyebut periode dan filter yang sedang aktif.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengubah data bisnis dari jalur laporan (read-only) dan dilarang menggabungkan data lintas proyek untuk "perbandingan".
7. Khusus skill ini: dilarang mengarang angka, tren, atau proyeksi (forecast) yang disajikan sebagai fakta data.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Total laporan cocok dengan penjumlahan manual data contoh pada periode yang sama.
- [ ] Periode tanpa data tampil nol/kosong dengan jujur.
- [ ] Grafik punya sumbu, satuan, dan periode yang jelas; tabel rekap menyertainya.
- [ ] Ekspor laporan berisi angka yang sama dengan halaman pada filter yang sama.
- [ ] Tidak ada query laporan yang mengubah data (read-only teruji).

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan laporan penjualan toko saya: grafik tren bulanan, rekap per produk, dan bisa ekspor laporan ke CSV."
- "Saya mau analitik booking per bulan dengan rekap mingguan untuk pemilik salon."

## 10. Kasus tepi & cara gagal yang jujur

- Data proyek masih kosong: laporan tampil keadaan kosong dengan angka nol yang jujur, bukan grafik contoh karangan.
- Pengguna meminta proyeksi penjualan tahun depan sebagai fakta: tolak sebagai fakta; bila ditawarkan pun harus berlabel perkiraan terpisah — default skill ini tidak membuat proyeksi.
