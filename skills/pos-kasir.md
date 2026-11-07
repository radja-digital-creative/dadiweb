---
name: pos-kasir
version: 1.0.0
family: commerce-bisnis
title: POS Kasir — Kasir Cepat, Stok, Struk, dan Laporan Harian Toko/Kafe
triggers: [pos, kasir, point of sale, toko retail, retail, struk, stok barang, laporan penjualan, mesin kasir, kafe, warung, minimarket]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [bayar-doku]
credit_profile: standard
outputs: [layar kasir cepat, kelola produk dan stok, struk digital dan cetak, laporan harian, tabel products transactions transaction_items stock_movements]
---

# POS Kasir — Kasir Cepat, Stok, Struk, dan Laporan Harian Toko/Kafe

Skill domain family commerce-bisnis. Sistem kasir (point of sale) untuk
toko retail, kafe, warung, dan usaha sejenis: transaksi secepat mungkin di
layar kasir, stok yang selalu bisa diaudit, struk digital + cetak, laporan
harian per kasir, dan banyak kasir yang bekerja bersamaan tanpa tabrakan.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Penjualan terjadi di tempat (offline) dan dicatat kasir saat itu juga.
- Prompt menyebut kasir, POS, point of sale, mesin kasir, struk, stok
  barang untuk toko/kafe, atau laporan penjualan harian.

TIDAK dipakai ketika:

- Penjualan online dengan pengiriman ke pembeli → toko-online.
- Usaha menjual slot waktu/jasa terjadwal → booking-reservasi.
- Hanya butuh pencatatan keuangan umum tanpa transaksi kasir → bukan POS;
  klarifikasi dulu, jangan memaksakan layar kasir.

## 2. Pertanyaan penjernih

Tiga pertanyaan baku skill ini (default berlaku bila tidak dijawab):

1. Satu kasir atau banyak kasir? Default: BANYAK kasir (multi-kasir) —
   setiap kasir masuk dengan akunnya sendiri dan laporan bisa dipisah
   per kasir.
2. Perlu stok dan barcode? Default: stok AKTIF — setiap penjualan
   mengurangi stok lewat stock_movements; pencarian barcode didukung
   lewat kolom barcode produk (pemindai bertindak sebagai keyboard).
3. Struk fisik atau digital? Default: struk DIGITAL + CETAK — struk tampil
   di layar untuk dibagikan (WhatsApp/gambar) dan bisa dicetak ke printer
   struk lewat dialog cetak browser.

Pertanyaan lain hanya bila mengubah struktur: misalnya pembayaran nontunai
lewat DOKU (opsional, bukan default) atau lebih dari satu cabang (di luar
cakupan skill ini — catat sebagai batas, jangan dikarang).

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan mode dari jawaban penjernih/default: multi-kasir, stok aktif,
   struk digital + cetak.
2. Serahkan tabel products, transactions, transaction_items, dan
   stock_movements ke database-designer.
3. Tetapkan peran dari auth-pengguna: admin (pemilik) dan kasir.

Designer:

4. Rancang layar kasir untuk kecepatan: daftar produk sebagai kisi besar
   yang bisa ditekan, pencarian dan barcode di atas, keranjang transaksi
   selalu terlihat di sisi kanan (desktop) atau panel geser (mobile).
5. Rancang target sentuh besar dan kontras tinggi — layar kasir dipakai
   cepat, sering di bawah cahaya terang.

Coder:

6. Implementasikan transaksi di server: klien mengirim daftar item dan
   jumlah; server membaca harga produk, menghitung subtotal, diskon,
   dan total. Total dari browser TIDAK PERNAH dipercaya.
7. Simpan transaksi + itemnya, lalu catat pengurangan stok sebagai baris
   stock_movements bertipe "sale" yang merujuk transaksi itu — dalam satu
   operasi atomik: bila satu item gagal, seluruh transaksi batal.
8. Implementasikan pembayaran tunai dengan hitung kembalian, dan nontunai
   manual (transfer/QRIS pemilik) sebagai metode tercatat; DOKU hanya
   bila bayar-doku dipilih.
9. Implementasikan void: transaksi berbayar hanya bisa dibatalkan dengan
   alasan wajib; void membuat transaksi berstatus void, mengembalikan
   stok lewat stock_movements bertipe "void", dan tercatat siapa yang
   membatalkan dan kenapa. Transaksi berbayar TIDAK bisa diedit isinya.
10. Implementasikan laporan harian: total penjualan, jumlah transaksi,
    per metode bayar, per kasir, dan daftar void hari itu.

Builder & Tester:

11. Uji kecepatan alur: cari produk → tambah → bayar → struk, tanpa
    langkah yang tidak perlu.
12. Uji total dimanipulasi dari browser: server harus menolak/menghitung
    ulang dengan benar.
13. Uji void: stok kembali, alasan wajib, transaksi asli tetap terbaca
    sebagai void (tidak hilang).
14. Uji multi-kasir: dua kasir menjual produk yang sama bersamaan; stok
    akhir harus tepat.

Fixer:

15. Perbaiki tahap gagal dengan skill ini; jangan pernah "memperbaiki"
    selisih stok dengan mengubah stok langsung — koreksi selalu lewat
    stock_movements bertipe "adjustment" dengan alasan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/NNNN_pos_kasir.sql` — products, transactions,
  transaction_items, stock_movements.
- `src/pages/kasir.tsx` — layar kasir utama.
- `src/pages/produk.tsx` — kelola produk dan stok (admin).
- `src/pages/laporan-harian.tsx` — laporan per hari/kasir.
- `src/pos/transaksi.ts` — pembuatan transaksi di server (hitung total).
- `src/pos/void.ts` — pembatalan beralasan + audit.
- `src/pos/stok.ts` — satu-satunya jalur mengubah stok (stock_movements).
- `src/pos/struk.tsx` — tampilan struk digital dan cetak.

Aturan bisnis wajib:

- Total transaksi dihitung di server dari harga produk tersimpan; browser
  hanya menampilkan perkiraan.
- Transaksi yang sudah dibayar TIDAK bisa diedit — koreksi hanya lewat
  void beralasan yang diaudit (siapa, kapan, kenapa).
- Stok TIDAK PERNAH diubah langsung; setiap perubahan stok adalah baris
  stock_movements (sale, void, restock, adjustment) sehingga stok saat
  ini selalu bisa dibuktikan dari riwayatnya.
- Penjualan yang membuat stok negatif ditolak, kecuali admin secara
  eksplisit mengaktifkan penjualan stok minus di pengaturan — default
  MATI.
- Diskon per transaksi dicatat sebagai angka dan alasan singkat; diskon
  tidak mengubah harga produk.
- Setiap transaksi mencatat kasir yang melayani (user_id kasir).
- Struk mencantumkan nama usaha, waktu, kasir, item, total, metode bayar,
  dan kembalian (tunai).

## 5. Skema database baku

Tabel `products`:

- `id` — integer, primary key, auto increment.
- `name` — teks, nama produk.
- `price_idr` — integer, harga jual rupiah.
- `cost_idr` — integer nullable, harga modal (hanya terlihat admin).
- `barcode` — teks nullable, terindeks, untuk pencarian pemindai.
- `category` — teks, kategori produk.
- `is_active` — integer boolean, default 1.
- `created_at`, `updated_at` — timestamp baku.
  (Stok saat ini adalah hasil hitung stock_movements, bukan kolom yang
  diubah langsung; ringkasannya boleh disimpan sebagai cache yang selalu
  konsisten dengan movements.)

Tabel `transactions`:

- `id` — integer, primary key, auto increment.
- `cashier_id` — foreign key ke users.id (kasir yang melayani), terindeks.
- `subtotal_idr`, `discount_idr`, `total_idr` — integer, dihitung server.
- `payment_method` — teks enum: tunai | qris | transfer | doku.
- `paid_idr` — integer nullable, uang diterima (tunai).
- `change_idr` — integer nullable, kembalian (tunai).
- `status` — teks enum: paid | void.
- `void_reason` — teks nullable, wajib terisi bila status void.
- `voided_by` — foreign key nullable ke users.id.
- `voided_at` — timestamp nullable.
- `created_at`, `updated_at` — timestamp baku.

Tabel `transaction_items`:

- `id` — integer, primary key.
- `transaction_id` — foreign key ke transactions.id, terindeks.
- `product_id` — foreign key ke products.id, terindeks.
- `qty` — integer jumlah terjual.
- `price_idr` — integer, harga snapshot saat transaksi.
- `created_at`, `updated_at` — timestamp baku.

Tabel `stock_movements`:

- `id` — integer, primary key.
- `product_id` — foreign key ke products.id, terindeks.
- `type` — teks enum: sale | void | restock | adjustment.
- `qty_delta` — integer bertanda (negatif keluar, positif masuk).
- `ref_transaction_id` — foreign key nullable ke transactions.id.
- `note` — teks, alasan untuk adjustment/restock.
- `created_by` — foreign key ke users.id.
- `created_at`, `updated_at` — timestamp baku.

## 6. Aturan UI & komponen

- Layar kasir: kisi produk besar dengan foto/nama/harga, kolom cari yang
  selalu fokus (siap menerima pemindai barcode), panel keranjang tetap.
- Keranjang: ubah jumlah dengan tombol +/− besar, hapus item, diskon
  transaksi, total besar dan jelas.
- Tombol Bayar membuka panel pembayaran: pilihan metode, input uang
  diterima untuk tunai dengan kembalian otomatis tampil.
- Setelah bayar: struk tampil penuh dengan tombol Bagikan (digital) dan
  Cetak; tombol "Transaksi Baru" memulai dari kosong.
- Produk stok habis tampil redup dan tidak bisa ditambahkan (bila aturan
  stok minus mati).
- Laporan harian: kartu ringkasan (omzet, transaksi, rata-rata), tabel per
  kasir dan per metode, daftar void beserta alasannya.
- Semua aksi kasir bisa diselesaikan tanpa mouse: urutan tab dan pintasan
  Enter logis dari cari → bayar.

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
6. Khusus skill ini: dilarang memercayai total dari browser, dilarang
   mengedit transaksi berbayar, dan dilarang mengubah stok di luar
   stock_movements — ketiganya pelanggaran keras karena merusak audit.
7. Khusus skill ini: dilarang menghapus baris transaksi atau movement
   dengan alasan apa pun; koreksi selalu berupa catatan baru (void /
   adjustment) yang bisa diaudit.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Transaksi tunai: total server benar, kembalian benar, struk tampil.
- [ ] Manipulasi total dari browser tidak mengubah total tersimpan.
- [ ] Setiap penjualan mengurangi stok lewat stock_movements "sale".
- [ ] Void beralasan mengembalikan stok dan tercatat pelakunya; transaksi
      berbayar tidak bisa diedit isinya.
- [ ] Stok produk tidak bisa diubah dari halaman produk secara langsung —
      hanya restock/adjustment beralasan.
- [ ] Dua kasir bersamaan: stok dan laporan akhir tetap konsisten.
- [ ] Laporan harian cocok dengan jumlah transaksi dan daftar void.

Hasil yang diharapkan: kasir bekerja cepat, pemilik bisa membuktikan
setiap rupiah dan setiap potong stok dari riwayat yang tidak bisa diubah
diam-diam.

## 9. Contoh prompt baik

- "Buatkan aplikasi kasir untuk kafe saya: 3 kasir bergantian, stok bahan
  tercatat, struk bisa dikirim ke WhatsApp pelanggan."
- "POS untuk toko kelontong dengan barcode, laporan penjualan harian per
  kasir, dan stok yang tidak bisa diubah sembarangan."
- "Kasir minimarket: transaksi cepat, diskon per transaksi, laporan
  harian, dan pembatalan harus pakai alasan."

## 10. Kasus tepi & cara gagal yang jujur

- Produk yang sama dipindai dua kali: digabung menjadi satu item dengan
  jumlah bertambah, bukan dua baris terpisah.
- Kasir salah memasukkan jumlah dan transaksi sudah dibayar: jalurnya
  void beralasan lalu transaksi baru — bukan edit; UI menjelaskan ini.
- Printer struk tidak tersedia: struk digital tetap tampil dan bisa
  dibagikan; cetak dinyatakan sebagai memakai printer yang terhubung ke
  perangkat kasir, bukan dijanjikan otomatis.
- Stok tidak cocok dengan fisik (barang rusak/hilang): admin membuat
  adjustment beralasan ("rusak", "hilang") — selisih tampil di laporan,
  tidak disembunyikan.
- Koneksi pembayaran DOKU gagal di tengah transaksi nontunai: transaksi
  tidak ditandai lunas; kasir bisa memilih metode lain atau membatalkan
  sebelum pembayaran, dan kejadian itu tercatat.
- Usaha ternyata punya banyak cabang dengan stok terpisah: di luar
  cakupan skill ini — laporkan sebagai batas jujur dan sarankan struktur
  per cabang sebagai pengembangan lanjutan, jangan mengarang fitur cabang.
