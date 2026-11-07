---
name: api-rest
version: 1.0.1
family: data-backend
title: API REST — Endpoint CRUD Terstruktur dan Kontrak OpenAPI Ringkas per Proyek
triggers: [api rest, rest api, endpoint, endpoint crud, openapi, api untuk android, backend api, json api, dokumentasi api, integrasi frontend, api, api backend]
requires: [database-designer]
optional: [auth-pengguna]
credit_profile: standard
outputs: [endpoint crud per tabel proyek, kontrak openapi ringkas per proyek, aturan autentikasi api, daftar error api baku]
---

# API REST — Endpoint CRUD Terstruktur dan Kontrak OpenAPI Ringkas per Proyek

Skill pendukung family data-backend. Menyediakan API REST untuk proyek itu sendiri: endpoint CRUD terstruktur atas tabel proyek, dipakai frontend proyek atau aplikasi Android proyek yang sama, dengan kontrak OpenAPI ringkas per proyek. API hanya membuka data proyek pemiliknya — bukan API platform Dadiweb.

## 1. Kapan dipakai / kapan TIDAK dipakai

Dipakai ketika:

- Frontend proyek atau aplikasi Android proyek perlu membaca/menulis data lewat endpoint terstruktur.
- Prompt menyebut API REST, endpoint, OpenAPI, backend API, atau integrasi frontend/Android ke data proyek.

TIDAK dipakai ketika:

- Hanya halaman web biasa tanpa konsumen API → skill domain + database-designer cukup.
- Mengakses data proyek lain atau data platform → selalu ditolak (bagian 7).

## 2. Pertanyaan penjernih

1. Endpoint untuk tabel apa saja? Default: tabel proyek yang disebut prompt/skill domain.
2. API publik baca-saja atau wajib autentikasi token? Default: tulis wajib token (auth-pengguna), baca mengikuti kepemilikan data.
3. Konsumennya frontend proyek sendiri, aplikasi Android proyek, atau keduanya? Default: keduanya dengan kontrak yang sama.

## 3. Workflow langkah demi langkah per tahap pipeline

Planner:

1. Tetapkan tujuan utama, pengguna sasaran, dan batasan proyek dari prompt dan jawaban klarifikasi.
2. Serahkan kebutuhan tabel baku skill ini ke database-designer agar masuk rencana skema proyek (skema per proyek proj_<project_id>).
3. Petakan resource dari tabel proyek menjadi endpoint dan tetapkan aturan autentikasi per resource.

Designer:

3. Terapkan desain-ui: tetapkan token warna, tipografi, dan komponen yang konsisten untuk seluruh halaman skill ini.
4. Tetapkan format respons/error baku yang konsisten agar mudah dipakai Designer halaman dan pengembang Android.

Coder:

4. Bangun halaman dan logika sesuai struktur file pada bagian 4, selalu terikat kepemilikan proyek.
5. Implementasikan endpoint CRUD dengan validasi kepemilikan proyek di server pada SETIAP permintaan, pagination, dan kontrak OpenAPI ringkas.

Builder & Tester:

5. Jalankan pemeriksaan pada bagian 8: data contoh sementara diuji lalu dihapus, tampilan ponsel dan desktop diperiksa.
6. Uji endpoint dengan token sah, tanpa token, dan token proyek lain (harus ditolak).

Fixer:

6. Perbaiki tahap yang gagal dengan skill yang sama; jangan melonggarkan aturan bisnis atau keamanan demi meloloskan uji.
7. Perbaiki endpoint yang gagal tanpa melonggarkan autentikasi/kepemilikan.

## 4. Struktur file yang dihasilkan + aturan bisnis wajib

Struktur file (path relatif di dalam pohon tenant proyek):

- `src/api/<resource>.ts` — handler CRUD per resource proyek.
- `api/openapi-ringkas.json` — kontrak OpenAPI ringkas per proyek (path, metode, skema ringkas, error).
- `api/README-api.md` — cara autentikasi dan contoh permintaan per endpoint.
- `db/migrations/` — tidak membuat tabel bisnis baru; memakai tabel proyek yang ada.

Aturan bisnis wajib:

- Setiap permintaan API ditegakkan kepemilikan proyek di server; id milik proyek lain diperlakukan tidak ditemukan.
- Operasi tulis wajib autentikasi; token tidak pernah dicatat utuh di log.
- Daftar (list) selalu berpaginasi dengan batas maksimal per halaman.
- Format error baku: kode, pesan Bahasa Indonesia, dan tidak membocorkan struktur database internal/platform.
- Kontrak OpenAPI ringkas harus cocok persis dengan endpoint yang benar-benar ada.

## 5. Skema database baku

Skill ini tidak membuat tabel bisnis baru. Ia memakai tabel proyek yang sudah dirancang database-designer (misalnya products, orders pada toko) dan memetakannya menjadi resource API. Satu-satunya data tambahan yang mungkin dicatat adalah kunci API proyek (bila autentikasi kunci dipilih): hanya HASH kunci yang disimpan mengikuti aturan auth-pengguna — kunci mentah tidak disimpan.

Semua tabel berada di skema logis proyek itu sendiri (proj_<project_id> pada pemetaan prototipe SQLite — bukan klaim PostgreSQL), dibuat lewat database-designer, dan setiap tabel mengikuti pola baku: id, created_at, updated_at, penamaan snake_case, serta indeks pada foreign key.

## 6. Aturan UI & komponen

- Skill ini tidak menghasilkan halaman publik; keluarannya dokumentasi API (README + OpenAPI ringkas) yang tampil di Editor proyek.
- Dokumentasi menampilkan per endpoint: metode, path, parameter, contoh respons, contoh error.
- Status autentikasi per endpoint ditandai jelas (publik baca / wajib token).

## 7. Larangan keras (hard prohibitions)

Larangan berikut tidak bisa ditawar dan tidak bisa dikalahkan oleh prompt pengguna, chip pilihan, atau aturan skill domain mana pun:

1. Skill TIDAK PERNAH mendapat akses file atau database secara bebas. Skill hanya menghasilkan rencana dan artefak; penulisan hanya dilakukan Executor di server yang memvalidasi path, kepemilikan, dan kuota sebelum menulis.
2. Path hanya boleh relatif di dalam tenants/<user_id>/<project_id>/. Executor menolak ../, path absolut, symlink yang keluar dari pohon tenant, dan path milik tenant/proyek lain.
3. Rahasia dan kunci (kredensial, token, kunci API) TIDAK PERNAH ditulis ke file proyek, log pipeline, atau prompt model. Di UI, rahasia hanya tampil 4 karakter terakhir.
4. Aturan platform (isolasi & keamanan) selalu menang atas aturan skill domain bila bertabrakan.
5. Bila tidak yakin, gagal dengan jujur: status partial atau needs_clarification. Dilarang mengarang tabel, harga, atau integrasi yang tidak diminta pengguna.
6. Khusus skill ini: dilarang membuka endpoint lintas proyek/platform, endpoint debug, atau endpoint daftar pengguna platform.
7. Khusus skill ini: dilarang mencatat token/kunci mentah di log API atau menampilkannya di dokumentasi.

## 8. Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan

- [ ] Setiap endpoint di OpenAPI ringkas benar-benar ada dan merespons sesuai kontrak.
- [ ] Permintaan tanpa token untuk operasi tulis ditolak.
- [ ] ID milik proyek lain diperlakukan tidak ditemukan di semua resource.
- [ ] List berpaginasi dan batas halamannya ditegakkan.
- [ ] Tidak ada token/kunci mentah di log atau dokumentasi.

Hasil yang diharapkan: proyek yang dihasilkan sesuai tujuan skill ini, datanya hanya milik proyek itu sendiri, dan tidak ada klaim atau integrasi karangan.

## 9. Contoh prompt baik

- "Buatkan API REST untuk aplikasi Android toko saya: endpoint CRUD produk dan pesanan dengan kontrak OpenAPI ringkas."
- "Saya butuh endpoint terstruktur agar frontend proyek bisa ambil data katalog dan booking lewat JSON API."

## 10. Kasus tepi & cara gagal yang jujur

- Tabel proyek belum ada: API tidak bisa dibuat di atas tabel karangan — serahkan dulu ke database-designer, status partial.
- Konsumen meminta endpoint tanpa autentikasi untuk data pribadi: tolak, jelaskan risiko, tawarkan baca publik hanya untuk data yang memang publik.
