// Skrip staging G12 — materialisasi folder file situs fisik dari database.
// (BUKAN bagian prototipe Muse: di prototipe, aksi hanya mengekspos ctx.db
// tanpa API penulisan file, sehingga folder site-files hanya representasi
// logis. Di server staging Bun ini, skrip ini menulis file fisik yang
// persis sama dengan string HTML yang dihasilkan renderer tunggal.)
//
// Yang dilakukan:
//  - Membaca app.db staging (READ-ONLY — tidak pernah menulis DB).
//  - Untuk setiap proyek berspec valid: menulis working copy
//    site-files/<slug>/index.html dari spec terkini (ini BUKAN versi
//    publik; working copy hanya untuk referensi/preview internal).
//  - Untuk setiap slug yang punya deployment live (regresi G11: bila
//    beberapa proyek berslug sama, yang dipakai adalah proyek dengan
//    deployment live TERBARU, id terbesar, dan spec efektif valid):
//    menulis site-files/<slug>/snapshots/<deploymentId>/index.html dari
//    spec EFEKTIF deployment itu — yaitu site_snapshot_spec bila ada dan
//    valid, atau spec proyek terkini bila snapshot pra-G12 kosong
//    (jalur kompatibilitas; dicatat snapshot:false di ringkasan).
//  - Slug draft tanpa deployment live: TIDAK dibuatkan snapshot, dan
//    tidak akan dilayani publik oleh server/index.ts walau ada file
//    working copy-nya. Slug tidak valid (path-guard) dilewati.
//
// CARA JALANKAN (di server staging, service BOLEH jalan karena DB
// dibuka read-only; tapi jalankan SETELAH swap code + migrasi 0020,
// dan ULANGI setelah setiap deploy/redeploy/rollback di staging,
// karena sinkronisasi file ini masih script-driven, BUKAN otomatis
// di setiap deploy — lihat README paket):
//   cd /var/www/dadiweb
//   bun ./scripts/materialize-site-files.ts
//   # atau dengan DB/outdir eksplisit:
//   DADIWEB_DB=/var/www/dadiweb/app.db SITE_FILES_ROOT=/var/www/dadiweb/site-files bun ./scripts/materialize-site-files.ts
//   (SITE_FILES_ROOT adalah direktori site-files ITU SENDIRI — skrip
//   menulis <SITE_FILES_ROOT>/<slug>/index.html, BUKAN
//   <SITE_FILES_ROOT>/site-files/<slug>/index.html. Defaultnya
//   <root-proyek>/site-files, sama dengan server/index.ts.)
//
// KELUAR: ringkasan JSON per baris di stdout + exit 0 bila selesai
// (melewati slug invalid/draft bukan error). Tidak ada secret yang
// dibaca atau ditulis skrip ini; HTML tidak mengandung token/data pemilik.

import { Database } from "bun:sqlite";
import { join, resolve } from "node:path";
import {
  isValidSiteSlug,
  renderSiteHtml,
  siteFilePath,
  siteSnapshotPath,
  type SiteSpecLike,
} from "../server/src/site-render";

const ROOT = resolve(import.meta.dir, "..");
const DB_PATH = process.env.DADIWEB_DB ?? join(ROOT, "app.db");
const OUT_ROOT = process.env.SITE_FILES_ROOT ?? join(ROOT, "site-files");

function parseSiteSpec(raw: unknown): SiteSpecLike | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const s = parsed as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const siteName = str(s.siteName);
  const headline = str(s.headline);
  const subheadline = str(s.subheadline);
  const ctaLabel = str(s.ctaLabel);
  const primaryColor = str(s.primaryColor);
  const accentColor = str(s.accentColor);
  if (
    siteName === null || headline === null || subheadline === null ||
    ctaLabel === null || primaryColor === null || accentColor === null ||
    !Array.isArray(s.features) || !Array.isArray(s.sections) ||
    !Array.isArray(s.pages)
  ) {
    return null;
  }
  const features: SiteSpecLike["features"] = [];
  for (const f of s.features) {
    if (!f || typeof f !== "object") return null;
    const t = str((f as Record<string, unknown>).title);
    const d = str((f as Record<string, unknown>).description);
    if (t === null || d === null) return null;
    features.push({ title: t, description: d });
  }
  const sections = s.sections.every((x) => typeof x === "string")
    ? (s.sections as string[])
    : null;
  const pages = s.pages.every((x) => typeof x === "string")
    ? (s.pages as string[])
    : null;
  if (sections === null || pages === null) return null;
  return {
    siteName, headline, subheadline, ctaLabel, primaryColor, accentColor,
    features, sections, pages,
  };
}

interface ProjectRow { id: number; slug: string; spec: string }
interface DeploymentRow {
  id: number; project_id: number; subdomain: string; status: string;
  site_snapshot_spec: string | null;
}

const sqlite = new Database(DB_PATH, { readonly: true });
const projects = sqlite
  .query("SELECT id, slug, spec FROM projects")
  .all() as ProjectRow[];
const deployments = sqlite
  .query(
    "SELECT id, project_id, subdomain, status, site_snapshot_spec FROM deployments",
  )
  .all() as DeploymentRow[];
sqlite.close();

const projectById = new Map(projects.map((p) => [p.id, p]));
const summary = {
  db: DB_PATH, outRoot: OUT_ROOT, working: [] as string[],
  snapshots: [] as Array<{ slug: string; deploymentId: number; snapshot: boolean; path: string }>,
  skippedDraft: [] as string[], skippedInvalid: [] as string[],
};

// 1) Working copy dari spec terkini (bukan versi publik). Working copy
//    dikunci slug, bukan proyek: bila dua proyek berslug sama, file
//    working copy slug itu ditimpa proyek berikutnya — ini bukan
//    masalah publik, karena yang dilayani server HANYA snapshot
//    deployment (kunci deployment, unambiguous), bukan working copy.
for (const project of projects) {
  if (!isValidSiteSlug(project.slug)) {
    summary.skippedInvalid.push(project.slug);
    continue;
  }
  const spec = parseSiteSpec(project.spec);
  if (!spec) {
    summary.skippedInvalid.push(project.slug);
    continue;
  }
  const rel = siteFilePath(project.slug);
  // OUT_ROOT sudah adalah direktori site-files, jadi buang prefix
  // "site-files/" dari path logis sebelum join (hindari site-files/
  // site-files/ ganda; server/index.ts memakai konvensi yang sama).
  const fsRel = rel.replace(/^site-files\//, "");
  await Bun.write(join(OUT_ROOT, fsRel), renderSiteHtml(spec));
  if (!summary.working.includes(rel)) summary.working.push(rel);
}

// 2) Snapshot live — resolver yang sama dengan G11/G12 di actions.ts:
//    per slug, per proyek ambil deployment live terbaru (id terbesar),
//    lalu di antara proyek berslug sama pilih deployment id terbesar
//    yang spec efektifnya valid.
const bySlug = new Map<string, DeploymentRow[]>();
for (const d of deployments) {
  if (d.status !== "live") continue;
  const project = projectById.get(d.project_id);
  if (!project || !isValidSiteSlug(project.slug)) continue;
  const list = bySlug.get(project.slug) ?? [];
  list.push(d);
  bySlug.set(project.slug, list);
}
for (const [slug, liveList] of bySlug) {
  // Deployment live terbaru per proyek dulu, lalu pilih yang id terbesar.
  const newestPerProject = new Map<number, DeploymentRow>();
  for (const d of liveList) {
    const cur = newestPerProject.get(d.project_id);
    if (!cur || d.id > cur.id) newestPerProject.set(d.project_id, d);
  }
  let best: { deployment: DeploymentRow; spec: SiteSpecLike; snapshot: boolean } | null = null;
  for (const d of [...newestPerProject.values()].sort((a, b) => b.id - a.id)) {
    const project = projectById.get(d.project_id)!;
    const snap = (d.site_snapshot_spec ?? "").trim();
    let spec: SiteSpecLike | null = null;
    let snapshot = false;
    if (snap) {
      spec = parseSiteSpec(snap);
      if (spec) snapshot = true;
    }
    if (!spec) spec = parseSiteSpec(project.spec);
    if (!spec) continue;
    best = { deployment: d, spec, snapshot };
    break; // id terbesar yang valid menang, sesuai resolver.
  }
  if (!best) {
    summary.skippedDraft.push(slug);
    continue;
  }
  const rel = siteSnapshotPath(slug, best.deployment.id);
  const fsRel = rel.replace(/^site-files\//, "");
  await Bun.write(
    join(OUT_ROOT, fsRel),
    renderSiteHtml(best.spec, best.deployment.subdomain),
  );
  summary.snapshots.push({
    slug, deploymentId: best.deployment.id,
    snapshot: best.snapshot, path: rel,
  });
}

// Slug tanpa deployment live sama sekali (draft) — dicatat, bukan error.
for (const project of projects) {
  if (!isValidSiteSlug(project.slug)) continue;
  if (!bySlug.has(project.slug) && !summary.skippedDraft.includes(project.slug)) {
    summary.skippedDraft.push(project.slug);
  }
}

console.log(JSON.stringify(summary, null, 2));
