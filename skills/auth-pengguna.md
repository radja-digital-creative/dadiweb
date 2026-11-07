---
name: auth-pengguna
version: 1.0.0
family: data-backend
title: Auth Pengguna — Login, Peran, dan Sesi untuk Proyek Hasil Generate
triggers: [login, masuk akun, daftar akun, registrasi, akun pengguna, anggota, member, kata sandi, peran pengguna]
requires: [database-designer]
optional: []
credit_profile: standard
outputs: [halaman login dan register, tabel users dan sessions, pengelolaan peran, alur lupa kata sandi]
---

# Auth Pengguna — Login, Peran, dan Sesi untuk Proyek Hasil Generate

Skill pendukung family data-backend. Skill ini menambahkan akun pengguna ke
proyek hasil generate: orang bisa mendaftar, masuk, keluar, dan dibedakan
perannya (admin, kasir, pelanggan). Dipakai skill domain yang butuh
identitas: pos-kasir, booking-reservasi, dashboard-admin, marketplace, dan
proyek apa pun yang prompt-nya menyebut login atau akun.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Proyek punya area yang hanya boleh dibuka pengguna tertentu (panel admin,
  halaman kasir, riwayat pesanan pelanggan).
- Prompt menyebut login, akun, member, anggota, staf, atau peran.
- Skill domain mencantumkan auth-pengguna pada requires-nya.

TIDAK dipakai ketika:

- Website bersifat publik penuh tanpa akun (company profile, landing page
  tanpa area member) — akun yang tidak perlu hanya menambah risiko.
- Yang diminta adalah login ke platform Dadiweb itu sendiri; itu wilayah
  platform, bukan skill proyek.
- Login sosial (Google/GitHub) untuk proyek hasil generate: tidak dijanjikan
  oleh skill ini; bila diminta, laporkan sebagai belum didukung, jangan
  mengarang integrasi OAuth.

## 2. Pertanyaan penjernih

1. Peran apa saja yang dibutuhkan? Default: admin dan pelanggan; kasir
   ditambahkan bila proyeknya pos-kasir.
2. Pendaftaran terbuka untuk publik, atau akun hanya dibuatkan oleh admin?
   Default: terbuka untuk peran pelanggan, peran staf hanya oleh admin.
3. Pengguna masuk dengan email + kata sandi, atau nomor WhatsApp + kata
   sandi? Default: email + kata sandi.
4. Apakah sesi harus berakhir otomatis setelah tidak aktif? Default: sesi
   berlaku 30 hari atau sampai pengguna keluar.

Default di atas dipakai tanpa bertanya bila prompt sudah jelas; pertanyaan
hanya diajukan bila jawabannya mengubah struktur peran secara nyata.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan daftar peran proyek dan hak akses kasar per peran (halaman apa
   yang boleh dibuka, data apa yang boleh diubah).
2. Serahkan kebutuhan tabel users dan sessions ke database-designer agar
   masuk rencana skema proyek.

Designer:

3. Rancang halaman masuk, daftar, dan lupa kata sandi mengikuti token
   desain-ui proyek: satu formulir per halaman, pesan error yang manusiawi.
4. Rancang penanda peran di antarmuka: menu yang tidak berhak tidak
   ditampilkan (tetapi penolakan sesungguhnya tetap di server).

Coder:

5. Buat tabel users dan sessions lewat migrasi database-designer.
6. Implementasikan register: validasi email unik, kata sandi minimal 8
   karakter, hash kata sandi dengan salt acak per pengguna sebelum simpan.
7. Implementasikan login: cocokkan hash, buat sesi bertoken acak, catat
   waktu kedaluwarsa; kegagalan login tidak membocorkan apakah emailnya
   terdaftar atau kata sandinya yang salah.
8. Implementasikan logout: sesi dicabut di server, bukan hanya di browser.
9. Implementasikan lupa kata sandi: token sekali pakai berhash yang
   kedaluwarsa 60 menit; setelah reset berhasil, semua sesi lama dicabut.
10. Terapkan pemeriksaan peran di server pada setiap aksi yang dibatasi.

Builder & Tester:

11. Uji alur daftar → masuk → keluar → masuk lagi.
12. Uji peran: akun kasir tidak bisa membuka aksi khusus admin.
13. Uji token reset: token lama tidak bisa dipakai dua kali dan token
    kedaluwarsa ditolak.

Fixer:

14. Perbaiki kegagalan pada tahap yang gagal dengan skill yang sama; jangan
    melonggarkan pemeriksaan peran demi membuat uji lolos.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `db/migrations/NNNN_auth_pengguna.sql` — tabel users dan sessions.
- `src/auth/register.ts` — pendaftaran dan validasi akun baru.
- `src/auth/login.ts` — pemeriksaan kredensial dan pembuatan sesi.
- `src/auth/session.ts` — pemeriksaan sesi dan peran pada setiap permintaan.
- `src/auth/reset-password.ts` — token lupa kata sandi dan reset.
- `src/pages/masuk.tsx`, `src/pages/daftar.tsx`,
  `src/pages/lupa-kata-sandi.tsx` — halaman antarmuka.

Aturan bisnis wajib:

- Kata sandi TIDAK PERNAH disimpan plaintext; yang disimpan hanya hash
  beserta salt-nya, dan hash tidak pernah dikirim ke klien.
- Email unik per proyek (case-insensitive); satu email satu akun.
- Peran hanya boleh: admin, kasir, pelanggan — peran baru hanya lewat
  klarifikasi, bukan karangan.
- Akun nonaktif (dinonaktifkan admin) tidak bisa masuk meskipun kata
  sandinya benar.
- Token sesi dan token reset selalu acak dari generator yang aman, disimpan
  sebagai hash untuk token reset, dan punya masa kedaluwarsa.
- Percobaan masuk yang gagal berulang dibatasi lajunya (rate limit) agar
  tidak bisa ditebak paksa.

## 5. Skema database baku

Tabel `users`:

- `id` — integer, primary key, auto increment.
- `name` — teks, nama tampilan pengguna.
- `email` — teks, unik, disimpan huruf kecil.
- `password_hash` — teks, hash kata sandi (tidak pernah plaintext).
- `password_salt` — teks, salt acak per pengguna.
- `role` — teks enum: admin | kasir | pelanggan.
- `is_active` — integer boolean, default 1.
- `created_at`, `updated_at` — timestamp baku.

Tabel `sessions`:

- `id` — integer, primary key, auto increment.
- `user_id` — foreign key ke users.id, terindeks.
- `token` — teks unik, token sesi acak.
- `expires_at` — timestamp kedaluwarsa sesi.
- `created_at`, `updated_at` — timestamp baku.

Token reset kata sandi disimpan sebagai baris token terpisah dengan hash
dan masa berlaku, mengikuti pola yang sama: tidak ada token mentah yang
bertahan di database setelah diterbitkan ke pengguna.

## 6. Aturan UI & komponen

- Formulir masuk: email, kata sandi (dengan tombol lihat/sembunyikan),
  tombol Masuk, tautan Lupa kata sandi dan Daftar.
- Pesan error generik untuk kredensial salah: "Email atau kata sandi
  salah." — tidak menyebut bagian mana yang salah.
- Setelah masuk, pengguna diarahkan sesuai peran: admin ke dashboard,
  kasir ke halaman kasir, pelanggan ke halaman akun/beranda proyek.
- Menu dan tombol mengikuti peran, tetapi teks antarmuka tidak pernah
  menyatakan halaman "aman karena disembunyikan" — keamanan ada di server.
- Halaman akun minimal menampilkan nama, email, peran, dan tombol Keluar.
- Bahasa seluruh antarmuka: Bahasa Indonesia.

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
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke
   file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya
   tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: kata sandi plaintext adalah pelanggaran keras — dalam
   bentuk apa pun, di tabel mana pun, di log mana pun.
7. Khusus skill ini: dilarang membuat akun "super admin" tersembunyi,
   kata sandi bawaan yang tidak diganti, atau jalan pintas (backdoor)
   untuk masuk tanpa kredensial.
8. Khusus skill ini: sesi dan peran pengguna satu proyek tidak berlaku di
   proyek lain; token tidak boleh dipakai lintas tenant.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Daftar dengan email baru berhasil; email yang sama ditolak.
- [ ] Kata sandi tersimpan sebagai hash + salt; tidak ada plaintext di DB.
- [ ] Login benar masuk, login salah ditolak dengan pesan generik.
- [ ] Logout mencabut sesi di server (token lama tidak bisa dipakai lagi).
- [ ] Peran ditegakkan di server: kasir ditolak dari aksi admin.
- [ ] Token reset sekali pakai dan kedaluwarsa; reset mencabut sesi lama.
- [ ] Akun nonaktif tidak bisa masuk.
- [ ] Hash kata sandi dan token tidak muncul di respons API maupun log.

Hasil yang diharapkan: proyek punya akun dengan peran yang jelas, sesi
yang bisa dicabut, dan tidak satu pun kata sandi tersimpan apa adanya.

## 9. Contoh prompt baik

- "Buatkan aplikasi kasir untuk kafe saya; kasir dan pemilik punya akun
  sendiri-sendiri, kasir tidak bisa mengubah harga."
- "Website booking salon dengan akun pelanggan agar bisa melihat riwayat
  booking mereka."
- "Dashboard admin untuk mengelola data siswa; hanya admin sekolah yang
  bisa masuk."

## 10. Kasus tepi & cara gagal yang jujur

- Pengguna meminta melihat kata sandi pengguna lain "untuk membantu lupa
  sandi": ditolak — alurnya adalah reset lewat token, bukan membuka sandi.
- Pengguna meminta login Google untuk proyeknya: jawab jujur belum
  didukung skill ini; tawarkan email + kata sandi, jangan mengarang OAuth.
- Dua peran disebut dengan nama yang sama tetapi hak berbeda (misalnya
  "admin gudang" dan "admin toko"): minta klarifikasi satu pertanyaan
  sebelum memetakan peran.
- Proyek sudah punya tabel users dari skill lain dengan bentuk berbeda:
  jangan menimpa; laporkan konflik skema sebagai partial dan serahkan ke
  database-designer untuk migrasi penyesuaian.
- Email pendaftaran memakai huruf besar/kecil campur: dinormalisasi ke
  huruf kecil agar akun ganda tidak lolos.
