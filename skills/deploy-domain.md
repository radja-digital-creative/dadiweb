---
name: deploy-domain
version: 1.0.0
family: platform-kualitas
title: Deploy & Domain — Subdomain dadiweb.id, Domain Custom, SSL, Riwayat dan Rollback Deploy
triggers: [deploy, deployment, domain, domain custom, subdomain, ssl, rollback deploy, riwayat deploy, publikasikan, tayang online, dadiweb.id]
requires: []
optional: [seo-performa]
credit_profile: standard
outputs: [alur deploy ke subdomain dadiweb.id, pengaturan domain custom dan ssl, riwayat deploy per versi, rollback ke versi sebelumnya]
---

# Deploy & Domain — Subdomain dadiweb.id, Domain Custom, SSL, Riwayat dan Rollback Deploy

Skill pendukung family platform-kualitas. Mengatur penayangan proyek selaras Deploy Center yang sudah ada: deploy ke subdomain *.dadiweb.id, domain custom dengan verifikasi dan SSL, riwayat deploy per versi, dan rollback ke versi live sebelumnya. Tarif deploy mengikuti tarif platform yang berlaku — skill ini tidak menetapkan tarif sendiri. Pemeriksaan DNS live dan penerbitan sertifikat asli berjalan di gateway produksi; di prototipe statusnya mengikuti pola simulasi berlabel jujur Deploy Center.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pengguna menayangkan proyeknya, mengganti domain, memeriksa riwayat deploy, atau rollback.
- Prompt menyebut deploy, domain custom, subdomain, SSL, rollback, atau publikasikan/tayang.

TIDAK dipakai ketika:

- Membuat isi websitenya → skill domain proyek itu; skill ini hanya penayangannya.
- Membeli domain baru dari registrar → di luar cakupan; skill ini menghubungkan domain yang sudah dimiliki pengguna.

## 2. Pertanyaan penjernih

1. Subdomain *.dadiweb.id yang diinginkan apa? Default: dari slug proyek; bentrok subdomain ditolak dengan saran alternatif.
2. Ada domain custom yang mau dihubungkan? Default: tidak; subdomain tetap aktif sebagai cadangan.
3. Rollback ke versi mana bila diminta? Wajib menyebut versi dari riwayat; rollback tidak menebak versi.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan target tayang (subdomain/domain custom) dan versi yang akan ditayangkan dari hasil Builder.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang panel deploy proyek: status tayang, alamat aktif, riwayat versi, dan tombol rollback dengan konfirmasi (selaras Deploy Center).

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan deploy sebagai baris riwayat BARU (append-only): versi live lama menjadi superseded, deploy/redeploy/rollback dibedakan jenisnya; domain custom lewat alur TXT verifikasi → aktif + SSL seperti Deploy Center.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji deploy pertama, redeploy, dan rollback: tepat satu versi live setiap saat dan riwayat tidak terhapus.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki alur deploy/rollback yang gagal tanpa menghapus riwayat versi lama.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- Panel Domain & Deploy proyek memakai Deploy Center yang sudah ada (halaman deploy).
- `deploy/riwayat` — tampilan riwayat deploy per proyek dari tabel deployments.
- Pengaturan domain custom memakai tabel custom_domains yang sudah ada (verifikasi TXT, status, SSL).

Aturan bisnis wajib:

- Riwayat deploy append-only: setiap deploy/redeploy/rollback adalah baris baru; tepat satu versi berstatus live per proyek.
- Rollback menerbitkan ulang versi lama sebagai baris live BARU berjenis rollback (bukan mengedit sejarah) dan mengikuti aturan Deploy Center (rollback tidak memotong kredit deploy baru bila platform menetapkannya gratis — ikuti tarif platform yang berlaku, jangan karang tarif).
- Domain custom aktif hanya setelah verifikasi kepemilikan (TXT) berhasil; SSL mengikuti status verifikasi itu.
- Subdomain *.dadiweb.id unik; bentrok ditolak sebelum tayang.

## 5. Skema database baku

Skill ini memakai skema Deploy Center yang sudah ada dan tidak membuat tabel tandingan: deployments — id, project_id, subdomain, status enum: live | building | failed | superseded, kind enum: deploy | redeploy | rollback, note, created_at, updated_at. custom_domains — id, project_id, domain, status enum: pending | verified | active, verification_token, is_primary, ssl_status, created_at, updated_at.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Panel deploy menampilkan: alamat aktif (subdomain/domain primer), status SSL, versi live saat ini.
- Riwayat deploy: daftar versi dengan waktu, jenis (deploy/redeploy/rollback), status, dan tombol Rollback pada versi superseded.
- Alur domain custom: tambah domain → tampilkan TXT record → tombol Verifikasi → status aktif + SSL, dengan label jujur bahwa pemeriksaan DNS live berjalan di gateway produksi.
- Konfirmasi rollback menyebut versi tujuan dan versi live yang akan digantikan.

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menghapus/menulis ulang riwayat deploy dan dilarang menayangkan dua versi live sekaligus untuk satu proyek.
7. Khusus skill ini: dilarang mengklaim domain terverifikasi/SSL aktif sebelum verifikasi berhasil, dan dilarang menetapkan tarif deploy sendiri — tarif mengikuti platform.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Deploy pertama menghasilkan tepat satu versi live dengan subdomain benar.
- [ ] Redeploy membuat baris baru dan versi live lama menjadi superseded.
- [ ] Rollback menerbitkan versi lama sebagai baris rollback live baru; riwayat lama tetap ada.
- [ ] Domain custom tidak aktif sebelum verifikasi TXT berhasil.
- [ ] Subdomain bentrok ditolak sebelum ada versi yang tayang.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Deploy proyek toko saya ke subdomain dadiweb.id dan hubungkan domain custom saya, lengkap dengan riwayat deploy dan rollback."
- "Saya mau publikasikan website ini, atur domain custom dan SSL-nya, dan kalau hasil baru bermasalah bisa rollback ke versi sebelumnya."

## 10. Kasus tepi & cara gagal yang jujur

- Verifikasi domain gagal/TXT belum terpasang: domain tetap pending dengan petunjuk perbaikan — jangan menandai aktif.
- Rollback ke versi yang build-nya gagal (status failed): ditolak dengan penjelasan; hanya versi yang pernah live/selesai yang bisa diterbitkan ulang.
- Deploy saat kredit tidak cukup mengikuti aturan platform (deploy ditolak sebelum berjalan, riwayat tidak bertambah).
