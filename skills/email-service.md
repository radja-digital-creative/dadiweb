---
name: email-service
version: 1.0.0
family: integrasi
title: Email Service — Email Transaksional Proyek dengan Template per Proyek (Simulasi)
triggers: [email, email transaksional, kirim email, invoice email, reset kata sandi email, notifikasi email, template email, email service, surat elektronik]
requires: []
optional: [database-designer, auth-pengguna]
credit_profile: standard
outputs: [template email per proyek, email invoice dan reset kata sandi, notifikasi email transaksional, kotak masuk simulasi proyek]
---

# Email Service — Email Transaksional Proyek dengan Template per Proyek (Simulasi)

Skill pendukung family integrasi. Email transaksional untuk proyek pengguna: invoice, reset kata sandi proyek, dan notifikasi, dengan template email per proyek. PENTING: di prototipe pengiriman bersifat SIMULASI mengikuti pola Kotak Masuk Simulasi prototipe — email dicatat di kotak masuk simulasi proyek, BUKAN dikirim sebagai email asli, sampai layanan email produksi milik platform/pemilik dipasang.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek perlu mengirim email transaksional: bukti/invoice, reset kata sandi proyek, notifikasi akun/pesanan.
- Prompt menyebut email transaksional, template email, atau email service untuk proyeknya.

TIDAK dipakai ketika:

- Email pemasaran massal/newsletter promosi → di luar cakupan skill transaksional ini.
- Email platform Dadiweb itu sendiri (verifikasi akun Dadiweb) → wilayah platform, bukan proyek.

## 2. Pertanyaan penjernih

1. Email transaksional apa saja: invoice, reset kata sandi, notifikasi pesanan/booking? Default mengikuti skill domain proyek.
2. Nama dan alamat pengirim tampil sebagai apa? Default: nama proyek; alamat pengirim asli menunggu layanan email produksi — di prototipe berlabel simulasi.
3. Template boleh diedit pemilik per proyek? Default: ya, subjek + isi Bahasa Indonesia tersimpan per proyek.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan jenis email, pemicu, penerima, dan template per jenis.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang template email sederhana yang terbaca di ponsel: subjek jelas, isi singkat, tombol/tautan aksi, label simulasi di pratinjau proyek.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan pengiriman ke kotak masuk simulasi proyek dengan pencatatan status simulasi; token reset proyek mengikuti aturan auth-pengguna (hash, sekali pakai, kedaluwarsa).

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji email invoice/reset tercatat di kotak masuk simulasi dengan isi benar dan token reset hanya bisa dipakai sekali.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki template/pemicu yang gagal tanpa mengklaim email asli terkirim.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/email/template.ts` — template email per proyek per jenis.
- `src/email/kirim.ts` — pemicu + pencatatan ke kotak masuk simulasi.
- `src/pages/pengaturan-email.tsx` — edit template + pratinjau + label simulasi.
- Kotak masuk simulasi proyek memakai pola simulated inbox prototipe.

Aturan bisnis wajib:

- Semua email di prototipe berstatus SIMULASI dan berlabel jelas di UI/pengaturan — tidak ada klaim email asli terkirim.
- Token reset kata sandi proyek: hanya hash yang disimpan, sekali pakai, kedaluwarsa mengikuti auth-pengguna; token mentah hanya muncul di kotak masuk simulasi penerima.
- Email hanya ke penerima yang terkait transaksi/akun proyek itu; tidak ada daftar email dari proyek lain.
- Isi invoice email sama persis dengan invoice di aplikasi (jumlah dari server).

## 5. Skema database baku

Tabel template & catatan pengiriman proyek (lewat database-designer bila pencatatan dipilih): email_templates — id, kind (invoice | reset_password | notifikasi), subject, body, created_at, updated_at. email_logs — id, kind, recipient_email, related_ref, status enum: simulasi_tercatat | gagal, created_at, updated_at. Token reset tidak disimpan mentah di tabel mana pun (hanya hash, mengikuti auth-pengguna).

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Pengaturan email: daftar jenis email, edit subjek/isi, pratinjau dengan data contoh bertanda contoh.
- Banner kuning: "Pengiriman email bersifat simulasi di prototipe — pesan tampil di Kotak Masuk Simulasi, bukan email asli."
- Kotak masuk simulasi proyek: daftar pesan dengan subjek, waktu, dan tombol pakai token untuk reset/verifikasi (pola prototipe).
- Status di riwayat transaksi: "Invoice tercatat di kotak masuk simulasi", bukan "Email terkirim".

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengklaim email asli terkirim selama mode simulasi dan dilarang menghapus label simulasi dari UI maupun status.
7. Khusus skill ini: dilarang mengirim email ke alamat yang dikumpulkan dari proyek lain, dan dilarang menyimpan token reset mentah di database/log.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Email invoice/reset/notifikasi tercatat di kotak masuk simulasi dengan isi dan jumlah yang benar.
- [ ] Token reset dari email simulasi hanya bisa dipakai sekali dan kedaluwarsa ditolak.
- [ ] Semua status dan banner berlabel simulasi dengan jelas.
- [ ] Template per proyek bisa diedit dan pratinjaunya memakai data contoh bertanda.
- [ ] Tidak ada token mentah tersimpan di database/log.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Proyek toko saya perlu email invoice otomatis dan email reset kata sandi untuk pelanggan, template-nya bisa saya edit."
- "Tambahkan email transaksional untuk booking: konfirmasi dan pengingat lewat email (simulasi dulu tidak apa-apa, yang penting template-nya siap)."

## 10. Kasus tepi & cara gagal yang jujur

- Layanan email produksi belum dipasang: hasil yang jujur adalah simulasi berlabel penuh — bukan kegagalan generate dan bukan klaim terkirim.
- Alamat penerima tidak valid: catatan pengiriman gagal dengan alasan format, tidak diklaim terkirim.
- Pemilik meminta mematikan label simulasi: ditolak — label kejujuran adalah aturan platform.
