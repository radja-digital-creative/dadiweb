---
name: booking-reservasi
version: 1.0.1
family: commerce-bisnis
title: Booking & Reservasi — Jadwal, Slot, Kalender, dan Pengingat
triggers: [booking, reservasi, jadwal, kalender, appointment, pesan tempat, sewa, janji temu, salon, klinik, lapangan, rental, slot, dokter, pasien, pengingat, layanan]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [bayar-doku]
credit_profile: standard
outputs: [kalender dan pilihan slot, formulir booking, status booking, pengingat, tabel services schedules bookings]
---

# Booking & Reservasi — Jadwal, Slot, Kalender, dan Pengingat

Skill domain family commerce-bisnis. Sistem pemesanan berbasis waktu untuk
usaha jasa: salon, klinik, studio, lapangan olahraga, rental kendaraan/
alat, konsultan, dan sejenisnya. Inti skill ini adalah jadwal dan slot:
pelanggan memilih layanan, hari, dan jam yang masih kosong; sistem
menjamin satu slot tidak terjual dua kali.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Yang dijual adalah waktu: layanan berdurasi, janji temu, sewa per jam/
  hari, atau tempat berkapasitas per sesi.
- Prompt menyebut booking, reservasi, janji temu, jadwal praktik, sewa
  lapangan, atau kalender pemesanan.

TIDAK dipakai ketika:

- Yang dijual produk fisik tanpa waktu → toko-online.
- Transaksi di tempat tanpa jadwal → pos-kasir.
- Sekadar menampilkan jadwal tanpa pemesanan (misalnya jadwal praktik
  dokter sebagai informasi) → company-profile cukup menampilkan jadwal;
  booking hanya bila ada aksi memesan slot.

## 2. Pertanyaan penjernih

1. Layanannya apa saja dan durasi masing-masing berapa lama? Default:
   durasi diisi pemilik per layanan; slot tampil per kelipatan durasi.
2. Slot ditentukan jam tetap (misalnya 09.00, 10.00) atau bebas mengikuti
   jam buka dan durasi layanan? Default: jam tetap mengikuti jam buka.
3. Booking perlu pembayaran di muka (bayar-doku) atau bayar di tempat?
   Default: bayar di tempat; status booking terkonfirmasi setelah pemilik
   menyetujui bila pemilik memilih persetujuan manual.
4. Siapa yang melayani: satu penyedia atau banyak (staf/dokter/lapangan)?
   Default: satu penyedia per proyek; banyak penyedia membuat jadwal per
   penyedia.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan layanan, durasi, jam buka, dan model penyedia dari prompt dan
   klarifikasi.
2. Serahkan tabel services, schedules, bookings ke database-designer.
3. Tetapkan status booking baku dan aturan bentrok slot.

Designer:

4. Rancang alur pemesanan tiga langkah: pilih layanan → pilih tanggal dan
   slot di kalender → isi data diri dan konfirmasi.
5. Slot yang penuh tampil jelas tidak bisa dipilih (bukan disembunyikan),
   agar pelanggan paham pilihan waktunya.

Coder:

6. Hasilkan slot dari schedules (jam buka per hari + hari libur) dikurangi
   bookings yang masih aktif pada rentang waktu itu.
7. Buat booking di server dengan pemeriksaan bentrok di dalam satu
   operasi: dua permintaan bersamaan untuk slot yang sama — hanya satu
   yang berhasil, yang lain menerima pesan slot sudah terisi.
8. Implementasikan perubahan status: pemilik bisa mengonfirmasi, menolak,
   dan menandai selesai/tidak hadir; pelanggan bisa membatalkan sebelum
   batas waktu yang ditetapkan pemilik.
9. Implementasikan pengingat: catatan pengingat untuk pelanggan dan
   pemilik (lewat WhatsApp bila nomor tersedia dan fitur itu dipilih);
   pengiriman pengingat dinyatakan sebagai terjadwal oleh sistem proyek,
   bukan janji terkirim tanpa kanal.
10. Bila bayar-doku dipilih: booking berstatus menunggu pembayaran dan
    slot ditahan selama masa tunggu yang ditetapkan pemilik; kedaluwarsa
    melepaskan slot.

Builder & Tester:

11. Uji bentrok: dua booking slot sama — satu berhasil, satu ditolak.
12. Uji hari libur dan di luar jam buka: tidak ada slot yang ditawarkan.
13. Uji pembatalan: slot yang dibatalkan bisa dipesan lagi.
14. Uji pengingat tercatat untuk booking terkonfirmasi.

Fixer:

15. Perbaiki tahap gagal dengan skill ini; jangan melonggarkan pemeriksaan
    bentrok demi meloloskan uji.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/NNNN_booking.sql` — services, schedules, bookings.
- `src/pages/booking.tsx` — alur pemesanan pelanggan (kalender + slot).
- `src/pages/booking-saya.tsx` — riwayat dan pembatalan pelanggan.
- `src/admin/jadwal.tsx` — kelola jam buka, libur, dan daftar booking.
- `src/booking/slot.ts` — penghasil slot kosong dari jadwal.
- `src/booking/buat-booking.ts` — pembuatan booking + cek bentrok server.
- `src/booking/pengingat.ts` — pencatatan dan antrean pengingat.

Aturan bisnis wajib:

- Satu slot untuk satu penyedia hanya boleh dimiliki satu booking aktif;
  penegakannya di server, bukan di tampilan kalender.
- Durasi layanan menentukan panjang slot; booking tidak boleh melewati
  jam tutup.
- Status booking baku: menunggu | terkonfirmasi | selesai | batal |
  tidak_hadir. Perpindahan status dicatat waktunya.
- Pembatalan oleh pelanggan hanya sebelum batas waktu pemilik (default
  3 jam sebelum mulai); lewat batas itu hanya pemilik yang bisa membatalkan.
- Data pelanggan pada booking (nama, WhatsApp) hanya untuk keperluan
  booking itu — tidak ditampilkan publik dan tidak dipakai proyek lain.
- Hari libur dan jam khusus dicatat di schedules sebagai pengecualian,
  bukan mengubah jam buka baku secara diam-diam.

## 5. Skema database baku

Tabel `services`:

- `id` — integer, primary key, auto increment.
- `name` — teks, nama layanan.
- `duration_minutes` — integer, durasi layanan dalam menit.
- `price_idr` — integer nullable, harga layanan (dari pemilik).
- `is_active` — integer boolean, default 1.
- `created_at`, `updated_at` — timestamp baku.

Tabel `schedules`:

- `id` — integer, primary key, auto increment.
- `provider_name` — teks, nama penyedia/staf/sumber daya (default "Utama").
- `day_of_week` — integer 0–6 (0 = Minggu) untuk jam buka rutin, nullable
  untuk pengecualian tanggal.
- `specific_date` — teks tanggal nullable, untuk hari libur/jam khusus.
- `open_time`, `close_time` — teks jam "HH:MM"; kosong pada hari libur.
- `is_closed` — integer boolean, menandai hari libur pada specific_date.
- `created_at`, `updated_at` — timestamp baku.

Tabel `bookings`:

- `id` — integer, primary key, auto increment.
- `service_id` — foreign key ke services.id, terindeks.
- `user_id` — foreign key nullable ke users.id (bila memakai akun).
- `customer_name` — teks; `customer_whatsapp` — teks.
- `provider_name` — teks, penyedia yang dipilih.
- `start_at` — timestamp mulai; `end_at` — timestamp selesai.
- `status` — teks enum: menunggu | terkonfirmasi | selesai | batal |
  tidak_hadir.
- `note` — teks nullable, catatan pelanggan.
- `created_at`, `updated_at` — timestamp baku.
  Indeks gabungan pada (provider_name, start_at) untuk cek bentrok cepat.

Pembayaran di muka memakai tabel payments baku bayar-doku yang terhubung
lewat referensi booking.

## 6. Aturan UI & komponen

- Kalender bulanan dengan hari yang bisa dipesan aktif, hari libur redup;
  memilih tanggal menampilkan slot jam sebagai tombol besar.
- Slot terisi tampil bergaris/redup dengan label "Penuh" — tidak hilang.
- Ringkasan booking selalu terlihat sebelum konfirmasi: layanan, tanggal,
  jam, durasi, harga (bila ada), dan total waktu.
- Konfirmasi berhasil menampilkan kode booking dan instruksi (datang 10
  menit lebih awal, dsb. dari pemilik).
- Pelanggan melihat booking-nya dan tombol Batalkan yang hilang otomatis
  setelah melewati batas waktu pembatalan.
- Pemilik melihat daftar booking per hari dengan status berwarna dan aksi
  konfirmasi/selesai/tidak hadir.
- Pengingat ditampilkan statusnya di detail booking (terjadwal/terkirim)
  sesuai kenyataan kanal yang aktif.

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
6. Khusus skill ini: dilarang menjanjikan slot tanpa pemeriksaan bentrok
   di server, dan dilarang menandai pengingat "terkirim" bila kanal
   pengiriman belum benar-benar aktif — status harus jujur (terjadwal).
7. Khusus skill ini: dilarang mengarang harga layanan, jam buka, atau
   kapasitas; yang belum diberikan pemilik memakai penanda jelas di
   pengaturan proyek.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Slot dihasilkan dari schedules dan berkurang oleh booking aktif.
- [ ] Dua permintaan bersamaan pada slot yang sama: tepat satu berhasil.
- [ ] Hari libur dan di luar jam buka tidak menawarkan slot.
- [ ] Pembatalan melepaskan slot; batas waktu pembatalan ditegakkan.
- [ ] Status booking hanya berpindah mengikuti urutan yang sah.
- [ ] Pengingat tercatat untuk booking terkonfirmasi dengan status jujur.
- [ ] Booking berbayar (DOKU) yang kedaluwarsa melepaskan slotnya.

Hasil yang diharapkan: pelanggan tidak pernah dijanjikan waktu yang sudah
milik orang lain, dan pemilik bisa memercayai kalendernya.

## 9. Contoh prompt baik

- "Buatkan website booking untuk salon saya: layanan potong, creambath,
  dan coloring, buka 09.00–20.00, dua kapster, bayar di tempat."
- "Sistem reservasi lapangan futsal per jam, buka sampai 23.00, booking
  harus DP dulu lewat DOKU."
- "Aplikasi janji temu klinik gigi dengan jadwal dokter Senin–Sabtu dan
  pengingat WhatsApp sehari sebelumnya."

## 10. Kasus tepi & cara gagal yang jujur

- Layanan berdurasi tidak kelipatan slot (misalnya 45 menit pada slot 30
  menit): slot dihitung dari durasi sebenarnya dan jadwal tampil sebagai
  rentang mulai–selesai, bukan dipaksa membulat diam-diam.
- Pemilik mengubah jam buka setelah ada booking: booking lama tetap
  dihormati dan konfliknya ditampilkan ke pemilik untuk diputuskan —
  tidak dibatalkan otomatis.
- Rental per hari (bukan per jam): model yang sama berlaku dengan slot
  harian; nyatakan unit sewanya dengan jelas di UI.
- Pengingat WhatsApp belum punya kanal aktif: status pengingat "terjadwal
  (kanal belum aktif)" dan pemilik diberi tahu — bukan diklaim terkirim.
- Pelanggan memesan untuk waktu yang sudah lewat: ditolak dengan pesan
  yang jelas, bukan dibuatkan booking lampau.
