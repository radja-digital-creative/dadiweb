---
name: marketplace
version: 1.0.0
family: commerce-bisnis
title: Marketplace — Platform Jual Beli Banyak Penjual dengan Komisi, Ulasan, dan Chat Dasar
triggers: [marketplace, banyak penjual, banyak toko, multi vendor, multivendor, multi-vendor, banyak seller, platform jual beli, jual beli online, penjual independen, komisi penjual, toko per penjual]
requires: [database-designer, auth-pengguna, bayar-doku]
optional: [desain-ui, whatsapp-api]
credit_profile: standard
outputs: [halaman marketplace banyak penjual, toko per penjual, katalog lintas penjual, checkout dan komisi, ulasan produk, chat dasar pembeli penjual, tabel stores products orders reviews]
---

# Marketplace — Platform Jual Beli Banyak Penjual dengan Komisi, Ulasan, dan Chat Dasar

Skill domain family commerce-bisnis. Marketplace BANYAK penjual: setiap penjual punya toko sendiri, platform mengambil komisi, pembeli memberi ulasan, dan ada chat dasar pembeli–penjual. Beda tegas dengan toko-online yang hanya SATU penjual/satu toko.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Ada banyak penjual/toko independen dalam satu platform.
- Prompt menyebut marketplace, banyak penjual, multi-vendor, seperti Shopee/Tokopedia, komisi, atau toko per penjual.

TIDAK dipakai ketika:

- Hanya satu penjual/satu toko milik sendiri → toko-online.
- Hanya etalase tanpa transaksi → katalog-produk.

## 2. Pertanyaan penjernih

1. Komisi platform berapa persen? Default: diisi admin platform di pengaturan; jangan mengarang angka komisi sebagai janji.
2. Penjual mendaftar terbuka atau diseleksi admin? Default: daftar terbuka, toko aktif setelah verifikasi admin sederhana.
3. Pembayaran lewat bayar-doku dengan status pending/paid? Default: ya bila checkout diminta.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan model penjual, komisi, dan alur pesanan lintas penjual (satu checkout bisa berisi produk dari banyak toko — pesanan dipecah per toko).

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang beranda marketplace, halaman toko per penjual, detail produk dengan nama toko, dan panel penjual.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan registrasi toko, CRUD produk per toko (penjual hanya mengelola tokonya), checkout dengan hitung komisi di server, ulasan setelah pesanan selesai, dan chat dasar.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji isolasi penjual: penjual A tidak bisa mengubah produk toko B; uji hitung komisi sama antara checkout dan laporan.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki isolasi/komisi yang gagal; jangan melonggarkan kepemilikan toko demi uji lolos.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — beranda marketplace + pencarian lintas toko.
- `src/pages/toko.tsx` — halaman toko per penjual.
- `src/pages/produk.tsx` — detail produk + ulasan + tombol chat.
- `src/penjual/` — panel penjual (produk, pesanan masuk toko saya).
- `src/admin/marketplace.tsx` — kelola penjual, komisi, moderasi.
- `db/migrations/NNNN_marketplace.sql` — stores, products, orders, reviews, dan tabel chat dasar.

Aturan bisnis wajib:

- Penjual hanya mengelola toko dan produknya sendiri; penegakan di server.
- Komisi dihitung di server dari persen yang ditetapkan admin platform, tampil transparan ke penjual.
- Total pesanan dihitung di server; harga dari browser tidak dipercaya.
- Ulasan hanya dari pembeli dengan pesanan selesai untuk produk itu.
- Chat dasar hanya antara pembeli dan penjual terkait produk/pesanan itu.

## 5. Skema database baku

Tabel `stores`: id, owner_user_id, name, slug unik, description, is_active, created_at, updated_at.

Tabel `products`: id, store_id (FK stores), name, description, price_idr, stock, is_active, created_at, updated_at.

Tabel `orders`: id, buyer_user_id, store_id (FK), total_idr, commission_idr, status enum: menunggu | dibayar | diproses | dikirim | selesai | batal, created_at, updated_at. Item pesanan mengikuti pola order_items toko-online.

Tabel `reviews`: id, product_id (FK), buyer_user_id, order_id, rating 1-5, body, created_at, updated_at.

Tabel chat dasar `messages`: id, store_id, buyer_user_id, body, sender_role, created_at, updated_at.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Beranda: pencarian besar, kategori, produk dari banyak toko dengan label nama toko di setiap kartu.
- Halaman toko: identitas penjual, daftar produk toko itu saja.
- Detail produk: nama toko + tautan tokonya, ulasan bintang, tombol chat penjual.
- Panel penjual: hanya data tokonya (produk, pesanan, komisi terpotong, sisa untuk penjual).

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mencampur data antar penjual — penjual tidak boleh melihat pesanan/komisi toko lain.
7. Khusus skill ini: dilarang mengarang jumlah penjual, transaksi, atau rating; ulasan hanya dari pesanan selesai.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Penjual hanya bisa mengelola toko/produk miliknya (uji lintas toko ditolak server).
- [ ] Komisi dihitung server dan konsisten di checkout dan panel penjual.
- [ ] Ulasan hanya bisa dibuat pembeli dengan pesanan selesai.
- [ ] Chat hanya terbuka antara pembeli dan penjual terkait.
- [ ] Checkout lintas toko memecah pesanan per toko dengan benar.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan marketplace untuk UMKM lokal: banyak penjual bisa buka toko sendiri, platform ambil komisi, ada ulasan dan chat pembeli ke penjual."
- "Platform jual beli multi-vendor seperti Shopee versi sederhana untuk produk fashion dari banyak seller."

## 10. Kasus tepi & cara gagal yang jujur

- Prompt tidak menyebut jumlah penjual untuk toko: router wajib klarifikasi satu vs banyak penjual (aturan router), skill ini tidak dipaksakan.
- Komisi belum ditetapkan admin: checkout tetap jalan dengan komisi tercatat 0 dan catatan jelas di panel admin — bukan angka karangan.
- Penjual meminta melihat data toko lain: ditolak server, tercatat sebagai akses tidak berhak.
