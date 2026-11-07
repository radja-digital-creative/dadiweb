---
name: whatsapp-api
version: 1.0.0
family: integrasi
title: WhatsApp API — Notifikasi dan Tombol Chat WhatsApp (Simulasi Pengiriman)
triggers: [whatsapp, wa, notifikasi whatsapp, tombol chat, chat whatsapp, konfirmasi pesanan whatsapp, pengingat booking whatsapp, template pesan whatsapp, whatsapp api]
requires: []
optional: [database-designer]
credit_profile: standard
outputs: [tombol chat whatsapp, template pesan bahasa indonesia, notifikasi konfirmasi dan pengingat, catatan pengiriman simulasi]
---

# WhatsApp API — Notifikasi dan Tombol Chat WhatsApp (Simulasi Pengiriman)

Skill pendukung family integrasi. Notifikasi dan tombol chat WhatsApp untuk proyek: tombol chat (wa.me), konfirmasi pesanan, pengingat booking, dan template pesan Bahasa Indonesia. PENTING: di prototipe pengiriman bersifat SIMULASI berlabel jujur (mengikuti pola label simulasi prototipe) — bukan pengiriman WhatsApp asli, sampai kredensial WhatsApp Business milik pemilik proyek dipasang di produksi.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek perlu tombol chat WhatsApp, konfirmasi pesanan via WhatsApp, atau pengingat booking via WhatsApp.
- Prompt menyebut WhatsApp, WA, notifikasi WA, atau template pesan.

TIDAK dipakai ketika:

- Pesan antar pengguna di dalam aplikasi (chat internal) → fitur domain (mis. chat dasar marketplace), bukan WhatsApp.
- Mengirim WhatsApp massal promosi ke nomor yang tidak memberi izin → ditolak (spam).

## 2. Pertanyaan penjernih

1. Nomor WhatsApp tujuan/pengirim milik siapa? Default: nomor pemilik proyek dari pengaturan; jangan mengarang nomor.
2. Kejadian apa yang memicu pesan: pesanan baru, booking terkonfirmasi, pengingat H-1? Default mengikuti skill domain proyek.
3. Isi template boleh diedit pemilik? Default: ya, template Bahasa Indonesia tersimpan per proyek.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan kejadian pemicu, penerima, dan template per kejadian.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang tombol chat mengambang/kontekstual dan pratinjau template di pengaturan proyek, lengkap dengan label Simulasi.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan tautan wa.me dengan pesan terisi, antrean notifikasi, dan pencatatan status pengiriman sebagai SIMULASI selama kredensial asli belum terpasang.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji template terisi data pesanan/booking yang benar; uji status tercatat simulasi, bukan terkirim asli.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki template/antrean yang gagal tanpa menghapus label simulasi.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/whatsapp/tombol-chat.tsx` — tombol chat wa.me kontekstual.
- `src/whatsapp/template.ts` — template pesan Bahasa Indonesia per kejadian.
- `src/whatsapp/notifikasi.ts` — antrean + pencatatan status pengiriman (simulasi).
- `src/pages/pengaturan-whatsapp.tsx` — nomor pemilik + edit template + label simulasi.

Aturan bisnis wajib:

- Status pengiriman WAJIB berlabel "Simulasi" selama kredensial WhatsApp Business asli pemilik proyek belum terpasang dan terverifikasi.
- Pesan hanya untuk kejadian transaksional proyek (konfirmasi, pengingat) ke penerima yang terkait transaksi itu.
- Template memakai data server (nomor pesanan, jadwal), bukan data dari browser.
- Nomor telepon penerima tidak ditampilkan publik dan tidak dibagikan lintas proyek.

## 5. Skema database baku

Tabel antrean notifikasi proyek (bila pencatatan dipilih, lewat database-designer): notifications — id, event (konfirmasi_pesanan | pengingat_booking | lainnya), recipient_phone, template_name, status enum: simulasi_tercatat | menunggu | gagal, related_ref, created_at, updated_at. Yang disimpan status dan referensinya — isi pesan lengkap berisi data pribadi tidak disimpan lebih lama dari kebutuhan antrean.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Tombol chat: ikon + label "Chat WhatsApp", membuka wa.me nomor pemilik dengan pesan awal sopan.
- Pengaturan: daftar template dengan pratinjau pesan terisi data contoh yang ditandai contoh.
- Banner kuning di pengaturan dan catatan status: "Pengiriman WhatsApp bersifat simulasi di prototipe — pesan dicatat, bukan dikirim lewat WhatsApp asli."
- Status notifikasi di detail pesanan/booking tampil sebagai Simulasi/Tercatat, bukan "Terkirim" palsu.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengklaim pesan WhatsApp terkirim asli selama mode simulasi, dan dilarang menghapus label simulasi.
7. Khusus skill ini: dilarang mengirim/menyiapkan pengiriman massal ke nomor tanpa izin penerima (spam) dan dilarang memakai nomor dari proyek lain.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Tombol chat membuka nomor pemilik yang benar dengan pesan terisi sesuai konteks.
- [ ] Template terisi data server yang benar untuk konfirmasi dan pengingat.
- [ ] Semua status pengiriman berlabel simulasi selama kredensial asli belum ada.
- [ ] Tidak ada nomor penerima yang tampil publik.
- [ ] Kejadian pemicu yang benar menghasilkan tepat satu catatan notifikasi.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Tambahkan notifikasi WhatsApp untuk toko saya: konfirmasi pesanan dan tombol chat WhatsApp di halaman produk."
- "Booking salon saya perlu pengingat WhatsApp sehari sebelum jadwal, template-nya Bahasa Indonesia."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik belum memasang kredensial WhatsApp Business: seluruh alur jalan sebagai simulasi berlabel — itu hasil yang jujur, bukan kegagalan.
- Nomor penerima tidak valid: notifikasi dicatat gagal dengan alasan format, bukan diklaim terkirim.
- Pengguna meminta blast promosi ke daftar nomor belian: tolak — di luar izin penerima dan di luar cakupan skill ini.
