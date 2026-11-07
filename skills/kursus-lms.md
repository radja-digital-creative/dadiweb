---
name: kursus-lms
version: 1.0.0
family: commerce-bisnis
title: Kursus & LMS — Kursus Online, Modul, Materi, Progres Siswa, dan Sertifikat Sederhana
triggers: [kursus online, kursus, lms, learning management, kelas online, modul belajar, materi kursus, platform kursus, e-learning, pembelajaran online, sertifikat kursus, siswa kursus]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [bayar-doku, email-service]
credit_profile: standard
outputs: [katalog kursus, modul dan materi per kursus, pendaftaran siswa, progres belajar, sertifikat sederhana, tabel courses lessons enrollments]
---

# Kursus & LMS — Kursus Online, Modul, Materi, Progres Siswa, dan Sertifikat Sederhana

Skill domain family commerce-bisnis. Kursus online/LMS sederhana: kursus tersusun modul dan materi (lessons), siswa mendaftar, progres belajar tercatat per materi, dan sertifikat sederhana diterbitkan bila kursus selesai.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt menyebut kursus online, kelas online, LMS, e-learning, modul/materi, atau sertifikat kursus.
- Ada siswa yang belajar bertahap dan progresnya perlu dicatat.

TIDAK dipakai ketika:

- Satu halaman promosi kursus tanpa sistem belajar → landing-page.
- Sekolah/manajemen siswa umum tanpa kursus online → dashboard-admin atau klarifikasi.

## 2. Pertanyaan penjernih

1. Kursusnya gratis, berbayar (bayar-doku), atau campuran? Default: gratis; berbayar hanya bila disebut.
2. Materi berbentuk teks, tautan video, atau file? Default: teks + tautan video dari pemilik kursus.
3. Sertifikat diterbitkan otomatis saat progres 100% atau disetujui pengajar? Default: otomatis dengan nama siswa dan judul kursus, nomor sertifikat unik.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan struktur kursus → modul → materi dan aturan selesai per materi.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang katalog kursus, halaman belajar (daftar materi + konten), dan penanda progres yang jelas.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan pendaftaran (enrollment), penanda materi selesai di server, hitung progres, dan penerbitan sertifikat.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji progres tidak bisa dilompati dengan memalsukan status dari browser; uji sertifikat hanya terbit di progres penuh.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki progres/sertifikat yang gagal tanpa membuka jalan pintas penyelesaian.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/kursus.tsx` — katalog dan detail kursus.
- `src/pages/belajar.tsx` — halaman materi + tandai selesai.
- `src/pages/sertifikat.tsx` — sertifikat siswa.
- `src/pengajar/` — kelola kursus, modul, materi, daftar siswa.
- `db/migrations/NNNN_lms.sql` — courses, lessons, enrollments, dan progres per materi.

Aturan bisnis wajib:

- Siswa hanya mengakses materi kursus tempat ia terdaftar (kecuali materi pratinjau yang ditandai pemilik).
- Progres dihitung server dari materi selesai; klaim selesai dari browser tidak dipercaya.
- Sertifikat hanya terbit bila progres 100%, berisi nama siswa, judul kursus, tanggal, nomor unik — tanpa klaim akreditasi.
- Materi dan harga kursus hanya dari pemilik; dilarang mengarang isi kursus sebagai materi resmi.

## 5. Skema database baku

Tabel `courses`: id, title, description, price_idr nullable, is_published boolean, created_at, updated_at.

Tabel `lessons`: id, course_id (FK courses), module_name, title, content (teks/tautan materi), sort_order, is_preview boolean, created_at, updated_at.

Tabel `enrollments`: id, course_id (FK), student_user_id, status enum: aktif | selesai | berhenti, enrolled_at (created_at), completed_at nullable, certificate_number nullable unik, created_at, updated_at. Progres per materi di tabel lesson_progress: enrollment_id, lesson_id, completed_at, unik gabungan.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Katalog kursus: kartu dengan judul, ringkasan, jumlah materi, harga/gratis.
- Halaman belajar: daftar materi di sisi kiri/atas, konten materi, tombol Tandai Selesai, bilah progres.
- Sertifikat: tata letak satu halaman siap unduh/cetak browser, nomor sertifikat terlihat.
- Panel pengajar: susun modul/materi dengan urutan seret atau naik/turun sederhana.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengklaim sertifikat terakreditasi resmi (nasional/internasional) — sertifikat adalah tanda selesai internal kursus ini.
7. Khusus skill ini: materi berhak cipta milik pihak lain tidak boleh disalin oleh skill; materi hanya dari pemilik kursus.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Siswa belum terdaftar tidak bisa membuka materi non-pratinjau.
- [ ] Progres dihitung server dan berubah hanya lewat materi yang ditandai selesai.
- [ ] Sertifikat hanya terbit pada progres 100% dengan nomor unik.
- [ ] Tidak ada klaim akreditasi pada sertifikat/halaman.
- [ ] Pengajar bisa menyusun modul/materi dan urutannya tampil benar ke siswa.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan platform kursus online memasak: ada modul dan materi video, siswa bisa daftar, progres belajar tercatat, dapat sertifikat sederhana setelah selesai."
- "LMS sederhana untuk kursus bahasa dengan kelas online dan materi per modul."

## 10. Kasus tepi & cara gagal yang jujur

- Kursus berbayar tanpa bayar-doku aktif: pendaftaran berbayar berjalan mode simulasi berlabel mengikuti bayar-doku, bukan diklaim lunas asli.
- Siswa meminta sertifikat tanpa menyelesaikan materi: ditolak sopan dengan sisa progresnya.
- Materi berupa file besar: catat sebagai unggahan proyek mengikuti kuota Executor; tolak sebelum menulis bila kuota tidak cukup.
