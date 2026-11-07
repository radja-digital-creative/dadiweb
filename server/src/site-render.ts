// ---------------------------------------------------------------------------
// G12 — Renderer situs tunggal (spec -> HTML statis).
//
// SATU-SATUNYA renderer tampilan situs yang dipakai jalur Preview dan jalur
// publik: Preview (panel + modal Tinjau Preview) dan situs publik keduanya
// menampilkan HTML yang dihasilkan fungsi ini dari spec yang sama, sehingga
// untuk snapshot yang sama isinya IDENTIK byte-per-byte — bukan dua
// komponen React yang "mirip" (SitePreview lama di lib.tsx vs PublicSiteView
// lama di views-public.tsx, yang terbukti berbeda header/CTA/warnanya).
//
// Desain kanonik = desain Preview yang sudah dikenal Eka: header berlatar
// primaryColor, nav halaman pertama, pill CTA accentColor di header, hero
// tengah dengan tombol utama primary + "Pelajari Dulu", kartu Fitur dengan
// ikon huruf selang-seling primary/accent, footer gelap berisi sections.
//
// File ini MURNI (tanpa DB, tanpa fs, tanpa fetch, tanpa secret): ia hanya
// mengubah spec yang sudah divalidasi menjadi string HTML. Karena runtime
// aksi prototipe hanya mengekspos ctx.db (tidak ada API penulisan file di
// codebase aksi), "folder" situs di prototipe direpresentasikan secara
// logis: path di bawah (siteFilePath / siteSnapshotPath) + konten HTML
// deterministik dari fungsi ini. Server staging (Bun, server/index.ts di
// paket staging — BUKAN bagian prototipe ini) dapat mematerialisasikan
// string HTML yang persis sama ke path tersebut dan melayaninya sebagai
// file statis; PM wajib mempertahankan direktori site-files/ saat swap
// code staging, seperti halnya set WAL. Di prototipe, aksi buildSiteFiles
// dan getPublicSiteHtml mengembalikan string HTML yang sama persis itu,
// dan client menampilkannya lewat <iframe srcDoc>, jadi identitas
// preview = publik tetap terjaga tanpa bergantung pada filesystem aksi.
//
// BUKAN PHP: keluarannya HTML/CSS/JS statis (bahkan tanpa <script> sama
// sekali). Fitur dinamis (formulir, database, login, integrasi) TIDAK
// dieksekusi dari file ini — tidak ada formulir palsu, tidak ada token
// pengguna di dalam HTML, tidak ada panggilan API dari file ini. Fitur
// dinamis tetap berjalan di aplikasi Dadiweb lewat aksi-aksinya sendiri.
// ---------------------------------------------------------------------------

export interface SiteSpecLike {
  siteName: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  primaryColor: string;
  accentColor: string;
  features: Array<{ title: string; description: string }>;
  sections: string[];
  pages: string[];
}

// Slug situs: hanya [a-z0-9-], tidak diawali/diakhiri "-", panjang 1-100.
// Ini adalah path-guard untuk folder situs: "..", "/", spasi, dan slug
// asing semuanya ditolak SEBELUM path apa pun dibentuk, sehingga tidak
// ada traversal direktori dan tidak ada akses file proyek lain lewat slug.
export function isValidSiteSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) && slug.length <= 100;
}

// Lokasi folder situs (konvensi, dipakai aksi + server staging).
// Working copy proyek: site-files/<slug>/index.html
// Snapshot satu deployment: site-files/<slug>/snapshots/<deploymentId>/index.html
export function siteFilePath(slug: string): string {
  return `site-files/${slug}/index.html`;
}

export function siteSnapshotPath(slug: string, deploymentId: number): string {
  return `site-files/${slug}/snapshots/${deploymentId}/index.html`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeColor(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
    ? value.trim()
    : fallback;
}

export function renderSiteHtml(spec: SiteSpecLike, subdomain?: string): string {
  const primary = safeColor(spec.primaryColor, "#2E6BFF");
  const accent = safeColor(spec.accentColor, "#F97316");
  const siteName = escapeHtml(spec.siteName);
  const headline = escapeHtml(spec.headline);
  const subheadline = escapeHtml(spec.subheadline);
  const cta = escapeHtml(spec.ctaLabel);
  const nav = spec.pages.slice(0, 4).map((p) => `<span>${escapeHtml(p)}</span>`).join("");
  const features = spec.features
    .slice(0, 4)
    .map((f, i) => {
      const iconBg = i % 2 === 0 ? primary : accent;
      const letter = escapeHtml((f.title.charAt(0) || "?").toUpperCase());
      return `<div class="feature"><div class="feature-icon" style="background:${iconBg}">${letter}</div><p class="feature-title">${escapeHtml(f.title)}</p><p class="feature-desc">${escapeHtml(f.description)}</p></div>`;
    })
    .join("");
  const sections = escapeHtml(spec.sections.join(" · "));
  const footerSub = subdomain
    ? `<p class="footer-sub">${escapeHtml(subdomain)}</p>`
    : "";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${siteName}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#0f172a}
.header{background:${primary};padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.header .name{color:#fff;font-weight:800;font-size:16px;min-width:0;overflow-wrap:anywhere}
.header nav{display:flex;flex-wrap:wrap;gap:16px;color:rgba(255,255,255,.85);font-size:12px;font-weight:500}
.header .cta{margin-left:auto;white-space:nowrap;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;background:${accent}}
.hero{padding:40px 20px;text-align:center}
.hero h1{margin:0 auto;font-size:32px;line-height:1.15;letter-spacing:-.02em;max-width:640px;overflow-wrap:anywhere}
.hero p{margin:8px auto 0;color:#64748b;font-size:14px;max-width:448px;line-height:1.6}
.hero .actions{margin-top:16px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.hero .btn-primary{color:#fff;font-size:14px;font-weight:700;padding:8px 16px;border-radius:8px;background:${primary}}
.hero .btn-secondary{font-size:14px;font-weight:600;padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;color:#475569}
.features{padding:0 20px 32px;display:grid;gap:12px;grid-template-columns:repeat(2,1fr);max-width:960px;margin:0 auto}
@media(max-width:600px){.features{grid-template-columns:1fr}}
.feature{border:1px solid #e2e8f0;border-radius:12px;padding:16px}
.feature-icon{width:32px;height:32px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:800}
.feature-title{margin:0;font-weight:700;font-size:14px}
.feature-desc{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.6}
.footer{background:#0f172a;color:#cbd5e1;font-size:11px;padding:12px 20px;display:flex;flex-wrap:wrap;gap:12px}
.footer .footer-sub{margin:0 0 0 auto;font-family:monospace;color:#94a3b8;overflow-wrap:anywhere}
</style>
</head>
<body>
<header class="header"><span class="name">${siteName}</span><nav>${nav}</nav><span class="cta">${cta}</span></header>
<main>
<section class="hero"><h1>${headline}</h1><p>${subheadline}</p><div class="actions"><span class="btn-primary">${cta}</span><span class="btn-secondary">Pelajari Dulu</span></div></section>
<section class="features">${features}</section>
</main>
<footer class="footer"><span>${siteName}</span><span>${sections}</span>${footerSub}</footer>
</body>
</html>`;
}
