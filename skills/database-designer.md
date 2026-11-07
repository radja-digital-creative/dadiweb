---
name: database-designer
version: 1.0.0
family: data-backend
title: Database Designer — Perancang Skema Database Proyek
triggers: [database, basis data, skema, tabel, data, relasi, migrasi, crud]
requires: []
optional: []
credit_profile: standard
outputs: [skema database, file migrasi, data seed awal, daftar indeks, aturan hapus per tabel]
---

# Database Designer — Perancang Skema Basis Data Proyek

Skill pendukung family data-backend. Skill ini dipanggil tahap Planner pada
semua proyek yang menyimpan data, dan hasilnya menjadi fondasi yang dipakai
skill domain (toko-online, pos-kasir, booking-reservasi, dashboard-admin,
dan lainnya) — bukan diganti oleh mereka.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek menyimpan data apa pun yang harus bertahan setelah halaman ditutup:
  produk, pesanan, transaksi, jadwal, pengguna, konten yang dikelola admin.
- Skill domain menyebut tabel baku (misalnya products dan orders pada
  toko-online) dan tabel itu harus diwujudkan menjadi skema yang konsisten.
- Pengguna meminta fitur kelola data: tambah, ubah, hapus, cari, filter,
  ekspor, atau laporan dari data proyeknya.
- Proyek lama perlu tabel baru karena ada fitur tambahan yang disetujui
  pengguna pada tahap klarifikasi.

TIDAK dipakai ketika:

- Proyek murni statis tanpa data dinamis (misalnya landing page satu halaman
  yang hanya menampilkan teks dan tombol WhatsApp tanpa formulir leads).
- Yang diminta hanya perubahan tampilan; itu wilayah desain-ui.
- Yang diminta hanya halaman baca dari data yang sudah ada tanpa perubahan
  skema; skill domain cukup memakai skema yang sudah tercatat.
- Pengguna meminta mengakses database proyek lain atau database platform
  Dadiweb — selalu ditolak, lihat bagian 7.

## 2. Pertanyaan penjernih

Ajukan hanya pertanyaan yang jawabannya mengubah skema; maksimal tiga, satu
per satu bila proyek berisiko salah rancang:

1. Data apa saja yang harus disimpan? Sebutkan contoh nyatanya (nama produk,
   jenis layanan, jenis transaksi) agar entitas tidak ditebak.
2. Siapa yang mengisi dan mengubah data: hanya admin, kasir, pelanggan
   sendiri, atau publik lewat formulir?
3. Data yang dihapus harus hilang permanen atau cukup ditandai tidak aktif
   (soft delete) agar riwayat tetap bisa diaudit?
4. Apakah ada data awal (seed) yang harus langsung tampil, misalnya daftar
   layanan atau produk contoh dari pengguna?

Bila pengguna tidak menjawab, pakai default yang aman: entitas hanya dari
yang disebut eksplisit di prompt, pengisian oleh admin, hapus permanen hanya
untuk data tanpa relasi, dan seed kosong (bukan data karangan).

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Ekstrak entitas dari prompt dan jawaban klarifikasi: kata benda yang
   perlu disimpan (produk, pesanan, pelanggan) menjadi kandidat tabel.
2. Tentukan relasi antar entitas: satu-ke-banyak (pesanan ke item pesanan),
   banyak-ke-banyak lewat tabel penghubung (produk ke kategori bila perlu).
3. Gabungkan dengan tabel baku skill domain yang terpilih; tabel baku domain
   menang untuk namanya, skill ini melengkapi kolom dan relasinya.
4. Tetapkan aturan hapus per tabel (restrict, cascade terbatas, soft delete)
   dan indeks untuk kolom yang sering dicari atau disaring.
5. Hasilkan rencana skema: daftar tabel, kolom, tipe, relasi, indeks, aturan
   hapus — dicatat sebagai artefak Planner untuk ditinjau tahap berikutnya.

Designer:

6. Petakan setiap tabel ke kebutuhan tampilan: kolom mana yang tampil di
   daftar, mana yang hanya di formulir, mana yang tidak pernah tampil
   (misalnya hash kata sandi).

Coder:

7. Hasilkan file migrasi yang membuat semua tabel sesuai rencana, dalam
   urutan yang menghormati relasi (tabel induk sebelum tabel anak).
8. Hasilkan seed hanya dari data yang diberikan pengguna atau yang diwajibkan
   skill domain (misalnya peran pengguna dasar pada auth-pengguna).
9. Hasilkan lapisan akses data per tabel: buat, baca daftar, baca satu,
   ubah, hapus — selalu terikat kepemilikan proyek.

Builder & Tester:

10. Jalankan migrasi pada database proyek dan pastikan tidak ada error.
11. Uji setiap operasi dasar per tabel dengan data contoh sementara, lalu
    hapus data contoh uji itu.
12. Periksa indeks benar-benar terdaftar dan aturan hapus bekerja (menghapus
    induk yang masih punya anak harus ditolak bila aturannya restrict).

Fixer:

13. Bila migrasi gagal, perbaiki file migrasi — jangan mengubah data yang
    sudah terlanjur benar; laporkan tabel mana yang gagal dan kenapa.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/0001_awal.sql` — migrasi pertama berisi seluruh tabel awal.
- `db/migrations/NNNN_nama_perubahan.sql` — migrasi lanjutan, nomor urut
  empat digit, tidak pernah mengedit migrasi yang sudah dijalankan.
- `db/seed.json` — data awal yang sah (dari pengguna atau kewajiban skill).
- `db/skema.md` — dokumentasi skema: tabel, kolom, relasi, aturan hapus.
- `src/data/<nama_tabel>.ts` — lapisan akses data per tabel.

Aturan bisnis wajib:

- Penamaan tabel dan kolom selalu snake_case Bahasa Inggris teknis
  (products, order_items, created_at), jamak untuk tabel.
- Setiap tabel wajib punya kolom `id`, `created_at`, dan `updated_at`.
- `updated_at` diperbarui server pada setiap perubahan; klien tidak boleh
  mengisinya.
- Kolom uang memakai bilangan bulat rupiah (tanpa desimal) agar tidak ada
  kesalahan pembulatan.
- Kolom status memakai daftar nilai tetap (enum) yang didokumentasikan di
  `db/skema.md`, bukan teks bebas.
- Tidak ada kolom untuk data yang tidak diminta pengguna; skema ramping
  lebih baik daripada skema yang mengarang kebutuhan masa depan.
- Relasi dinyatakan sebagai kolom `<tabel_induk>_id` pada tabel anak dan
  wajib terindeks.

## 5. Skema database baku

Skill ini tidak memaksakan tabel bisnis tertentu; ia menetapkan pola baku
yang berlaku untuk semua tabel yang dirancangnya:

Pola kolom setiap tabel:

- `id` — integer, primary key, auto increment.
- `created_at` — timestamp, diisi server saat baris dibuat, tidak berubah.
- `updated_at` — timestamp, diisi server saat baris dibuat dan diubah.
- Kolom bisnis sesuai entitas, dengan tipe yang tegas: teks untuk nama dan
  keterangan, integer untuk jumlah dan uang rupiah, real hanya bila memang
  ada pecahan (misalnya berat), boolean sebagai integer 0/1.

Pola relasi:

- Satu-ke-banyak: kolom foreign key di sisi banyak, indeks wajib.
- Banyak-ke-banyak: tabel penghubung bernama gabungan dua tabel
  (misalnya product_categories) dengan dua foreign key dan primary key
  gabungan.
- Bukti transaksi dan riwayat (ledger-like) bersifat append-only: baris
  tidak diubah dan tidak dihapus, koreksi dibuat sebagai baris baru.

Contoh hasil pola (untuk proyek toko): products, orders, order_items,
payments — dirinci oleh skill toko-online; skill ini memastikan keempatnya
mengikuti pola kolom, relasi, dan indeks di atas.

## 6. Aturan UI & komponen

Skill ini tidak menghasilkan halaman sendiri, tetapi menetapkan aturan agar
tahap Designer dan Coder menampilkan data secara konsisten:

- Daftar data selalu berbentuk tabel atau daftar kartu dengan kolom sesuai
  `db/skema.md`; kolom internal (id teknis, hash, token) tidak ditampilkan.
- Formulir tambah/ubah data dibuat dari definisi kolom: label Bahasa
  Indonesia, wajib/opsional mengikuti aturan kolom, pesan error per kolom.
- Nilai uang selalu diformat sebagai rupiah (Rp 150.000), tanggal dan waktu
  ditampilkan pada zona waktu pengguna proyek.
- Status ditampilkan sebagai label berwarna yang konsisten antar halaman
  (misalnya hijau = aktif/lunas, kuning = menunggu, merah = gagal/batal).
- Aksi hapus selalu meminta konfirmasi dan menjelaskan dampak relasinya
  ("produk ini punya riwayat transaksi dan tidak bisa dihapus, hanya bisa
  dinonaktifkan") bila aturan hapusnya restrict.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt
pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill
   hanya menghasilkan rencana dan artefak (teks skema, migrasi, seed);
   penulisan hanya dilakukan Executor di server yang memvalidasi path,
   kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/.
   Executor menolak ../, path absolut, symlink yang keluar dari pohon
   tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke
   file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya
   tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang merancang tabel lintas proyek atau tabel yang
   membaca data platform Dadiweb (akun, kredit, langganan pengguna lain).
7. Khusus skill ini: dilarang menyimpan kata sandi, nomor kartu, atau token
   sesi mentah sebagai kolom biasa; data sensitif mengikuti aturan skill
   auth-pengguna dan bayar-doku (hash dan token terkelola, bukan plaintext).

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Semua tabel dari rencana Planner benar-benar terbuat oleh migrasi.
- [ ] Setiap tabel punya id, created_at, updated_at dan nama snake_case.
- [ ] Setiap foreign key punya indeks dan aturan hapus yang terdokumentasi.
- [ ] Migrasi berjalan bersih dari database kosong.
- [ ] Seed hanya berisi data yang sah (dari pengguna atau kewajiban skill).
- [ ] Operasi buat/baca/ubah/hapus teruji per tabel dengan data sementara.
- [ ] Menghapus induk berelasi restrict ditolak dengan pesan yang jelas.
- [ ] Tidak ada kolom berisi kata sandi plaintext atau data kartu.
- [ ] db/skema.md cocok persis dengan migrasi yang dijalankan.

Hasil yang diharapkan: skema terdokumentasi yang bisa dibuat ulang dari
nol hanya dengan menjalankan migrasi berurutan, dan lapisan akses data per
tabel yang hanya menyentuh data milik proyek itu sendiri.

## 9. Contoh prompt baik

- "Buatkan website klinik dengan data pasien, dokter, dan jadwal praktik;
  pasien bisa daftar janji temu, admin mengelola semuanya."
- "Saya butuh aplikasi untuk rental mobil: data mobil, penyewa, dan
  transaksi sewa dengan tanggal kembali."
- "Toko kue saya perlu menyimpan produk, pesanan masuk, dan pembayaran;
  pesanan yang sudah dibayar tidak boleh dihapus."

Prompt seperti ini baik karena entitas dan relasinya disebut eksplisit,
sehingga skema tidak perlu ditebak.

## 10. Kasus tepi & cara gagal yang jujur

- Prompt menyebut data yang bertentangan (misalnya "stok boleh minus" vs
  aturan domain yang melarangnya): aturan domain dan platform menang, dan
  konfliknya dilaporkan, bukan disembunyikan.
- Pengguna meminta tabel dengan data pribadi pihak ketiga yang sensitif
  (nomor KTP, data kesehatan rinci) tanpa konteks yang sah: minta
  klarifikasi; bila tetap tidak jelas, tandai needs_clarification.
- Migrasi gagal di tengah (satu tabel konflik): status partial — sebutkan
  tabel yang berhasil dan yang gagal; jangan mengklaim selesai.
- Proyek lama tanpa skema tercatat meminta tabel baru: rancang migrasi
  lanjutan saja; jangan menulis ulang migrasi awal yang tidak tercatat.
- Kuota penyimpanan proyek tidak cukup untuk migrasi/seed: Executor menolak
  penulisan; laporkan sebagai kegagalan kuota, bukan error skema.
