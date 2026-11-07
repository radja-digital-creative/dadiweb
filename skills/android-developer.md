---
name: android-developer
version: 1.0.0
family: aplikasi-android
title: Android Developer — Mengubah Proyek Web Menjadi Aplikasi Android (Capacitor)
triggers: [android, aplikasi android, apk, aab, aplikasi mobile, mobile app, aplikasi hp, play store, capacitor]
requires: [desain-ui]
optional: [seo-performa]
credit_profile: standard
outputs: [konfigurasi capacitor, aset ikon dan splash, identitas aplikasi, riwayat build android]
---

# Android Developer — Mengubah Proyek Web Menjadi Aplikasi Android (Capacitor)

Skill domain family aplikasi-android. Skill ini mengubah proyek web yang
sudah ada menjadi aplikasi Android memakai Capacitor: menetapkan identitas
aplikasi (nama, package id), ikon dan splash, warna tema, konfigurasi
build APK/AAB, dan mencatat riwayat build-nya di proyek. Tarif build
mengikuti tarif platform yang berlaku (build Android per proyek) — skill
ini tidak menetapkan tarif sendiri.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Pemilik proyek web ingin proyeknya juga hadir sebagai aplikasi Android.
- Prompt menyebut Android, APK, AAB, aplikasi HP, atau Play Store.
- Chip pengguna memilih Aplikasi Android.

TIDAK dipakai ketika:

- Proyek webnya sendiri belum ada/selesai — selesaikan proyek web dengan
  skill domainnya dulu, baru jalankan skill ini.
- Yang diminta aplikasi iOS: di luar cakupan; nyatakan jujur bahwa jalur
  ini Android saja.
- Yang diminta aplikasi native penuh dengan fitur perangkat keras berat
  (misalnya AR): Capacitor membungkus web; kebutuhan di luar kemampuan
  web harus dilaporkan sebagai batas, bukan dijanjikan.

## 2. Pertanyaan penjernih

1. Nama aplikasi yang tampil di HP pengguna apa? Default: nama proyek.
2. Package ID apa? Default: dibentuk dari domain proyek terbalik
   (misalnya app.dadiweb.<slug-proyek>) dan dinyatakan sebagai default
   yang sebaiknya tidak diganti setelah rilis pertama.
3. Warna utama ikon/splash mengikuti merek proyek? Default: ya, dari
   token desain-ui proyek.
4. Format rilis: APK (pasang langsung/uji) atau AAB (untuk Play Store)?
   Default: APK untuk pengujian; AAB disiapkan konfigurasinya untuk rilis.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Periksa proyek sumber: pastikan proyek web ada, milik pengguna yang
   sama, dan punya halaman yang layak dibungkus (responsif, tanpa
   ketergantungan hover).
2. Tetapkan identitas aplikasi: nama, package id, versi awal 1.0.0
   (version code 1).

Designer:

3. Tetapkan aset visual dari merek proyek: ikon aplikasi (latar warna
   token + lambang sederhana dari logo/inisial proyek), splash screen
   (latar + logo + nama), warna status bar mengikuti tema.
4. Periksa halaman proyek pada ukuran layar HP kecil: teks, tombol, dan
   navigasi harus nyaman disentuh dalam wadah aplikasi.

Coder:

5. Hasilkan `capacitor.config` proyek: appId = package id, appName = nama
   aplikasi, webDir menunjuk hasil build web proyek, warna latar splash.
6. Hasilkan aset ikon dalam ukuran baku Android (mdpi sampai xxxhdpi) dan
   aset splash dari satu gambar sumber milik proyek.
7. Tetapkan izin Android seminimal mungkin: default hanya internet; izin
   tambahan (kamera, lokasi) hanya bila fitur proyek benar-benar
   memakainya dan dinyatakan alasannya.

Builder & Tester:

8. Jalankan build konfigurasi: hasil build dicatat sebagai baris riwayat
   build Android proyek (nama, package id, versi, format, waktu, tarif
   platform yang berlaku).
9. Periksa manifest hasil: nama, package id, ikon, dan izin cocok dengan
   konfigurasi; tidak ada izin berlebih.
10. Nyatakan status biner dengan jujur (lihat bagian 10): di lingkungan
    prototipe, yang dihasilkan adalah konfigurasi + paket build; biner
    APK/AAB final berlabel simulasi sampai akun Google Play dan keystore
    rilis tersedia.

Fixer:

11. Kegagalan konfigurasi (package id tidak valid, aset hilang) diperbaiki
    pada tahapnya; jangan mengganti package id diam-diam setelah ada
    riwayat build — itu identitas aplikasi.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `android/capacitor.config.ts` — konfigurasi Capacitor proyek.
- `android/identitas.md` — nama aplikasi, package id, versi, keputusan
  build yang tercatat.
- `android/assets/icon/` — ikon berbagai ukuran dari satu sumber.
- `android/assets/splash/` — gambar splash.
- `db/riwayat build` — dicatat lewat tabel android_builds proyek yang
  sudah ada di platform (bukan tabel baru karangan skill).

Aturan bisnis wajib:

- Package ID bersifat tetap setelah build pertama tercatat; perubahan
  package id berarti aplikasi baru dan harus keputusan eksplisit pemilik.
- Nomor versi naik teratur: version name (1.0.0 → 1.0.1) dan version code
  bilangan bulat yang selalu bertambah setiap build rilis.
- Izin Android seminimal kebutuhan fitur; setiap izin tambahan dicatat
  alasannya di identitas.md.
- Ikon dan splash berasal dari aset/merek proyek milik pengguna; dilarang
  memakai ikon aplikasi terkenal lain.
- Nama aplikasi tidak boleh meniru nama aplikasi terkenal untuk
  mengelabui pengguna.
- Build memakai tarif platform yang berlaku untuk build Android per
  proyek; skill tidak menambah biaya tersembunyi.

## 5. Skema database baku

Skill ini memakai tabel riwayat build Android proyek yang disediakan
platform (`android_builds`): app_name, package_id, version_name,
version_code, build_type (apk|aab), status, icon_color, splash_text, dan
waktu build. Skill ini TIDAK membuat tabel bisnis baru. Konfigurasi yang
berubah-ubah (nama, package id, warna) hidup sebagai berkas konfigurasi
proyek dan dicerminkan ke riwayat setiap build dijalankan.

## 6. Aturan UI & komponen

- Panel Android pada proyek menampilkan: nama aplikasi, package id, versi
  terakhir, format terakhir, warna ikon, dan pratinjau ikon + splash.
- Tombol "Build" menyatakan formatnya (APK/AAB) dan tarif platformnya
  sebelum dijalankan — tidak ada potongan mengejutkan.
- Riwayat build tampil sebagai daftar: versi, format, status, waktu; build
  simulasi berlabel "Simulasi" dengan jelas (lihat bagian 7 dan 10).
- Pratinjau splash memakai warna dan logo proyek, bukan contoh generik.
- Pesan hasil build membedakan tiga hal: konfigurasi siap, paket build
  siap diunduh, dan biner final (bila jalur rilis asli aktif).

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt
pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill
   hanya menghasilkan rencana dan artefak (konfigurasi, aset); penulisan
   hanya dilakukan Executor di server yang memvalidasi path, kepemilikan,
   dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/.
   Executor menolak ../, path absolut, symlink yang keluar dari pohon
   tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci — termasuk keystore dan kata sandi penandatanganan —
   TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model.
   Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang menandai biner APK/AAB sebagai final/asli
   selama akun Google Play dan keystore rilis belum tersedia — statusnya
   simulasi dan harus berlabel jujur.
7. Khusus skill ini: dilarang meminta kata sandi keystore atau kredensial
   Google Play lewat prompt/chat; kredensial dipasang lewat jalur aman
   platform bila jalurnya sudah ada.
8. Khusus skill ini: dilarang menambahkan izin Android yang tidak
   dibutuhkan fitur proyek (kontak, SMS, dsb.) demi "jaga-jaga".

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] capacitor.config berisi appId dan appName yang sama dengan panel.
- [ ] Ikon tampil benar pada pratinjau dan tersedia dalam ukuran baku.
- [ ] Splash tampil dengan warna dan nama yang benar.
- [ ] Izin Android hanya yang dibutuhkan fitur; alasannya tercatat.
- [ ] Riwayat build bertambah satu baris dengan versi dan format benar.
- [ ] Package ID tidak berubah dari build sebelumnya tanpa keputusan
      eksplisit pemilik.
- [ ] Status biner berlabel jujur (simulasi sampai Play + keystore siap).
- [ ] Halaman proyek nyaman dipakai pada layar HP kecil di dalam aplikasi.

Hasil yang diharapkan: proyek web punya identitas Android yang konsisten
dan paket build yang siap dilanjutkan ke rilis asli begitu kredensial
rilis tersedia, tanpa klaim biner final yang belum ada.

## 9. Contoh prompt baik

- "Jadikan toko online saya aplikasi Android juga, namanya 'BatikArum',
  ikonnya pakai warna cokelat merek saya."
- "Buatkan APK untuk aplikasi kasir kafe saya supaya bisa dipasang di
  tablet kasir."
- "Siapkan versi Android dari website booking salon saya untuk nanti
  dirilis ke Play Store."

## 10. Kasus tepi & cara gagal yang jujur

- Akun Google Play dan keystore belum tersedia: build menghasilkan
  konfigurasi dan paket build dengan status biner "simulasi" — laporkan
  persis begitu, dan sebutkan yang kurang (akun Play + keystore pemilik).
- Package ID yang diminta ternyata formatnya tidak valid (mengandung
  spasi/huruf besar): perbaiki formatnya dan konfirmasi ke pemilik;
  jangan memakai package id yang akan ditolak Play Store.
- Proyek web memakai fitur yang tidak berjalan di wadah aplikasi
  (misalnya unduhan berkas khusus browser): catat sebagai batas pada
  identitas.md dan tandai hasil partial untuk fitur itu.
- Pemilik meminta mengganti package id setelah ada riwayat build:
  jelaskan itu berarti aplikasi baru di Play Store dan riwayat versi
  mulai dari awal; hanya lanjutkan atas konfirmasi eksplisit.
- Nama aplikasi menyerupai aplikasi terkenal: tolak nama itu dan minta
  nama lain; jangan meneruskan identitas yang menipu.
