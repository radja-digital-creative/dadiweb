// ---------------------------------------------------------------------------
// G12 — Halaman situs publik (menggantikan renderer React G10).
// Dulu PublicSiteView merender situs sendiri (header putih, tanpa CTA
// header, accent tidak dipakai) — renderer KEDUA yang terbukti berbeda
// dari Preview. Kini halaman ini hanya menampilkan, lewat
// <iframe srcDoc>, HTML yang dihasilkan renderer statis tunggal yang
// sama persis dengan yang dipakai Preview (server/src/site-render.ts),
// dari SNAPSHOT deployment live (aksi getPublicSiteHtml). Untuk snapshot
// yang sama, situs publik = preview, byte-per-byte.
// Komponen ini dirender App SEBELUM gerbang login bila hostname adalah
// subdomain dadiweb.id (atau, untuk pengujian di prototipe yang tidak
// dilayani lewat subdomain, bila query ?site={slug} ada) — aksi
// getPublicSiteHtml tidak memakai token dan server hanya mengembalikan
// proyek dengan deployment live, tanpa data pemilik apa pun.
// Mobile-first mengikuti desain-ui 1.0.1 di dalam HTML statis itu
// sendiri (nav flex-wrap, grid fitur runtuh ke 1 kolom di layar sempit,
// tanpa overflow horizontal, CTA dapat disentuh); iframe di sini hanya
// membentang selebar viewport.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function detectPublicSlug(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
  if (host.endsWith(".dadiweb.id")) {
    const first = host.slice(0, -".dadiweb.id".length);
    if (first && !first.includes(".") && first !== "www" && slugPattern.test(first)) {
      return first;
    }
  }
  const param = new URLSearchParams(window.location.search).get("site");
  if (param && slugPattern.test(param.trim().toLowerCase())) {
    return param.trim().toLowerCase();
  }
  return null;
}

export function PublicSiteView({ slug }: { slug: string }) {
  const site = useQuery({
    queryKey: ["public-site-html", slug],
    queryFn: () => api.getPublicSiteHtml({ slug }),
  });

  if (site.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <p className="text-sm font-semibold text-slate-600">Memuat situs…</p>
      </div>
    );
  }

  if (site.isError || !site.data?.ok || !site.data.html) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 p-6 text-center">
          <p className="font-bold text-slate-900">Situs tidak ditemukan</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {site.data?.error ??
              "Situs ini belum diterbitkan atau alamatnya salah."}
          </p>
          <p className="mt-3 break-all font-mono text-xs text-slate-400">
            {slug}.dadiweb.id
          </p>
        </div>
      </div>
    );
  }

  // sandbox="" (tanpa allow-scripts): HTML situs statis tidak memakai
  // <script> sama sekali, jadi tidak ada fungsi yang hilang; sebaliknya
  // spec yang ter-escape pun tidak bisa mengeksekusi apa pun di sini.
  // title memakai subdomain agar tab browser menunjukkan alamat situs.
  return (
    <iframe
      title={`Situs ${site.data.subdomain ?? slug}`}
      srcDoc={site.data.html}
      sandbox=""
      className="block min-h-screen w-full border-0"
    />
  );
}
