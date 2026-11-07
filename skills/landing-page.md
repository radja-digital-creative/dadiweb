---
name: landing-page
version: 1.0.0
family: web-konten
title: Landing Page — Satu Halaman Promosi yang Mengubah Pengunjung Jadi Leads
triggers: [landing page, landing, halaman promosi, halaman penjualan, one page, lead generation, halaman arahan, promosi produk, promosi jasa]
requires: [desain-ui]
optional: [database-designer, seo-performa]
credit_profile: standard
outputs: [satu halaman landing lengkap, seksi hero sampai faq, tombol cta whatsapp, tabel leads dan formulir minat]
---

# Landing Page — Satu Halaman Promosi yang Mengubah Pengunjung Jadi Leads

Skill domain family web-konten. Satu halaman terfokus untuk satu tawaran:
produk, jasa, kursus, atau acara. Seluruh halaman mengalir ke satu aksi —
menghubungi via WhatsApp atau mengisi formulir minat — tanpa menu yang
membingungkan dan tanpa halaman lain yang mencuri perhatian.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Tujuan utamanya satu: promosi satu produk/jasa, pengumpulan leads,
  pendaftaran acara, atau peluncuran.
- Prompt menyebut landing page, halaman promosi, halaman penjualan, atau
  "satu halaman saja".
- Pengguna memasang iklan dan butuh halaman tujuan iklan itu.

TIDAK dipakai ketika:

- Butuh banyak halaman berisi profil usaha lengkap → company-profile.
- Ada keranjang dan checkout → toko-online; ada jadwal dan slot →
  booking-reservasi.
- Pengguna sebenarnya butuh aplikasi dengan akun dan data → arahkan ke
  skill domain yang sesuai lewat klarifikasi, jangan memaksakan satu
  halaman.

## 2. Pertanyaan penjernih

1. Tawaran utamanya apa, dalam satu kalimat (produk/jasa + untuk siapa)?
2. Aksi utama pengunjung: chat WhatsApp, isi formulir, atau keduanya?
   Default: tombol WhatsApp mengambang + formulir minat singkat.
3. Nomor WhatsApp tujuan berapa? Bila belum diberikan, pakai penanda yang
   jelas terlihat di Editor ("GANTI NOMOR WA") — jangan mengarang nomor.
4. Ada bukti sosial yang sah (testimoni nyata, jumlah pelanggan, mitra)?
   Hanya tampilkan yang diberikan pengguna; jangan mengarang testimoni.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan satu tawaran, satu pengunjung sasaran, dan satu aksi utama.
2. Susun urutan seksi baku: hero → manfaat → cara kerja/fitur → bukti
   sosial → harga → FAQ → CTA penutup.
3. Bila ada formulir minat, serahkan tabel leads ke database-designer.

Designer:

4. Terapkan desain-ui: hero dengan judul besar, satu gambar/visual utama,
   tombol CTA kontras yang terlihat tanpa menggulir.
5. Rancang tombol WhatsApp mengambang di kanan bawah pada mobile dan
   desktop, tidak menutupi konten.

Coder:

6. Bangun halaman satu berkas per seksi agar mudah diubah di Editor.
7. Implementasikan formulir minat (nama, WhatsApp, kebutuhan) yang
   tersimpan ke tabel leads dan membuka WhatsApp dengan pesan terisi
   otomatis setelah kirim.
8. Buat tautan WhatsApp memakai format wa.me dengan teks awal yang sopan
   dan menyebut nama produk/jasa.

Builder & Tester:

9. Jalankan seo-performa: judul/meta halaman, satu H1, gambar terkompresi.
10. Uji tombol CTA di ponsel: terlihat, bisa ditekan, membuka WhatsApp
    dengan nomor dan pesan yang benar.
11. Uji formulir: data tersimpan sebagai lead, isian tidak valid ditolak
    dengan pesan per kolom.

Fixer:

12. Perbaiki seksi yang gagal uji (misalnya CTA tertutup tombol mengambang)
    tanpa mengubah urutan seksi baku.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — halaman tunggal yang merangkai semua seksi.
- `src/sections/hero.tsx`, `manfaat.tsx`, `bukti-sosial.tsx`, `harga.tsx`,
  `faq.tsx`, `cta-penutup.tsx` — satu berkas per seksi.
- `src/components/tombol-whatsapp.tsx` — tombol mengambang + tautan CTA.
- `src/leads/formulir-minat.tsx` dan `src/leads/simpan-lead.ts` — formulir
  dan penyimpanan lead (bila formulir dipakai).
- `db/migrations/NNNN_leads.sql` — tabel leads (bila formulir dipakai).

Aturan bisnis wajib:

- Satu halaman, satu tawaran, satu aksi utama; tidak ada menu ke halaman
  lain kecuali tautan kebijakan sederhana bila memang ada.
- Harga hanya ditampilkan bila diberikan pengguna; dilarang mengarang
  harga, diskon, atau hitung mundur palsu.
- Testimoni hanya dari pengguna; bila tidak ada, seksi bukti sosial diganti
  fakta usaha yang diberikan (tahun berdiri, kota layanan) atau dihilangkan.
- Nomor WhatsApp selalu dari pengguna; penanda sementara harus mencolok
  agar tidak ikut tayang tanpa disadari.
- Klaim hasil ("turun 10 kg", "omzet naik 3x") tidak boleh dikarang; klaim
  dari pengguna ditampilkan sebagai kutipan klaim pemilik, bukan janji
  platform.

## 5. Skema database baku

Tabel `leads` (dibuat lewat database-designer bila formulir minat dipakai):

- `id` — integer, primary key, auto increment.
- `name` — teks, nama pengunjung.
- `whatsapp` — teks, nomor WhatsApp pengunjung (format angka, divalidasi).
- `need` — teks, kebutuhan/pesan singkat pengunjung.
- `source` — teks, asal lead (misalnya "formulir" atau "tombol-wa").
- `status` — teks enum: baru | dihubungi | selesai. Default: baru.
- `created_at`, `updated_at` — timestamp baku.

Tanpa formulir (hanya tombol WhatsApp), skill ini tidak membuat tabel apa
pun; klik WhatsApp tidak dilacak sebagai data pribadi.

## 6. Aturan UI & komponen

- Hero: judul manfaat (bukan sekadar nama produk), subjudul satu kalimat,
  satu tombol CTA utama, visual produk/jasa.
- Seksi manfaat: 3–6 kartu manfaat dengan ikon sederhana dan teks pendek.
- Harga: paket ditampilkan berdampingan, paket yang dianjurkan pemilik
  ditandai; tanpa harga karangan (lihat bagian 4).
- FAQ: akordeon 4–8 pertanyaan yang benar-benar sering ditanyakan untuk
  jenis tawaran ini, dijawab dari fakta pengguna.
- CTA penutup mengulang tawaran dan tombol yang sama dengan hero.
- Mobile-first: judul hero terbaca tanpa zoom, tombol CTA selebar wajar
  dan mudah ditekan ibu jari.
- Kecepatan adalah fitur: satu halaman harus ringan; animasi seperlunya.

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
3. Rahasia dan kunci TIDAK PERNAH ditulis ke file proyek, log pipeline,
   atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill
   domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau
   needs_clarification. Dilarang mengarang tabel, harga, atau integrasi
   yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengarang testimoni, jumlah pelanggan,
   harga, diskon, tenggat palsu (hitung mundur yang mereset), atau klaim
   hasil yang tidak diberikan pengguna.
7. Khusus skill ini: data leads adalah data pribadi pengunjung — tidak
   boleh ditampilkan publik, dibagikan ke proyek lain, atau dipakai di
   luar proyek pemiliknya.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Satu H1, urutan seksi baku lengkap, satu aksi utama yang konsisten.
- [ ] Tombol WhatsApp membuka nomor yang benar dengan pesan terisi.
- [ ] Formulir minat menyimpan lead dan menolak isian tidak valid.
- [ ] Tidak ada harga/testimoni/klaim yang tidak diberikan pengguna.
- [ ] Tampilan ponsel: CTA terlihat tanpa tertutup tombol mengambang.
- [ ] Judul/meta lulus checklist seo-performa; gambar terkompresi.
- [ ] Penanda nomor WA sementara (bila ada) mencolok di Editor.

Hasil yang diharapkan: satu halaman cepat dan fokus yang mengubah
pengunjung menjadi percakapan WhatsApp atau lead tersimpan, tanpa satu pun
klaim palsu.

## 9. Contoh prompt baik

- "Buatkan landing page untuk kursus bahasa Inggris online anak, harga
  Rp 299 ribu per bulan, CTA-nya chat WhatsApp untuk daftar trial gratis."
- "Halaman promosi jasa servis AC di Depok, ada paket cuci dan isi freon,
  testimoni nanti saya isi sendiri, yang penting tombol WA-nya jelas."
- "Landing page peluncuran aplikasi catatan keuangan, kumpulkan email dan
  nomor WA orang yang berminat."

## 10. Kasus tepi & cara gagal yang jujur

- Pengguna tidak memberikan nomor WhatsApp: halaman tetap dibuat dengan
  penanda mencolok dan catatan di hasil generate; jangan mengarang nomor.
- Pengguna meminta testimoni "dibuatkan saja yang bagus-bagus": ditolak;
  tawarkan kerangka testimoni kosong untuk diisi testimoni asli.
- Tawaran mengandung klaim kesehatan/keuangan yang dilarang diiklankan:
  tampilkan deskripsi faktual saja dan catat penyesuaiannya.
- Pengguna ingin banyak produk dengan harga berbeda-beda dan keranjang:
  ini toko-online — minta klarifikasi/beralih skill, jangan menjejalkan
  katalog ke landing page.
- Formulir diminta tetapi proyek menolak tabel baru (kuota): hasilkan
  halaman dengan CTA WhatsApp saja dan status partial yang menjelaskan
  formulir belum aktif.
