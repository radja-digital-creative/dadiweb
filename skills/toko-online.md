---
name: toko-online
version: 1.0.0
family: commerce-bisnis
title: Toko Online — Katalog, Keranjang, Checkout, dan Status Pesanan Satu Penjual
triggers: [toko online, toko, e-commerce, ecommerce, online shop, jual produk, katalog produk, keranjang, checkout, jualan online, satu penjual, satu toko]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [bayar-doku]
credit_profile: standard
outputs: [katalog produk, keranjang belanja, checkout dengan ongkir sederhana, status pesanan, tabel products orders order_items payments]
---

# Toko Online — Katalog, Keranjang, Checkout, dan Status Pesanan Satu Penjual

Skill domain family commerce-bisnis. Toko milik SATU penjual: katalog
produk, keranjang, checkout dengan ongkir sederhana, pembayaran (tunai/
transfer manual atau via bayar-doku bila dipilih), dan status pesanan yang
jelas bagi pembeli dan penjual. Untuk banyak penjual, skill-nya adalah
marketplace (P1) — bukan skill ini.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Satu usaha menjual produknya sendiri secara online.
- Prompt menyebut toko online, jualan online, katalog produk, keranjang,
  atau checkout — dan konteksnya satu penjual (atau klarifikasi router
  menjawab satu penjual).

TIDAK dipakai ketika:

- Banyak penjual dalam satu platform → marketplace (di luar G1; router
  mengklarifikasi, bukan menebak).
- Penjualan terjadi di tempat dengan struk dan stok kasir → pos-kasir.
- Produknya adalah slot waktu/layanan terjadwal → booking-reservasi.
- Hanya memamerkan produk tanpa transaksi → company-profile atau
  landing-page.

## 2. Pertanyaan penjernih

Pertanyaan router yang wajib diselesaikan lebih dulu: "Apakah toko ini
satu penjual saja atau banyak penjual seperti marketplace?" — tanpa
jawaban, generate tidak berjalan.

Lalu, maksimal dua pertanyaan domain:

1. Pembayaran bagaimana: transfer manual + konfirmasi, atau DOKU
   (bayar-doku)? Default: transfer manual dengan instruksi dari pemilik;
   DOKU hanya bila diminta/dipilih.
2. Ongkir bagaimana: tarif datar per pesanan, per kota, atau gratis di atas
   belanja tertentu? Default: tarif datar yang diisi pemilik di pengaturan
   toko; jangan mengarang angka ongkir.
3. Pembeli harus punya akun untuk checkout, atau boleh sebagai tamu?
   Default: tamu boleh checkout; akun untuk riwayat pesanan.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Pastikan domain satu penjual (hasil router/klarifikasi).
2. Serahkan tabel products, orders, order_items, payments ke
   database-designer; tetapkan status pesanan baku.
3. Catat pilihan pembayaran dan aturan ongkir dari klarifikasi.

Designer:

4. Rancang katalog: kartu produk (foto, nama, harga, tombol tambah),
   pencarian dan saring kategori sederhana.
5. Rancang keranjang dan checkout satu alur pendek: isi → alamat → ongkir
   → pembayaran → selesai, dengan ringkasan selalu terlihat.

Coder:

6. Implementasikan katalog dari tabel products (hanya produk aktif).
7. Implementasikan keranjang di sisi pengunjung dan checkout di server:
   server menghitung subtotal, ongkir, dan total dari harga produk saat
   checkout — harga dari browser tidak dipercaya.
8. Buat pesanan + itemnya dalam satu transaksi data; kurangi stok produk
   (bila stok dilacak) secara aman.
9. Bila bayar-doku dipilih: buat pembayaran pending lewat skill itu;
   pesanan berstatus menunggu pembayaran. Bila manual: pesanan berstatus
   menunggu konfirmasi dan pembeli menerima instruksi transfer pemilik.
10. Implementasikan halaman status pesanan untuk pembeli dan daftar
    pesanan untuk penjual (ubah status sesuai alur baku).

Builder & Tester:

11. Uji alur penuh: pilih produk → keranjang → checkout → pesanan tercatat
    dengan total yang benar.
12. Uji stok: produk habis tidak bisa di-checkout.
13. Uji status: perpindahan status hanya mengikuti urutan yang sah.

Fixer:

14. Perbaiki tahap yang gagal dengan skill yang sama; jangan mengubah
    aturan total/stok demi meloloskan uji.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/NNNN_toko_online.sql` — products, orders, order_items,
  payments.
- `src/pages/katalog.tsx`, `src/pages/produk-detail.tsx` — etalase.
- `src/pages/keranjang.tsx`, `src/pages/checkout.tsx` — belanja.
- `src/pages/pesanan-saya.tsx` — status pesanan pembeli.
- `src/admin/pesanan.tsx` — kelola pesanan penjual.
- `src/orders/hitung-total.ts` — perhitungan total di server.

Aturan bisnis wajib:

- Total pesanan SELALU dihitung server dari harga produk tersimpan dan
  aturan ongkir pemilik; angka dari browser hanya tampilan.
- Harga yang tercatat di order_items adalah harga saat checkout (snapshot),
  agar perubahan harga produk tidak mengubah pesanan lama.
- Status pesanan baku: menunggu_pembayaran → dibayar → diproses →
  dikirim → selesai; batal hanya dari menunggu_pembayaran/dibayar dengan
  catatan, dan pembatalan mengembalikan stok.
- Stok tidak pernah negatif; checkout produk yang stoknya kurang ditolak
  dengan pesan yang menyebut produknya.
- Ongkir mengikuti aturan pemilik (datar/per kota/gratis bersyarat);
  tanpa aturan dari pemilik, ongkir ditampilkan sebagai "dihitung penjual"
  — bukan angka karangan.
- Pembayaran DOKU hanya lewat bayar-doku; nomor rekening instruksi manual
  hanya dari pemilik dan tampil apa adanya dari pengaturannya.

## 5. Skema database baku

Tabel `products`:

- `id` — integer, primary key, auto increment.
- `name` — teks, nama produk.
- `description` — teks, deskripsi produk.
- `price_idr` — integer, harga rupiah.
- `stock` — integer, stok tersedia (tidak pernah negatif).
- `category` — teks, kategori sederhana.
- `image_url` — teks nullable, foto produk dari pemilik.
- `is_active` — integer boolean, default 1.
- `created_at`, `updated_at` — timestamp baku.

Tabel `orders`:

- `id` — integer, primary key, auto increment.
- `buyer_name` — teks; `buyer_whatsapp` — teks; `address` — teks alamat.
- `user_id` — foreign key nullable ke users (bila checkout memakai akun).
- `subtotal_idr`, `shipping_idr`, `total_idr` — integer, dihitung server.
- `status` — teks enum: menunggu_pembayaran | dibayar | diproses |
  dikirim | selesai | batal.
- `created_at`, `updated_at` — timestamp baku.

Tabel `order_items`:

- `id` — integer, primary key.
- `order_id` — foreign key ke orders.id, terindeks.
- `product_id` — foreign key ke products.id, terindeks.
- `qty` — integer jumlah.
- `price_idr` — integer, harga snapshot saat checkout.
- `created_at`, `updated_at` — timestamp baku.

Tabel `payments`: mengikuti skema baku bayar-doku (reference, method,
amount_idr, status pending/paid/failed/expired) dan terhubung ke orders
lewat order_ref; untuk pembayaran manual, method = manual dan status
diubah penjual setelah cek mutasi — dinyatakan sebagai konfirmasi manual,
bukan status bank.

## 6. Aturan UI & komponen

- Kartu produk: foto, nama, harga terformat rupiah, label stok habis bila
  stok 0, tombol "Tambah" yang memberi umpan balik seketika.
- Keranjang: ubah jumlah dengan batas stok, hapus item, subtotal berjalan,
  tombol Checkout yang jelas.
- Checkout: formulir singkat (nama, WhatsApp, alamat), pilihan ongkir
  sesuai aturan pemilik, ringkasan total yang sama dengan hitungan server.
- Halaman selesai: nomor pesanan besar, status awal, instruksi pembayaran
  (manual) atau tombol bayar (DOKU), tautan cek status.
- Pembeli mengecek status dengan nomor pesanan (+ nomor WhatsApp) tanpa
  harus punya akun bila checkout sebagai tamu.
- Penjual melihat daftar pesanan per status dengan aksi lanjut status
  yang hanya menampilkan langkah sah berikutnya.

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
6. Khusus skill ini: dilarang memercayai total/harga dari browser, dan
   dilarang mengubah pesanan yang sudah dibayar selain perpindahan status
   yang sah dan pembatalan tercatat.
7. Khusus skill ini: dilarang mengarang harga produk, ongkir, nomor
   rekening, atau stok awal — semuanya dari pemilik; yang belum ada
   memakai penanda jelas, bukan angka tebakan.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Checkout menghitung total di server; manipulasi harga di browser
      tidak mengubah total pesanan.
- [ ] Snapshot harga di order_items tidak berubah saat harga produk diubah.
- [ ] Stok berkurang saat checkout dan kembali saat pesanan dibatalkan;
      stok tidak bisa negatif.
- [ ] Urutan status pesanan ditegakkan; lompat status ditolak.
- [ ] Pembayaran DOKU (bila aktif) mengikuti checklist bayar-doku;
      pembayaran manual berlabel konfirmasi manual.
- [ ] Pembeli tamu bisa mengecek status dengan nomor pesanan + WhatsApp.
- [ ] Produk nonaktif/habis tidak bisa di-checkout.

Hasil yang diharapkan: toko satu penjual yang totalnya tidak bisa
dimanipulasi pembeli, stoknya konsisten, dan status pesanannya bisa
dipercaya kedua pihak.

## 9. Contoh prompt baik

- "Buatkan toko online untuk batik tulis saya: katalog, keranjang,
  checkout transfer manual, ongkir datar Rp 15.000 se-Indonesia."
- "Toko online skincare satu brand, pembayaran pakai DOKU QRIS dan VA,
  pembeli bisa cek status pesanan tanpa daftar."
- "Jualan kopi bubuk online: produk ada stoknya, gratis ongkir untuk
  belanja di atas Rp 200 ribu."

## 10. Kasus tepi & cara gagal yang jujur

- Selama checkout stok berubah (dibeli orang lain): tolak item itu dengan
  pesan jelas; jangan membuat stok negatif atau pesanan diam-diam berubah.
- Pemilik belum mengisi ongkir dan nomor rekening: toko tetap dibuat,
  checkout menampilkan "ongkir dan instruksi bayar diatur penjual" dan
  hasil generate mencatatnya — bukan angka karangan.
- Pengguna sebenarnya ingin banyak penjual setelah generate berjalan:
  hentikan dan jelaskan perbedaan marketplace; jangan menambal toko satu
  penjual menjadi marketplace diam-diam.
- Produk digital tanpa pengiriman fisik: ongkir 0 dengan label "produk
  digital — tanpa ongkir", pengiriman diganti pengiriman akses/tautan
  oleh penjual secara manual, dinyatakan apa adanya.
- Pembayaran DOKU kedaluwarsa: pesanan kembali bisa dibatalkan dan stok
  dipulihkan sesuai aturan status; jangan menandai lunas.
