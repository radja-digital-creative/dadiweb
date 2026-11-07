---
name: ai-api
version: 1.0.0
family: integrasi
title: AI API — Fitur AI di Dalam Aplikasi Pengguna (Chatbot, Ringkasan, Rekomendasi)
triggers: [ai api, ai, chatbot, chatbot toko, asisten ai, asisten virtual, ringkasan otomatis, ringkasan ai, rekomendasi produk, rekomendasi ai, rekomendasi, fitur ai, kecerdasan buatan, tanya jawab otomatis, chat ai, ai untuk toko]
requires: [database-designer]
optional: [auth-pengguna]
credit_profile: standard
outputs: [endpoint ai per proyek, chatbot toko, ringkasan otomatis, rekomendasi produk, kuota ai per proyek, label belum aktif bila kunci belum terpasang]
---

# AI API — Fitur AI di Dalam Aplikasi Pengguna (Chatbot, Ringkasan, Rekomendasi)

Skill pendukung family integrasi. Menambahkan fitur AI ke DALAM aplikasi pengguna: chatbot toko yang menjawab dari data proyek, ringkasan otomatis, dan rekomendasi produk — semuanya lewat endpoint AI per proyek dengan kuota terpisah. Skill ini bukan generate Dadiweb itu sendiri (itu pipeline platform); ini fitur yang hidup di aplikasi hasil generate. Beda tegas dengan api-rest (endpoint CRUD data): ai-api memanggil model AI, bukan sekadar membaca tabel.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt meminta chatbot, asisten AI, ringkasan otomatis, atau rekomendasi di dalam aplikasi pengguna.
- Aplikasi toko/konten butuh tanya-jawab otomatis dari katalog, artikel, atau data proyeknya sendiri.

TIDAK dipakai ketika:

- Hanya endpoint CRUD tanpa model AI → api-rest.
- Pengguna meminta generate website baru dari prompt → itu pipeline platform Dadiweb, bukan skill ini.
- Aplikasi tidak menyebut fitur AI sama sekali → skill ini tidak dimuat diam-diam.

## 2. Pertanyaan penjernih

1. Fitur AI apa: chatbot, ringkasan, rekomendasi, atau gabungan? Default dari prompt.
2. Sumber jawaban chatbot: data proyek apa (katalog produk, artikel, FAQ)? Default: data proyek yang disebut prompt; di luar itu chatbot menjawab jujur "tidak tahu dari data ini".
3. Batas kuota AI per proyek per bulan berapa? Default dari paket proyek; pemakaian dicatat di ai_usage.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan fitur AI, sumber datanya, dan kuota per proyek; nyatakan bahwa kunci API adalah rahasia per proyek (bagian 7).

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang widget chatbot (gelembung chat, riwayat sesi, penanda "jawaban AI") dan penempatan rekomendasi/ringkasan di halaman.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan endpoint AI sisi server saja: kunci dibaca dari rahasia proyek terenkripsi, tidak pernah dikirim ke browser; setiap pemanggilan memeriksa kuota proyek sebelum memanggil model.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji tanpa kunci terpasang: fitur menampilkan label jujur belum aktif, bukan jawaban karangan. Uji kuota habis: pemanggilan ditolak dengan pesan yang jelas.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki endpoint/kuota yang gagal tanpa pernah mengekspos kunci atau menonaktifkan label belum aktif secara diam-diam.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/components/ChatbotToko.tsx` — widget chat pengunjung (hanya memanggil endpoint server proyek).
- `src/api/ai.ts` — endpoint AI sisi server proyek (membaca kunci dari rahasia proyek, memeriksa kuota, memanggil model).
- `src/admin/ai-pengaturan.tsx` — panel pemilik: status kunci (hanya 4 karakter terakhir), sisa kuota, riwayat pemakaian.
- `db/migrations/NNNN_ai.sql` — ai_quotas, ai_usage (tanpa kolom kunci apa pun).

Aturan bisnis wajib:

- Kunci API tidak pernah ada di bundle client, respons API, log, atau file proyek.
- Pemakaian AI oleh pengunjung aplikasi TIDAK memotong kredit generate pemilik (generate 300, deploy 25, build Android 150 tetap); ia memakai kuota AI proyek sendiri yang tercatat di ai_usage.
- Kuota habis → fitur menolak dengan pesan jelas, bukan jawaban diam-diam dari cache karangan.
- Bila kunci belum terpasang, seluruh fitur AI berlabel jujur belum aktif dan tidak berpura-pura berhasil.

## 5. Skema database baku

Tabel `ai_quotas`: id, monthly_limit integer, used integer default 0, period string (YYYY-MM), created_at, updated_at.

Tabel `ai_usage`: id, feature string (chatbot, ringkasan, rekomendasi), tokens_in integer, tokens_out integer, created_at, updated_at. Tabel ini TIDAK menyimpan isi prompt, jawaban lengkap, atau kunci — hanya hitungan pemakaian untuk kuota dan audit.

Kunci API disimpan HANYA sebagai rahasia per proyek terenkripsi lewat mekanisme rahasia G2 (setprojectsecret), bukan di tabel mana pun di sini.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Widget chatbot: gelembung chat di sudut halaman, riwayat sesi, penanda jelas "jawaban AI — periksa sebelum membeli" pada jawaban yang menyebut harga/stok.
- Rekomendasi: kartu produk dari data proyek saja, dengan alasan rekomendasi yang jujur ("sering dibeli bersama", "kategori sama").
- Ringkasan: tampil sebagai ringkasan dari teks sumber yang ditautkan, bukan klaim baru.
- Panel pemilik: status kunci (aktif/belum terpasang, hanya 4 karakter terakhir), sisa kuota bulan berjalan, dan tombol rotasi kunci.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: kunci API model DILARANG terekspos ke browser dalam bentuk apa pun (bundle client, respons API, log, file proyek, prompt yang dikirim ke model lain). Kunci hanya dibaca sisi server dari rahasia proyek terenkripsi.
7. Khusus skill ini: dilarang memotong kredit generate pemilik untuk pemakaian AI pengunjung; dilarang menampilkan jawaban karangan sebagai jawaban AI saat kunci belum terpasang — fitur wajib berlabel jujur belum aktif.
8. Khusus skill ini: chatbot dilarang mengarang produk, harga, atau stok; jawaban di luar data proyek wajib dinyatakan sebagai tidak diketahui dari data ini.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Kunci tidak ditemukan di bundle client, respons API, log, atau file proyek (pencarian string kunci uji menghasilkan nol).
- [ ] Tanpa kunci terpasang, fitur menampilkan label belum aktif — bukan jawaban palsu.
- [ ] Pemakaian AI tercatat di ai_usage dan tidak mengurangi kredit generate pemilik.
- [ ] Kuota habis menolak pemanggilan dengan pesan yang jelas.
- [ ] Chatbot menjawab dari data proyek; di luar data, ia menyatakan tidak tahu.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Toko online saya butuh chatbot yang menjawab pertanyaan pembeli dari katalog produk, plus rekomendasi produk serupa."
- "Tambahkan ringkasan otomatis untuk artikel blog dan rekomendasi artikel terkait di aplikasi saya."

## 10. Kasus tepi & cara gagal yang jujur

- Kunci belum terpasang: fitur tampil dengan label belum aktif dan panduan memasang kunci untuk pemilik; pengunjung tidak mendapat jawaban palsu.
- Kuota proyek habis: chatbot menampilkan pesan kuota habis dan mengarahkan ke kontak pemilik, bukan jawaban diam-diam.
- Prompt meminta chatbot menjawab dari data proyek lain: ditolak — chatbot hanya membaca data proyek pemiliknya.
