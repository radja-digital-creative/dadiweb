---
name: klinik-layanan
version: 1.0.1
family: commerce-bisnis
title: Klinik & Layanan Kesehatan — Antrean, Rekam Kunjungan Dasar, dan Jadwal Dokter/Praktisi
triggers: [klinik layanan, antrean, nomor antrean, antrean pasien, rekam kunjungan, kunjungan pasien, jadwal praktisi, poli, layanan kesehatan, manajemen klinik, sistem klinik, antrean klinik, klinik, catatan kunjungan, pendaftaran pasien, antrean harian, jadwal dokter]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [booking-reservasi, whatsapp-api, email-service]
credit_profile: standard
outputs: [sistem antrean pasien, rekam kunjungan dasar, jadwal dokter dan praktisi, panel staf klinik, tabel patients visits queues]
---

# Klinik & Layanan Kesehatan — Antrean, Rekam Kunjungan Dasar, dan Jadwal Dokter/Praktisi

Skill domain family commerce-bisnis. Operasional klinik/layanan kesehatan skala kecil: pendaftaran dan antrean pasien, rekam kunjungan DASAR (administratif: tanggal, poli, praktisi, keluhan umum yang ditulis pasien, status kunjungan), dan jadwal dokter/praktisi. Skill ini BUKAN sistem rekam medis elektronik resmi — lihat larangan keras bagian 7. Beda dengan booking-reservasi umum: booking mengatur janji temu/slot untuk layanan apa pun, sedangkan skill ini mengatur antrean berjalan dan kunjungan layanan kesehatan.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt menyebut klinik/layanan kesehatan dengan antrean pasien, nomor antrean, rekam kunjungan, atau jadwal praktisi/poli.
- Ada staf klinik yang memanggil antrean dan mencatat kunjungan dasar.

TIDAK dipakai ketika:

- Janji temu/slot umum tanpa konteks antrean layanan kesehatan (salon, lapangan, rental, klinik gigi yang hanya booking jadwal dokter) → booking-reservasi.
- Klaim kepatuhan rekam medis elektronik resmi, diagnosis/terapi/resep sebagai sistem medis resmi → DITOLAK sebagai klaim; skill ini hanya administrasi kunjungan dasar (bagian 7).

## 2. Pertanyaan penjernih

1. Poli/layanan apa saja dan praktisinya siapa? Default dari prompt; jadwal diisi staf klinik.
2. Antrean dari pendaftaran di tempat, daftar online, atau keduanya? Default: keduanya, satu urutan nomor per poli per hari.
3. Data kunjungan dasar apa yang dicatat staf? Default administratif saja: poli, praktisi, waktu, status, catatan umum kunjungan — bukan rekam medis resmi.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan poli, praktisi, alur antrean harian, dan batas data kunjungan dasar (administratif).

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang layar antrean publik (nomor berjalan), pendaftaran pasien, dan panel staf pemanggil antrean.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan nomor antrean unik per poli per hari di server, pemanggilan antrean, dan catatan kunjungan dasar terikat pasien.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji nomor antrean tidak ganda pada pendaftaran bersamaan; uji akses kunjungan hanya oleh staf proyek ini.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki antrean/kunjungan yang gagal tanpa melonggarkan isolasi data pasien.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/antrean.tsx` — layar publik nomor antrean berjalan per poli.
- `src/pages/daftar-kunjungan.tsx` — pendaftaran pasien dan ambil nomor antrean.
- `src/staf/antrean.tsx` — panel staf: panggil, lewati, selesaikan antrean.
- `src/staf/kunjungan.tsx` — rekam kunjungan dasar pasien.
- `db/migrations/NNNN_klinik.sql` — patients, visits, queues.

Aturan bisnis wajib:

- Nomor antrean diterbitkan server, unik per poli per hari, tidak bisa ditebak/diubah pasien.
- Rekam kunjungan bersifat dasar/administratif dan hanya bisa diakses staf berwenang proyek ini.
- Data pasien hanya milik proyek klinik ini; tidak tampil publik selain nomor antrean berjalan (tanpa nama lengkap di layar publik — tampilkan inisial/nomor saja).
- Jadwal praktisi diisi staf; sistem tidak mengarang jadwal dokter.

## 5. Skema database baku

Tabel `patients`: id, name, contact (WhatsApp/telepon), birth_year integer nullable (hanya bila diperlukan pendaftaran), note umum pendaftaran, created_at, updated_at. Hindari kolom kesehatan sensitif di luar kebutuhan kunjungan dasar.

Tabel `visits`: id, patient_id (FK patients), poli, practitioner_name, visit_date, complaint_general (teks umum dari pasien, administratif), status enum: terdaftar | dilayani | selesai | batal, created_at, updated_at.

Tabel `queues`: id, visit_id (FK visits), poli, queue_number, queue_date, status enum: menunggu | dipanggil | dilayani | dilewati | selesai, called_at nullable, created_at, updated_at. Indeks gabungan (poli, queue_date, queue_number) unik.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Layar publik antrean: nomor yang sedang dipanggil besar dan jelas per poli, tanpa nama lengkap pasien.
- Pendaftaran: formulir singkat (nama, kontak, poli, keluhan umum), lalu nomor antrean besar sebagai bukti.
- Panel staf: daftar antrean per poli dengan tombol Panggil Berikutnya, Lewati, Selesai.
- Jadwal praktisi tampil sebagai tabel hari/jam per poli.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini — WAJIB: skill ini TIDAK BOLEH mengklaim kepatuhan rekam medis elektronik (RME) resmi, standar medis, atau regulasi kesehatan apa pun. Setiap halaman/hasil yang menyebut rekam kunjungan WAJIB menyatakan ini catatan kunjungan dasar administratif, bukan rekam medis elektronik resmi.
7. Khusus skill ini — WAJIB: TIDAK BOLEH menyimpan data kesehatan sensitif (diagnosis rinci, hasil lab, resep, riwayat penyakit) di luar aturan isolasi Bab 5 katalog: data hanya di skema per proyek (proj_<project_id>), diakses kredensial per proyek, rahasia terenkripsi, dan tidak pernah keluar ke proyek/platform lain. Bila pengguna meminta menyimpan data kesehatan sensitif di luar aturan itu, tolak dan jelaskan batasnya.
8. Khusus skill ini: nama lengkap pasien tidak boleh tampil di layar antrean publik; data pasien tidak boleh dipakai untuk pemasaran atau dibagikan ke pihak ketiga dari skill ini.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Nomor antrean unik per poli per hari, termasuk pendaftaran bersamaan.
- [ ] Layar publik hanya menampilkan nomor/inisial, bukan nama lengkap pasien.
- [ ] Kunjungan dasar hanya bisa dibuka staf proyek ini; proyek lain ditolak.
- [ ] Tidak ada klaim kepatuhan RME resmi di halaman, teks hasil, atau dokumentasi proyek.
- [ ] Tidak ada kolom/data kesehatan sensitif di luar batas kunjungan dasar dan aturan isolasi.
- [ ] Jadwal praktisi hanya dari isian staf, bukan karangan.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan sistem klinik dengan antrean pasien per poli, staf bisa panggil nomor antrean, ada rekam kunjungan dasar dan jadwal dokter."
- "Aplikasi antrean untuk klinik umum: pasien daftar online dapat nomor antrean, ada jadwal praktisi per poli."

## 10. Kasus tepi & cara gagal yang jujur

- Pengguna meminta fitur rekam medis elektronik resmi/diagnosis/resep resmi: tolak klaim itu dengan jujur, tawarkan batas kunjungan dasar administratif skill ini, status needs_clarification bila tetap dipaksakan.
- Prompt klinik gigi yang hanya janji temu dan jadwal dokter tanpa antrean/kunjungan: itu booking-reservasi — jangan rebut dengan skill ini.
- Pasien mendaftar dua kali di poli sama hari sama: sistem menandai kunjungan ganda dan staf yang memutuskan, bukan menghapus diam-diam.
