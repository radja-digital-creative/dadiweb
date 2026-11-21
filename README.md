# Dadiweb

Platform Website & App Builder with AI — pengguna cukup mengetik prompt, AI membuat website/aplikasi/sistem bisnis.

Kode di repo ini adalah build staging G12 (2 Nov 2026): server Bun mandiri yang menyajikan `client/dist/` dan menangani `POST /actions`.

## Jalankan

```sh
bun install
PORT=3002 HOST=127.0.0.1 bun run start
```

Lalu buka aplikasi di port 3002 (di staging, Apache mem-proxy `dadiweb.id` ke port ini).

## Catatan penting

- Repo ini **tidak** membawa database (`app.db`), kredensial, token, atau secret apa pun. Semua kredensial (DeepInfra, OAuth Google/GitHub, Cloudflare, DOKU, email) dipasang lewat panel admin Dadiweb, bukan lewat file/chat.
- Migrasi database ada di `drizzle/`; server staging tidak auto-migrate, jadi migrasi baru harus diterapkan manual saat service berhenti (lihat `README-CARA-JALANKAN-STAGING.md`).
- G12: satu renderer statis tunggal spec → HTML, folder file per proyek di `site-files/` (di-generate, tidak ikut repo), deploy membuat snapshot sehingga edit setelah deploy tidak langsung mengubah situs live sampai redeploy, dan rollback kembali ke snapshot lama. Sinkronisasi file fisik di staging masih script-driven: jalankan `bun ./scripts/materialize-site-files.ts` setelah deploy/rollback.
- HTTPS subdomain masih pekerjaan terpisah (mode Cloudflare saat ini `dns_only` + vhost wildcard HTTP).
