---
name: crm-internal
version: 1.0.0
family: aplikasi-android
title: CRM & Sistem Internal — Pelanggan, Pipeline, Tugas, dan Catatan Follow-Up
triggers: [crm, crm internal, sistem crm, customer relationship, pipeline penjualan, pipeline, follow-up, follow up, kontak pelanggan, prospek, sistem internal, manajemen pelanggan, tugas follow-up]
requires: [database-designer, auth-pengguna, desain-ui]
optional: [laporan-analitik, email-service, whatsapp-api]
credit_profile: standard
outputs: [daftar kontak pelanggan, pipeline deal bertahap, tugas dan pengingat follow-up, catatan follow-up per kontak, tabel contacts deals tasks]
---

# CRM & Sistem Internal — Pelanggan, Pipeline, Tugas, dan Catatan Follow-Up

Skill domain family aplikasi-android (pengelompokan katalog untuk aplikasi/sistem). CRM/sistem internal tim: mengelola kontak pelanggan/prospek, pipeline deal bertahap, tugas, dan catatan follow-up. Beda dengan dashboard-admin umum: dashboard menampilkan/mengelola data yang sudah ada, sedangkan skill ini adalah alur kerja CRM-nya sendiri (kontak → deal → follow-up).

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Prompt menyebut CRM, pipeline penjualan, prospek, follow-up pelanggan, atau sistem internal tim sales/operasional.
- Ada tahap deal yang bergerak (baru → dihubungi → negosiasi → menang/kalah).

TIDAK dipakai ketika:

- Hanya statistik dan CRUD data yang sudah ada tanpa alur kontak/deal → dashboard-admin.
- Penjualan ke publik dengan checkout → toko-online/marketplace.

## 2. Pertanyaan penjernih

1. Tahap pipeline apa saja? Default: baru, dihubungi, negosiasi, menang, kalah.
2. Siapa penggunanya: satu tim sales atau banyak tim? Default: satu tim, semua anggota melihat pipeline tim (peran admin/anggota).
3. Pengingat follow-up lewat apa? Default: daftar tugas di dalam aplikasi; WhatsApp/email hanya bila skill integrasi dipilih (dan berlabel simulasi mengikuti skill-nya).

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan tahap pipeline, peran tim, dan aturan perpindahan deal.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang papan pipeline (kolom per tahap), daftar kontak, dan daftar tugas hari ini.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan CRUD kontak, perpindahan deal antar tahap di server, tugas dengan tenggat dan pemilik tugas, serta catatan follow-up kronologis.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji perpindahan tahap, tugas lewat tenggat terflag, dan catatan tidak bisa diubah diam-diam (koreksi sebagai catatan baru).

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki pipeline/tugas yang gagal tanpa menghapus riwayat catatan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/pipeline.tsx` — papan deal per tahap.
- `src/pages/kontak.tsx` — daftar dan detail kontak + riwayat follow-up.
- `src/pages/tugas.tsx` — tugas saya / tugas tim dan tenggat.
- `db/migrations/NNNN_crm.sql` — contacts, deals, tasks.

Aturan bisnis wajib:

- Setiap deal terikat satu kontak; deal menang/kalah wajib punya catatan penutup.
- Catatan follow-up bersifat kronologis append-only: koreksi dibuat sebagai catatan baru, bukan mengedit sejarah diam-diam.
- Tugas punya pemilik dan tenggat; tugas selesai dicatat waktunya dan oleh siapa.
- Data kontak adalah data pelanggan milik tim ini — tidak tampil publik dan tidak lintas proyek.

## 5. Skema database baku

Tabel `contacts`: id, name, company nullable, phone, email nullable, source, status enum: prospek | pelanggan | tidak_aktif, created_at, updated_at.

Tabel `deals`: id, contact_id (FK contacts), title, value_idr nullable, stage enum tahap pipeline, owner_user_id, closed_note nullable, created_at, updated_at.

Tabel `tasks`: id, contact_id nullable (FK), deal_id nullable (FK), title, due_at, assignee_user_id, status enum: terbuka | selesai | batal, completed_at nullable, created_at, updated_at. Catatan follow-up di tabel follow_ups: contact_id, author_user_id, body, created_at, updated_at.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Papan pipeline: kolom per tahap, kartu deal berisi kontak, nilai (bila ada), dan tugas berikutnya.
- Detail kontak: info kontak, deal aktif, riwayat follow-up kronologis, tombol tambah catatan/tugas.
- Daftar tugas: kelompok Hari Ini / Lewat Tenggat / Nanti, dengan penanda warna tenggat.
- Pencarian kontak menurut nama/perusahaan selalu tersedia.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menampilkan data kontak pelanggan ke publik atau ke proyek lain; CRM bersifat internal dan wajib login (auth-pengguna).
7. Khusus skill ini: dilarang menghapus/mengedit riwayat follow-up diam-diam — integritas catatan adalah aturan bisnis.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Deal berpindah tahap dan nilai pipeline per tahap terhitung benar.
- [ ] Catatan follow-up tampil kronologis dan tidak bisa diedit diam-diam.
- [ ] Tugas lewat tenggat terflag jelas; tugas selesai tercatat waktunya.
- [ ] Halaman CRM menolak pengunjung tanpa login.
- [ ] Kontak/deal proyek lain tidak bisa diakses dari proyek ini.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan CRM internal untuk tim sales properti: ada kontak prospek, pipeline dari baru sampai closing, tugas follow-up dan catatan setiap kontak."
- "Sistem internal untuk mengelola pelanggan dan pipeline penjualan dengan pengingat follow-up."

## 10. Kasus tepi & cara gagal yang jujur

- Tahap pipeline kustom di luar default: simpan sebagai konfigurasi proyek yang tercatat, bukan mengubah enum diam-diam tanpa migrasi.
- Kontak ganda (nomor sama): sistem menandai kemungkinan ganda dan pengguna yang menggabungkan — data tidak digabung otomatis diam-diam.
