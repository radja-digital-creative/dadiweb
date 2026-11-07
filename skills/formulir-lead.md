---
name: formulir-lead
version: 1.0.0
family: web-konten
title: Formulir & Lead — Formulir Pendaftaran, Survei, dan Kuis Lead-Generation
triggers: [formulir, formulir pendaftaran, formulir kontak, formulir survei, form, form pendaftaran, form survei, survei, survey, kuis, kuesioner, angket, pendaftaran peserta, pendaftaran webinar, pendaftaran event, lead generation, pengumpul lead, form online, formulir lead]
requires: [database-designer, desain-ui]
optional: [whatsapp-api, email-service]
credit_profile: standard
outputs: [formulir dinamis multi-langkah, halaman terima kasih, tabel forms form_fields submissions, rekap jawaban, notifikasi lead baru]
---

# Formulir & Lead — Formulir Pendaftaran, Survei, dan Kuis Lead-Generation

Skill domain family web-konten. Formulir dinamis untuk mengumpulkan lead: pendaftaran peserta, survei kepuasan, kuis lead-generation, dan formulir kontak yang jawabannya tersimpan rapi dan bisa direkap pemilik. Beda tegas dengan landing-page (satu halaman promosi dengan CTA) dan company-profile (profil perusahaan multi-halaman): skill ini fokus pada pengisian, validasi, dan penyimpanan jawaban — bukan pada promosi atau profil.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt menyebut formulir, pendaftaran, survei, kuis, kuesioner, atau pengumpul lead.
- Pemilik butuh jawaban pengunjung tersimpan dan bisa dilihat/diekspor, bukan sekadar tombol chat.
- Formulir menempel pada website (pendukung chip "Website" bersama desain-ui dan seo-performa) atau berdiri sebagai halaman formulir sendiri.

TIDAK dipakai ketika:

- Ada keranjang/checkout/pembayaran → toko-online atau marketplace.
- Fokusnya jadwal/slot yang dipesan → booking-reservasi.
- Hanya halaman promosi tanpa penyimpanan jawaban → landing-page.

## 2. Pertanyaan penjernih

1. Formulir ini untuk apa: pendaftaran, survei, kuis, atau kontak? Default dari prompt.
2. Bidang apa saja dan mana yang wajib? Bila belum dirinci, pakai bidang baku: nama, kontak (WhatsApp/email), dan satu pertanyaan terbuka — sisanya tidak dikarang.
3. Setelah mengirim, pengunjung diarahkan ke mana (halaman terima kasih, WhatsApp, atau keduanya)? Default: halaman terima kasih.
4. Apakah jawaban perlu notifikasi ke pemilik (WhatsApp/email)? Default: rekap di panel kelola; notifikasi hanya bila pemilik meminta dan jalurnya tersedia.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan jenis formulir dan daftar bidang beserta aturan wajib/opsionalnya; bidang sensitif tidak pernah masuk daftar (bagian 7).

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang formulir multi-langkah yang ramah ponsel: satu pertanyaan per layar untuk survei panjang, validasi inline, dan indikator progres.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan validasi sisi server untuk setiap bidang (tipe, wajib, panjang) dan penyimpanan jawaban ke submissions.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji kirim formulir end-to-end: jawaban tersimpan, rekap tampil, halaman terima kasih muncul.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki validasi/rekap yang gagal tanpa menambahkan bidang sensitif diam-diam.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/formulir.tsx` — halaman formulir dinamis (multi-langkah bila perlu).
- `src/pages/formulir-terima-kasih.tsx` — halaman terima kasih setelah kirim.
- `src/admin/leads.tsx` — kelola formulir, lihat rekap dan daftar submissions.
- `db/migrations/NNNN_formulir.sql` — forms, form_fields, submissions.

Aturan bisnis wajib:

- Setiap jawaban tersimpan terikat formulir dan proyek pemilik; tidak ada jawaban lintas proyek.
- Bidang wajib tidak bisa dilewati; jawaban kosong pada bidang wajib ditolak dengan pesan yang jelas.
- Satu pengiriman = satu submission; pengiriman ganda tidak menimpa submission sebelumnya.
- Rekap menampilkan hitungan per jawaban pilihan dan daftar submissions terbaru; ekspor hanya milik proyek peminta.

## 5. Skema database baku

Tabel `forms`: id, title, description, is_active, created_at, updated_at.

Tabel `form_fields`: id, form_id (FK forms), label, field_type (text, email, phone, select, radio, checkbox, textarea, number, date), is_required boolean, options_json nullable, sort_order integer, created_at, updated_at.

Tabel `submissions`: id, form_id (FK forms), answers_json, created_at, updated_at. answers_json hanya berisi jawaban atas bidang yang didefinisikan di form_fields; tidak pernah ada kolom untuk kata sandi, nomor kartu, atau data sensitif lain (bidang semacam itu ditolak sejak perancangan, bagian 7).

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Formulir: label jelas di atas bidang, pesan error inline di bawah bidang yang salah, tombol kirim besar dan mudah ditekan di ponsel.
- Survei panjang: satu pertanyaan per layar dengan indikator progres dan tombol kembali.
- Kuis lead-generation: hasil kuis tampil langsung setelah kirim, dengan ajakan tindak lanjut yang jujur (bukan janji hasil yang dikarang).
- Panel kelola: daftar submissions dengan pencarian, rekap jawaban pilihan dalam bentuk hitungan, dan tombol ekspor CSV milik proyek.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: formulir DILARANG mengumpulkan kata sandi (plaintext maupun hash), nomor kartu, CVV, PIN, OTP, nomor rekening, NIK/KTP, atau data kesehatan sensitif. Prompt jebakan yang meminta formulir semacam itu wajib ditolak atau dialihkan ke jalur yang benar (auth-pengguna untuk login, bayar-doku untuk pembayaran) — bukan dibangun apa adanya.
7. Khusus skill ini: dilarang menambahkan bidang sensitif diam-diam ke formulir yang sudah disepakati; setiap bidang baru harus terlihat di panel kelola pemilik.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Tidak ada bidang kata sandi, kartu, atau data sensitif lain di formulir mana pun.
- [ ] Kirim formulir tersimpan sebagai satu submission dan tampil di rekap pemilik.
- [ ] Bidang wajib tidak bisa dilewati; pesan error inline jelas.
- [ ] Halaman terima kasih muncul setelah kirim berhasil.
- [ ] Ekspor submissions hanya memuat data proyek peminta.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan formulir pendaftaran webinar dengan nama, email, dan nomor WhatsApp, plus halaman terima kasih."
- "Survei kepuasan pelanggan 10 pertanyaan dengan rekap jawaban yang bisa saya lihat dan ekspor."

## 10. Kasus tepi & cara gagal yang jujur

- Pemilik meminta formulir "login" atau "pembayaran": tolak sebagai formulir; arahkan ke auth-pengguna atau bayar-doku lewat klarifikasi.
- Daftar bidang belum dirinci: pakai bidang baku (nama, kontak, satu pertanyaan terbuka), status partial pada kelengkapan formulir.
- Prompt berkembang meminta checkout: klarifikasi beralih ke toko-online, jangan menambal formulir menjadi toko setengah jadi.
