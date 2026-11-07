---
name: restoran-kuliner
version: 1.0.0
family: commerce-bisnis
title: Restoran & Kuliner — Menu Digital QR, Pesan di Meja, dan Dapur (KDS Sederhana)
triggers: [restoran, kuliner, menu digital, menu qr, qr meja, pesan di meja, pesan makanan, rumah makan, warung makan, dapur restoran, kitchen display, menu restoran, kds]
requires: [database-designer, desain-ui]
optional: [pos-kasir, whatsapp-api, google-maps]
credit_profile: standard
outputs: [menu digital via qr per meja, alur pesan di meja, layar dapur kds sederhana, status pesanan dapur, tabel menus tables orders]
---

# Restoran & Kuliner — Menu Digital QR, Pesan di Meja, dan Dapur (KDS Sederhana)

Skill domain family commerce-bisnis. Restoran/kuliner: tamu memindai QR di meja, melihat menu digital, memesan dari meja; pesanan masuk ke layar dapur (KDS sederhana) dengan status dimasak/selesai. Beda dengan pos-kasir yang transaksinya di kasir.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt menyebut restoran, rumah makan, menu digital/QR, pesan di meja, atau dapur/KDS.
- Tamu memesan sendiri dari meja, bukan lewat kasir.

TIDAK dipakai ketika:

- Kasir yang melayani transaksi dan struk di konter → pos-kasir.
- Makanan dijual online dengan pengiriman dan checkout → toko-online/marketplace.

## 2. Pertanyaan penjernih

1. Berapa meja dan bagaimana nomor meja dikenali? Default: kode QR unik per meja berisi nomor meja.
2. Bayar di akhir di kasir, atau bayar online setelah pesan? Default: catatan pesanan ke kasir (pos-kasir) — pembayaran online hanya bila bayar-doku dipilih.
3. Kategori menu apa saja (makanan, minuman, paket)? Default dari daftar menu pemilik.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan alur meja → menu → pesanan → dapur → selesai, dan status pesanan baku.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang menu mobile-first untuk tamu (dibuka dari QR), dan layar dapur padat dan jelas untuk staf.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan sesi meja dari kode QR, keranjang per meja, kirim pesanan ke KDS, dan perubahan status oleh dapur.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji dua meja bersamaan tidak tertukar; uji status dapur tampil di layar tamu.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki sesi meja/status yang gagal tanpa mencampur pesanan antar meja.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/menu.tsx` — menu digital tamu (dari QR meja).
- `src/pages/pesanan-saya.tsx` — status pesanan meja ini.
- `src/dapur/kds.tsx` — layar dapur: antrean pesanan + status.
- `src/admin/menu.tsx` — kelola menu, kategori, meja, kode QR.
- `db/migrations/NNNN_restoran.sql` — menus, tables, orders.

Aturan bisnis wajib:

- Pesanan selalu terikat nomor meja dari kode QR; tamu tidak bisa mengklaim meja lain.
- Harga dan total dihitung server dari tabel menus; harga dari browser tidak dipercaya.
- Menu habis (tidak tersedia) tidak bisa dipesan.
- Status pesanan baku: diterima | dimasak | selesai | dibatalkan; perubahan status dicatat waktunya.
- KDS hanya menampilkan pesanan aktif; pesanan selesai berpindah ke riwayat.

## 5. Skema database baku

Tabel `menus`: id, name, category, description, price_idr, is_available boolean, created_at, updated_at.

Tabel `tables`: id, label (mis. Meja 1), qr_code unik, is_active, created_at, updated_at.

Tabel `orders`: id, table_id (FK tables), status enum di atas, total_idr (dihitung server), note, created_at, updated_at. Item pesanan di tabel order_items: order_id, menu_id, qty, price_idr saat pesan.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Menu tamu: kategori lengket di atas, kartu menu dengan foto/deskripsi/harga, tombol tambah besar untuk ibu jari.
- Keranjang per meja selalu terlihat ringkas di bawah layar tamu.
- KDS dapur: kartu pesanan per meja, waktu tunggu, tombol status besar, kontras tinggi.
- Layar admin: cetak/unduh kode QR per meja.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mencampur pesanan antar meja atau membiarkan tamu mengubah pesanan meja lain.
7. Khusus skill ini: harga menu tidak boleh dikarang; menu tanpa harga dari pemilik tampil dengan penanda di admin.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] QR meja membuka menu dengan sesi meja yang benar.
- [ ] Pesanan dua meja bersamaan tidak tertukar.
- [ ] Menu tidak tersedia tidak bisa dipesan.
- [ ] Perubahan status di KDS tampil di layar tamu.
- [ ] Total dihitung server sama dengan harga menu saat pesan.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan sistem restoran: tamu scan QR di meja untuk lihat menu digital dan pesan, pesanan masuk ke layar dapur."
- "Menu QR untuk rumah makan dengan 12 meja dan dapur bisa tandai pesanan selesai."

## 10. Kasus tepi & cara gagal yang jujur

- Tamu membuka menu tanpa QR (tautan langsung): minta pilih/konfirmasi nomor meja secara manual dengan catatan, jangan menebak meja.
- Dapur menandai selesai pesanan yang sudah dibatalkan: ditolak dengan pesan status tidak sah.
- Menu belum diisi pemilik: tampilkan keadaan kosong jujur di admin, bukan menu karangan.
