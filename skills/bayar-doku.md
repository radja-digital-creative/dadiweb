---
name: bayar-doku
version: 1.0.0
family: integrasi
title: Bayar DOKU — Pembayaran di Dalam Aplikasi Pengguna via DOKU
triggers: [doku, pembayaran, bayar online, checkout bayar, payment gateway, qris, virtual account, transfer bank]
requires: [database-designer]
optional: [auth-pengguna]
credit_profile: standard
outputs: [alur checkout pembayaran, penanganan webhook status, tabel pembayaran proyek, label status simulasi]
---

# Bayar DOKU — Pembayaran di Dalam Aplikasi Pengguna via DOKU

Skill pendukung family integrasi. Skill ini menambahkan pembayaran sungguhan
di dalam aplikasi milik pengguna proyek (bukan pembayaran langganan Dadiweb
itu sendiri) memakai layanan DOKU: checkout, notifikasi webhook, dan status
pembayaran paid/pending/failed. Kredensial merchant yang dipakai adalah
milik pemilik proyek, bukan milik platform.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek menjual sesuatu dan menerima pembayaran online: toko-online saat
  checkout, booking-reservasi dengan pembayaran di muka, pos-kasir dengan
  pembayaran nontunai.
- Prompt menyebut DOKU, payment gateway, QRIS, virtual account, transfer
  bank, atau "bisa bayar online".

TIDAK dipakai ketika:

- Pembayaran hanya tunai/transfer manual dengan konfirmasi WhatsApp —
  catat sebagai pembayaran manual di skill domain, jangan memaksakan DOKU.
- Yang diminta adalah pembayaran langganan atau top up kredit Dadiweb;
  itu wilayah platform, bukan proyek pengguna.
- Pemilik proyek belum punya akun merchant DOKU: skill tetap boleh
  menyiapkan alur dalam mode simulasi berlabel jujur (lihat bagian 10),
  tetapi tidak boleh mengklaim pembayaran asli sudah aktif.

## 2. Pertanyaan penjernih

1. Metode pembayaran apa yang diaktifkan merchant: QRIS, virtual account,
   transfer bank, kartu, atau semua yang tersedia? Default: semua metode
   yang diizinkan akun merchant.
2. Pembayaran penuh di muka atau ada status menunggu (pending) yang boleh
   kedaluwarsa? Default: pending kedaluwarsa mengikuti kebijakan DOKU dan
   pesanan otomatis batal bila tidak dibayar.
3. Setelah pembayaran berhasil, status pesanan/booking berubah menjadi apa?
   Default mengikuti skill domain (pesanan: diproses; booking: terkonfirmasi).

Kredensial merchant TIDAK PERNAH ditanyakan lewat prompt atau chat; pemilik
proyek memasangnya lewat panel integrasi proyek yang aman (lihat bagian 4).

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Identifikasi titik pembayaran pada alur domain (checkout toko, konfirmasi
   booking) dan jumlah yang harus dibayar — selalu dari data server proyek.
2. Catat kebutuhan tabel pembayaran proyek untuk database-designer dan
   kebutuhan status pada tabel domain (orders/bookings).

Designer:

3. Rancang halaman checkout: ringkasan pesanan, total, pilihan metode,
   tombol Bayar; dan halaman hasil: berhasil, menunggu, gagal.
4. Rancang label status simulasi yang jelas terlihat bila kredensial
   merchant asli belum terpasang (lihat bagian 6).

Coder:

5. Implementasikan pembuatan transaksi pembayaran di server: server membaca
   total dari data pesanan, membuat referensi pembayaran unik, lalu meminta
   sesi checkout ke DOKU dengan kredensial merchant pemilik proyek.
6. Implementasikan endpoint webhook: verifikasi tanda tangan notifikasi
   DOKU, petakan status menjadi paid/pending/failed, perbarui pembayaran
   dan pesanan secara idempoten (notifikasi ganda tidak menggandakan efek).
7. Implementasikan pemeriksaan status manual (refresh status) untuk halaman
   hasil, memakai data server — bukan status yang diklaim browser.

Builder & Tester:

8. Uji mode simulasi: transaksi uji menghasilkan status paid/pending/failed
   yang konsisten dan semuanya berlabel simulasi.
9. Uji webhook: notifikasi dengan tanda tangan salah ditolak; notifikasi
   sah mengubah status tepat satu kali.
10. Uji jumlah: total yang dibayar selalu sama dengan total pesanan di
    server, termasuk ongkir/diskon yang berlaku.

Fixer:

11. Kegagalan webhook atau pemetaan status diperbaiki di tahap Coder dengan
    skill ini; jangan pernah "memperbaiki" dengan memercayai status dari
    sisi klien.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/NNNN_bayar_doku.sql` — tabel payments proyek.
- `src/payments/doku-checkout.ts` — pembuatan sesi checkout di server.
- `src/payments/doku-webhook.ts` — penerima notifikasi dan verifikasi
  tanda tangan.
- `src/payments/status.ts` — pemetaan status DOKU ke status proyek.
- `src/pages/pembayaran.tsx` dan `src/pages/pembayaran-hasil.tsx`.

Aturan bisnis wajib:

- Jumlah pembayaran selalu dihitung dan dibaca di server dari data pesanan;
  jumlah dari browser tidak pernah dipercaya.
- Setiap pembayaran punya referensi unik per proyek; percobaan ulang
  memakai referensi yang sama tidak membuat tagihan ganda (idempoten).
- Status pembayaran hanya berubah lewat webhook terverifikasi atau
  pemeriksaan status ke DOKU dari server — tidak ada tombol "tandai lunas"
  untuk pembayaran DOKU.
- Kredensial merchant adalah milik pemilik proyek, dipasang lewat panel
  integrasi, disimpan terenkripsi oleh platform, dan hanya ditampilkan
  4 karakter terakhir.
- Data kartu TIDAK PERNAH masuk atau disimpan server proyek; halaman kartu
  selalu milik DOKU (hosted checkout/redirect).
- Selama kredensial merchant asli belum terpasang, seluruh alur berjalan
  dalam mode simulasi dan wajib berlabel "Simulasi" di UI dan status.

## 5. Skema database baku

Tabel `payments` (per proyek; pada toko-online tabel ini adalah tabel
payments yang disebut skill toko-online):

- `id` — integer, primary key, auto increment.
- `order_ref` — teks, referensi pesanan/booking yang dibayar.
- `reference` — teks unik, referensi pembayaran ke DOKU.
- `method` — teks, metode terpilih (qris, va, transfer, kartu, lainnya).
- `amount_idr` — integer, jumlah rupiah yang ditagihkan (dari server).
- `status` — teks enum: pending | paid | failed | expired.
- `paid_at` — timestamp nullable, diisi saat status menjadi paid.
- `created_at`, `updated_at` — timestamp baku.

Yang TIDAK disimpan: nomor kartu, CVV, PIN, kredensial merchant mentah,
dan tanda tangan webhook mentah. Riwayat notifikasi cukup dicatat sebagai
status dan waktu perubahan.

## 6. Aturan UI & komponen

- Halaman checkout menampilkan: rincian item, ongkir/diskon bila ada, total
  besar yang jelas, pilihan metode, dan tombol "Bayar via DOKU".
- Mode simulasi: banner kuning "Mode Simulasi — belum ada uang sungguhan
  yang berpindah. Pasang kredensial merchant DOKU untuk mengaktifkan
  pembayaran asli." tampil di halaman checkout dan halaman hasil.
- Halaman hasil punya tiga keadaan yang berbeda jelas: Berhasil (hijau,
  nomor referensi), Menunggu Pembayaran (kuning, instruksi dan batas
  waktu), Gagal/Kedaluwarsa (merah, tombol coba lagi).
- Status di halaman hasil dibaca dari server; tombol "Cek Status" memicu
  pemeriksaan ulang, bukan mengubah status secara lokal.
- Tidak ada formulir nomor kartu di dalam aplikasi proyek — pembayaran
  dialihkan ke halaman aman DOKU.

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
3. Rahasia dan kunci (kredensial merchant, kunci tanda tangan, token)
   TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model.
   Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menyimpan, meminta, atau meneruskan data
   kartu (nomor, masa berlaku, CVV) dalam bentuk apa pun.
7. Khusus skill ini: dilarang menandai pembayaran lunas berdasarkan klaim
   browser/pengguna; hanya webhook terverifikasi atau status resmi DOKU
   dari server yang sah.
8. Khusus skill ini: dilarang memakai kredensial merchant platform atau
   milik proyek lain; setiap proyek memakai merchant pemiliknya sendiri.
9. Khusus skill ini: dilarang menyembunyikan mode simulasi — status
   simulasi harus berlabel jujur sampai kredensial merchant asli terpasang
   dan terverifikasi.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Checkout membuat pembayaran pending dengan jumlah sama persis dengan
      total pesanan di server.
- [ ] Webhook bertanda tangan salah ditolak dan tidak mengubah status.
- [ ] Webhook sah mengubah status tepat satu kali (idempoten).
- [ ] Status paid menggerakkan status pesanan/booking sesuai skill domain.
- [ ] Tidak ada data kartu atau kredensial mentah di DB, file, atau log.
- [ ] Mode simulasi berlabel jelas di checkout dan halaman hasil.
- [ ] Kredensial di panel integrasi hanya tampil 4 karakter terakhir.
- [ ] Pembayaran kedaluwarsa menandai pesanan sesuai aturan domain.

Hasil yang diharapkan: alur bayar yang jumlahnya tidak bisa dimanipulasi
dari browser, statusnya hanya berubah lewat jalur resmi, dan jujur soal
simulasi selama merchant asli belum terpasang.

## 9. Contoh prompt baik

- "Toko online saya harus bisa dibayar pakai QRIS dan virtual account
  lewat DOKU; pesanan baru diproses setelah pembayaran masuk."
- "Booking lapangan futsal dengan pembayaran di muka via DOKU, slot
  otomatis lepas kalau tidak dibayar dalam 30 menit."
- "Tambahkan pembayaran DOKU ke toko saya; saya sudah punya akun merchant,
  kredensialnya saya pasang sendiri di panel integrasi."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik proyek belum punya merchant DOKU: hasilkan alur lengkap dalam
  mode simulasi berlabel, dan nyatakan dengan jelas bahwa pembayaran asli
  menunggu kredensial merchant pemilik proyek — bukan kegagalan generate.
- Webhook tidak kunjung datang: halaman hasil tetap pending dan menawarkan
  Cek Status; jangan menebak lunas.
- Jumlah dari DOKU berbeda dengan jumlah server: tandai failed dan catat
  selisihnya untuk pemilik proyek; jangan menyesuaikan diam-diam.
- Pengguna meminta menyimpan kartu pelanggan "agar checkout berikutnya
  cepat": ditolak; jelaskan pembayaran selalu lewat halaman aman DOKU.
- Pengguna meminta mematikan label simulasi padahal merchant belum
  terpasang: ditolak — label kejujuran adalah aturan platform.
