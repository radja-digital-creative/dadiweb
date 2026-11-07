---
name: blog-majalah
version: 1.0.0
family: web-konten
title: Blog & Majalah — Blog, Majalah Online, dan Portal Berita Sederhana
triggers: [blog, majalah, portal berita, artikel, majalah online, blog pribadi, berita online, jurnal online, tulisan blog, publikasi artikel]
requires: [database-designer, desain-ui]
optional: [seo-performa]
credit_profile: standard
outputs: [daftar artikel, halaman artikel, kategori dan pencarian artikel, komentar pembaca, tabel posts categories comments]
---

# Blog & Majalah — Blog, Majalah Online, dan Portal Berita Sederhana

Skill domain family web-konten. Blog/majalah/portal berita sederhana: artikel berkategori, pencarian, halaman baca yang nyaman, dan komentar pembaca yang termoderasi pemilik.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Isi utamanya artikel/tulisan berkala: blog pribadi, majalah online, portal berita sederhana.
- Prompt menyebut blog, majalah, portal berita, artikel, atau publikasi tulisan.

TIDAK dipakai ketika:

- Satu halaman promosi saja → landing-page.
- Karya visual personal sebagai isi utama → portfolio.
- Produk untuk dijual/dipesan → toko-online atau katalog-produk.

## 2. Pertanyaan penjernih

1. Topik/kategori artikel apa saja? Default dari prompt; kategori dibuat pemilik di admin.
2. Komentar terbuka untuk publik atau harus dimoderasi dulu? Default: moderasi dulu sebelum tampil.
3. Penulisnya satu orang atau banyak? Default: satu penulis (pemilik) plus peran editor bila diminta.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Tetapkan kategori awal dan aturan moderasi komentar.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Rancang daftar artikel (kartu + gambar utama), halaman baca dengan tipografi nyaman, dan pencarian.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan CRUD artikel untuk pemilik, pencarian teks, filter kategori, dan komentar termoderasi.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji pencarian, filter kategori, komentar menunggu moderasi tidak tampil publik.

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki pencarian/moderasi yang gagal tanpa membuka komentar tanpa moderasi.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/pages/index.tsx` — beranda blog (artikel terbaru + unggulan).
- `src/pages/artikel.tsx` — halaman baca artikel.
- `src/pages/kategori.tsx` — daftar per kategori + pencarian.
- `src/admin/artikel.tsx` — kelola artikel dan moderasi komentar.
- `db/migrations/NNNN_blog.sql` — posts, categories, comments.

Aturan bisnis wajib:

- Artikel hanya diterbitkan pemilik/editor proyek; publik tidak bisa menerbitkan artikel.
- Komentar berstatus menunggu tidak tampil publik sebelum disetujui.
- Tanggal terbit dan penulis tampil apa adanya; dilarang mengarang artikel atau berita.
- Pencarian hanya mencari di dalam artikel proyek ini.

## 5. Skema database baku

Tabel `categories`: id, name, slug, created_at, updated_at.

Tabel `posts`:
- `id`, `category_id` (FK categories), `title`, `slug` unik, `excerpt`, `body`, `status` enum: draft | terbit, `published_at` nullable, `created_at`, `updated_at`.

Tabel `comments`:
- `id`, `post_id` (FK posts), `author_name`, `body`, `status` enum: menunggu | tampil | ditolak, `created_at`, `updated_at`.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Daftar artikel: kartu dengan kategori, judul, ringkasan, tanggal, penulis.
- Halaman baca: lebar teks nyaman, judul besar, daftar isi bila artikel panjang.
- Pencarian selalu terlihat di header blog; hasil kosong memberi saran kata kunci lain.
- Komentar: formulir nama + isi, catatan "komentar tampil setelah moderasi".

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang mengarang berita/artikel atau mengklaim artikel karangan sebagai berita nyata.
7. Khusus skill ini: komentar berisi data pribadi pihak ketiga tidak boleh ditampilkan di luar proyek ini.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Artikel draft tidak tampil publik; artikel terbit tampil di daftar dan kategori.
- [ ] Pencarian menemukan artikel dari judul/isi.
- [ ] Komentar menunggu tidak tampil sebelum disetujui pemilik.
- [ ] Slug artikel unik dan halaman baca bisa dibuka.
- [ ] Tidak ada artikel karangan yang diklaim sebagai konten pemilik.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan blog pribadi tentang perjalanan dengan kategori destinasi dan tips, pembaca bisa berkomentar setelah moderasi."
- "Portal berita lokal sederhana dengan kategori politik, ekonomi, olahraga dan pencarian berita."

## 10. Kasus tepi & cara gagal yang jujur

- Belum ada artikel: beranda tampil keadaan kosong yang jujur, bukan artikel karangan.
- Komentar spam: tetap masuk antrean moderasi, pemilik yang menolak — sistem tidak mengklaim filter spam otomatis.
- Prompt meminta portal berita besar multi-redaksi kompleks: hasilkan versi sederhana ini dan tandai partial untuk fitur redaksi lanjutan.
