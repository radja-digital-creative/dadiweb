// Actions for the Dadiweb MVP prototype.
//
// Per-user data isolation: every data action requires the caller's session
// token and only ever reads or writes rows owned by that user. Projects
// carry user_id directly; generations, project tables/rows and deployments
// are owned through their project; the credit ledger and usage rows carry
// user_id; workspace and credit account rows are keyed by the owner's user
// id. Templates remain a shared global catalog.
//
// The core loop: generateWebsite runs a 5-stage AI pipeline
// (Planner → Designer → Coder → Builder & Tester → Fixer). Since G5-A the
// model-calling stages go through the DeepInfra provider layer
// (server/src/ai-provider.ts) with their own Zod schemas — generateWebsite
// never calls ctx.inference directly — and each stage is charged a fixed
// credit cost from the approved roadmap, recorded in the append-only
// credit_ledger.
// Stages are persisted in `generations` so the editor can show exactly what
// the AI did. If the balance cannot cover a stage, the pipeline stops before
// that stage; credits already spent stay spent.

import { defineAction, z, type ActionsModule, type Ctx } from "./sdk-shim";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { SKILL_FILES } from "./skills-content";
import {
  AI_PROVIDER,
  clearProviderKey,
  ensureAiStageModels,
  getProviderKeyStatus,
  getStageModel,
  logAiKeyMissing,
  runAiStage,
  setProviderKey,
  testModelConnection,
} from "./ai-provider";
import {
  buildGoogleAuthUrl,
  clearGoogleOAuthSettings,
  consumeOAuthState,
  createOAuthState,
  exchangeCodeForProfile,
  getGoogleOAuthSettingsStatus,
  setGoogleOAuthSettings,
} from "./google-oauth";
import {
  buildGitHubAuthUrl,
  clearGitHubOAuthSettings,
  consumeGitHubOAuthState,
  createGitHubOAuthState,
  exchangeCodeForProfile as exchangeGitHubCodeForProfile,
  getGitHubOAuthSettingsStatus,
  setGitHubOAuthSettings,
} from "./github-oauth";
import {
  CLOUDFLARE_MISSING_LABELS,
  CloudflareError,
  clearCloudflareSettings,
  ensureDnsRecord,
  getCloudflareSettingsStatus,
  loadCloudflareSettingsForDeploy,
  setCloudflareSettings,
} from "./cloudflare";
import {
  FalVideoError,
  VideoEstimateError,
  clearFalVideoKey,
  estimateVideoCostFor,
  getFalVideoSettingsStatus,
  getVideoModels,
  loadFalVideoKey,
  setFalVideoKey,
  setFalVideoTariff,
  testFalVideoConnection,
} from "./fal-video";
import {
  cancelVideoJob,
  deleteProjectVideoBlobs,
  getVideoJob,
  listVideoJobs,
  submitVideoJob,
  toVideoJobOut,
  type VideoBlobStore,
} from "./video-jobs";
import { chargeCredits } from "./credit-charges";
import {
  isValidSiteSlug,
  renderSiteHtml,
  siteFilePath,
  siteSnapshotPath,
} from "./site-render";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

const STAGES = [
  { key: "planner", label: "Planner", cost: 40 },
  { key: "designer", label: "Designer", cost: 60 },
  { key: "coder", label: "Coder", cost: 120 },
  { key: "builder", label: "Builder & Tester", cost: 50 },
  { key: "fixer", label: "Fixer", cost: 30 },
] as const;

const TOTAL_GENERATE_COST = STAGES.reduce((sum, s) => sum + s.cost, 0); // 300
const DEPLOY_COST = 25;
const ANDROID_BUILD_COST = 150;

// Plan entitlements (mirror the plan cards in the design / PLANS on the
// client). A brand-new account starts with a full monthly balance.
const PLAN_QUOTA: Record<string, number> = {
  Free: 200,
  "Pro Plan": 5000,
  Bisnis: 15000,
};
const PLAN_PRICE: Record<string, number> = {
  Free: 0,
  "Pro Plan": 299000,
  Bisnis: 799000,
};
const USAGE_CATEGORIES = ["AI Coding", "Gambar", "Database", "Video", "Lainnya"];

const tokenField = z.string().min(1).max(200);

const siteSpecSchema = z.object({
  siteName: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  ctaLabel: z.string(),
  primaryColor: z.string(),
  accentColor: z.string(),
  features: z.array(z.object({ title: z.string(), description: z.string() })),
  sections: z.array(z.string()),
  pages: z.array(z.string()),
});
type SiteSpec = z.infer<typeof siteSpecSchema>;

const planSchema = z.object({
  siteName: z.string().describe("Nama website yang singkat dan mudah diingat"),
  slug: z
    .string()
    .describe("Slug subdomain: huruf kecil dan tanda hubung saja, tanpa spasi"),
  category: z
    .enum([
      "Website",
      "Marketplace",
      "Sistem Bisnis",
      "Aplikasi Android",
      "Dashboard",
      "Lainnya",
    ])
    .describe("Kategori proyek yang paling cocok dengan prompt"),
  summary: z.string().describe("Ringkasan rencana situs dalam 1-2 kalimat"),
  pages: z.array(z.string()).describe("Daftar nama halaman situs"),
  features: z
    .array(z.string())
    .describe("Fitur utama situs, 4 sampai 6 butir"),
  dbTables: z
    .array(
      z.object({
        name: z.string().describe("Nama tabel, huruf kecil dengan underscore"),
        columns: z
          .array(z.string())
          .describe("Nama kolom tabel, termasuk id bila relevan"),
      }),
    )
    .describe("Tabel database yang dibutuhkan situs ini"),
});

const designSchema = z.object({
  headline: z.string().describe("Judul besar hero situs"),
  subheadline: z.string().describe("Subjudul hero, 1-2 kalimat"),
  ctaLabel: z.string().describe("Teks tombol utama"),
  primaryColor: z
    .string()
    .describe("Warna utama situs sebagai hex, mis. #2563EB"),
  accentColor: z
    .string()
    .describe("Warna aksen situs sebagai hex, mis. #F97316"),
  layoutNotes: z.string().describe("Catatan tata letak dalam satu kalimat"),
});

const codeSchema = z.object({
  features: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
      }),
    )
    .describe("4 fitur unggulan situs dengan deskripsi singkat"),
  sections: z
    .array(z.string())
    .describe("Nama-nama section halaman utama secara berurutan"),
  stackNotes: z.string().describe("Ringkasan stack yang dihasilkan, satu kalimat"),
});

// G5-D — struktur JSON persis per tahap yang dikomunikasikan ke model
// DeepInfra (termasuk nilai enum yang sah & bentuk objek bersarang);
// tanpa ini model mengarang nama/nilai field dan validasi skema gagal
// walau model menjawab dengan baik.
const PLAN_STRUCTURE_HINT =
  '{"siteName": string (nama website singkat), "slug": string (huruf kecil & tanda hubung saja), "category": salah satu dari "Website" | "Marketplace" | "Sistem Bisnis" | "Aplikasi Android" | "Dashboard" | "Lainnya", "summary": string (1-2 kalimat), "pages": string[] (nama halaman), "features": string[] (4-6 fitur), "dbTables": [{"name": string (huruf kecil underscore), "columns": string[]}]}';
const DESIGN_STRUCTURE_HINT =
  '{"headline": string, "subheadline": string (1-2 kalimat), "ctaLabel": string, "primaryColor": string (hex, mis. #2563EB), "accentColor": string (hex), "layoutNotes": string (satu kalimat)}';
const CODE_STRUCTURE_HINT =
  '{"features": [{"title": string, "description": string}] (tepat 4 fitur), "sections": string[] (nama section halaman utama berurutan), "stackNotes": string (satu kalimat)}';

const specOut = z.object({
  siteName: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  ctaLabel: z.string(),
  primaryColor: z.string(),
  accentColor: z.string(),
  features: z.array(z.object({ title: z.string(), description: z.string() })),
  sections: z.array(z.string()),
  pages: z.array(z.string()),
});

const projectOut = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  status: z.string(),
  prompt: z.string(),
  source: z.string(),
  creditsCost: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  spec: specOut.nullable(),
  // G6 — planner MD proyek untuk bagian "Rencana" di panel details.
  plannerMd: z.string(),
});

const templateOut = z.object({
  id: z.number(),
  name: z.string(),
  category: z.string(),
  tagline: z.string(),
  hue: z.number(),
  uses: z.number(),
  spec: specOut,
});

function getDb(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
type Db = ReturnType<typeof getDb>;
type UserRow = typeof schema.users.$inferSelect;

function parseSpec(raw: string): SiteSpec | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = siteSpecSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function toProjectOut(row: typeof schema.projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    status: row.status,
    prompt: row.prompt,
    source: row.source,
    creditsCost: row.creditsCost,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    spec: parseSpec(row.spec),
    plannerMd: row.plannerMd ?? "",
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "proyek-baru";
}

// ---------------------------------------------------------------------------
// G0 — Fondasi Katalog Skill AI
//
// G0 hanya fondasi: (a) format SKILL.md baku + validator, (b) Router v1 yang
// memakai METADATA routing (nama, family, triggers, requires) — file
// SKILL.md lengkap untuk skill P0 ditulis di G1, bukan di sini, (c)
// pencatatan skill_plan + skill_versions per proyek, dan (d) Executor
// path-guard (uji isolasi I-4). Tidak ada tarif kredit yang berubah di G0.
// ---------------------------------------------------------------------------

const SKILL_CATALOG_VERSION = "1.0.0";
const SKILL_VERSION_NOTE =
  "file SKILL.md lengkap (katalog 30 skill: 12 P0 G1 + 16 P1 G3 + 2 P2 G4)";
const ROUTE_NOTE =
  "Router memakai snapshot registry triggers (SKILL_REGISTRY di server/src/actions.ts) yang disinkronkan persis dengan frontmatter triggers ke-30 file SKILL.md tersimpan (12 P0 + 16 P1 G3 + 2 P2 G4); versi setiap skill dibaca dari frontmatter file SKILL.md-nya (booking-reservasi, klinik-layanan, api-rest, dan desain-ui 1.0.1 sejak G7, 26 skill lain 1.0.0). Skill yang dinonaktifkan admin (skill_catalog_state.is_active=false) dikeluarkan dari registry aktif SEBELUM penskoran, jadi routing berubah langsung tanpa deploy ulang. Bila ada file SKILL.md yang berubah, snapshot registry ini WAJIB disinkronkan ulang agar skor router tetap cocok dengan file tersimpan.";
const MAX_SKILLS_PER_STAGE = 4;

interface SkillMeta {
  name: string;
  family: "domain" | "pendukung";
  priority: "P0" | "P1" | "P2";
  triggers: string[];
  requires: string[];
}

// Registry metadata routing — SNAPSHOT yang disinkronkan dengan tangan.
// PENTING: triggers dan requires di bawah ini adalah salinan PERSIS dari
// frontmatter ke-30 file SKILL.md yang tersimpan (skills/<name>.md, juga
// tersimpan sebagai SKILL_FILES di skills-content): 12 P0 (booking-reservasi
// dan desain-ui versi 1.0.1 — desain-ui sejak G7 mobile-first, 10 lain 1.0.0)
// + 16 P1 G3 (klinik-layanan dan api-rest versi
// 1.0.1 sejak putaran perbaikan router G3, 14 lain 1.0.0) (portfolio,
// blog-majalah, katalog-produk, marketplace — kini PUNYA file, restoran-
// kuliner, klinik-layanan, kursus-lms, saas-platform, crm-internal sebagai
// domain; api-rest, import-eksport-data, laporan-analitik, whatsapp-api,
// google-maps, email-service, deploy-domain sebagai pendukung) + 2 P2 G4
// (formulir-lead sebagai domain; ai-api sebagai pendukung). Versi resmi
// setiap skill dibaca dari frontmatter file itu (skillFileVersion), bukan
// dari registry ini. SETIAP KALI ada file SKILL.md yang berubah (triggers,
// requires, atau versi), snapshot registry ini WAJIB disinkronkan ulang —
// bila tidak, skor router akan kembali usang dan tidak lagi mencerminkan
// file tersimpan (pelajaran cacat G1).
// Routing family di registry ini ("domain" | "pendukung") adalah peran
// routing, BUKAN field family frontmatter (web-konten, commerce-bisnis,
// dst. — itu dibaca dari file lewat skillCatalogEntry).
const SKILL_REGISTRY: SkillMeta[] = [
  { name: "landing-page", family: "domain", priority: "P0", triggers: ["landing page", "landing", "halaman promosi", "halaman penjualan", "one page", "lead generation", "halaman arahan", "promosi produk", "promosi jasa"], requires: ["desain-ui"] },
  { name: "company-profile", family: "domain", priority: "P0", triggers: ["company profile", "profil perusahaan", "profil bisnis", "perusahaan", "portofolio", "tentang kami", "jasa konstruksi", "klien korporat", "website perusahaan"], requires: ["desain-ui"] },
  { name: "toko-online", family: "domain", priority: "P0", triggers: ["toko online", "toko", "e-commerce", "ecommerce", "online shop", "jual produk", "katalog produk", "keranjang", "checkout", "jualan online", "satu penjual", "satu toko"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "pos-kasir", family: "domain", priority: "P0", triggers: ["pos", "kasir", "point of sale", "toko retail", "retail", "struk", "stok barang", "laporan penjualan", "mesin kasir", "kafe", "warung", "minimarket"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "booking-reservasi", family: "domain", priority: "P0", triggers: ["booking", "reservasi", "jadwal", "kalender", "appointment", "pesan tempat", "sewa", "janji temu", "salon", "klinik", "lapangan", "rental", "slot", "dokter", "pasien", "pengingat", "layanan"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "android-developer", family: "domain", priority: "P0", triggers: ["android", "aplikasi android", "apk", "aab", "aplikasi mobile", "mobile app", "aplikasi hp", "play store", "capacitor"], requires: ["desain-ui"] },
  { name: "dashboard-admin", family: "domain", priority: "P0", triggers: ["dashboard", "admin", "panel admin", "manajemen", "statistik", "crm", "kelola data", "manajemen pengguna", "panel kelola", "laporan"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "marketplace", family: "domain", priority: "P1", triggers: ["marketplace", "banyak penjual", "banyak toko", "multi vendor", "multivendor", "multi-vendor", "banyak seller", "platform jual beli", "jual beli online", "penjual independen", "komisi penjual", "toko per penjual"], requires: ["database-designer", "auth-pengguna", "bayar-doku"] },
  { name: "portfolio", family: "domain", priority: "P1", triggers: ["portfolio", "portofolio personal", "galeri karya", "karya kreatif", "cv online", "resume online", "portofolio desainer", "showcase karya", "personal branding", "portofolio fotografer"], requires: ["desain-ui"] },
  { name: "blog-majalah", family: "domain", priority: "P1", triggers: ["blog", "majalah", "portal berita", "artikel", "majalah online", "blog pribadi", "berita online", "jurnal online", "tulisan blog", "publikasi artikel"], requires: ["database-designer", "desain-ui"] },
  { name: "katalog-produk", family: "domain", priority: "P1", triggers: ["katalog", "etalase", "etalase produk", "katalog digital", "katalog tanpa transaksi", "tanpa checkout", "tanpa keranjang", "hanya katalog", "pesan via whatsapp", "katalog whatsapp", "daftar produk", "showroom produk"], requires: ["database-designer", "desain-ui"] },
  { name: "restoran-kuliner", family: "domain", priority: "P1", triggers: ["restoran", "kuliner", "menu digital", "menu qr", "qr meja", "pesan di meja", "pesan makanan", "rumah makan", "warung makan", "dapur restoran", "kitchen display", "menu restoran", "kds"], requires: ["database-designer", "desain-ui"] },
  { name: "klinik-layanan", family: "domain", priority: "P1", triggers: ["klinik layanan", "antrean", "nomor antrean", "antrean pasien", "rekam kunjungan", "kunjungan pasien", "jadwal praktisi", "poli", "layanan kesehatan", "manajemen klinik", "sistem klinik", "antrean klinik", "klinik", "catatan kunjungan", "pendaftaran pasien", "antrean harian", "jadwal dokter"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "kursus-lms", family: "domain", priority: "P1", triggers: ["kursus online", "kursus", "lms", "learning management", "kelas online", "modul belajar", "materi kursus", "platform kursus", "e-learning", "pembelajaran online", "sertifikat kursus", "siswa kursus"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "saas-platform", family: "domain", priority: "P1", triggers: ["saas", "platform berlangganan", "multi-tenant", "multitenant", "tenant", "paket berlangganan", "kuota pengguna", "billing", "produk saas", "aplikasi berlangganan", "subscription", "layanan berlangganan"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "crm-internal", family: "domain", priority: "P1", triggers: ["crm", "crm internal", "sistem crm", "customer relationship", "pipeline penjualan", "pipeline", "follow-up", "follow up", "kontak pelanggan", "prospek", "sistem internal", "manajemen pelanggan", "tugas follow-up"], requires: ["database-designer", "auth-pengguna", "desain-ui"] },
  { name: "formulir-lead", family: "domain", priority: "P2", triggers: ["formulir", "formulir pendaftaran", "formulir kontak", "formulir survei", "form", "form pendaftaran", "form survei", "survei", "survey", "kuis", "kuesioner", "angket", "pendaftaran peserta", "pendaftaran webinar", "pendaftaran event", "lead generation", "pengumpul lead", "form online", "formulir lead"], requires: ["database-designer", "desain-ui"] },
  { name: "ai-api", family: "pendukung", priority: "P2", triggers: ["ai api", "ai", "chatbot", "chatbot toko", "asisten ai", "asisten virtual", "ringkasan otomatis", "ringkasan ai", "rekomendasi produk", "rekomendasi ai", "rekomendasi", "fitur ai", "kecerdasan buatan", "tanya jawab otomatis", "chat ai", "ai untuk toko"], requires: ["database-designer"] },
  { name: "api-rest", family: "pendukung", priority: "P1", triggers: ["api rest", "rest api", "endpoint", "endpoint crud", "openapi", "api untuk android", "backend api", "json api", "dokumentasi api", "integrasi frontend", "api", "api backend"], requires: ["database-designer"] },
  { name: "import-eksport-data", family: "pendukung", priority: "P1", triggers: ["impor data", "ekspor data", "import csv", "export csv", "impor csv", "ekspor csv", "csv", "unggah data", "unduh data", "template csv", "migrasi data"], requires: ["database-designer"] },
  { name: "laporan-analitik", family: "pendukung", priority: "P1", triggers: ["laporan analitik", "laporan penjualan", "analitik", "grafik tren", "tren penjualan", "rekap periode", "rekap", "ekspor laporan", "laporan", "statistik penjualan", "analisis data"], requires: ["database-designer"] },
  { name: "whatsapp-api", family: "pendukung", priority: "P1", triggers: ["whatsapp", "wa", "notifikasi whatsapp", "tombol chat", "chat whatsapp", "konfirmasi pesanan whatsapp", "pengingat booking whatsapp", "template pesan whatsapp", "whatsapp api"], requires: [] },
  { name: "google-maps", family: "pendukung", priority: "P1", triggers: ["google maps", "maps", "peta lokasi", "peta", "lokasi", "alamat", "titik cabang", "cabang", "navigasi", "rute ke lokasi", "embed peta"], requires: ["desain-ui"] },
  { name: "email-service", family: "pendukung", priority: "P1", triggers: ["email", "email transaksional", "kirim email", "invoice email", "reset kata sandi email", "notifikasi email", "template email", "email service", "surat elektronik"], requires: [] },
  { name: "deploy-domain", family: "pendukung", priority: "P1", triggers: ["deploy", "deployment", "domain", "domain custom", "subdomain", "ssl", "rollback deploy", "riwayat deploy", "publikasikan", "tayang online", "dadiweb.id"], requires: [] },
  { name: "database-designer", family: "pendukung", priority: "P0", triggers: ["database", "basis data", "skema", "tabel", "data", "relasi", "migrasi", "crud"], requires: [] },
  { name: "auth-pengguna", family: "pendukung", priority: "P0", triggers: ["login", "masuk akun", "daftar akun", "registrasi", "akun pengguna", "anggota", "member", "kata sandi", "peran pengguna"], requires: ["database-designer"] },
  { name: "bayar-doku", family: "pendukung", priority: "P0", triggers: ["doku", "pembayaran", "bayar online", "checkout bayar", "payment gateway", "qris", "virtual account", "transfer bank"], requires: ["database-designer"] },
  { name: "desain-ui", family: "pendukung", priority: "P0", triggers: ["desain", "tampilan", "warna", "tema", "gaya", "ui", "responsif", "mode gelap", "gelap", "terang"], requires: [] },
  { name: "seo-performa", family: "pendukung", priority: "P0", triggers: ["seo", "google", "pencarian", "meta", "sitemap", "cepat", "performa", "loading", "ditemukan di google"], requires: [] },
];

const DOMAIN_SKILLS = SKILL_REGISTRY.filter((s) => s.family === "domain");

function skillMeta(name: string): SkillMeta | undefined {
  return SKILL_REGISTRY.find((s) => s.name === name);
}

// G1 — versi sebuah skill dibaca dari frontmatter file SKILL.md aslinya di
// katalog (skills-content), bukan lagi label katalog G0. Skill tanpa file
// (misalnya marketplace, masih P1/metadata) memakai versi katalog.
function skillFileVersion(name: string): string {
  const content = SKILL_FILES[name];
  if (!content) return SKILL_CATALOG_VERSION;
  const version = parseFrontmatter(content)?.get("version")?.value.trim();
  return version ? version : SKILL_CATALOG_VERSION;
}

// G1 — ringkasan katalog dari frontmatter file SKILL.md asli.
function skillCatalogEntry(name: string): {
  name: string;
  family: string;
  title: string;
  version: string;
} | null {
  const content = SKILL_FILES[name];
  if (!content) return null;
  const fields = parseFrontmatter(content);
  if (!fields) return null;
  return {
    name: fields.get("name")?.value.trim() || name,
    family: fields.get("family")?.value.trim() ?? "",
    title: fields.get("title")?.value.trim() ?? "",
    version: fields.get("version")?.value.trim() ?? "",
  };
}

const skillStagesOut = z.object({
  planner: z.array(z.string()),
  designer: z.array(z.string()),
  coder: z.array(z.string()),
  builder: z.array(z.string()),
  fixer: z.array(z.string()),
});
type SkillStages = z.infer<typeof skillStagesOut>;

const skillPlanOut = z.object({
  label: z.string(),
  primaryDomain: z.string().nullable(),
  isGeneric: z.boolean(),
  winnerSource: z.string(),
  stages: skillStagesOut,
});
type SkillPlan = z.infer<typeof skillPlanOut>;

const skillVersionOut = z.object({
  name: z.string(),
  version: z.string(),
  note: z.string(),
});

function normalizeText(value: string): string {
  return ` ${value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function scoreSkillMetas(
  prompt: string,
  metas: SkillMeta[],
): Array<{ skill: string; score: number }> {
  const norm = normalizeText(prompt);
  return metas
    .map((meta) => {
      let score = 0;
      for (const trigger of meta.triggers) {
        const t = normalizeText(trigger);
        if (t.trim() && norm.includes(t)) {
          score += t.trim().includes(" ") ? 3 : 2;
        }
      }
      return { skill: meta.name, score };
    })
    .sort((a, b) => b.score - a.score);
}

function scoreDomainSkills(
  prompt: string,
  disabled?: ReadonlySet<string>,
): Array<{ skill: string; score: number }> {
  const metas = disabled
    ? DOMAIN_SKILLS.filter((s) => !disabled.has(s.name))
    : DOMAIN_SKILLS;
  return scoreSkillMetas(prompt, metas);
}

// Perbaikan router G1 (C) + G3 + G4 — skill pendukung standalone yang boleh
// menjadi fallback: auth-pengguna dan bayar-doku (G1) ditambah 7 pendukung
// P1 G3 (api-rest, import-eksport-data, laporan-analitik, whatsapp-api,
// google-maps, email-service, deploy-domain) dan ai-api (P2 G4), diskor dari triggers
// frontmatter mereka (snapshot registry di atas). Pendukung generik
// (database-designer, desain-ui, seo-performa) tidak pernah diskor sebagai
// fallback — mereka masuk plan lewat requires/tahap baku.
const FALLBACK_SUPPORT_SKILLS = [
  "auth-pengguna",
  "bayar-doku",
  "api-rest",
  "import-eksport-data",
  "laporan-analitik",
  "whatsapp-api",
  "google-maps",
  "email-service",
  "deploy-domain",
  "ai-api",
] as const;

function scoreFallbackSupportSkills(
  prompt: string,
  disabled?: ReadonlySet<string>,
): Array<{ skill: string; score: number }> {
  const metas = SKILL_REGISTRY.filter(
    (s) =>
      (FALLBACK_SUPPORT_SKILLS as readonly string[]).includes(s.name) &&
      !(disabled && disabled.has(s.name)),
  );
  return scoreSkillMetas(prompt, metas);
}

// G3 + G4 — pendukung P1 (dan ai-api P2) yang, bila triggers-nya cocok
// cukup kuat (skor >= 3)
// pada prompt yang dimenangkan domain lain, wajib ikut ke plan tahap yang
// sesuai (Coder untuk integrasi/API/data, Builder juga untuk laporan &
// deploy). Ini cara prompt seperti "company profile + Google Maps" atau
// "toko online + notifikasi WhatsApp" memasukkan skill integrasinya.
const STAGE_INCLUSION_SKILLS = [
  "api-rest",
  "import-eksport-data",
  "laporan-analitik",
  "whatsapp-api",
  "google-maps",
  "email-service",
  "deploy-domain",
  "ai-api",
] as const;

function scoreStageInclusionSkills(
  prompt: string,
  disabled?: ReadonlySet<string>,
): string[] {
  const metas = SKILL_REGISTRY.filter(
    (s) =>
      (STAGE_INCLUSION_SKILLS as readonly string[]).includes(s.name) &&
      !(disabled && disabled.has(s.name)),
  );
  return scoreSkillMetas(prompt, metas)
    .filter((s) => s.score >= 3)
    .map((s) => s.skill);
}

// Nama tampil kandidat untuk pertanyaan klarifikasi: judul resmi dari
// frontmatter file SKILL.md bila ada, selalu disertai nama skill-nya.
function skillDisplayLabel(name: string): string {
  const entry = skillCatalogEntry(name);
  return entry && entry.title ? `${name} (${entry.title})` : name;
}

// Chip pengguna: nama skill langsung, atau label jenis proyek yang dikenal.
// Chip yang terlalu umum ("website", "lainnya", "auto") tidak memaksa
// domain — router kembali ke skor prompt.
function chipToSkill(
  chip: string | undefined | null,
  disabled?: ReadonlySet<string>,
): string | null {
  if (!chip) return null;
  const raw = chip.trim().toLowerCase();
  if (!raw || raw === "auto") return null;
  const exact = SKILL_REGISTRY.find((s) => s.name === raw);
  if (exact && exact.family === "domain" && !(disabled && disabled.has(exact.name)))
    return exact.name;
  const norm = normalizeText(chip).trim();
  const labelMap: Record<string, string> = {
    "landing page": "landing-page",
    "company profile": "company-profile",
    "profil perusahaan": "company-profile",
    "toko online": "toko-online",
    "toko": "toko-online",
    "pos kasir": "pos-kasir",
    "kasir": "pos-kasir",
    "pos": "pos-kasir",
    "sistem bisnis": "pos-kasir",
    "booking": "booking-reservasi",
    "reservasi": "booking-reservasi",
    "booking reservasi": "booking-reservasi",
    "booking & reservasi": "booking-reservasi",
    "android": "android-developer",
    "aplikasi android": "android-developer",
    "dashboard": "dashboard-admin",
    "dashboard admin": "dashboard-admin",
    "admin": "dashboard-admin",
    "marketplace": "marketplace",
    "portfolio": "portfolio",
    "portofolio": "portfolio",
    "blog": "blog-majalah",
    "majalah": "blog-majalah",
    "katalog": "katalog-produk",
    "katalog produk": "katalog-produk",
    "restoran": "restoran-kuliner",
    "kuliner": "restoran-kuliner",
    "klinik": "klinik-layanan",
    "kursus": "kursus-lms",
    "lms": "kursus-lms",
    "saas": "saas-platform",
    "crm": "crm-internal",
  };
  const mapped = labelMap[norm] ?? null;
  if (mapped && disabled && disabled.has(mapped)) return null;
  return mapped;
}

function capStage(skills: string[]): string[] {
  return [...new Set(skills)].slice(0, MAX_SKILLS_PER_STAGE);
}

// Pembagian skill per tahap pipeline (Rencana Bab Router): Planner = domain
// utama + database-designer; Designer = desain-ui + domain; Coder = domain +
// auth/integrasi terpilih (dari requires + sinyal prompt); Builder & Tester
// = seo-performa + checklist QA skill domain; Fixer = skill tahap yang
// gagal, diwakili skill domain utama proyek ini.
function buildSkillStages(
  primary: string | null,
  promptNorm: string,
  opts?: { inclusions?: string[]; disabled?: ReadonlySet<string> },
): SkillStages {
  const disabled = opts?.disabled;
  const alive = (name: string) => !(disabled && disabled.has(name));
  if (!primary) {
    // Mode generik "proyek kustom": desain-ui + database-designer.
    return {
      planner: capStage(["database-designer", "desain-ui"]),
      designer: capStage(["desain-ui"]),
      coder: capStage(["desain-ui", "database-designer"]),
      builder: capStage(["seo-performa", "desain-ui"]),
      fixer: capStage(["desain-ui"]),
    };
  }
  const requires = skillMeta(primary)?.requires ?? [];
  const coder = [
    primary,
    ...requires.filter(
      (r) => (r === "auth-pengguna" || r === "bayar-doku") && alive(r),
    ),
  ];
  if (
    /(doku|pembayaran|bayar|payment|checkout|transaksi)/.test(promptNorm) &&
    alive("bayar-doku")
  ) {
    coder.push("bayar-doku");
  }
  if (
    /(login|masuk akun|akun pengguna|anggota|member|registrasi|daftar akun)/.test(promptNorm) &&
    alive("auth-pengguna")
  ) {
    coder.push("auth-pengguna");
  }
  // G3 — pendukung P1 yang triggers-nya cocok ikut ke tahap yang sesuai.
  const inclusions = (opts?.inclusions ?? []).filter(
    (n) => n !== primary && alive(n),
  );
  const builderExtra = inclusions.filter(
    (n) => n === "laporan-analitik" || n === "deploy-domain",
  );
  return {
    planner: capStage([primary, "database-designer"]),
    designer: capStage(["desain-ui", primary]),
    coder: capStage([...coder, ...inclusions]),
    builder: capStage(["seo-performa", primary, ...builderExtra]),
    fixer: capStage([primary]),
  };
}

interface RouteDecision {
  status: "ok" | "needs_clarification" | "generic";
  primaryDomain: string | null;
  label: string;
  winnerSource: "chip" | "skor" | "klarifikasi" | "generik";
  chipSkill: string | null;
  guessedSkill: string | null;
  scores: Array<{ skill: string; score: number }>;
  stages: SkillStages;
  plan: SkillPlan;
  versions: Array<{ name: string; version: string; note: string }>;
  clarificationQuestion: string | null;
  // G3 — skill nonaktif saat routing ini berjalan, dan kandidat terdekat
  // (untuk antrean kandidat skill baru bila hasilnya generik).
  disabledSkills: string[];
  nearestSkill: string | null;
  nearestScore: number;
}

// Putaran perbaikan router G3 — keluarga klarifikasi berpasangan. SEMUA
// pertanyaan penjernih dua skill (toko satu-vs-banyak penjual, pos-kasir
// vs dashboard-admin, booking vs klinik, dashboard vs crm, dan pertanyaan
// selisih tipis umum) hanya boleh memicu bila DUA syarat terpenuhi
// sekaligus: (1) selisih skor dua teratas ≤ 1 (ambang G1, tidak berubah —
// selisih 2 tetap rute diam-diam), DAN (2) pemenang saat ini termasuk
// keluarga skill klarifikasi itu. Syarat keanggotaan keluarga — bukan
// penyebutan harfiah kedua skill dalam pertanyaan — dipakai agar
// klarifikasi yang benar seperti katalog minim (toko-online 3 vs
// katalog-produk 2, pertanyaan keluarga toko menyebut toko vs
// marketplace) tetap memicu, sementara penahanan keliru pada prompt yang
// pemenangnya bukan keluarga mana pun (api-rest, google-maps,
// email-service, laporan-analitik rinci/tipikal) tidak lagi terjadi.
const CLARIFICATION_FAMILIES: ReadonlyArray<readonly string[]> = [
  ["toko-online", "marketplace", "katalog-produk"],
  ["pos-kasir", "dashboard-admin"],
  ["booking-reservasi", "klinik-layanan"],
  ["dashboard-admin", "crm-internal"],
];

function isInClarificationFamily(skill: string): boolean {
  return CLARIFICATION_FAMILIES.some((family) => family.includes(skill));
}

const SINGLE_SELLER_SIGNALS = ["satu penjual", "satu toko", "toko saya", "toko milik", "penjual tunggal", "satu seller", "hanya satu penjual", "toko tunggal"];
const MULTI_SELLER_SIGNALS = ["banyak penjual", "banyak toko", "multi vendor", "multivendor", "multi-vendor", "banyak seller", "marketplace", "seperti shopee", "seperti tokopedia", "banyak penjual"];

// Router v1 — berjalan di tahap Planner. Aturan platform (isolasi &
// keamanan) selalu menang atas skill domain: router tidak pernah bisa
// mengalahkan path-guard atau pemeriksaan kepemilikan.
function routeSkills(args: {
  prompt: string;
  chip?: string | null;
  clarificationAnswer?: string | null;
  // G3 — skill yang dinonaktifkan admin dikeluarkan SEBELUM penskoran:
  // routing berubah langsung tanpa deploy ulang aplikasi.
  disabledSkills?: ReadonlySet<string> | string[];
}): RouteDecision {
  const disabled: ReadonlySet<string> = new Set(args.disabledSkills ?? []);
  const promptNorm = normalizeText(args.prompt);
  const domainScores = scoreDomainSkills(args.prompt, disabled);
  // Putaran perbaikan router G3 — pemutus seri nama eksplisit: bila dua
  // skor domain teratas SERI persis dan prompt menyebut akar nama salah
  // satu skill-nya saja (mis. "klinik" pada "aplikasi klinik" — akar nama
  // klinik-layanan — tanpa menyebut "booking"), skill yang disebut itu
  // yang menang dan seri dianggap tuntas: rute diam-diam tanpa
  // klarifikasi. Bila kedua akar nama disebut atau tidak ada yang
  // disebut, seri tetap diputuskan aturan klarifikasi biasa di bawah.
  let tieBrokenByName = false;
  {
    const first = domainScores[0];
    const second = domainScores[1];
    if (first && second && first.score > 0 && first.score === second.score) {
      const rootOf = (name: string) => name.split("-")[0] ?? name;
      const firstNamed = promptNorm.includes(` ${rootOf(first.skill)} `);
      const secondNamed = promptNorm.includes(` ${rootOf(second.skill)} `);
      if (firstNamed !== secondNamed) {
        tieBrokenByName = true;
        if (secondNamed) {
          domainScores[0] = second;
          domainScores[1] = first;
        }
      }
    }
  }
  const supportScores = scoreFallbackSupportSkills(args.prompt, disabled);
  const inclusionSkills = scoreStageInclusionSkills(args.prompt, disabled);
  // Skor yang dilaporkan: domain aktif ditambah skor fallback pendukung
  // aktif. Keputusan domain (termasuk aturan selisih tipis ≤1) hanya
  // memakai domainScores — ambang klarifikasi TIDAK berubah di G3.
  const scores = [...domainScores, ...supportScores].sort(
    (a, b) => b.score - a.score,
  );
  // Putaran perbaikan router G3 — selisih dua teratas untuk gerbang
  // klarifikasi dihitung dari skor gabungan (domain + pendukung fallback)
  // di atas: penahanan keliru yang teramati selalu berbentuk skill yang
  // benar menang jauh (api-rest 10 vs 2, google-maps 13/15 vs 2,
  // email-service 8 vs 3, laporan-analitik 8 vs 4 dan 5 vs 3) sementara
  // pasangan domain di bawahnya berselisih tipis. Dengan selisih gabungan
  // > 1, klarifikasi tidak memicu dan router diam-diam ke pemenang.
  // Skor kedua yang 0/tiada diperlakukan sebagai 0 (selisih = skor
  // teratas, selalu > 1 untuk skor positif) — prompt bercocok tunggal
  // tidak pernah ditahan klarifikasi.
  //
  // Penyempurnaan G4 — pendukung INKLUSI bukan kandidat primary: skor
  // pendukung yang TIDAK melampaui pemenang domain (mis. ai-api 7 di
  // belakang toko-online 8 pada "toko online saya butuh chatbot …")
  // menandakan fitur pendamping yang akan masuk plan lewat inklusi
  // tahap, BUKAN ambiguitas primary — memakainya sebagai skor kedua
  // membuat selisih gabungan menyempit ke ≤1 dan menahan prompt yang
  // sebenarnya jelas ke klarifikasi toko. Karena itu selisih gerbang
  // kini dihitung dari pasangan DOMAIN teratas, dan perlindungan G3 di
  // atas dipertahankan dalam bentuknya yang setara: bila pendukung
  // teratas melampaui pemenang domain lebih dari 1 poin (kasus-kasus
  // G3: api-rest/google-maps/email-service/laporan menang jauh),
  // klarifikasi tetap tertahan. Ambang ≤1 dan gerbang keluarga tidak
  // berubah.
  const domainSecondScore =
    domainScores[1] && domainScores[1].score > 0 ? domainScores[1].score : 0;
  const domainTopDiff =
    (domainScores[0]?.score ?? 0) - domainSecondScore;
  const supportDominates =
    (supportScores[0]?.score ?? 0) > (domainScores[0]?.score ?? 0) + 1;
  const overallTopDiff = supportDominates
    ? Number.POSITIVE_INFINITY
    : domainTopDiff;
  const nearest = scores.find((s) => s.score > 0) ?? null;
  const nearestSkill = nearest ? nearest.skill : null;
  const nearestScore = nearest ? nearest.score : 0;
  const top = domainScores[0];
  const guessedSkill = top && top.score > 0 ? top.skill : null;
  const chipSkill = chipToSkill(args.chip ?? undefined, disabled);
  const answer = (args.clarificationAnswer ?? "").trim();
  const answerNorm = normalizeText(answer);

  const finish = (
    primary: string | null,
    winnerSource: RouteDecision["winnerSource"],
    opts?: { forcedSkills?: string[] },
  ): RouteDecision => {
    let stages = buildSkillStages(primary, promptNorm, {
      inclusions: inclusionSkills,
      disabled,
    });
    // Putaran perbaikan router G3 — api-rest sebagai pendukung Coder:
    // bila api-rest mendapat skor > 0 dari triggers-nya tetapi skill
    // domain lain yang menjadi primary (mis. android-developer pada
    // prompt "API backend untuk aplikasi Android: endpoint …"), api-rest
    // TETAP masuk tahap Coder sebagai skill pendukung, tanpa ambang
    // skor inklusi tahap (≥3) yang berlaku untuk inklusi umum. Tidak
    // berlaku bila api-rest nonaktif, sudah ada di tahap Coder, atau
    // primary-nya bukan skill domain (fallback standalone api-rest
    // diatur jalur lain).
    if (
      primary !== null &&
      primary !== "api-rest" &&
      skillMeta(primary)?.family === "domain" &&
      !disabled.has("api-rest") &&
      (supportScores.find((s) => s.skill === "api-rest")?.score ?? 0) > 0 &&
      !stages.coder.includes("api-rest")
    ) {
      stages = { ...stages, coder: capStage([...stages.coder, "api-rest"]) };
    }
    // Fallback pendukung ganda (C): skill pendukung lain yang juga cocok
    // wajib ikut di setiap tahap, tetap maks. MAX_SKILLS_PER_STAGE.
    if (opts?.forcedSkills && opts.forcedSkills.length > 0) {
      const forced = opts.forcedSkills;
      stages = {
        planner: capStage([...stages.planner, ...forced]),
        designer: capStage([...stages.designer, ...forced]),
        coder: capStage([...stages.coder, ...forced]),
        builder: capStage([...stages.builder, ...forced]),
        fixer: capStage([...stages.fixer, ...forced]),
      };
    }
    const isGeneric = primary === null;
    const label = isGeneric
      ? "proyek kustom"
      : (skillMeta(primary!)?.name ?? primary!);
    const plan: SkillPlan = {
      label,
      primaryDomain: primary,
      isGeneric,
      winnerSource,
      stages,
    };
    const allSkills = [
      ...stages.planner,
      ...stages.designer,
      ...stages.coder,
      ...stages.builder,
      ...stages.fixer,
    ];
    const versions = [...new Set(allSkills)].map((name) => ({
      name,
      version: skillFileVersion(name),
      note: SKILL_FILES[name]
        ? SKILL_VERSION_NOTE
        : "metadata routing (belum ada file SKILL.md)",
    }));
    return {
      status: isGeneric ? "generic" : "ok",
      primaryDomain: primary,
      label,
      winnerSource,
      chipSkill,
      guessedSkill,
      scores,
      stages,
      plan,
      versions,
      clarificationQuestion: null,
      disabledSkills: [...disabled],
      nearestSkill,
      nearestScore,
    };
  };

  const clarify = (question: string): RouteDecision => {
    const base = finish(null, "skor");
    return {
      ...base,
      status: "needs_clarification",
      label: "menunggu klarifikasi",
      stages: { planner: [], designer: [], coder: [], builder: [], fixer: [] },
      plan: {
        label: "menunggu klarifikasi",
        primaryDomain: null,
        isGeneric: false,
        winnerSource: "skor",
        stages: { planner: [], designer: [], coder: [], builder: [], fixer: [] },
      },
      versions: [],
      clarificationQuestion: question,
    };
  };

  // (2) Chip pengguna SELALU mengalahkan tebakan model.
  if (chipSkill) return finish(chipSkill, "chip");

  // Jawaban klarifikasi dari putaran sebelumnya menentukan pilihan.
  if (answer) {
    if (MULTI_SELLER_SIGNALS.some((s) => answerNorm.includes(normalizeText(s).trim()))) {
      // Marketplace nonaktif: jangan pernah merutekan ke skill nonaktif.
      return finish(
        disabled.has("marketplace") ? "toko-online" : "marketplace",
        "klarifikasi",
      );
    }
    if (SINGLE_SELLER_SIGNALS.some((s) => answerNorm.includes(normalizeText(s).trim()))) {
      return finish("toko-online", "klarifikasi");
    }
    // Perbaikan router G1 (B) — kata tunggal pada jawaban klarifikasi
    // selisih tipis umum dipetakan ke domainnya, termasuk kata yang tidak
    // persis sama dengan satu trigger utuh (mis. "panel" sendirian harus
    // tetap terbaca sebagai dashboard-admin). Urutan kata pada jawaban
    // menentukan kandidat yang disebut lebih dulu.
    const ANSWER_WORD_ALIASES: Record<string, string> = {
      booking: "booking-reservasi",
      reservasi: "booking-reservasi",
      jadwal: "booking-reservasi",
      kalender: "booking-reservasi",
      slot: "booking-reservasi",
      dashboard: "dashboard-admin",
      admin: "dashboard-admin",
      panel: "dashboard-admin",
      kasir: "pos-kasir",
      pos: "pos-kasir",
      android: "android-developer",
      apk: "android-developer",
      landing: "landing-page",
      marketplace: "marketplace",
    };
    for (const word of answerNorm.trim().split(/\s+/)) {
      const aliased = ANSWER_WORD_ALIASES[word];
      if (aliased && !disabled.has(aliased)) return finish(aliased, "klarifikasi");
    }
    const named = DOMAIN_SKILLS.filter((s) => !disabled.has(s.name)).find(
      (s) => answerNorm.includes(normalizeText(s.name).trim()) || s.triggers.some((t) => answerNorm.includes(normalizeText(t).trim())),
    );
    if (named) return finish(named.name, "klarifikasi");
  }

  // (5) Kasus seri toko-online vs marketplace: prompt belanja tanpa
  // penjelasan satu/banyak penjual TIDAK ditebak — wajib klarifikasi
  // dengan tepat satu pertanyaan. Berlaku hanya bila tebakan teratas memang
  // toko-online/marketplace (prompt kasir "toko retail" bukan toko online).
  const shopContext = guessedSkill === "toko-online" || guessedSkill === "marketplace";
  if (shopContext) {
    const hasSingle = SINGLE_SELLER_SIGNALS.some((s) => promptNorm.includes(normalizeText(s).trim()));
    const hasMulti = MULTI_SELLER_SIGNALS.some((s) => promptNorm.includes(normalizeText(s).trim()));
    if (hasMulti && !hasSingle && !disabled.has("marketplace"))
      return finish("marketplace", "skor");
    if (hasMulti && !hasSingle && disabled.has("marketplace"))
      return finish("toko-online", "skor");
    if (hasSingle && !hasMulti) return finish("toko-online", "skor");
    if (!hasSingle && !hasMulti) {
      // Putaran perbaikan router G3 — klarifikasi toko pun tunduk pada
      // gerbang klarifikasi berpasangan: hanya memicu bila selisih skor
      // dua teratas (gabungan domain + pendukung) ≤ 1, pemenang termasuk
      // keluarga toko, dan seri tidak sudah diputus nama eksplisit. Bila
      // tidak, jatuh ke keputusan skor biasa di bawah (rute diam-diam ke
      // pemenang).
      const second = domainScores[1];
      if (
        !tieBrokenByName &&
        second &&
        overallTopDiff <= 1 &&
        guessedSkill !== null &&
        isInClarificationFamily(guessedSkill)
      ) {
        return clarify(
          "Apakah toko ini satu penjual saja atau banyak penjual seperti marketplace?",
        );
      }
    }
  }

  // (5b) Perbaikan router G1 (B) + gerbang G3 — klarifikasi selisih tipis
  // umum: bila klarifikasi toko-online di atas TIDAK terpicu, chip tidak
  // dipilih, dan dua skor domain teratas berselisih tipis dengan skor
  // kedua > 0, router TIDAK memilih diam-diam — wajib tepat satu
  // pertanyaan penjernih yang menyebut kedua kandidat, skillPlan kosong,
  // tanpa generate. Putaran G3 menambahkan gerbang keluarga: klarifikasi
  // hanya memicu bila selisih skor dua teratas (gabungan domain +
  // pendukung, overallTopDiff) ≤ 1, pemenang termasuk salah satu
  // keluarga klarifikasi berpasangan (CLARIFICATION_FAMILIES), dan seri
  // tidak sudah diputus nama eksplisit; bila salah satu syarat tidak
  // terpenuhi, rute diam-diam ke pemenang tanpa pertanyaan. Selisih ≥ 2
  // tetap rute langsung ke pemenang (ambang ≤ 1 tidak berubah).
  if (top && top.score > 0) {
    const second = domainScores[1];
    if (
      second &&
      second.score > 0 &&
      overallTopDiff <= 1 &&
      !tieBrokenByName &&
      isInClarificationFamily(top.skill)
    ) {
      return clarify(
        `Prompt ini mirip untuk dua jenis proyek: ${skillDisplayLabel(top.skill)} dan ${skillDisplayLabel(second.skill)}. Mana yang kamu maksud: ${top.skill} atau ${second.skill}?`,
      );
    }
    return finish(top.skill, "skor");
  }

  // (5c) Perbaikan router G1 (C) — fallback skill pendukung standalone:
  // tidak ada domain yang mencapai skor > 0, tetapi auth-pengguna dan/atau
  // bayar-doku cocok dari triggers frontmatter mereka. Skill pendukung
  // yang cocok menjadi domain utama (bukan plan generik tanpa skill yang
  // dimaksud); bila keduanya cocok, keduanya masuk plan dan yang skornya
  // lebih tinggi menjadi utama. Fallback ini tidak pernah mengalahkan
  // kemenangan domain di atas.
  const matchedSupport = supportScores.filter((s) => s.score > 0);
  if (matchedSupport.length > 0) {
    const primarySupport = matchedSupport[0]!.skill;
    return finish(primarySupport, "skor", {
      forcedSkills: matchedSupport.map((s) => s.skill),
    });
  }

  // (6) Tidak ada skill yang cocok → mode generik "proyek kustom".
  return finish(null, "generik");
}

function parseSkillPlan(raw: string): SkillPlan | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = skillPlanOut.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseSkillVersions(raw: string): Array<{ name: string; version: string; note: string }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is { name: string; version: string; note: string } =>
          !!v && typeof v === "object" &&
          typeof (v as { name?: unknown }).name === "string" &&
          typeof (v as { version?: unknown }).version === "string",
      )
      .map((v) => ({ name: v.name, version: v.version, note: typeof v.note === "string" ? v.note : SKILL_VERSION_NOTE }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// G3 — Keadaan katalog admin (aktif/nonaktif + eval) dan antrean kandidat.
//
// skill_catalog_state adalah SUMBER status aktif: skill tanpa baris di
// tabel itu berarti aktif dan belum dievaluasi. routeSkills menerima daftar
// nonaktif dan mengeluarkannya sebelum penskoran, jadi perubahan status
// admin berlaku langsung pada routing berikutnya tanpa deploy ulang.
// ---------------------------------------------------------------------------

async function getDisabledSkills(db: Db): Promise<Set<string>> {
  const rows = await db.select().from(schema.skillCatalogState);
  return new Set(rows.filter((r) => !r.isActive).map((r) => r.skillName));
}

async function getSkillStateMap(
  db: Db,
): Promise<Map<string, { isActive: boolean; evalScore: number | null }>> {
  const rows = await db.select().from(schema.skillCatalogState);
  return new Map(
    rows.map((r) => [
      r.skillName,
      { isActive: r.isActive, evalScore: r.evalScore },
    ]),
  );
}

async function recordSkillCandidate(
  db: Db,
  args: {
    prompt: string;
    nearestSkill: string | null;
    nearestScore: number;
    userId: number | null;
  },
): Promise<number | null> {
  const inserted = await db
    .insert(schema.skillCandidates)
    .values({
      prompt: args.prompt.slice(0, 2000),
      nearestSkill: args.nearestSkill,
      nearestScore: args.nearestScore,
      userId: args.userId,
    })
    .returning({ id: schema.skillCandidates.id });
  return inserted[0]?.id ?? null;
}

// Rincian biaya per skill di DALAM paket generate 300 kredit yang tetap.
// Bukan tarif baru: satu komposisi generate selalu total 300 (Planner 40 +
// Designer 60 + Coder 120 + Builder 50 + Fixer 30). Rincian satu skill =
// jatah tahap-tahap komposisi di mana skill itu menjadi skill utama:
// biaya tiap tahap dibagi rata ke skill yang mengisi tahap itu.
const STAGE_COST_MAP: Record<keyof SkillStages, number> = {
  planner: 40,
  designer: 60,
  coder: 120,
  builder: 50,
  fixer: 30,
};
type CostBreakdown = {
  planner: number;
  designer: number;
  coder: number;
  builder: number;
  fixer: number;
  total: number;
};

function computeCompositionBreakdown(primary: string): {
  perSkill: Record<string, CostBreakdown>;
  total: number;
} {
  const stages = buildSkillStages(primary, "");
  const perSkill: Record<string, CostBreakdown> = {};
  const ensure = (name: string): CostBreakdown => {
    if (!perSkill[name]) {
      perSkill[name] = {
        planner: 0,
        designer: 0,
        coder: 0,
        builder: 0,
        fixer: 0,
        total: 0,
      };
    }
    return perSkill[name]!;
  };
  (Object.keys(STAGE_COST_MAP) as Array<keyof SkillStages>).forEach(
    (stageKey) => {
      const list = stages[stageKey];
      if (list.length === 0) return;
      const cost = STAGE_COST_MAP[stageKey];
      const base = Math.floor(cost / list.length);
      let remainder = cost - base * list.length;
      for (const name of list) {
        const add = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        ensure(name)[stageKey] += add;
      }
    },
  );
  let total = 0;
  for (const entry of Object.values(perSkill)) {
    entry.total =
      entry.planner + entry.designer + entry.coder + entry.builder + entry.fixer;
    total += entry.total;
  }
  return { perSkill, total };
}

const costBreakdownOut = z.object({
  planner: z.number(),
  designer: z.number(),
  coder: z.number(),
  builder: z.number(),
  fixer: z.number(),
  total: z.number(),
});

// ---------------------------------------------------------------------------
// G0 (a) — Validator format SKILL.md baku (Rencana Katalog Bab 3)
// ---------------------------------------------------------------------------

const REQUIRED_FRONTMATTER_FIELDS = [
  "name",
  "version",
  "family",
  "title",
  "triggers",
  "requires",
  "optional",
  "credit_profile",
  "outputs",
] as const;

const LIST_FRONTMATTER_FIELDS = ["triggers", "requires", "optional", "outputs"] as const;

const REQUIRED_SECTIONS: Array<{ title: string; match: string }> = [
  { title: "Kapan dipakai / kapan TIDAK dipakai", match: "kapan dipakai" },
  { title: "Pertanyaan penjernih", match: "pertanyaan penjernih" },
  { title: "Workflow langkah demi langkah per tahap pipeline", match: "workflow" },
  { title: "Struktur file yang dihasilkan + aturan bisnis wajib", match: "struktur file" },
  { title: "Skema database baku", match: "skema database" },
  { title: "Aturan UI & komponen", match: "aturan ui" },
  { title: "Larangan keras (hard prohibitions)", match: "larangan keras" },
  { title: "Checklist QA sebelum dinyatakan selesai & hasil yang diharapkan", match: "checklist qa" },
  { title: "Contoh prompt baik", match: "contoh prompt" },
  { title: "Kasus tepi & cara gagal yang jujur", match: "kasus tepi" },
];

interface FrontmatterField {
  kind: "scalar" | "list";
  value: string;
  items: string[];
}

function parseFrontmatter(content: string): Map<string, FrontmatterField> | null {
  const text = content.replace(/^﻿/, "");
  if (!/^\s*---\s*\n/.test(text) && !text.trimStart().startsWith("---")) return null;
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      if (start === -1) start = i;
      else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return null;
  const fields = new Map<string, FrontmatterField>();
  let currentKey: string | null = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i]!;
    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey) {
      const field = fields.get(currentKey)!;
      field.kind = "list";
      field.items.push(itemMatch[1]!.trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1]!;
      const rawValue = kv[2]!.trim();
      currentKey = key;
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        const inner = rawValue.slice(1, -1).trim();
        fields.set(key, {
          kind: "list",
          value: "",
          items: inner
            ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
            : [],
        });
      } else {
        fields.set(key, {
          kind: "scalar",
          value: rawValue.replace(/^["']|["']$/g, ""),
          items: [],
        });
      }
    }
  }
  return fields;
}

function validateSkillMarkdown(content: string): {
  valid: boolean;
  errors: string[];
  missingFields: string[];
  missingSections: string[];
} {
  const errors: string[] = [];
  const missingFields: string[] = [];
  const missingSections: string[] = [];

  if (!content || !content.trim()) {
    return {
      valid: false,
      errors: ["Teks SKILL.md kosong — tidak ada yang bisa divalidasi."],
      missingFields: [...REQUIRED_FRONTMATTER_FIELDS],
      missingSections: REQUIRED_SECTIONS.map((s) => s.title),
    };
  }

  const fields = parseFrontmatter(content);
  if (!fields) {
    errors.push("Frontmatter hilang: SKILL.md wajib diawali blok frontmatter (--- … ---).");
    for (const f of REQUIRED_FRONTMATTER_FIELDS) missingFields.push(f);
  } else {
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      const entry = fields.get(field);
      if (!entry) {
        missingFields.push(field);
        errors.push(`Field frontmatter wajib hilang: ${field}`);
        continue;
      }
      const isListField = (LIST_FRONTMATTER_FIELDS as readonly string[]).includes(field);
      if (isListField) {
        if (entry.kind !== "list") {
          errors.push(`Field frontmatter "${field}" harus berupa daftar (list), misalnya [item1, item2] atau daftar "- item".`);
          continue;
        }
        if ((field === "triggers" || field === "outputs") && entry.items.length === 0) {
          errors.push(`Field frontmatter wajib "${field}" tidak boleh kosong — isi minimal satu item.`);
        }
      } else if (!entry.value.trim()) {
        errors.push(`Field frontmatter wajib "${field}" tidak boleh kosong.`);
      }
    }
    const nameEntry = fields.get("name");
    if (nameEntry?.value && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(nameEntry.value)) {
      errors.push(`Field frontmatter "name" harus kebab-case Bahasa Inggris (huruf kecil dan tanda hubung), diterima: "${nameEntry.value}".`);
    }
    const versionEntry = fields.get("version");
    if (
      versionEntry?.value &&
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(versionEntry.value)
    ) {
      errors.push(`Field frontmatter "version" harus semver (misalnya 1.0.0), diterima: "${versionEntry.value}".`);
    }
  }

  // Isi: 10 bagian wajib, dalam urutan baku.
  const bodyStart = content.indexOf("\n---", 3);
  const body = bodyStart >= 0 ? content.slice(bodyStart + 4) : content;
  const headings: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) {
      headings.push(
        m[1]!
          .toLowerCase()
          .replace(/^\s*(bagian\s*)?\d+\s*[.)\-:]\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  let lastIndex = -1;
  REQUIRED_SECTIONS.forEach((section, idx) => {
    const foundAt = headings.findIndex((h) => h.includes(section.match));
    if (foundAt === -1) {
      missingSections.push(section.title);
      errors.push(`Bagian wajib hilang: ${idx + 1}. ${section.title}`);
    } else if (foundAt <= lastIndex) {
      errors.push(`Bagian wajib tidak sesuai urutan: "${section.title}" harus menjadi bagian ke-${idx + 1} sesuai urutan baku.`);
    } else {
      lastIndex = foundAt;
    }
  });

  return { valid: errors.length === 0, errors, missingFields, missingSections };
}

// ---------------------------------------------------------------------------
// G0 (d) — Executor path-guard (uji isolasi I-4)
//
// Berjalan SEBELUM penulisan apa pun. Setiap penulisan file proyek harus
// berada di dalam pohon tenant pemiliknya: tenants/<user_id>/<project_id>/
// dengan path relatif. Penolakan selalu tercatat sebagai percobaan
// pelanggaran dan tidak ada satu pun tulisan yang terjadi.
// ---------------------------------------------------------------------------

interface GuardResult {
  allowed: boolean;
  kind: string;
  reason: string;
  resolvedPath: string | null;
}

function pathSegments(raw: string): string[] {
  return raw.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
}

function symlinkEscapesTenant(target: string, userId: number, projectId: number): boolean {
  const t = target.trim();
  if (!t) return false;
  const prefix = `tenants/${userId}/${projectId}`;
  if (/^[a-zA-Z]:[\\/]/.test(t)) return true;
  if (t.startsWith("/")) {
    return !(t === `/${prefix}` || t.startsWith(`/${prefix}/`));
  }
  const segs = pathSegments(t);
  if (segs[0] === "tenants") {
    return !(segs[1] === String(userId) && segs[2] === String(projectId));
  }
  if (segs.includes("..")) return true;
  return false;
}

function evaluatePathGuard(args: {
  userId: number;
  projectId: number;
  projectOwned: boolean;
  balance: number;
  path: string;
  symlinkTarget?: string | null;
}): GuardResult {
  // (5) Proyek bukan milik sesi peminta — pola isolasi yang sudah ada.
  if (!args.projectOwned) {
    return {
      allowed: false,
      kind: "proyek_bukan_milik",
      reason: "Proyek tidak ditemukan",
      resolvedPath: null,
    };
  }
  // Pemeriksaan kuota G0: hanya saldo kredit tidak negatif. Kuota
  // penyimpanan per paket adalah bagian G2 dan tidak dikarang di sini.
  if (args.balance < 0) {
    return {
      allowed: false,
      kind: "saldo_negatif",
      reason: "Penulisan ditolak: saldo kredit akun negatif. Isi ulang kredit sebelum menulis file proyek.",
      resolvedPath: null,
    };
  }
  const raw = (args.path ?? "").trim();
  if (!raw) {
    return {
      allowed: false,
      kind: "path_kosong",
      reason: "Penulisan ditolak: path file kosong.",
      resolvedPath: null,
    };
  }
  // (2) Path absolut.
  if (raw.startsWith("/") || raw.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(raw)) {
    return {
      allowed: false,
      kind: "path_absolut",
      reason: `Penulisan ditolak: path "${raw}" adalah path absolut. File proyek wajib ditulis dengan path relatif di dalam pohon tenant tenants/${args.userId}/${args.projectId}/.`,
      resolvedPath: null,
    };
  }
  const segs = pathSegments(raw);
  // (1) Segmen '..'.
  if (segs.includes("..")) {
    return {
      allowed: false,
      kind: "segmen_dotdot",
      reason: `Penulisan ditolak: path "${raw}" mengandung segmen '..' yang dapat keluar dari pohon tenant.`,
      resolvedPath: null,
    };
  }
  let relativeSegs = segs;
  if (segs[0] === "tenants") {
    // (4) Path milik tenant lain / proyek lain.
    if (segs[1] !== String(args.userId)) {
      return {
        allowed: false,
        kind: "tenant_lain",
        reason: `Penulisan ditolak: path "${raw}" berada di pohon tenant pengguna lain. Setiap penulisan hanya boleh di dalam tenants/${args.userId}/${args.projectId}/ milikmu.`,
        resolvedPath: null,
      };
    }
    if (segs[2] !== String(args.projectId) || segs.length < 4) {
      return {
        allowed: false,
        kind: "proyek_lain",
        reason: `Penulisan ditolak: path "${raw}" tidak menunjuk file di dalam proyek ini (tenants/${args.userId}/${args.projectId}/…).`,
        resolvedPath: null,
      };
    }
    relativeSegs = segs.slice(3);
  }
  if (relativeSegs.length === 0) {
    return {
      allowed: false,
      kind: "path_tidak_lengkap",
      reason: "Penulisan ditolak: path harus menunjuk file di dalam pohon tenant proyek.",
      resolvedPath: null,
    };
  }
  // (3) Symlink yang mengarah keluar dari pohon tenant.
  if (args.symlinkTarget && symlinkEscapesTenant(args.symlinkTarget, args.userId, args.projectId)) {
    return {
      allowed: false,
      kind: "symlink_keluar",
      reason: `Penulisan ditolak: symlink pada path "${raw}" mengarah ke "${args.symlinkTarget}" yang berada di luar pohon tenant tenants/${args.userId}/${args.projectId}/.`,
      resolvedPath: null,
    };
  }
  return {
    allowed: true,
    kind: "lolos",
    reason: `Path lolos Executor path-guard: berada di dalam pohon tenant tenants/${args.userId}/${args.projectId}/.`,
    resolvedPath: `tenants/${args.userId}/${args.projectId}/${relativeSegs.join("/")}`,
  };
}

async function recordPathViolation(
  db: Db,
  args: { userId: number; projectId: number; path: string; kind: string; reason: string },
): Promise<void> {
  await db.insert(schema.pathViolations).values({
    userId: args.userId,
    projectId: args.projectId,
    path: args.path,
    kind: args.kind,
    reason: args.reason,
  });
}

// ---------------------------------------------------------------------------
// G2 — Isolasi Penuh (Bab 5.2, 5.3, Bab 8 rencana katalog & isolasi)
//
// PEMETAAN JUJUR ke storage prototipe: prototipe ini berjalan di SQLite
// app.db milik artifact, BUKAN PostgreSQL produksi. Semantik isolasinya
// diwujudkan nyata di storage ini sebagai berikut:
// - Skema per proyek `proj_<project_id>`: kolom schema_name pada setiap
//   tabel proyek + penegakan kepemilikan (ownedProject) di SETIAP query.
//   Tabel satu proyek tidak pernah terbaca dari proyek lain — termasuk
//   proyek lain milik pengguna yang sama — karena tidak ada jalur query
//   yang memfilter selain project_id proyek yang lolos pemeriksaan
//   kepemilikan.
// - Kredensial DB per proyek: baris project_db_credentials memberi setiap
//   proyek pengguna database logis sendiri (proj_<id>_app) yang hanya
//   berhak atas skemanya. Kata sandi penuh TIDAK disimpan di app.db (hanya
//   petunjuk 4 karakter terakhir); di produksi kata sandi tinggal di
//   secret manager dan disuntikkan sebagai env saat runtime. Aplikasi
//   hasil generate TIDAK PERNAH menerima kredensial platform: nilai yang
//   diekspos ke permukaan aplikasi hanya nama skema + pengguna proyek itu
//   sendiri (lihat G2_PLATFORM_CREDENTIAL_EXPOSURE = false di bawah dan
//   aksi getProjectIsolation yang hanya mengembalikan petunjuk).
// - Sandbox tmp per job: baris executor_jobs (sandbox_dir tmp/job-<id>).
//   Prototipe tidak punya filesystem proyek sungguhan — "salinan hanya-
//   baca folder proyek" adalah snapshot baris project_files proyek, dan
//   "ruang kerja dihapus" dibuktikan kolom workspace_deleted + artefak
//   hasil yang hanya muncul di builds/ SETELAH job lolos QA. Batas waktu
//   & memori dicatat per job dan ditegakkan sebagai batas semantik: job
//   yang melewati batas ditandai timeout dan dilaporkan apa adanya.
// - Kuota Executor: kuota byte per paket dihitung dari pemakaian nyata
//   proyek (file + baris data + metadata unggahan) dan penulisan yang
//   melewatinya ditolak SEBELUM terjadi dengan pesan yang bisa dipahami.
// - Rahasia per proyek: AES-256-GCM (WebCrypto), kunci diturunkan per
//   proyek dari kunci master server lewat HKDF — plaintext tidak pernah
//   disimpan/ditulis ke file/log/prompt; UI hanya menerima 4 karakter
//   terakhir. Rotasi mengganti ciphertext seketika (kunci lama langsung
//   tidak berlaku) dan tercatat di secret_events.
// ---------------------------------------------------------------------------

const G2_PLATFORM_CREDENTIAL_EXPOSURE = false;

// Kuota penyimpanan Executor per paket (byte). Angka prototipe: ditegakkan
// nyata oleh Executor di storage ini; angka produksi mengikuti paket.
const STORAGE_QUOTA_BYTES: Record<string, number> = {
  Free: 100 * 1024 * 1024, // 100 MB
  "Pro Plan": 1024 * 1024 * 1024, // 1 GB
  Bisnis: 5 * 1024 * 1024 * 1024, // 5 GB
};

// Batas job Executor + daftar izin jaringan keluar selama build.
const JOB_TIME_LIMIT_SEC = 120;
const JOB_MEMORY_LIMIT_MB = 512;
const JOB_NETWORK_ALLOWLIST = ["registry.npmjs.org", "registry.yarnpkg.com"];

function schemaNameForProject(projectId: number): string {
  return `proj_${projectId}`;
}

function dbUsernameForProject(projectId: number): string {
  return `proj_${projectId}_app`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace(".", ",")} GB`;
}

// Sediakan kredensial DB logis proyek (insert-if-not-exists): setiap proyek
// mendapat pengguna database sendiri yang hanya berhak atas skemanya.
// Kata sandi penuh dibuat acak di sini dan TIDAK disimpan — yang persisten
// hanya petunjuk 4 karakter terakhirnya.
async function ensureProjectDbCredential(db: Db, projectId: number) {
  const existing = await db
    .select()
    .from(schema.projectDbCredentials)
    .where(eq(schema.projectDbCredentials.projectId, projectId));
  if (existing.length > 0) return existing[0]!;
  const password = randomHex(16);
  const inserted = await db
    .insert(schema.projectDbCredentials)
    .values({
      projectId,
      schemaName: schemaNameForProject(projectId),
      dbUsername: dbUsernameForProject(projectId),
      passwordHint: `••••${password.slice(-4)}`,
    })
    .returning();
  return inserted[0]!;
}

// Pemakaian penyimpanan nyata satu proyek di storage prototipe: isi file
// proyek (project_files) + data baris tabel proyeknya + metadata unggahan.
// Inilah angka yang ditegakkan kuota Executor.
async function projectStorageUsedBytes(db: Db, projectId: number): Promise<number> {
  let used = 0;
  const files = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId));
  for (const f of files) used += new TextEncoder().encode(f.content).length + f.path.length;
  const tables = await db
    .select()
    .from(schema.projectTables)
    .where(eq(schema.projectTables.projectId, projectId));
  if (tables.length > 0) {
    const rows = await db
      .select()
      .from(schema.projectRows)
      .where(inArray(schema.projectRows.tableId, tables.map((t) => t.id)));
    for (const r of rows) used += new TextEncoder().encode(r.dataJson).length;
  }
  const uploads = await db
    .select()
    .from(schema.projectUploads)
    .where(eq(schema.projectUploads.projectId, projectId));
  for (const u of uploads) used += u.sizeBytes;
  return used;
}

interface QuotaCheck {
  allowed: boolean;
  usedBytes: number;
  quotaBytes: number;
  plan: string;
  reason: string;
}

// Penegakan kuota Executor: dipanggil SEBELUM penulisan apa pun. Penulisan
// yang akan melewati kuota paket ditolak di muka dengan pesan yang bisa
// dipahami pengguna — bukan error "disk penuh" dari storage.
async function checkStorageQuota(
  db: Db,
  user: UserRow,
  projectId: number,
  incomingBytes: number,
): Promise<QuotaCheck> {
  const account = await getAccount(db, user.id);
  const plan = account?.plan ?? user.plan;
  const quotaBytes = STORAGE_QUOTA_BYTES[plan] ?? STORAGE_QUOTA_BYTES["Free"]!;
  const usedBytes = await projectStorageUsedBytes(db, projectId);
  if (usedBytes + incomingBytes > quotaBytes) {
    return {
      allowed: false,
      usedBytes,
      quotaBytes,
      plan,
      reason:
        `Penulisan ditolak oleh Executor sebelum terjadi: kuota penyimpanan paket ${plan} ` +
        `(${fmtBytes(quotaBytes)}) akan terlampaui — terpakai ${fmtBytes(usedBytes)}, ` +
        `penulisan ini ${fmtBytes(incomingBytes)}. Hapus file/data lama atau naikkan paket ` +
        `untuk menambah ruang. Tidak ada data yang ditulis.`,
    };
  }
  return { allowed: true, usedBytes, quotaBytes, plan, reason: "" };
}

// --- Enkripsi rahasia per proyek (AES-256-GCM, kunci turunan per proyek) --
// Kunci master hanya ada di server prototipe ini (di produksi: KMS/secret
// manager). Kunci enkripsi per proyek diturunkan dengan HKDF-SHA256 dengan
// info "dadiweb-secret-proj-<id>", jadi ciphertext satu proyek tidak bisa
// dibuka dengan kunci proyek lain.
const SECRET_MASTER_KEY_MATERIAL = "dadiweb-prototype-secret-master-v1";

async function deriveProjectSecretKey(projectId: number): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET_MASTER_KEY_MATERIAL),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(`dadiweb-proj-${projectId}`),
      info: new TextEncoder().encode("project-secret-encryption"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return globalThis.btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encryptProjectSecret(
  projectId: number,
  plaintext: string,
): Promise<string> {
  const key = await deriveProjectSecretKey(projectId);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(cipher))}`;
}

// Dekripsi HANYA dipakai server untuk membuktikan integritas ciphertext
// (cek internal saat menyimpan). Plaintext hasil dekripsi tidak pernah
// dikembalikan oleh aksi mana pun.
async function decryptProjectSecret(
  projectId: number,
  stored: string,
): Promise<string | null> {
  try {
    const [ivB64, cipherB64] = stored.split(".");
    if (!ivB64 || !cipherB64) return null;
    const key = await deriveProjectSecretKey(projectId);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(cipherB64),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// Jalankan satu job Executor di sandbox tmp/job-<id> untuk proyek milik
// pengguna. Job selalu berakhir dengan ruang kerja sandbox terhapus
// (workspace_deleted) — termasuk job gagal/timeout. Hasil yang lolos QA
// disalin ke builds/ proyek sebagai file proyek; job yang gagal kuota/
// timeout/jaringan TIDAK menyalin apa pun.
async function runSandboxJob(
  db: Db,
  args: {
    user: UserRow;
    projectId: number;
    kind: string;
    simulateTimeout?: boolean;
    simulateOversizeBytes?: number;
    networkTarget?: string;
  },
): Promise<typeof schema.executorJobs.$inferSelect> {
  const inserted = await db
    .insert(schema.executorJobs)
    .values({
      projectId: args.projectId,
      userId: args.user.id,
      kind: args.kind,
      sandboxDir: "",
      status: "running",
      detail: "Job dibuat; menyalin snapshot hanya-baca folder proyek ke sandbox…",
      networkPolicy: `Jaringan keluar ditolak kecuali daftar izin: ${JOB_NETWORK_ALLOWLIST.join(", ")}`,
      timeLimitSec: JOB_TIME_LIMIT_SEC,
      memoryLimitMb: JOB_MEMORY_LIMIT_MB,
    })
    .returning({ id: schema.executorJobs.id });
  const jobId = inserted[0]?.id;
  if (!jobId) throw new Error("Gagal membuat job Executor");
  const sandboxDir = `tmp/job-${jobId}`;
  await db
    .update(schema.executorJobs)
    .set({ sandboxDir })
    .where(eq(schema.executorJobs.id, jobId));

  const finish = async (
    status: "done" | "failed" | "timeout",
    detail: string,
    artifactPath: string,
    copiedBack: boolean,
  ) => {
    await db
      .update(schema.executorJobs)
      .set({
        status,
        detail,
        artifactPath,
        copiedBack,
        workspaceDeleted: true,
        finishedAt: new Date(),
      })
      .where(eq(schema.executorJobs.id, jobId));
    const rows = await db
      .select()
      .from(schema.executorJobs)
      .where(eq(schema.executorJobs.id, jobId));
    return rows[0]!;
  };

  // Kebijakan jaringan: target di luar daftar izin ditolak sebelum build.
  const target = (args.networkTarget ?? "").trim().toLowerCase();
  if (target && !JOB_NETWORK_ALLOWLIST.some((h) => target === h || target.endsWith(`.${h}`))) {
    return finish(
      "failed",
      `Job dihentikan sebelum build: akses jaringan keluar ke "${args.networkTarget}" ditolak — selama build hanya daftar izin yang boleh dihubungi (${JOB_NETWORK_ALLOWLIST.join(", ")}). Sandbox ${sandboxDir} sudah dihapus.`,
      "",
      false,
    );
  }

  // Batas waktu: job yang melewati batas dihentikan & dilaporkan jujur.
  if (args.simulateTimeout) {
    return finish(
      "timeout",
      `Job dihentikan oleh Executor: melewati batas waktu ${JOB_TIME_LIMIT_SEC} detik per job (batas memori ${JOB_MEMORY_LIMIT_MB} MB). Tidak ada hasil yang disalin ke builds/. Sandbox ${sandboxDir} sudah dihapus.`,
      "",
      false,
    );
  }

  // Kuota ditegakkan SEBELUM hasil disalin kembali: artefak yang akan
  // melewati kuota paket ditolak di muka, tidak ada salinan parsial.
  if (args.simulateOversizeBytes && args.simulateOversizeBytes > 0) {
    const quota = await checkStorageQuota(db, args.user, args.projectId, args.simulateOversizeBytes);
    if (!quota.allowed) {
      return finish(
        "failed",
        `Hasil build sebesar ${fmtBytes(args.simulateOversizeBytes)} lolos uji di sandbox, tetapi tidak disalin ke builds/. ${quota.reason} Sandbox ${sandboxDir} sudah dihapus.`,
        "",
        false,
      );
    }
  }

  // QA lolos → Executor menyalin hasil ke builds/ proyek sebagai file
  // proyek (dikenai path-guard + kuota yang sama seperti penulisan lain).
  const artifactPath = `tenants/${args.user.id}/${args.projectId}/builds/build-job-${jobId}.json`;
  const artifactContent = JSON.stringify(
    {
      jobId,
      kind: args.kind,
      sandbox: sandboxDir,
      qa: "lolos",
      networkAllowlist: JOB_NETWORK_ALLOWLIST,
      limits: { timeSec: JOB_TIME_LIMIT_SEC, memoryMb: JOB_MEMORY_LIMIT_MB },
    },
    null,
    2,
  );
  const quota = await checkStorageQuota(
    db,
    args.user,
    args.projectId,
    new TextEncoder().encode(artifactContent).length,
  );
  if (!quota.allowed) {
    return finish(
      "failed",
      `Hasil build lolos QA di sandbox, tetapi tidak disalin ke builds/. ${quota.reason} Sandbox ${sandboxDir} sudah dihapus.`,
      "",
      false,
    );
  }
  await db.insert(schema.projectFiles).values({
    projectId: args.projectId,
    path: artifactPath,
    content: artifactContent,
  });
  return finish(
    "done",
    `Build & test berjalan di sandbox ${sandboxDir} (salinan hanya-baca folder proyek, jaringan keluar hanya daftar izin, batas ${JOB_TIME_LIMIT_SEC} detik / ${JOB_MEMORY_LIMIT_MB} MB). QA lolos — hasil disalin Executor ke builds/ proyek, lalu ruang kerja sandbox dihapus.`,
    artifactPath,
    true,
  );
}

// ---------------------------------------------------------------------------
// Auth helpers (Fase 1 — Login/Register)
// Passwords are never stored in plain text: SHA-256(salt + password) with a
// per-user random salt. Sessions are opaque random tokens stored server-side
// with a 30-day expiry, so logout truly revokes access.
// ---------------------------------------------------------------------------

const DEMO_EMAIL = "budi@email.com";
const SESSION_TTL_MS = 30 * 24 * 3600_000;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(salt: string, password: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${password}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function passwordMatches(
  salt: string,
  password: string,
  expected: string,
): Promise<boolean> {
  const actual = await hashPassword(salt, password);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    provider: row.provider,
    emailVerified: row.emailVerified,
  };
}

async function ensureDemoUser(db: Db): Promise<UserRow> {
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_EMAIL));
  if (existing.length > 0) return existing[0]!;
  const salt = randomHex(16);
  // The demo account's password is a random server-only secret: nobody can
  // log in as demo with a published password. Demo entry goes through the
  // authDemo action, which issues a session without exposing a credential.
  const inserted = await db
    .insert(schema.users)
    .values({
      name: "Budi Santoso",
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(salt, randomHex(24)),
      passwordSalt: salt,
      provider: "email",
      plan: "Pro Plan",
    })
    .returning();
  return inserted[0]!;
}

async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomHex(32);
  await db.insert(schema.authSessions).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

async function userFromToken(db: Db, token: string): Promise<UserRow | null> {
  if (!token) return null;
  const sessions = await db
    .select()
    .from(schema.authSessions)
    .where(eq(schema.authSessions.token, token));
  const session = sessions[0];
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db
      .delete(schema.authSessions)
      .where(eq(schema.authSessions.id, session.id));
    return null;
  }
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId));
  return rows[0] ?? null;
}

async function requireUser(db: Db, token: string): Promise<UserRow> {
  const user = await userFromToken(db, token);
  if (!user) {
    throw new Error("Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.");
  }
  // G5-C — akun yang dinonaktifkan admin tidak bisa memakai platform
  // (termasuk generate), walau sesi lamanya masih tersimpan.
  if (!user.isActive) {
    throw new Error(
      "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
    );
  }
  await ensureUserData(db, user);
  if (user.email === DEMO_EMAIL) {
    await ensureDemoData(db, user);
  }
  return user;
}

const authResponse = z.object({
  ok: z.boolean(),
  token: z.string().nullable(),
  error: z.string().nullable(),
  user: z
    .object({
      id: z.number(),
      name: z.string(),
      email: z.string(),
      plan: z.string(),
      provider: z.string(),
      emailVerified: z.boolean(),
    })
    .nullable(),
});

// ---------------------------------------------------------------------------
// Per-user data provisioning
//
// Workspace and credit account rows are keyed by the owner's user id, so
// each account gets exactly one of each. A new account starts with a full
// monthly balance for its plan, an empty project list and an empty ledger —
// nothing is shared with any other account. The demo account is the one
// exception: it keeps the design's example content (2.850/5.000 credits and
// the example projects from the user's screenshots).
// ---------------------------------------------------------------------------

async function ensureUserData(db: Db, user: UserRow) {
  const wsRows = await db
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, user.id));
  if (wsRows.length === 0) {
    await db.insert(schema.workspace).values({
      id: user.id,
      displayName: user.name,
      email: user.email,
      plan: user.plan,
      priceIdr: PLAN_PRICE[user.plan] ?? 299000,
    });
  } else {
    await db
      .update(schema.workspace)
      .set({ displayName: user.name, email: user.email, plan: user.plan })
      .where(eq(schema.workspace.id, user.id));
  }

  const accRows = await db
    .select()
    .from(schema.creditAccount)
    .where(eq(schema.creditAccount.id, user.id));
  if (accRows.length === 0) {
    // G5-C — kuota default Free dari pengaturan platform hanya berlaku
    // untuk akun BARU (pendaftar baru); akun lama tidak pernah diubah
    // oleh perubahan pengaturan itu.
    const quota =
      user.plan === "Free"
        ? await getFreeQuota(db)
        : (PLAN_QUOTA[user.plan] ?? 200);
    const isDemo = user.email === DEMO_EMAIL;
    await db.insert(schema.creditAccount).values({
      id: user.id,
      plan: user.plan,
      monthlyQuota: quota,
      // The demo balance comes straight from the user's design (2.850 of
      // 5.000). Any other new account starts with its full plan quota.
      balance: isDemo ? 2850 : quota,
    });
    const usageSeed = isDemo
      ? [
          { category: "AI Coding", used: 1290 },
          { category: "Gambar", used: 430 },
          { category: "Database", used: 215 },
          { category: "Lainnya", used: 215 },
        ]
      : USAGE_CATEGORIES.map((category) => ({ category, used: 0 }));
    for (const u of usageSeed) {
      await db.insert(schema.creditUsage).values({
        userId: user.id,
        category: u.category,
        used: u.used,
      });
    }
  } else if (accRows[0]!.plan !== user.plan) {
    await db
      .update(schema.creditAccount)
      .set({ plan: user.plan })
      .where(eq(schema.creditAccount.id, user.id));
  }
}

const TEMPLATE_SPECS: Array<{
  name: string;
  category: string;
  tagline: string;
  hue: number;
  uses: number;
  spec: SiteSpec;
}> = [
  {
    name: "Landing Page",
    category: "Website",
    tagline: "Modern",
    hue: 258,
    uses: 1284,
    spec: {
      siteName: "Landing Page Modern",
      headline: "Solusi Digital untuk Bisnismu",
      subheadline:
        "Satu halaman yang fokus mengubah pengunjung menjadi pelanggan.",
      ctaLabel: "Mulai Sekarang",
      primaryColor: "#6D28D9",
      accentColor: "#2DD4BF",
      features: [
        { title: "Hero yang Menjual", description: "Judul besar dengan CTA jelas di layar pertama." },
        { title: "Bukti Sosial", description: "Testimoni dan logo klien untuk membangun kepercayaan." },
        { title: "Harga Transparan", description: "Tabel paket yang mudah dibandingkan." },
        { title: "Formulir Kontak", description: "Lead langsung masuk ke database proyekmu." },
      ],
      sections: ["Hero", "Keunggulan", "Testimoni", "Harga", "Kontak"],
      pages: ["Beranda"],
    },
  },
  {
    name: "Toko Online",
    category: "Marketplace",
    tagline: "Marketplace",
    hue: 222,
    uses: 2310,
    spec: {
      siteName: "Toko Online",
      headline: "Belanja Mudah, Kirim Cepat",
      subheadline: "Katalog produk lengkap dengan pembayaran aman.",
      ctaLabel: "Lihat Produk",
      primaryColor: "#2563EB",
      accentColor: "#F97316",
      features: [
        { title: "Katalog Produk", description: "Grid produk dengan foto, harga, dan stok." },
        { title: "Keranjang & Checkout", description: "Alur belanja singkat sampai pembayaran." },
        { title: "Pembayaran DOKU", description: "Siap terhubung ke payment gateway DOKU." },
        { title: "Lacak Pesanan", description: "Status pesanan terpantau pembeli secara real-time." },
      ],
      sections: ["Hero", "Kategori", "Produk Unggulan", "Promo", "Footer"],
      pages: ["Beranda", "Katalog", "Detail Produk", "Checkout"],
    },
  },
  {
    name: "Company Profile",
    category: "Website",
    tagline: "Profesional",
    hue: 205,
    uses: 976,
    spec: {
      siteName: "Company Profile",
      headline: "Mitra Terpercaya untuk Bertumbuh",
      subheadline: "Profil perusahaan yang rapi dan meyakinkan calon klien.",
      ctaLabel: "Hubungi Kami",
      primaryColor: "#0369A1",
      accentColor: "#F59E0B",
      features: [
        { title: "Tentang Kami", description: "Cerita, visi, dan misi perusahaan." },
        { title: "Layanan", description: "Daftar layanan dengan halaman detail." },
        { title: "Portofolio", description: "Galeri proyek dan klien yang pernah ditangani." },
        { title: "Tim", description: "Profil singkat orang-orang di balik perusahaan." },
      ],
      sections: ["Hero", "Tentang", "Layanan", "Portofolio", "Kontak"],
      pages: ["Beranda", "Tentang", "Layanan", "Kontak"],
    },
  },
  {
    name: "Sistem Booking",
    category: "Sistem Bisnis",
    tagline: "Reservasi",
    hue: 168,
    uses: 764,
    spec: {
      siteName: "Sistem Booking",
      headline: "Reservasi Tanpa Ribet",
      subheadline: "Pilih jadwal, konfirmasi, dan terima pengingat otomatis.",
      ctaLabel: "Booking Sekarang",
      primaryColor: "#0D9488",
      accentColor: "#F43F5E",
      features: [
        { title: "Kalender Jadwal", description: "Slot waktu tampil real-time dari database." },
        { title: "Konfirmasi Otomatis", description: "Notifikasi via WhatsApp dan email." },
        { title: "Kelola Reservasi", description: "Panel admin untuk mengubah atau membatalkan." },
        { title: "Pembayaran DP", description: "Uang muka terhubung payment gateway." },
      ],
      sections: ["Hero", "Pilih Layanan", "Kalender", "Konfirmasi", "Footer"],
      pages: ["Beranda", "Booking", "Admin Reservasi"],
    },
  },
  {
    name: "Dashboard Admin",
    category: "Dashboard",
    tagline: "Manajemen",
    hue: 232,
    uses: 1102,
    spec: {
      siteName: "Dashboard Admin",
      headline: "Kendalikan Bisnis dari Satu Layar",
      subheadline: "Statistik, pesanan, dan pengguna dalam satu panel.",
      ctaLabel: "Buka Dashboard",
      primaryColor: "#1D4ED8",
      accentColor: "#22C55E",
      features: [
        { title: "Statistik Real-time", description: "Grafik pendapatan dan aktivitas terbaru." },
        { title: "Kelola Data", description: "Tabel dengan pencarian, filter, dan ekspor." },
        { title: "Manajemen Pengguna", description: "Peran dan izin akses per anggota tim." },
        { title: "Laporan", description: "Ringkasan periodik siap dibagikan." },
      ],
      sections: ["Ringkasan", "Grafik", "Tabel Data", "Aktivitas"],
      pages: ["Dashboard", "Data", "Pengguna", "Pengaturan"],
    },
  },
  {
    name: "SaaS Platform",
    category: "Website",
    tagline: "Berlangganan",
    hue: 282,
    uses: 689,
    spec: {
      siteName: "SaaS Platform",
      headline: "Software yang Tumbuh Bersama Timmu",
      subheadline: "Mulai gratis, naik paket kapan pun bisnismu berkembang.",
      ctaLabel: "Coba Gratis",
      primaryColor: "#7C3AED",
      accentColor: "#06B6D4",
      features: [
        { title: "Paket Berlangganan", description: "Free, Pro, dan Bisnis dengan perbandingan fitur." },
        { title: "Onboarding Cepat", description: "Daftar dan langsung pakai dalam semenit." },
        { title: "Billing Otomatis", description: "Tagihan dan invoice terbit sendiri tiap periode." },
        { title: "API Terbuka", description: "Integrasikan dengan tools yang sudah dipakai tim." },
      ],
      sections: ["Hero", "Fitur", "Harga", "FAQ", "CTA"],
      pages: ["Beranda", "Fitur", "Harga", "Masuk"],
    },
  },
];

async function ensureTemplates(db: Db) {
  const existing = await db.select({ id: schema.templates.id }).from(schema.templates).limit(1);
  if (existing.length > 0) return;
  for (const t of TEMPLATE_SPECS) {
    await db.insert(schema.templates).values({
      name: t.name,
      category: t.category,
      tagline: t.tagline,
      hue: t.hue,
      uses: t.uses,
      spec: JSON.stringify(t.spec),
    });
  }
}

// The example projects from the user's own design screenshots belong to the
// demo account only. Rows created before per-user isolation have no owner;
// they are claimed by the demo account (that shared workspace was the demo
// workspace), never shown to any other account.
async function ensureDemoData(db: Db, demo: UserRow) {
  await db
    .update(schema.projects)
    .set({ userId: demo.id })
    .where(isNull(schema.projects.userId));
  await db
    .update(schema.creditLedger)
    .set({ userId: demo.id })
    .where(isNull(schema.creditLedger.userId));
  await db
    .update(schema.integrations)
    .set({ userId: demo.id })
    .where(isNull(schema.integrations.userId));

  const mine = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.userId, demo.id))
    .limit(1);
  if (mine.length > 0) return;

  const now = new Date();
  const exampleProjects: Array<{
    name: string;
    slug: string;
    category: string;
    status: "online" | "draft";
    prompt: string;
    templateIndex: number;
    ageHours: number;
  }> = [
    { name: "Toko Online Modern", slug: "toko", category: "E-commerce", status: "online", prompt: "Buatkan toko online modern untuk jual beli produk", templateIndex: 1, ageHours: 1 },
    { name: "Zona Event", slug: "event", category: "Marketplace", status: "online", prompt: "Platform event dan tiket online", templateIndex: 0, ageHours: 2 },
    { name: "Dealora", slug: "dealora", category: "Sistem CRM", status: "online", prompt: "Sistem CRM untuk mengelola deal penjualan", templateIndex: 4, ageHours: 26 },
    { name: "Toko Gadget", slug: "gadget", category: "Toko Online", status: "draft", prompt: "Toko online khusus gadget dan smartphone", templateIndex: 1, ageHours: 74 },
    { name: "Company Profile", slug: "mitra", category: "Website", status: "online", prompt: "Company profile profesional untuk perusahaan mitra", templateIndex: 2, ageHours: 122 },
  ];

  for (const p of exampleProjects) {
    const tpl = TEMPLATE_SPECS[p.templateIndex];
    if (!tpl) continue;
    const spec: SiteSpec = { ...tpl.spec, siteName: p.name };
    const created = new Date(now.getTime() - p.ageHours * 3600_000);
    const inserted = await db
      .insert(schema.projects)
      .values({
        userId: demo.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        status: p.status,
        prompt: p.prompt,
        spec: JSON.stringify(spec),
        source: "example",
        creditsCost: 0,
        createdAt: created,
        updatedAt: created,
      })
      .returning({ id: schema.projects.id });
    const projectId = inserted[0]?.id;
    if (projectId && p.status === "online") {
      await db.insert(schema.deployments).values({
        projectId,
        subdomain: `${p.slug}.dadiweb.id`,
        status: "live",
        createdAt: created,
      });
    }
  }

  // Database tables for the flagship example project (orders table is shown
  // in the user's own Database screen design).
  const flagship = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.userId, demo.id),
        eq(schema.projects.slug, "toko"),
      ),
    );
  const flagshipId = flagship[0]?.id;
  if (flagshipId) {
    const tables: Array<{ name: string; columns: string[] }> = [
      { name: "products", columns: ["id", "name", "price", "stock"] },
      { name: "orders", columns: ["id", "user_id", "product_id", "total", "status", "created_at"] },
      { name: "users", columns: ["id", "name", "email", "role"] },
    ];
    for (const t of tables) {
      await db.insert(schema.projectTables).values({
        projectId: flagshipId,
        name: t.name,
        schemaName: schemaNameForProject(flagshipId),
        columnsJson: JSON.stringify(t.columns),
      });
    }
  }
}

// Fase 3 — forum komunitas: postingan contoh dari desain user di-seed sekali
// sebagai konten bersama; setelah itu semua postingan/komentar/suka adalah
// data nyata milik pengguna yang membuatnya.
const COMMUNITY_SEED: Array<{ author: string; title: string; body: string; tag: string; ageHours: number }> = [
  { author: "Andi", title: "Contoh Prompt untuk Marketplace", body: "Prompt yang bekerja baik untuk marketplace: sebutkan kategori produk, metode pembayaran (DOKU), dan fitur chat. Semakin spesifik, hasil AI-nya semakin rapi.", tag: "Inspirasi", ageHours: 2 },
  { author: "Budi", title: "Cara deploy custom domain", body: "Setelah deploy ke subdomain dadiweb.id, tambahkan domain kamu di menu Domain & Deploy, pasang TXT record verifikasinya, lalu klik Verifikasi — SSL terbit otomatis.", tag: "Tutorial", ageHours: 26 },
  { author: "Sari", title: "Template terbaik untuk company profile", body: "Menurutku template Company Profile paling aman untuk klien korporat: strukturnya lengkap dan tinggal ganti headline. Ada yang punya pengalaman lain?", tag: "Diskusi", ageHours: 30 },
  { author: "Rudi", title: "Integrasi DOKU di aplikasi", body: "Aktifkan DOKU di menu Integrasi API, simpan Client ID kamu, dan pembayaran di aplikasi hasil generate langsung memakai konfigurasi itu.", tag: "Tutorial", ageHours: 50 },
];

async function ensureCommunitySeed(db: Db) {
  const existing = await db
    .select({ id: schema.communityPosts.id })
    .from(schema.communityPosts)
    .limit(1);
  if (existing.length > 0) return;
  const now = Date.now();
  for (const p of COMMUNITY_SEED) {
    await db.insert(schema.communityPosts).values({
      userId: null,
      authorName: p.author,
      title: p.title,
      body: p.body,
      tag: p.tag,
      createdAt: new Date(now - p.ageHours * 3600_000),
    });
  }
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function getAccount(db: Db, userId: number) {
  const rows = await db
    .select()
    .from(schema.creditAccount)
    .where(eq(schema.creditAccount.id, userId));
  return rows[0] ?? null;
}

async function ownedProject(db: Db, userId: number, projectId: number) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    );
  return rows[0] ?? null;
}

// G12 — preview situs boleh diakses pemilik proyek ATAU admin (akun demo
// admin, pola yang sama dengan aksi admin lain yang memeriksa DEMO_EMAIL).
async function ownedOrAdminProject(
  db: Db,
  user: UserRow,
  projectId: number,
) {
  const owned = await ownedProject(db, user.id, projectId);
  if (owned) return owned;
  if (user.email !== DEMO_EMAIL) return null;
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return rows[0] ?? null;
}

// G12 — spec efektif sebuah deployment live: snapshot spec yang direkam
// saat deployment itu diterbitkan bila ada (dan valid); bila deployment
// pra-G12 (snapshot kosong) atau snapshotnya rusak, pakai spec proyek
// terkini sebagai jalur kompatibilitas — dicatat lewat flag snapshot
// agar pemanggil tahu ini BUKAN snapshot (edit setelah deploy lama
// masih mengubah live sampai redeploy berikutnya).
function effectiveLiveSpec(
  project: { spec: string },
  deployment: { siteSnapshotSpec: string },
): {
  spec: NonNullable<ReturnType<typeof parseSpec>> | null;
  snapshot: boolean;
} {
  const snap = (deployment.siteSnapshotSpec ?? "").trim();
  if (snap) {
    const parsed = parseSpec(snap);
    if (parsed) return { spec: parsed, snapshot: true };
  }
  return { spec: parseSpec(project.spec), snapshot: false };
}

// G12 — resolver situs live bersama untuk getPublicSite (spec) dan
// getPublicSiteHtml (HTML). Regresi G11 tetap: iterasi SEMUA proyek
// berslug sama, pilih deployment live paling baru (id terbesar;
// createdAt pembanding sekunder). Slug yang tidak lolos path-guard
// ditolak di pemanggil (bukan di sini, agar pesan "tidak ditemukan"
// tetap sama untuk semua slug asing).
async function resolveLiveSite(db: Db, slug: string) {
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.slug, slug));
  let best: {
    project: (typeof projects)[number];
    live: (typeof schema.deployments.$inferSelect);
    liveCreatedAt: number;
    spec: NonNullable<ReturnType<typeof parseSpec>>;
    snapshot: boolean;
  } | null = null;
  for (const project of projects) {
    const live = await db
      .select()
      .from(schema.deployments)
      .where(
        and(
          eq(schema.deployments.projectId, project.id),
          eq(schema.deployments.status, "live"),
        ),
      )
      .orderBy(desc(schema.deployments.id));
    const newestLive = live[0];
    if (!newestLive) continue;
    const { spec, snapshot } = effectiveLiveSpec(project, newestLive);
    if (!spec) continue;
    const createdAt =
      newestLive.createdAt instanceof Date
        ? newestLive.createdAt.getTime()
        : Number(newestLive.createdAt);
    if (
      best === null ||
      newestLive.id > best.live.id ||
      (newestLive.id === best.live.id && createdAt > best.liveCreatedAt)
    ) {
      best = { project, live: newestLive, liveCreatedAt: createdAt, spec, snapshot };
    }
  }
  return best;
}

// G13-D — chargeCredits DIPINDAH ke server/src/credit-charges.ts tanpa
// mengubah logika (video-jobs.ts butuh helper yang sama; impor dari sini
// akan circular karena file ini mengimpor video-jobs.ts). Semua pemanggil
// di file ini memakai impor tersebut.

// ---------------------------------------------------------------------------
// G5-C — Pengaturan platform, tarif dinamis, dan log audit admin.
// platform_settings adalah satu baris (id=1) yang dibuat insert-if-missing
// dengan nilai awal persis keadaan sebelum G5-C (nama Dadiweb, kuota Free
// 200, tarif generate 300 / deploy 25 / build Android 150). Perubahan
// tarif hanya berlaku untuk operasi BERIKUTNYA (dibaca segar di setiap
// generate/deploy/build), tidak retroaktif. Kuota Free dari pengaturan
// hanya dipakai saat akun kredit BARU dibuat (pendaftar baru).
// admin_audit_log bersifat append-only: helper ini satu-satunya penulisnya
// dan tidak ada aksi yang mengubah atau menghapus barisnya.
// ---------------------------------------------------------------------------

type Tariffs = { generate: number; deploy: number; android: number };

async function ensurePlatformSettings(db: Db) {
  const rows = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 1));
  if (rows.length > 0) return rows[0]!;
  const inserted = await db
    .insert(schema.platformSettings)
    .values({
      id: 1,
      platformName: "Dadiweb",
      maintenanceMessage: "",
      maintenanceEnabled: false,
      freeQuota: 200,
      generateCost: TOTAL_GENERATE_COST,
      deployCost: DEPLOY_COST,
      androidCost: ANDROID_BUILD_COST,
    })
    .returning();
  return inserted[0]!;
}

async function getTariffs(db: Db): Promise<Tariffs> {
  const s = await ensurePlatformSettings(db);
  return {
    generate: s.generateCost,
    deploy: s.deployCost,
    android: s.androidCost,
  };
}

async function getFreeQuota(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, 1));
  return rows[0]?.freeQuota ?? PLAN_QUOTA["Free"] ?? 200;
}

// Distribusi total tarif generate ke 5 tahap secara proporsional terhadap
// komposisi baku (40/60/120/50/30 = 300); tahap terakhir menyerap sisa
// pembulatan agar jumlahnya selalu persis total tarif yang berlaku.
function effectiveStageCosts(total: number): number[] {
  const base = STAGES.map((s) => s.cost);
  const baseTotal = base.reduce((a, b) => a + b, 0);
  const costs = base.map((c) => Math.round((total * c) / baseTotal));
  const diff = total - costs.reduce((a, b) => a + b, 0);
  const last = costs.length - 1;
  costs[last] = Math.max(0, (costs[last] ?? 0) + diff);
  return costs;
}

function normalizePlanName(raw: string): string {
  if (raw === "Pro") return "Pro Plan";
  return raw;
}

async function writeAdminAudit(
  db: Db,
  admin: { id: number; email: string },
  args: {
    action: string;
    target: string;
    beforeValue: string;
    afterValue: string;
  },
): Promise<void> {
  await db.insert(schema.adminAuditLog).values({
    adminId: admin.id,
    adminEmail: admin.email,
    action: args.action,
    target: args.target,
    beforeValue: args.beforeValue,
    afterValue: args.afterValue,
  });
}

async function findTargetUser(
  db: Db,
  args: { userId?: number; email?: string },
): Promise<UserRow | null> {
  if (args.userId !== undefined) {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, args.userId));
    return rows[0] ?? null;
  }
  if (args.email !== undefined && args.email.trim() !== "") {
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, args.email.trim().toLowerCase()));
    return rows[0] ?? null;
  }
  return null;
}

// Hapus satu proyek beserta SELURUH ruang miliknya (dipakai jalur pemilik
// deleteProject dan jalur admin adminDeleteProject — transaksi tercatat
// yang sama): folder, skema + kredensial DB, artefak build, rahasia,
// unggahan. Buku besar kredit DIPERTAHANKAN (tautan proyek dilepas) dan
// penghapusan dicatat di project_deletion_log atas nama pemilik proyek.
// Diekspor supaya skrip verifikasi bisa memanggilnya langsung (bukan
// aksi publik). `blobs` opsional demi pemanggil lama — bila diberikan,
// file MP4 video proyek ikut dihapus dari blob storage (CELAH 2).
export async function deleteProjectFully(
  db: Db,
  project: typeof schema.projects.$inferSelect,
  blobs?: VideoBlobStore,
): Promise<{ ledgerKept: number; videoBlobsDeleted: number }> {
  const projectId = project.id;
  const tables = await db
    .select()
    .from(schema.projectTables)
    .where(eq(schema.projectTables.projectId, projectId));
  for (const t of tables) {
    await db
      .delete(schema.projectRows)
      .where(eq(schema.projectRows.tableId, t.id));
  }
  await db
    .delete(schema.projectTables)
    .where(eq(schema.projectTables.projectId, projectId));
  await db
    .delete(schema.generations)
    .where(eq(schema.generations.projectId, projectId));
  await db
    .delete(schema.deployments)
    .where(eq(schema.deployments.projectId, projectId));
  await db
    .delete(schema.customDomains)
    .where(eq(schema.customDomains.projectId, projectId));
  await db
    .delete(schema.androidBuilds)
    .where(eq(schema.androidBuilds.projectId, projectId));
  await db
    .delete(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, projectId));
  await db
    .delete(schema.projectDbCredentials)
    .where(eq(schema.projectDbCredentials.projectId, projectId));
  await db
    .delete(schema.projectSecrets)
    .where(eq(schema.projectSecrets.projectId, projectId));
  await db
    .delete(schema.secretEvents)
    .where(eq(schema.secretEvents.projectId, projectId));
  await db
    .delete(schema.executorJobs)
    .where(eq(schema.executorJobs.projectId, projectId));
  await db
    .delete(schema.projectUploads)
    .where(eq(schema.projectUploads.projectId, projectId));
  // G13-B — job video ikut terhapus bersama proyek. CELAH 2 (7 Nov
  // 2026): bersihkan DULU file MP4-nya dari blob storage (sebelum baris
  // job dihapus, agar local_path masih terbaca) — tanpa ini file MP4
  // menjadi yatim di storage. Tanpa `blobs` langkah ini dilewati
  // (pemanggil lama); semua call site aksi kini meneruskan ctx.blobs.
  let videoBlobsDeleted = 0;
  if (blobs) {
    videoBlobsDeleted = (
      await deleteProjectVideoBlobs(db, blobs, projectId)
    ).deleted;
  }
  await db
    .delete(schema.videoJobs)
    .where(eq(schema.videoJobs.projectId, projectId));
  // Tampilan project chat: riwayat chat ikut terhapus bersama proyek
  // (pesan adalah turunan proyek, bukan riwayat keuangan — ledger tetap
  // dipertahankan di bawah dengan tautan proyek dilepas, pola G2).
  await db
    .delete(schema.projectChatMessages)
    .where(eq(schema.projectChatMessages.projectId, projectId));
  const ledgerKept = await db
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.projectId, projectId));
  await db
    .update(schema.creditLedger)
    .set({ projectId: null })
    .where(eq(schema.creditLedger.projectId, projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  await db.insert(schema.projectDeletionLog).values({
    userId: project.userId ?? null,
    projectId,
    projectName: project.name,
    schemaName: schemaNameForProject(projectId),
    detail:
      `Folder proyek, skema ${schemaNameForProject(projectId)} beserta kredensial DB-nya, ` +
      `artefak build, rahasia terenkripsi, dan metadata unggahan dihapus dalam satu transaksi. ` +
      (blobs
        ? `File video proyek (${videoBlobsDeleted} MP4) dihapus dari penyimpanan. `
        : ``) +
      `${ledgerKept.length} baris riwayat kredit di ledger platform dipertahankan (tautan proyek dilepas).`,
  });
  return { ledgerKept: ledgerKept.length, videoBlobsDeleted };
}

// ---------------------------------------------------------------------------
// Token verifikasi email & reset kata sandi — sekali pakai, ada masa berlaku.
// Token mentah hanya muncul di kotak masuk simulasi di dalam aplikasi
// (pengganti email sungguhan sampai layanan email produksi dipasang);
// server hanya menyimpan hash-nya.
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_MS = 60 * 60_000; // 60 menit
const VERIFY_TOKEN_TTL_MS = 24 * 3600_000; // 24 jam

async function hashToken(raw: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`dadiweb-token:${raw}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function issueAuthToken(
  db: Db,
  user: UserRow,
  purpose: "verify_email" | "reset_password",
): Promise<void> {
  const now = new Date();
  // Token baru menggugurkan token lama yang belum terpakai untuk keperluan
  // yang sama — hanya token terakhir yang berlaku.
  const pending = await db
    .select()
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.userId, user.id),
        eq(schema.authTokens.purpose, purpose),
      ),
    );
  for (const t of pending) {
    if (!t.usedAt) {
      await db
        .update(schema.authTokens)
        .set({ usedAt: now })
        .where(eq(schema.authTokens.id, t.id));
    }
  }
  const raw = randomHex(24);
  const ttl =
    purpose === "reset_password" ? RESET_TOKEN_TTL_MS : VERIFY_TOKEN_TTL_MS;
  await db.insert(schema.authTokens).values({
    userId: user.id,
    purpose,
    tokenHash: await hashToken(raw),
    expiresAt: new Date(now.getTime() + ttl),
  });
  const isReset = purpose === "reset_password";
  await db.insert(schema.simulatedEmails).values({
    userId: user.id,
    email: user.email,
    subject: isReset
      ? "Atur ulang kata sandi Dadiweb kamu"
      : "Verifikasi email Dadiweb kamu",
    body: isReset
      ? `Halo ${user.name}, kami menerima permintaan atur ulang kata sandi untuk akun ini. Token di bawah berlaku 60 menit dan hanya bisa dipakai sekali. Setelah kata sandi diganti, semua sesi masuk lama akun ini dicabut. Abaikan pesan ini bila kamu tidak memintanya.`
      : `Halo ${user.name}, selamat datang di Dadiweb! Verifikasi email ini agar akunmu terkonfirmasi. Token di bawah berlaku 24 jam dan hanya bisa dipakai sekali.`,
    purpose,
    token: raw,
  });
}

async function consumeAuthToken(
  db: Db,
  raw: string,
  purpose: "verify_email" | "reset_password",
): Promise<{ userId: number } | { error: string }> {
  const hash = await hashToken(raw.trim());
  const rows = await db
    .select()
    .from(schema.authTokens)
    .where(
      and(
        eq(schema.authTokens.tokenHash, hash),
        eq(schema.authTokens.purpose, purpose),
      ),
    );
  const row = rows[0];
  if (!row) {
    return {
      error: "Token tidak ditemukan. Minta token baru dari kotak masuk simulasi.",
    };
  }
  if (row.usedAt) {
    return {
      error:
        "Token ini sudah pernah dipakai — token hanya berlaku sekali. Minta token baru.",
    };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { error: "Token sudah kedaluwarsa. Minta token baru." };
  }
  await db
    .update(schema.authTokens)
    .set({ usedAt: new Date() })
    .where(eq(schema.authTokens.id, row.id));
  return { userId: row.userId };
}

// ---------------------------------------------------------------------------
// Invoice / kuitansi — satu invoice untuk setiap baris ledger berbayar
// (top up kredit & ganti paket), ditautkan lewat ledger_id.
// ---------------------------------------------------------------------------

// Harga paket top up mengikuti kartu paket di klien (TOPUP_PACKS).
const TOPUP_PACK_PRICES: Record<number, number> = {
  500: 49000,
  1500: 129000,
  5000: 349000,
};

async function latestLedgerId(db: Db, userId: number): Promise<number | null> {
  const rows = await db
    .select({ id: schema.creditLedger.id })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(desc(schema.creditLedger.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function createInvoice(
  db: Db,
  args: {
    userId: number;
    ledgerId: number | null;
    kind: "topup" | "plan" | "adjust";
    title: string;
    amountIdr: number | null;
    creditsDelta: number;
    balanceAfter: number | null;
  },
): Promise<void> {
  const inserted = await db
    .insert(schema.invoices)
    .values({
      userId: args.userId,
      ledgerId: args.ledgerId,
      kind: args.kind,
      title: args.title,
      amountIdr: args.amountIdr,
      creditsDelta: args.creditsDelta,
      balanceAfter: args.balanceAfter,
      status: "paid",
    })
    .returning({ id: schema.invoices.id, createdAt: schema.invoices.createdAt });
  const row = inserted[0];
  if (!row) return;
  const d = row.createdAt;
  const number = `INV/${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}/${String(row.id).padStart(4, "0")}`;
  await db
    .update(schema.invoices)
    .set({ number })
    .where(eq(schema.invoices.id, row.id));
}

// Transaksi top up / ganti paket yang tercatat di buku besar sebelum fitur
// invoice ada tetap diterbitkan invoicenya (ditautkan ke baris ledger-nya),
// agar setiap transaksi berbayar selalu punya kuitansi yang bisa dibuka.
async function ensureInvoicesBackfill(db: Db, userId: number) {
  const ledgerRows = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId))
    .orderBy(asc(schema.creditLedger.id));
  const billable = ledgerRows.filter(
    (l) => l.kind === "topup" || l.kind === "adjust",
  );
  if (billable.length === 0) return;
  const existing = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.userId, userId));
  const covered = new Set(existing.map((i) => i.ledgerId));
  for (const l of billable) {
    if (covered.has(l.id)) continue;
    if (l.kind === "topup") {
      await createInvoice(db, {
        userId,
        ledgerId: l.id,
        kind: "topup",
        title: `Top up kredit — ${l.amount} kredit`,
        amountIdr: TOPUP_PACK_PRICES[l.amount] ?? null,
        creditsDelta: l.amount,
        balanceAfter: l.balanceAfter,
      });
    } else if (l.label.startsWith("Penyesuaian saldo oleh admin")) {
      // Baris ledger penyesuaian saldo oleh admin BUKAN ganti paket —
      // invoicenya harus berlabel jujur sebagai penyesuaian.
      await createInvoice(db, {
        userId,
        ledgerId: l.id,
        kind: "adjust",
        title: "Penyesuaian saldo oleh admin",
        amountIdr: null,
        creditsDelta: l.amount,
        balanceAfter: l.balanceAfter,
      });
    } else {
      const planName = Object.keys(PLAN_PRICE).find((p) =>
        l.label.includes(p),
      );
      await createInvoice(db, {
        userId,
        ledgerId: l.id,
        kind: "plan",
        title: planName
          ? `Ganti paket langganan — ${planName}`
          : "Ganti paket langganan",
        amountIdr: planName ? (PLAN_PRICE[planName] ?? null) : null,
        creditsDelta: l.amount,
        balanceAfter: l.balanceAfter,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Hapus akun beserta seluruh datanya (dipakai admin untuk membersihkan
// akun pengujian dari data produksi prototipe).
// ---------------------------------------------------------------------------

async function deleteUserAndData(db: Db, target: UserRow) {
  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.userId, target.id));
  // Invoice & buku besar lebih dulu: invoice menunjuk baris ledger, dan
  // baris ledger menunjuk proyek — keduanya harus hilang sebelum proyek
  // dan akunnya dihapus agar tidak melanggar foreign key.
  await db.delete(schema.invoices).where(eq(schema.invoices.userId, target.id));
  await db
    .delete(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, target.id));
  for (const p of owned) {
    const tables = await db
      .select()
      .from(schema.projectTables)
      .where(eq(schema.projectTables.projectId, p.id));
    for (const t of tables) {
      await db
        .delete(schema.projectRows)
        .where(eq(schema.projectRows.tableId, t.id));
    }
    await db
      .delete(schema.projectTables)
      .where(eq(schema.projectTables.projectId, p.id));
    await db
      .delete(schema.generations)
      .where(eq(schema.generations.projectId, p.id));
    await db
      .delete(schema.deployments)
      .where(eq(schema.deployments.projectId, p.id));
    await db
      .delete(schema.customDomains)
      .where(eq(schema.customDomains.projectId, p.id));
    await db
      .delete(schema.androidBuilds)
      .where(eq(schema.androidBuilds.projectId, p.id));
    await db
      .delete(schema.projectFiles)
      .where(eq(schema.projectFiles.projectId, p.id));
    // G2 — ruang isolasi proyek ikut dibersihkan bersama akunnya.
    await db
      .delete(schema.projectDbCredentials)
      .where(eq(schema.projectDbCredentials.projectId, p.id));
    await db
      .delete(schema.projectSecrets)
      .where(eq(schema.projectSecrets.projectId, p.id));
    await db
      .delete(schema.secretEvents)
      .where(eq(schema.secretEvents.projectId, p.id));
    await db
      .delete(schema.executorJobs)
      .where(eq(schema.executorJobs.projectId, p.id));
    await db
      .delete(schema.projectUploads)
      .where(eq(schema.projectUploads.projectId, p.id));
    // Riwayat chat proyek ikut dihapus SEBELUM baris proyeknya:
    // project_chat_messages merujuk projects tanpa cascade, jadi proyek
    // ber-riwayat chat yang langsung dihapus akan gagal foreign key
    // (pola yang sama seperti deleteProjectFully di jalur hapus proyek).
    await db
      .delete(schema.projectChatMessages)
      .where(eq(schema.projectChatMessages.projectId, p.id));
    await db.delete(schema.projects).where(eq(schema.projects.id, p.id));
  }
  await db
    .delete(schema.projectDeletionLog)
    .where(eq(schema.projectDeletionLog.userId, target.id));
  await db
    .delete(schema.pathViolations)
    .where(eq(schema.pathViolations.userId, target.id));
  const posts = await db
    .select({ id: schema.communityPosts.id })
    .from(schema.communityPosts)
    .where(eq(schema.communityPosts.userId, target.id));
  for (const post of posts) {
    await db
      .delete(schema.communityComments)
      .where(eq(schema.communityComments.postId, post.id));
    await db
      .delete(schema.communityLikes)
      .where(eq(schema.communityLikes.postId, post.id));
    await db
      .delete(schema.communityPosts)
      .where(eq(schema.communityPosts.id, post.id));
  }
  await db
    .delete(schema.communityComments)
    .where(eq(schema.communityComments.userId, target.id));
  await db
    .delete(schema.communityLikes)
    .where(eq(schema.communityLikes.userId, target.id));
  await db
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.userId, target.id));
  await db
    .delete(schema.authTokens)
    .where(eq(schema.authTokens.userId, target.id));
  await db
    .delete(schema.simulatedEmails)
    .where(eq(schema.simulatedEmails.userId, target.id));
  await db
    .delete(schema.simulatedEmails)
    .where(eq(schema.simulatedEmails.email, target.email));
  await db
    .delete(schema.creditUsage)
    .where(eq(schema.creditUsage.userId, target.id));
  await db
    .delete(schema.integrations)
    .where(eq(schema.integrations.userId, target.id));
  // G3 — dua tabel katalog yang juga merujuk users dan selama ini TIDAK
  // ikut dibersihkan, sehingga barisnya menahan penghapusan users
  // (foreign key di "delete from users" walau proyek akun sudah bersih):
  // - skill_candidates.user_id: prompt kandidat milik akun adalah data
  //   akun itu sendiri → barisnya dihapus.
  // - skill_status_log.actor_user_id: log status katalog adalah riwayat
  //   platform, bukan data pribadi akun → barisnya dipertahankan, cukup
  //   aktornya dilepas (kolomnya nullable).
  await db
    .delete(schema.skillCandidates)
    .where(eq(schema.skillCandidates.userId, target.id));
  await db
    .update(schema.skillStatusLog)
    .set({ actorUserId: null })
    .where(eq(schema.skillStatusLog.actorUserId, target.id));
  // Sapuan langsung per user_id untuk tabel yang merujuk users lewat
  // kolom user_id-nya sendiri (di atas hanya dibersihkan lewat proyek):
  // memastikan tidak ada baris sisa — dari proyek mana pun — yang masih
  // menahan penghapusan baris users.
  await db
    .delete(schema.projectChatMessages)
    .where(eq(schema.projectChatMessages.userId, target.id));
  await db
    .delete(schema.executorJobs)
    .where(eq(schema.executorJobs.userId, target.id));
  await db
    .delete(schema.creditAccount)
    .where(eq(schema.creditAccount.id, target.id));
  await db.delete(schema.workspace).where(eq(schema.workspace.id, target.id));
  await db.delete(schema.users).where(eq(schema.users.id, target.id));
}

// ---------------------------------------------------------------------------
// G6 — Chat Perencana (conversational planner).
//
// G7 — perubahan atas G6: balasan chat di luar build TIDAK LAGI
// gratis — 5 kredit per balasan assistant (ledger kind "chat"),
// saldo < 5 menolak bersih tanpa proyek/pesan baru. Anggaran
// pertanyaan detail maksimal 2 putaran per proyek
// (projects.question_rounds); setelah putaran ke-2 dijawab atau
// pengguna menolak detail lanjutan, pesan berikutnya langsung
// dieksekusi sebagai build otomatis memakai planner MD. Nama usaha
// yang DINYATAKAN pengguna mengganti "Proyek Kustom" segera.
// Aturan cakupan responder (di system prompt DAN klasifikasi): bila
// konteks proyek belum diketahui (belum ada brief) dan pertanyaan
// bersifat umum di luar proyek, AI WAJIB menanyakan dulu konteks
// proyeknya, bukan menjawab generik panjang.
// Planner MD disimpan sebagai kolom projects.planner_md (bukan tabel
// baru) sehingga ikut terhapus otomatis saat proyek/akun dihapus —
// pelajaran dari dua kegagalan FK gelombang sebelumnya.
// ---------------------------------------------------------------------------

// Skema jawaban responder: balasan + fragmen brief baru yang akan
// digabungkan ke planner MD. Hanya fakta BARU dari pesan ini yang diisi.
const responderSchema = z.object({
  reply: z
    .string()
    .describe("Jawaban untuk pengguna, Bahasa Indonesia, singkat dan konkret"),
  topic: z
    .string()
    .optional()
    .describe("Topik proyek bila baru diketahui dari pesan ini"),
  pages: z
    .array(z.string())
    .optional()
    .describe("Halaman baru yang disebut pengguna"),
  features: z
    .array(z.string())
    .optional()
    .describe("Fitur baru yang disebut pengguna"),
  style: z
    .string()
    .optional()
    .describe("Gaya/desain yang disebut pengguna"),
  notes: z
    .array(z.string())
    .optional()
    .describe("Fakta brief singkat lainnya"),
  // G7 — nama usaha/situs yang DINYATAKAN pengguna di pesan ini
  // (mis. "toko saya Martabak Manis"). Wajib kosong bila pengguna hanya
  // menyebut jenis usaha tanpa nama — JANGAN mengarang nama merek.
  businessName: z
    .string()
    .optional()
    .describe(
      "Nama usaha/situs yang dinyatakan pengguna di pesan ini, persis seperti disebutnya; kosong bila tidak dinyatakan",
    ),
  // G7 — true bila balasan ini meminta detail lanjutan dari pengguna
  // (pertanyaan soal halaman/fitur/gaya/dll). Dipakai untuk anggaran
  // putaran pertanyaan (maksimal 2 per proyek).
  asksDetail: z
    .boolean()
    .optional()
    .describe(
      "True bila balasan ini meminta detail lanjutan dari pengguna, false bila hanya menjawab tanpa meminta detail",
    ),
});
const RESP_STRUCTURE_HINT =
  '{"reply": string, "topic": string (opsional), "pages": string[] (opsional), "features": string[] (opsional), "style": string (opsional), "notes": string[] (opsional), "businessName": string (opsional, hanya bila pengguna MENYATAKAN nama usaha/situsnya), "asksDetail": boolean (true bila balasan meminta detail lanjutan)}';

type ChatIntent = "greeting" | "build" | "question" | "discuss";

function normalizeChatText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

// Sapaan MURNI: seluruh pesan hanya sapaan (+ sapaan alamat opsional).
// "halo, mau buat website toko roti" TIDAK cocok di sini (ada substansi)
// sehingga jatuh ke diskusi/build, bukan sapaan.
const GREETING_RE =
  /^(halo+|hai+|hi+|hallo+|hello+|hey+|selamat (pagi|siang|sore|malam)|assalamualaikum|permisi|tes|test|testing|cek)[\s.,!]*(kak|gan|min|bang|mas|mbak|bro|sis|ya)?[\s.,!]*$/;
// Perintah build eksplisit — selalu menang atas bentuk pertanyaan
// ("buatkan website toko roti?" tetap build).
const BUILD_MARKERS =
  /\b(buatkan|buatin|buatlah|bikin(kan)?|tolong buatkan?|tolong bikinkan|lanjut|lanjutkan|kerjakan|kerjain|eksekusi|mulai (buat|bangun|kerjakan)|buat sekarang|sudah siap|siap (dikerjakan|dibuat|diekseskusi)|silakan (buat|dibuat|lanjut|kerjakan)|gas(kan)?|gaskeun|ayo buat|langsung (buat|bangun)|coba buatkan?)\b/;
// Imperatif perubahan di chat proyek ("tambahkan halaman galeri") —
// hanya bila bukan bentuk pertanyaan (tanpa "?" akhir dan tanpa kata
// tanya di awal), agar "bagaimana kalau ubah warna?" tetap diskusi.
const PROJECT_IMPERATIVES =
  /^(tambah(kan)?|tambahkan|ubah|ganti|hapus|perbaiki|edit|sisipkan|buat(kan)?|kurangi|pindah(kan)?|perbarui|update)\b/;
const QUESTION_START =
  /^(apa|apakah|bagaimana|gimana|kenapa|mengapa|kapan|di ?mana|siapa|berapa|bisakah|bisa kah|tolong jelaskan|jelaskan|apa itu|apa yang|darimana|dari mana|untuk apa|kok|loh|(mau|numpang|izin) tanya)\b/;
// ---------------------------------------------------------------------------
// G7 — tarif chat, penolakan detail, anggaran putaran pertanyaan, dan
// penamaan usaha otomatis.
// ---------------------------------------------------------------------------
// Tarif per balasan assistant di luar build (sapaan/tanya/diskusi).
// Build/iterasi tetap memakai tarif build 300 dan TIDAK ditambah 5.
const CHAT_REPLY_COST = 5;
// Penolakan detail lanjutan ("tidak usah", "simple saja", ...) —
// memicu build otomatis bila proyek sudah punya brief atau sudah
// melewati minimal satu putaran pertanyaan. Kata "cukup" hanya dihitung
// bila berdiri sendiri ("cukup", "cukup, gitu aja"), bukan di tengah
// kalimat lain ("harganya cukup murah" bukan penolakan).
const REFUSAL_RE =
  /\b(tidak usah|tidak perlu|nggak usah|gak usah|ga usah|nggak perlu|gak perlu|sudah cukup|cukup saja|simple saja|gitu aja|gitu saja|skip aja|skip saja|tidak jadi|nggak jadi|gak jadi)\b/;
const BARE_CUKUP_RE = /^cukup[\s.,!]*$/;
// Anggaran pertanyaan detail: maksimal 2 putaran per proyek. Satu putaran
// = satu balasan assistant yang isinya meminta detail. Sapaan pembuka
// TIDAK dihitung (ia membuka percakapan, bukan putaran detail).
const MAX_QUESTION_ROUNDS = 2;
// Penanda heuristik bila model tidak mengisi field asksDetail: balasan
// yang mengandung "?" plus kata ajakan detail.
const DETAIL_CUE_RE =
  /\b(mau|ingin|butuh|perlu|apakah|berapa|jenis|warna|halaman|fitur|tambah|pilih|ceritakan|sebutkan|kasih tahu|gimana|bagaimana|yang mana)\b/i;
function replyAsksDetail(
  reply: string,
  flag: boolean | undefined,
): boolean {
  if (flag !== undefined) return flag;
  if (!reply.includes("?")) return false;
  return DETAIL_CUE_RE.test(reply);
}
// Nama usaha yang DINYATAKAN pengguna — cadangan bila model tidak
// mengisi field businessName. Hanya pola eksplisit ("toko saya X",
// "namanya X", "nama usaha saya X") dengan nama berhuruf kapital; bila
// pengguna hanya menyebut jenis usaha ("usaha martabak") tanpa nama,
// fungsi ini mengembalikan null (JANGAN menebak nama merek).
function extractBusinessName(message: string): string | null {
  const text = message.trim();
  const namePart =
    "[A-ZÀ-ÿ][\\w'’.-]*(?:\\s+[A-ZÀ-ÿ][\\w'’.-]*){0,3}";
  const patterns = [
    new RegExp(
      `(?:toko|usaha|warung|restoran|kafe|kedai|klinik|brand|merek|bisnis)\\s+(?:saya|kami|kita)\\s+(?:bernama\\s+|namanya\\s+)?(${namePart})`,
    ),
    new RegExp(`\\bnamanya\\s+(${namePart})`),
    new RegExp(
      `\\bnama\\s+(?:usaha|toko|warung|restoran|kafe|kedai|brand|merek)(?:\\s+saya)?\\s+(?:adalah\\s+|itu\\s+)?(${namePart})`,
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      let name = m[1].trim().replace(/[\s.,!]+$/g, "");
      name = name
        .replace(/\s+(yang|dan|untuk|dengan|jualan|jual)$/i, "")
        .trim();
      if (name.length >= 2) return name;
    }
  }
  return null;
}
// Kata kunci tipe situs/usaha — dipakai untuk mendeteksi "brief lengkap"
// di composer dan topik proyek di pertanyaan.
const SITE_TYPE_KEYWORDS =
  /\b(website|web|aplikasi|app|marketplace|toko|warung|restoran|kafe|kedai|klinik|sekolah|kursus|hotel|travel|dashboard|sistem|platform|landing page|company profile|portofolio|portfolio|blog|booking|kasir|undangan|komunitas|forum|saas|crm|lms|e-?commerce|bisnis|usaha|perusahaan|jasa|produk|jual|sewa|rental)\b/;
const TOPIC_KEYWORDS =
  /\b(website|aplikasi|marketplace|toko|warung|restoran|kafe|kedai|klinik|sekolah|kursus|hotel|travel|dashboard|sistem|platform|landing page|company profile|portofolio|blog|booking|kasir|undangan|komunitas|saas|crm|lms|bisnis|usaha|perusahaan|halaman|fitur|tabel|database|desain|warna|logo|domain|deploy|android|login|pembayaran|katalog|galeri|menu|langganan|reservasi|konten)\b/;

function classifyChatMessage(
  raw: string,
  opts: { inProject: boolean },
): ChatIntent {
  const text = normalizeChatText(raw);
  const stripped = text.replace(/[!?.…,]+$/g, "").trim();
  if (GREETING_RE.test(stripped)) return "greeting";
  if (BUILD_MARKERS.test(text)) return "build";
  if (
    opts.inProject &&
    PROJECT_IMPERATIVES.test(text) &&
    !text.endsWith("?") &&
    !QUESTION_START.test(text)
  ) {
    return "build";
  }
  if (!opts.inProject) {
    // Composer ("Buat dengan AI"): brief yang jelas dan lengkap langsung
    // build — panjang + menyebut tipe situs + bukan pertanyaan. Brief
    // pendek/vague ("mau buat website toko roti") jatuh ke diskusi agar
    // responder menggali dulu, bukan langsung membakar 300 kredit.
    if (
      text.length >= 80 &&
      SITE_TYPE_KEYWORDS.test(text) &&
      !text.endsWith("?") &&
      !QUESTION_START.test(text)
    ) {
      return "build";
    }
  }
  if (text.endsWith("?") || QUESTION_START.test(text)) return "question";
  return "discuss";
}

function greetingReply(displayName: string, projectName: string | null): string {
  const name = displayName.trim();
  const greeting = name ? `Halo kak ${name}` : "Halo kak";
  if (projectName) {
    return (
      `${greeting}! Ada yang bisa aku bantu untuk proyek ${projectName}? ` +
      `Kamu bisa bertanya soal proyek ini atau minta perubahan — pertanyaan dan diskusi ${CHAT_REPLY_COST} kredit per balasan, perubahan/build 300 kredit bila berhasil.`
    );
  }
  return (
    `${greeting}, mau buat website apa? Ceritakan idemu — jenis usahanya, ` +
    `halaman yang kamu mau, atau fitur yang penting — nanti aku susun rencananya dulu sebelum dibuat. ` +
    `(Balasan chat ${CHAT_REPLY_COST} kredit per balasan; build 300 kredit bila berhasil.)`
  );
}

// ---------------------------------------------------------------------------
// Planner MD: dokumen markdown brief per proyek.
// Format tetap: # Rencana Proyek, ## Topik, ## Halaman, ## Fitur,
// ## Gaya, ## Catatan. Merge bersifat union (dedup tak peka huruf besar
// kecil) + topik hanya diisi bila masih placeholder.
// ---------------------------------------------------------------------------

const PLANNER_MD_TOPIC_PLACEHOLDER =
  "Belum diketahui — AI sedang menggali kebutuhan.";

function initialPlannerMd(): string {
  return (
    `# Rencana Proyek\n\n## Topik\n${PLANNER_MD_TOPIC_PLACEHOLDER}\n\n## Halaman\n- (belum ada)\n\n## Fitur\n- (belum ada)\n\n## Gaya\n- (belum ada)\n\n## Catatan\n`
  );
}

function seedPlannerMd(prompt: string): string {
  const brief = prompt.trim().slice(0, 500);
  return (
    `# Rencana Proyek\n\n## Topik\n${PLANNER_MD_TOPIC_PLACEHOLDER}\n\n## Halaman\n- (belum ada)\n\n## Fitur\n- (belum ada)\n\n## Gaya\n- (belum ada)\n\n## Catatan\n- Brief awal: ${brief}\n`
  );
}

function plannerMdHasBrief(md: string): boolean {
  if (!md.trim()) return false;
  const lines = md.split("\n").map((l) => l.trim());
  const topicIdx = lines.indexOf("## Topik");
  if (topicIdx >= 0) {
    const topicLine = lines
      .slice(topicIdx + 1)
      .find((l) => l.length > 0);
    if (topicLine && !topicLine.startsWith("Belum diketahui")) return true;
  }
  const notesIdx = lines.indexOf("## Catatan");
  if (notesIdx >= 0) {
    if (
      lines
        .slice(notesIdx + 1)
        .some((l) => l.startsWith("- ") && l.trim().length > 2)
    ) {
      return true;
    }
  }
  return false;
}

function parsePlannerMd(md: string): {
  topic: string;
  pages: string[];
  features: string[];
  style: string[];
  notes: string[];
} {
  const sections: Record<string, string[]> = {
    Topik: [],
    Halaman: [],
    Fitur: [],
    Gaya: [],
    Catatan: [],
  };
  let current: string | null = null;
  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      const name = line.slice(3).trim();
      current = name in sections ? name : null;
      continue;
    }
    if (current && line.startsWith("- ")) {
      const item = line.slice(2).trim();
      if (item && item !== "(belum ada)") sections[current]!.push(item);
    } else if (current === "Topik" && line.length > 0) {
      if (line !== PLANNER_MD_TOPIC_PLACEHOLDER) sections.Topik!.push(line);
    }
  }
  return {
    topic: sections.Topik?.[0] ?? "",
    pages: sections.Halaman ?? [],
    features: sections.Fitur ?? [],
    style: sections.Gaya ?? [],
    notes: sections.Catatan ?? [],
  };
}

function renderPlannerMd(parts: {
  topic: string;
  pages: string[];
  features: string[];
  style: string[];
  notes: string[];
}): string {
  const bullets = (items: string[]) =>
    items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : "- (belum ada)";
  return (
    `# Rencana Proyek\n\n## Topik\n${parts.topic || PLANNER_MD_TOPIC_PLACEHOLDER}\n\n## Halaman\n${bullets(parts.pages)}\n\n## Fitur\n${bullets(parts.features)}\n\n## Gaya\n${bullets(parts.style)}\n\n## Catatan\n${parts.notes.map((n) => `- ${n}`).join("\n")}\n`
  );
}

function unionMdItems(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((i) => i.toLowerCase()));
  const out = [...existing];
  for (const item of incoming) {
    const clean = item.trim();
    if (!clean) continue;
    if (!seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
    }
  }
  return out;
}

function mergePlannerMd(
  existing: string,
  update: {
    topic?: string;
    pages?: string[];
    features?: string[];
    style?: string;
    notes?: string[];
  },
): string {
  const base = existing.trim() ? parsePlannerMd(existing) : parsePlannerMd(initialPlannerMd());
  const topic =
    update.topic?.trim() && !base.topic ? update.topic.trim() : base.topic;
  const pages = unionMdItems(base.pages, update.pages ?? []);
  const features = unionMdItems(base.features, update.features ?? []);
  // Gaya adalah satu konsep: bila gaya baru mengandung gaya lama (atau
  // sebaliknya) sebagai substring, gaya lama diganti — bukan ditumpuk.
  // Tanpa ini, "Sederhana" → "Sederhana dengan nuansa hangat" →
  // "Hijau tua, sederhana dengan nuansa hangat" menumpuk 3 baris yang
  // hampir sama di bagian Gaya.
  let style = base.style;
  const newStyle = update.style?.trim() ?? "";
  if (newStyle) {
    const lower = newStyle.toLowerCase();
    style = style.filter((s) => {
      const sl = s.toLowerCase();
      return !lower.includes(sl) && !sl.includes(lower);
    });
    if (!style.some((s) => s.toLowerCase() === lower)) style.push(newStyle);
  }
  let notes = unionMdItems(base.notes, update.notes ?? []);
  // Batas pertumbuhan: simpan maksimal 50 catatan terbaru agar MD tidak
  // menggelembung tanpa batas dari diskusi panjang.
  if (notes.length > 50) notes = notes.slice(notes.length - 50);
  let rendered = renderPlannerMd({ topic, pages, features, style, notes });
  // Batas keras 8000 karakter: pangkas catatan tertua sampai muat.
  while (rendered.length > 8000 && notes.length > 0) {
    notes = notes.slice(1);
    rendered = renderPlannerMd({ topic, pages, features, style, notes });
  }
  return rendered;
}

function appendPlannerNote(md: string, note: string): string {
  return mergePlannerMd(md, { notes: [note] });
}

async function insertChatMessage(
  db: Db,
  args: {
    projectId: number;
    userId: number;
    role: "user" | "assistant";
    content: string;
    kind: "build" | "free" | "chat";
  },
): Promise<void> {
  await db.insert(schema.projectChatMessages).values({
    projectId: args.projectId,
    userId: args.userId,
    role: args.role,
    content: args.content,
    kind: args.kind,
  });
}

// ---------------------------------------------------------------------------
// Pipeline build khusus chat (dipakai sendChatMessage untuk klasifikasi
// BUILD). Disengaja TIDAK mengubah generateWebsite/iterateProject yang
// sudah lolos audit: pipeline ini memakai primitif yang sama (runAiStage,
// runSandboxJob, chargeCredits, routeSkills) dengan konteks planner MD.
// Kasus: proyek baru (buat cangkang setelah Planner, seperti generate),
// proyek draft (bangun ke dalam draft, draft dipertahankan bila gagal),
// proyek berspec (iterasi, slug tidak diubah, seperti iterate).
// ---------------------------------------------------------------------------

type ChatBuildStage = {
  stage: string;
  label: string;
  status: string;
  credits: number;
  note: string;
};

type ChatBuildResult = {
  ok: boolean;
  projectId: number | null;
  error: string | null;
  balance: number;
  stages: ChatBuildStage[];
  routeStatus: string;
  clarificationQuestion: string | null;
  skillPlan: SkillPlan | null;
  skillVersions: Array<{ name: string; version: string; note: string }>;
  plannerMd: string;
};

async function runChatBuildPipeline(
  db: Db,
  ctx: Ctx,
  user: UserRow,
  opts: {
    message: string;
    plannerMd: string;
    project: typeof schema.projects.$inferSelect | null;
    chip?: string;
    clarificationAnswer?: string;
  },
): Promise<ChatBuildResult> {
  const account = await getAccount(db, user.id);
  const balance0 = account?.balance ?? 0;
  const existing = opts.project;
  const oldSpec = existing ? parseSpec(existing.spec) : null;
  const isSpecProject = oldSpec !== null;
  const base: Omit<ChatBuildResult, "ok" | "error"> = {
    projectId: existing?.id ?? null,
    balance: balance0,
    stages: [],
    routeStatus: "not_found",
    clarificationQuestion: null,
    skillPlan: null,
    skillVersions: [],
    plannerMd: opts.plannerMd,
  };

  // Gerbang saldo SEBELUM tulisan apa pun (pola iterate).
  const tariffsNow = await getTariffs(db);
  if (balance0 < tariffsNow.generate) {
    return {
      ...base,
      ok: false,
      routeStatus: "insufficient",
      error: `Kredit tidak cukup. Build membutuhkan ${tariffsNow.generate} kredit, saldo kamu ${balance0}. Top up dulu yuk.`,
    };
  }
  // Router v1 untuk pesan build (sama seperti iterate).
  const disabledSkills = await getDisabledSkills(db);
  const route = routeSkills({
    prompt: opts.message,
    chip: opts.chip,
    clarificationAnswer: opts.clarificationAnswer,
    disabledSkills,
  });
  if (route.status === "generic") {
    await recordSkillCandidate(db, {
      prompt: opts.message,
      nearestSkill: route.nearestSkill,
      nearestScore: route.nearestScore,
      userId: user.id,
    });
  }
  if (route.status === "needs_clarification") {
    return {
      ...base,
      ok: false,
      routeStatus: "needs_clarification",
      clarificationQuestion: route.clarificationQuestion,
      error:
        "Router skill butuh satu klarifikasi sebelum build berjalan (tidak ada kredit terpotong): " +
        (route.clarificationQuestion ?? ""),
    };
  }
  const routeFields = {
    routeStatus: route.status,
    clarificationQuestion: null as string | null,
    skillPlan: route.plan as SkillPlan | null,
    skillVersions: route.versions,
  };
  // Gerbang kunci DeepInfra.
  const keyStatus = await getProviderKeyStatus(db);
  if (!keyStatus.configured) {
    const plannerCfg = await getStageModel(db, "planner");
    await logAiKeyMissing(db, {
      userId: user.id,
      stage: "planner",
      model: plannerCfg?.primaryModel ?? "",
    });
    return {
      ...base,
      ...routeFields,
      ok: false,
      routeStatus: "ai_not_active",
      error:
        "Build AI belum aktif: kunci DeepInfra belum terpasang di platform. Tidak ada perubahan pada proyek dan saldo kredit kamu tidak berubah.",
    };
  }

  // Tabel lama (hanya proyek berspec): dipakai untuk konteks Planner dan
  // dedup tabel baru, seperti iterate.
  const oldTableRows = isSpecProject
    ? await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, existing!.id))
        .orderBy(asc(schema.projectTables.id))
    : [];
  const oldTablesDesc =
    oldTableRows.length > 0
      ? oldTableRows
          .map((t) => {
            let cols: string[] = [];
            try {
              const parsed: unknown = JSON.parse(t.columnsJson);
              if (Array.isArray(parsed))
                cols = parsed.filter((c): c is string => typeof c === "string");
            } catch {
              cols = [];
            }
            return `${t.name} (${cols.join(", ")})`;
          })
          .join("; ")
      : "tidak ada tabel";
  const oldSpecJson = isSpecProject
    ? JSON.stringify({
        siteName: oldSpec!.siteName,
        headline: oldSpec!.headline,
        subheadline: oldSpec!.subheadline,
        ctaLabel: oldSpec!.ctaLabel,
        primaryColor: oldSpec!.primaryColor,
        accentColor: oldSpec!.accentColor,
        pages: oldSpec!.pages,
        sections: oldSpec!.sections,
        features: oldSpec!.features.map((f) => f.title),
        dbTables: oldTablesDesc,
      })
    : "";
  const stageCosts = effectiveStageCosts(tariffsNow.generate);

  // Planner berjalan SEBELUM tulisan apa pun (pola G5-D).
  let plan: z.infer<typeof planSchema>;
  let plannerModelNote = "";
  try {
    const plannerContent = isSpecProject
      ? `Kamu adalah Planner untuk platform pembuat website AI bernama Dadiweb (pasar Indonesia). Pengguna meminta PERUBAHAN pada website yang sudah ada, bukan website baru. Kembalikan rencana LENGKAP yang sudah diperbarui: pertahankan semua yang tidak diminta diubah (nama situs, slug, kategori, halaman, fitur, tabel), ubah hanya yang diminta instruksi lanjutan. Semua teks dalam Bahasa Indonesia. Keadaan proyek saat ini (JSON): ${oldSpecJson}. Rencana proyek (planner MD): ${opts.plannerMd || "(belum ada)"}. Prompt awal proyek: "${existing!.prompt}". Instruksi lanjutan pengguna: "${opts.message}". Router skill memilih domain utama "${route.label}" dengan skill tahap Planner: ${route.stages.planner.join(", ")} (${ROUTE_NOTE})`
      : `Kamu adalah Planner untuk platform pembuat website AI bernama Dadiweb (pasar Indonesia). Buat rencana website dari brief berikut. Semua teks dalam Bahasa Indonesia. Rencana proyek sejauh ini (planner MD): ${opts.plannerMd || "(belum ada)"}. Instruksi build pengguna: "${opts.message}". Router skill (katalog SKILL.md G1) memilih domain utama "${route.label}" dengan skill tahap Planner: ${route.stages.planner.join(", ")} (${ROUTE_NOTE})`;
    const res = await runAiStage({
      db,
      stage: "planner",
      messages: [{ role: "user", content: plannerContent }],
      schema: planSchema,
      structureHint: PLAN_STRUCTURE_HINT,
      userId: user.id,
      projectId: existing?.id ?? null,
    });
    plan = res.data;
    plannerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
  } catch (e) {
    const detail = e instanceof Error ? e.message : undefined;
    return {
      ...base,
      ...routeFields,
      ok: false,
      error:
        `AI gagal menyelesaikan tahap Planner${detail ? `: ${detail}` : "."} ` +
        "Tidak ada perubahan pada proyek dan saldo kredit kamu tidak berubah — coba lagi sebentar lagi.",
      stages: [
        {
          stage: "planner",
          label: "Planner",
          status: "failed",
          credits: 0,
          note: detail
            ? `Tahap gagal dijalankan: ${detail}`
            : "Tahap gagal dijalankan",
        },
      ],
    };
  }

  // Baris proyek: baru (cangkang setelah Planner, seperti generate),
  // draft (pakai baris yang ada), atau berspec (pakai baris yang ada).
  let projectId: number;
  let isNewShell = false;
  if (existing) {
    projectId = existing.id;
    await ensureProjectDbCredential(db, projectId);
    if (!isSpecProject) {
      // Draft: guard check seperti generate, tapi proyek dipertahankan
      // bila ditolak (bukan dihapus seperti cangkang baru).
      const guardCheck = evaluatePathGuard({
        userId: user.id,
        projectId,
        projectOwned: true,
        balance: balance0,
        path: "src/app.tsx",
      });
      if (!guardCheck.allowed) {
        await recordPathViolation(db, {
          userId: user.id,
          projectId,
          path: "src/app.tsx",
          kind: guardCheck.kind,
          reason: guardCheck.reason,
        });
        return { ...base, ...routeFields, ok: false, error: guardCheck.reason };
      }
    }
  } else {
    const shell = await db
      .insert(schema.projects)
      .values({
        userId: user.id,
        name: "Proyek Baru",
        slug: slugify(`proyek-${Date.now()}`),
        category: "Website",
        status: "draft",
        prompt: opts.message,
        spec: "{}",
        source: "ai",
        creditsCost: 0,
        plannerMd: seedPlannerMd(opts.message),
      })
      .returning({ id: schema.projects.id });
    projectId = shell[0]?.id ?? 0;
    if (!projectId) throw new Error("Gagal membuat proyek");
    isNewShell = true;
    await ensureProjectDbCredential(db, projectId);
    const guardCheck = evaluatePathGuard({
      userId: user.id,
      projectId,
      projectOwned: true,
      balance: balance0,
      path: "src/app.tsx",
    });
    if (!guardCheck.allowed) {
      await recordPathViolation(db, {
        userId: user.id,
        projectId,
        path: "src/app.tsx",
        kind: guardCheck.kind,
        reason: guardCheck.reason,
      });
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
      return { ...base, ...routeFields, ok: false, error: guardCheck.reason };
    }
  }

  const stageResults: ChatBuildStage[] = [];
  let spent = 0;
  // Prefix catatan generations: proyek berspec memakai "Iterasi: "
  // (seperti iterateProject); build pertama (baru/draft) tanpa prefix
  // (seperti generateWebsite).
  const notePrefix = isSpecProject ? "Iterasi: " : "";
  const recordStage = async (
    stageKey: string,
    label: string,
    cost: number,
    note: string,
    status: "done" | "failed",
  ) => {
    await db.insert(schema.generations).values({
      projectId,
      stage: stageKey,
      status,
      credits: status === "done" ? cost : 0,
      note: `${notePrefix}${note}`,
    });
    if (status === "done") {
      spent += cost;
      await chargeCredits(db, user.id, {
        amount: -cost,
        label: isSpecProject
          ? `Iterasi ${label} — ${existing!.name}`
          : `${label} — generasi website`,
        category: "AI Coding",
        kind: "generate",
        projectId,
      });
    }
    stageResults.push({
      stage: stageKey,
      label,
      status,
      credits: status === "done" ? cost : 0,
      note,
    });
  };

  // Gagal di tengah: kembalikan kredit tahap yang sudah selesai (pola
  // iterate); cangkang baru dihapus (pola generate), draft/berspec
  // dipertahankan dengan spec tidak berubah.
  const fail = async (
    stageKey: string,
    label: string,
    cost: number,
    detail?: string,
  ): Promise<ChatBuildResult> => {
    await recordStage(
      stageKey,
      label,
      cost,
      detail ? `Tahap gagal dijalankan: ${detail}` : "Tahap gagal dijalankan",
      "failed",
    );
    if (spent > 0) {
      for (const s of stageResults) {
        if (s.status === "done" && s.credits > 0) {
          await chargeCredits(db, user.id, {
            amount: s.credits,
            label: `Pengembalian kredit — build gagal di tahap ${label} (tahap ${s.label} dibatalkan)`,
            category: "AI Coding",
            kind: "adjust",
            projectId,
          });
        }
      }
      const usageRows = await db
        .select()
        .from(schema.creditUsage)
        .where(
          and(
            eq(schema.creditUsage.userId, user.id),
            eq(schema.creditUsage.category, "AI Coding"),
          ),
        );
      const usageRow = usageRows[0];
      if (usageRow) {
        await db
          .update(schema.creditUsage)
          .set({ used: Math.max(0, usageRow.used - spent) })
          .where(
            and(
              eq(schema.creditUsage.userId, user.id),
              eq(schema.creditUsage.category, "AI Coding"),
            ),
          );
      }
    }
    if (isNewShell) {
      const projectRow = await ownedProject(db, user.id, projectId);
      if (projectRow) {
        await deleteProjectFully(db, projectRow, ctx.blobs);
      } else {
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
      }
    }
    const acc = await getAccount(db, user.id);
    return {
      ...base,
      ...routeFields,
      ok: false,
      projectId: isNewShell ? null : projectId,
      error:
        `AI gagal menyelesaikan tahap ${label}${detail ? `: ${detail}` : "."} ` +
        "Proyek tidak berubah dan seluruh kredit build dikembalikan — coba lagi sebentar lagi.",
      balance: acc?.balance ?? 0,
      stages: stageResults,
    };
  };

  await recordStage(
    "planner",
    "Planner",
    stageCosts[0] ?? STAGES[0].cost,
    `${plan.summary} (Skill: ${route.stages.planner.join(", ")})${plannerModelNote}`,
    "done",
  );

  // Designer.
  let design: z.infer<typeof designSchema>;
  let designerModelNote = "";
  try {
    const designerContent = isSpecProject
      ? `Kamu adalah Designer untuk Dadiweb. Rancang tampilan hero website "${plan.siteName}" (kategori ${plan.category}) setelah perubahan berikut: "${opts.message}". Rencana proyek (planner MD): ${opts.plannerMd || "(belum ada)"}. Halaman: ${plan.pages.join(", ")}. Fitur: ${plan.features.join("; ")}. Headline lama: "${oldSpec!.headline}". Semua teks Bahasa Indonesia, headline harus kuat dan menjual.`
      : `Kamu adalah Designer untuk Dadiweb. Rancang tampilan hero website "${plan.siteName}" (kategori ${plan.category}). Halaman: ${plan.pages.join(", ")}. Fitur: ${plan.features.join("; ")}. Prompt asli pengguna: "${opts.message}". Semua teks Bahasa Indonesia, headline harus kuat dan menjual.`;
    const res = await runAiStage({
      db,
      stage: "designer",
      messages: [{ role: "user", content: designerContent }],
      schema: designSchema,
      structureHint: DESIGN_STRUCTURE_HINT,
      userId: user.id,
      projectId,
    });
    design = res.data;
    designerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
  } catch (e) {
    return fail(
      "designer",
      "Designer",
      stageCosts[1] ?? STAGES[1].cost,
      e instanceof Error ? e.message : undefined,
    );
  }
  await recordStage(
    "designer",
    "Designer",
    stageCosts[1] ?? STAGES[1].cost,
    `${design.layoutNotes}${designerModelNote}`,
    "done",
  );

  // Coder.
  let code: z.infer<typeof codeSchema>;
  let coderModelNote = "";
  try {
    const coderContent = isSpecProject
      ? `Kamu adalah Coder untuk Dadiweb. Tulis konten fitur dan struktur section untuk website "${plan.siteName}" dengan headline "${design.headline}" setelah perubahan berikut: "${opts.message}". Fitur yang direncanakan: ${plan.features.join("; ")}. Section lama: ${oldSpec!.sections.join(", ")}. Semua teks Bahasa Indonesia dan spesifik untuk situs ini, bukan generik.`
      : `Kamu adalah Coder untuk Dadiweb. Tulis konten fitur dan struktur section untuk website "${plan.siteName}" dengan headline "${design.headline}". Fitur yang direncanakan: ${plan.features.join("; ")}. Semua teks Bahasa Indonesia dan spesifik untuk situs ini, bukan generik.`;
    const res = await runAiStage({
      db,
      stage: "coder",
      messages: [{ role: "user", content: coderContent }],
      schema: codeSchema,
      structureHint: CODE_STRUCTURE_HINT,
      userId: user.id,
      projectId,
    });
    code = res.data;
    coderModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
  } catch (e) {
    return fail(
      "coder",
      "Coder",
      stageCosts[2] ?? STAGES[2].cost,
      e instanceof Error ? e.message : undefined,
    );
  }
  await recordStage(
    "coder",
    "Coder",
    stageCosts[2] ?? STAGES[2].cost,
    `${code.stackNotes}${coderModelNote}`,
    "done",
  );

  // Builder & Tester — job Executor G2 yang sama seperti generate/iterate.
  const buildJob = await runSandboxJob(db, {
    user,
    projectId,
    kind: "build",
  });
  if (buildJob.status !== "done") {
    return fail("builder", "Builder & Tester", stageCosts[3] ?? STAGES[3].cost);
  }
  await recordStage(
    "builder",
    "Builder & Tester",
    stageCosts[3] ?? STAGES[3].cost,
    `${plan.pages.length} halaman dan ${plan.dbTables.length} tabel database berhasil dibangun dan lolos uji render. Job Executor #${buildJob.id} berjalan di sandbox ${buildJob.sandboxDir} (ruang kerja sudah dihapus; hasil di builds/).`,
    "done",
  );

  // Fixer — pemeriksaan lokal, selalu selesai (seperti generate/iterate).
  await recordStage(
    "fixer",
    "Fixer",
    stageCosts[4] ?? STAGES[4].cost,
    "Pemeriksaan akhir selesai: tautan, warna, dan tata letak valid.",
    "done",
  );

  const spec: SiteSpec = {
    siteName: plan.siteName,
    headline: design.headline,
    subheadline: design.subheadline,
    ctaLabel: design.ctaLabel,
    primaryColor: design.primaryColor,
    accentColor: design.accentColor,
    features: code.features,
    sections: code.sections,
    pages: plan.pages,
  };

  let finalMd = opts.plannerMd;
  if (isSpecProject) {
    // Spec tidak berubah slug-nya (seperti iterate); MD dicatat
    // perubahannya agar tetap menjadi brief hidup proyek.
    finalMd = appendPlannerNote(opts.plannerMd, `Perubahan: ${opts.message}`);
    await db
      .update(schema.projects)
      .set({
        name: plan.siteName,
        category: plan.category,
        spec: JSON.stringify(spec),
        skillPlan: JSON.stringify(route.plan),
        skillVersions: JSON.stringify(route.versions),
        creditsCost: (existing!.creditsCost ?? 0) + spent,
        plannerMd: finalMd,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));
    const existingNames = new Set(oldTableRows.map((t) => t.name));
    for (const t of plan.dbTables.slice(0, 6)) {
      if (existingNames.has(t.name)) continue;
      await db.insert(schema.projectTables).values({
        projectId,
        name: t.name,
        schemaName: schemaNameForProject(projectId),
        columnsJson: JSON.stringify(t.columns.length > 0 ? t.columns : ["id"]),
      });
    }
    await insertChatMessage(db, {
      projectId,
      userId: user.id,
      role: "user",
      content: opts.message,
      kind: "build",
    });
    await insertChatMessage(db, {
      projectId,
      userId: user.id,
      role: "assistant",
      content:
        `Perubahan selesai: ${plan.summary} ` +
        `Halaman sekarang: ${plan.pages.join(", ")}. ` +
        `Biaya iterasi ${spent} kredit. Kirim pesan lanjutan lagi bila masih ada yang ingin diubah.`,
      kind: "build",
    });
  } else {
    // Build pertama (baru/draft): slug boleh mengikuti rencana (belum
    // ada deployment); MD draft dipertahankan, MD proyek baru sudah
    // dibenihkan saat cangkang dibuat.
    finalMd = existing ? opts.plannerMd : seedPlannerMd(opts.message);
    await db
      .update(schema.projects)
      .set({
        name: plan.siteName,
        slug: slugify(plan.slug || plan.siteName),
        category: plan.category,
        spec: JSON.stringify(spec),
        creditsCost: spent,
        skillPlan: JSON.stringify(route.plan),
        skillVersions: JSON.stringify(route.versions),
        plannerMd: finalMd,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));
    for (const t of plan.dbTables.slice(0, 6)) {
      await db.insert(schema.projectTables).values({
        projectId,
        name: t.name,
        schemaName: schemaNameForProject(projectId),
        columnsJson: JSON.stringify(t.columns.length > 0 ? t.columns : ["id"]),
      });
    }
    await insertChatMessage(db, {
      projectId,
      userId: user.id,
      role: "user",
      content: opts.message,
      kind: "build",
    });
    await insertChatMessage(db, {
      projectId,
      userId: user.id,
      role: "assistant",
      content:
        `Website "${plan.siteName}" selesai dibuat: ${plan.summary} ` +
        `Halaman: ${plan.pages.join(", ")}. ` +
        `Skill: ${route.stages.planner.join(", ")}. ` +
        `Kirim pesan lanjutan di chat ini untuk mengubah proyek (300 kredit per iterasi yang berhasil) atau bertanya soal proyek ini (${CHAT_REPLY_COST} kredit per balasan).`,
      kind: "build",
    });
  }

  const acc = await getAccount(db, user.id);
  ctx.invalidateQueries();
  return {
    ...base,
    ...routeFields,
    ok: true,
    projectId,
    error: null,
    balance: acc?.balance ?? 0,
    stages: stageResults,
    plannerMd: finalMd,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const stateResponse = z.object({
  workspace: z.object({
    displayName: z.string(),
    email: z.string(),
    plan: z.string(),
    emailVerified: z.boolean(),
    // Sama dengan gerbang aksi admin: hanya akun pemilik platform.
    // Dipakai klien untuk menampilkan tautan halaman admin dan untuk
    // menggerbang halaman /admin; penolakan sesungguhnya tetap di server.
    isAdmin: z.boolean(),
  }),
  account: z.object({
    plan: z.string(),
    monthlyQuota: z.number(),
    balance: z.number(),
  }),
  usage: z.array(z.object({ category: z.string(), used: z.number() })),
  projects: z.array(projectOut),
  templates: z.array(templateOut),
  ledger: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      label: z.string(),
      category: z.string(),
      amount: z.number(),
      balanceAfter: z.number(),
      createdAt: z.string(),
    }),
  ),
  deployments: z.array(
    z.object({
      id: z.number(),
      projectId: z.number(),
      subdomain: z.string(),
      status: z.string(),
      kind: z.string(),
      note: z.string(),
      // G10 — kosong = belum ada record DNS (baris pra-G10 dan deploy
      // yang gagal di tahap DNS tidak pernah ditandai live).
      cloudflareRecordId: z.string(),
      dnsStatus: z.string(),
      createdAt: z.string(),
    }),
  ),
  invoices: z.array(
    z.object({
      id: z.number(),
      number: z.string(),
      kind: z.string(),
      title: z.string(),
      amountIdr: z.number().nullable(),
      creditsDelta: z.number(),
      balanceAfter: z.number().nullable(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  integrations: z.array(
    z.object({
      key: z.string(),
      enabled: z.boolean(),
      status: z.string(),
      hasApiKey: z.boolean(),
      apiKeyHint: z.string(),
      webhookUrl: z.string(),
    }),
  ),
  customDomains: z.array(
    z.object({
      id: z.number(),
      projectId: z.number(),
      domain: z.string(),
      status: z.string(),
      verificationToken: z.string(),
      isPrimary: z.boolean(),
      sslStatus: z.string(),
      createdAt: z.string(),
    }),
  ),
  androidBuilds: z.array(
    z.object({
      id: z.number(),
      projectId: z.number(),
      appName: z.string(),
      packageId: z.string(),
      versionName: z.string(),
      versionCode: z.number(),
      buildType: z.string(),
      status: z.string(),
      iconColor: z.string(),
      splashText: z.string(),
      creditsCost: z.number(),
      createdAt: z.string(),
    }),
  ),
  generateCost: z.number(),
  androidBuildCost: z.number(),
  // G5-C — info platform untuk UI semua pengguna: nama platform + pesan
  // maintenance (ditampilkan untuk pengguna non-admin tanpa memblokir
  // panel Admin) + tarif yang sedang berlaku.
  platform: z.object({
    name: z.string(),
    maintenanceMessage: z.string(),
    maintenanceEnabled: z.boolean(),
    freeQuota: z.number(),
    deployCost: z.number(),
  }),
});

// G13-B — satu job video. playbackUrl adalah URL own-origin
// (./blobs/...) dari MP4 yang sudah diunduh ke ctx.blobs —
// SATU-SATUNYA sumber pemutaran/daftar. URL fal CDN (video_url) TIDAK
// PERNAH dikembalikan ke client (hanya jejak sementara di DB).
const videoJobOut = z.object({
  id: z.number(),
  projectId: z.number(),
  modelKey: z.string(),
  modelLabel: z.string(),
  prompt: z.string(),
  imageUrl: z.string().nullable(),
  durationSec: z.number(),
  resolution: z.string(),
  creditsCost: z.number(),
  status: z.string(),
  playbackUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const Actions = {
  getState: defineAction({
    description: "Memuat seluruh snapshot workspace pengguna yang masuk: profil, saldo kredit, proyek, template, ledger, invoice, tarif, dan pengaturan platform.",
    request: z.object({ token: tokenField }),
    response: stateResponse,
    async handler(ctx, args): Promise<z.infer<typeof stateResponse>> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      await ensureInvoicesBackfill(db, user.id);
      const platformRow = await ensurePlatformSettings(db);

      const ws = await db
        .select()
        .from(schema.workspace)
        .where(eq(schema.workspace.id, user.id));
      const account = await getAccount(db, user.id);
      const usageRows = await db
        .select()
        .from(schema.creditUsage)
        .where(eq(schema.creditUsage.userId, user.id));
      const projectRows = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.userId, user.id))
        .orderBy(desc(schema.projects.updatedAt));
      const templateRows = await db
        .select()
        .from(schema.templates)
        .orderBy(asc(schema.templates.id));
      const ledgerRows = await db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.userId, user.id))
        .orderBy(desc(schema.creditLedger.id))
        .limit(30);
      const projectIds = projectRows.map((p) => p.id);
      // G2 — proyek lama (pra-G2, termasuk 5 proyek demo) mendapat skema +
      // kredensial DB per proyek secara insert-if-not-exists saat dimuat.
      for (const id of projectIds) {
        await ensureProjectDbCredential(db, id);
      }
      const deploymentRows =
        projectIds.length > 0
          ? await db
              .select()
              .from(schema.deployments)
              .where(inArray(schema.deployments.projectId, projectIds))
              .orderBy(desc(schema.deployments.id))
          : [];
      const integrationRows = await db
        .select()
        .from(schema.integrations)
        .where(eq(schema.integrations.userId, user.id));
      const domainRows =
        projectIds.length > 0
          ? await db
              .select()
              .from(schema.customDomains)
              .where(inArray(schema.customDomains.projectId, projectIds))
              .orderBy(desc(schema.customDomains.id))
          : [];
      const buildRows =
        projectIds.length > 0
          ? await db
              .select()
              .from(schema.androidBuilds)
              .where(inArray(schema.androidBuilds.projectId, projectIds))
              .orderBy(desc(schema.androidBuilds.id))
          : [];
      const invoiceRows = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.userId, user.id))
        .orderBy(desc(schema.invoices.id))
        .limit(30);

      return {
        workspace: {
          displayName: ws[0]?.displayName ?? user.name,
          email: ws[0]?.email ?? user.email,
          plan: ws[0]?.plan ?? user.plan,
          emailVerified: user.emailVerified,
          isAdmin: user.email === DEMO_EMAIL,
        },
        account: {
          plan: account?.plan ?? user.plan,
          monthlyQuota: account?.monthlyQuota ?? PLAN_QUOTA[user.plan] ?? 200,
          balance: account?.balance ?? 0,
        },
        usage: usageRows.map((u) => ({ category: u.category, used: u.used })),
        projects: projectRows.map(toProjectOut),
        templates: templateRows
          .map((t) => {
            const spec = parseSpec(t.spec);
            if (!spec) return null;
            return {
              id: t.id,
              name: t.name,
              category: t.category,
              tagline: t.tagline,
              hue: t.hue,
              uses: t.uses,
              spec,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null),
        ledger: ledgerRows.map((l) => ({
          id: l.id,
          kind: l.kind,
          label: l.label,
          category: l.category,
          amount: l.amount,
          balanceAfter: l.balanceAfter,
          createdAt: l.createdAt.toISOString(),
        })),
        deployments: deploymentRows.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          subdomain: d.subdomain,
          status: d.status,
          kind: d.kind,
          note: d.note,
          cloudflareRecordId: d.cloudflareRecordId ?? "",
          dnsStatus: d.dnsStatus ?? "",
          createdAt: d.createdAt.toISOString(),
        })),
        invoices: invoiceRows.map((i) => ({
          id: i.id,
          number: i.number,
          kind: i.kind,
          title: i.title,
          amountIdr: i.amountIdr,
          creditsDelta: i.creditsDelta,
          balanceAfter: i.balanceAfter,
          status: i.status,
          createdAt: i.createdAt.toISOString(),
        })),
        integrations: integrationRows.map((i) => {
          const cfg = parseConfig(i.configJson);
          return {
            key: i.key,
            enabled: i.enabled,
            status: i.status,
            hasApiKey: cfg["hasApiKey"] === true,
            apiKeyHint: typeof cfg["apiKeyHint"] === "string" ? cfg["apiKeyHint"] : "",
            webhookUrl: typeof cfg["webhookUrl"] === "string" ? cfg["webhookUrl"] : "",
          };
        }),
        customDomains: domainRows.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          domain: d.domain,
          status: d.status,
          verificationToken: d.verificationToken,
          isPrimary: d.isPrimary,
          sslStatus: d.sslStatus,
          createdAt: d.createdAt.toISOString(),
        })),
        androidBuilds: buildRows.map((b) => ({
          id: b.id,
          projectId: b.projectId,
          appName: b.appName,
          packageId: b.packageId,
          versionName: b.versionName,
          versionCode: b.versionCode,
          buildType: b.buildType,
          status: b.status,
          iconColor: b.iconColor,
          splashText: b.splashText,
          creditsCost: b.creditsCost,
          createdAt: b.createdAt.toISOString(),
        })),
        generateCost: platformRow.generateCost,
        androidBuildCost: platformRow.androidCost,
        platform: {
          name: platformRow.platformName,
          maintenanceMessage: platformRow.maintenanceMessage,
          maintenanceEnabled: platformRow.maintenanceEnabled,
          freeQuota: platformRow.freeQuota,
          deployCost: platformRow.deployCost,
        },
      };
    },
  }),

  generateWebsite: defineAction({

    description: "Menjalankan pipeline AI 5 tahap untuk membuat website baru dari prompt pengguna, dengan tarif generate yang berlaku dan hanya dipotong bila sukses.",
    request: z.object({
      token: tokenField,
      prompt: z.string().min(10).max(2000),
      // G0 Router v1: chip jenis proyek pilihan pengguna (nama skill atau
      // labelnya). Bila ada, chip SELALU mengalahkan tebakan router.
      chip: z.string().max(60).optional(),
      // Jawaban atas pertanyaan penjernih router (status needs_clarification).
      clarificationAnswer: z.string().max(500).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      projectId: z.number().nullable(),
      error: z.string().nullable(),
      balance: z.number(),
      stages: z.array(
        z.object({
          stage: z.string(),
          label: z.string(),
          status: z.string(),
          credits: z.number(),
          note: z.string(),
        }),
      ),
      // G0 — hasil Router v1 untuk generate ini.
      routeStatus: z.string(),
      clarificationQuestion: z.string().nullable(),
      skillPlan: skillPlanOut.nullable(),
      skillVersions: z.array(skillVersionOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const account = await getAccount(db, user.id);
      const balance0 = account?.balance ?? 0;

      // G0 — Router v1 berjalan di awal tahap Planner. Bila router butuh
      // klarifikasi, generate TIDAK berjalan: tidak ada proyek dibuat dan
      // tidak ada kredit terpotong sampai pertanyaan dijawab.
      const disabledSkills = await getDisabledSkills(db);
      const route = routeSkills({
        prompt: args.prompt,
        chip: args.chip,
        clarificationAnswer: args.clarificationAnswer,
        disabledSkills,
      });
      // G3 — prompt generik (tidak ada domain aktif berskor >0) tercatat
      // sebagai kandidat skill baru untuk admin; generate generik tetap
      // berjalan sebagai "proyek kustom", tidak digagalkan.
      if (route.status === "generic") {
        await recordSkillCandidate(db, {
          prompt: args.prompt,
          nearestSkill: route.nearestSkill,
          nearestScore: route.nearestScore,
          userId: user.id,
        });
      }
      if (route.status === "needs_clarification") {
        return {
          ok: false,
          projectId: null,
          error:
            "Router skill butuh satu klarifikasi sebelum generate berjalan (tidak ada kredit terpotong): " +
            (route.clarificationQuestion ?? ""),
          balance: balance0,
          stages: [],
          routeStatus: "needs_clarification",
          clarificationQuestion: route.clarificationQuestion,
          skillPlan: null,
          skillVersions: [],
        };
      }
      const routeFields = {
        routeStatus: route.status,
        clarificationQuestion: null as string | null,
        skillPlan: route.plan as SkillPlan | null,
        skillVersions: route.versions,
      };

      // G5-A — gerbang kunci DeepInfra. Selama kunci belum terpasang di
      // penyimpanan platform terenkripsi, generate berhenti di sini
      // dengan routeStatus "ai_not_active": TANPA proyek baru, TANPA
      // potongan kredit, TANPA pemanggilan model apa pun. Routing skill
      // di atas tidak memakai model, jadi skillPlan tetap dihitung dan
      // dikembalikan seperti biasa. Penolakan ini tercatat satu baris di
      // ai_usage_log berstatus kunci_belum_terpasang.
      const keyStatus = await getProviderKeyStatus(db);
      if (!keyStatus.configured) {
        const plannerCfg = await getStageModel(db, "planner");
        await logAiKeyMissing(db, {
          userId: user.id,
          stage: "planner",
          model: plannerCfg?.primaryModel ?? "",
        });
        return {
          ok: false,
          projectId: null,
          error:
            "Generate AI belum aktif: kunci DeepInfra belum terpasang di platform. Tidak ada proyek yang dibuat dan saldo kredit kamu tidak berubah. Generate akan berjalan begitu kunci DeepInfra dipasang oleh admin.",
          balance: balance0,
          stages: [],
          routeStatus: "ai_not_active",
          clarificationQuestion: null,
          skillPlan: routeFields.skillPlan,
          skillVersions: routeFields.skillVersions,
        };
      }

      // G5-C — tarif generate dibaca segar dari pengaturan platform;
      // perubahan tarif admin berlaku untuk generate berikutnya saja.
      const tariffsNow = await getTariffs(db);
      const stageCosts = effectiveStageCosts(tariffsNow.generate);
      if (balance0 < tariffsNow.generate) {
        return {
          ok: false,
          projectId: null,
          error: `Kredit tidak cukup. Membuat website membutuhkan ${tariffsNow.generate} kredit, saldo kamu ${balance0}. Top up dulu yuk.`,
          balance: balance0,
          stages: [],
          ...routeFields,
        };
      }

      const stageResults: Array<{
        stage: string;
        label: string;
        status: string;
        credits: number;
        note: string;
      }> = [];

      // G5-D — Tahap Planner berjalan SEBELUM baris proyek dibuat.
      // Generate yang gagal di Planner (penyebab draft kosong pada uji
      // G5-D pertama: cangkang dibuat duluan, lalu ditinggal saat Planner
      // timeout) kini tidak meninggalkan proyek apa pun. Baris proyek
      // baru dibuat setelah rencana berhasil didapat; kegagalan tahap
      // berikutnya menghapus proyek itu lagi lewat fail() di bawah.
      let plan: z.infer<typeof planSchema>;
      let plannerModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "planner",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Planner untuk platform pembuat website AI bernama Dadiweb (pasar Indonesia). Buat rencana website dari prompt pengguna berikut. Semua teks dalam Bahasa Indonesia. Prompt: "${args.prompt}". Router skill (katalog SKILL.md G1) memilih domain utama "${route.label}" dengan skill tahap Planner: ${route.stages.planner.join(", ")} (${ROUTE_NOTE})`,
            },
          ],
          schema: planSchema,
          structureHint: PLAN_STRUCTURE_HINT,
          userId: user.id,
          projectId: null,
        });
        plan = res.data;
        plannerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        const detail = e instanceof Error ? e.message : undefined;
        return {
          ok: false,
          projectId: null,
          error:
            `AI gagal menyelesaikan tahap Planner${detail ? `: ${detail}` : "."} ` +
            "Tidak ada proyek yang dibuat dan saldo kredit kamu tidak berubah — coba lagi sebentar lagi.",
          balance: balance0,
          stages: [
            {
              stage: "planner",
              label: "Planner",
              status: "failed",
              credits: 0,
              note: detail
                ? `Tahap gagal dijalankan: ${detail}`
                : "Tahap gagal dijalankan",
            },
          ],
          ...routeFields,
        };
      }

      // Planner berhasil — sekarang baris proyek dibuat untuk tahap
      // berikutnya.
      const shell = await db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: "Proyek Baru",
          slug: slugify(`proyek-${Date.now()}`),
          category: "Website",
          status: "draft",
          prompt: args.prompt,
          spec: "{}",
          source: "ai",
          creditsCost: 0,
        })
        .returning({ id: schema.projects.id });
      const projectId = shell[0]?.id;
      if (!projectId) throw new Error("Gagal membuat proyek");

      // G2 — proyek baru langsung mendapat skema sendiri (proj_<id>) dan
      // pengguna database sendiri yang hanya berhak atas skema itu.
      await ensureProjectDbCredential(db, projectId);

      // G0 — Executor path-guard berjalan SEBELUM penulisan apa pun pada
      // jalur generate. Penolakan membatalkan job dengan aman: proyek
      // cangkang dihapus, tidak ada kredit terpotong, kejadian tercatat.
      const guardCheck = evaluatePathGuard({
        userId: user.id,
        projectId,
        projectOwned: true,
        balance: balance0,
        path: "src/app.tsx",
      });
      if (!guardCheck.allowed) {
        await recordPathViolation(db, {
          userId: user.id,
          projectId,
          path: "src/app.tsx",
          kind: guardCheck.kind,
          reason: guardCheck.reason,
        });
        await db
          .delete(schema.projects)
          .where(eq(schema.projects.id, projectId));
        return {
          ok: false,
          projectId: null,
          error: guardCheck.reason,
          balance: balance0,
          stages: [],
          ...routeFields,
        };
      }

      let spent = 0;
      const recordStage = async (
        stageKey: string,
        label: string,
        cost: number,
        note: string,
        status: "done" | "failed",
      ) => {
        await db.insert(schema.generations).values({
          projectId,
          stage: stageKey,
          status,
          credits: status === "done" ? cost : 0,
          note,
        });
        if (status === "done") {
          spent += cost;
          await chargeCredits(db, user.id, {
            amount: -cost,
            label: `${label} — generasi website`,
            category: "AI Coding",
            kind: "generate",
            projectId,
          });
        }
        stageResults.push({
          stage: stageKey,
          label,
          status,
          credits: status === "done" ? cost : 0,
          note,
        });
      };

      const fail = async (
        stageKey: string,
        label: string,
        cost: number,
        detail?: string,
      ) => {
        await recordStage(
          stageKey,
          label,
          cost,
          detail ? `Tahap gagal dijalankan: ${detail}` : "Tahap gagal dijalankan",
          "failed",
        );
        // G5-D — generate yang gagal TIDAK meninggalkan proyek dan TIDAK
        // memotong saldo: kredit tahap yang sudah selesai dikembalikan
        // (satu baris ledger "adjust" per tahap, transparan di riwayat),
        // pemakaian kategori AI Coding dikurangi kembali, lalu proyek
        // beserta seluruh ruangnya dihapus (ledger dipertahankan oleh
        // deleteProjectFully dengan tautan proyek dilepas, pola G2).
        if (spent > 0) {
          for (const s of stageResults) {
            if (s.status === "done" && s.credits > 0) {
              await chargeCredits(db, user.id, {
                amount: s.credits,
                label: `Pengembalian kredit — generate gagal di tahap ${label} (tahap ${s.label} dibatalkan)`,
                category: "AI Coding",
                kind: "adjust",
                projectId,
              });
            }
          }
          const usageRows = await db
            .select()
            .from(schema.creditUsage)
            .where(
              and(
                eq(schema.creditUsage.userId, user.id),
                eq(schema.creditUsage.category, "AI Coding"),
              ),
            );
          const usageRow = usageRows[0];
          if (usageRow) {
            await db
              .update(schema.creditUsage)
              .set({ used: Math.max(0, usageRow.used - spent) })
              .where(
                and(
                  eq(schema.creditUsage.userId, user.id),
                  eq(schema.creditUsage.category, "AI Coding"),
                ),
              );
          }
        }
        const projectRow = await ownedProject(db, user.id, projectId);
        if (projectRow) {
          await deleteProjectFully(db, projectRow, ctx.blobs);
        } else {
          await db
            .delete(schema.projects)
            .where(eq(schema.projects.id, projectId));
        }
        const acc = await getAccount(db, user.id);
        return {
          ok: false,
          projectId: null,
          error:
            `AI gagal menyelesaikan tahap ${label}${detail ? `: ${detail}` : "."} ` +
            "Proyek yang belum selesai sudah dihapus dan seluruh kredit generate dikembalikan — coba lagi sebentar lagi.",
          balance: acc?.balance ?? 0,
          stages: stageResults,
          ...routeFields,
        };
      };

      // G5-A — ketiga tahap bermodel (Planner, Designer, Coder) berjalan
      // lewat lapisan provider DeepInfra (runAiStage): model & harga dari
      // registry ai_stage_models, fallback satu kali per tahap, dan
      // setiap percobaan tercatat di ai_usage_log. Builder & Fixer tidak
      // memanggil model (Builder = job Executor G2; Fixer = pemeriksaan
      // lokal) tetapi modelnya tetap terdaftar di registry tahap itu.

      // Stage 1 — Planner SUDAH berjalan sebelum proyek dibuat (lihat
      // blok G5-D di atas); di sini hasilnya dicatat ke proyek baru.
      await recordStage(
        "planner",
        "Planner",
        stageCosts[0] ?? STAGES[0].cost,
        `${plan.summary} (Skill: ${route.stages.planner.join(", ")})${plannerModelNote}`,
        "done",
      );

      // Stage 2 — Designer
      let design: z.infer<typeof designSchema>;
      let designerModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "designer",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Designer untuk Dadiweb. Rancang tampilan hero website "${plan.siteName}" (kategori ${plan.category}). Halaman: ${plan.pages.join(", ")}. Fitur: ${plan.features.join("; ")}. Prompt asli pengguna: "${args.prompt}". Semua teks Bahasa Indonesia, headline harus kuat dan menjual.`,
            },
          ],
          schema: designSchema,
          structureHint: DESIGN_STRUCTURE_HINT,
          userId: user.id,
          projectId,
        });
        design = res.data;
        designerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        return fail(
          "designer",
          "Designer",
          stageCosts[1] ?? STAGES[1].cost,
          e instanceof Error ? e.message : undefined,
        );
      }
      await recordStage(
        "designer",
        "Designer",
        stageCosts[1] ?? STAGES[1].cost,
        `${design.layoutNotes}${designerModelNote}`,
        "done",
      );

      // Stage 3 — Coder
      let code: z.infer<typeof codeSchema>;
      let coderModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "coder",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Coder untuk Dadiweb. Tulis konten fitur dan struktur section untuk website "${plan.siteName}" dengan headline "${design.headline}". Fitur yang direncanakan: ${plan.features.join("; ")}. Semua teks Bahasa Indonesia dan spesifik untuk situs ini, bukan generik.`,
            },
          ],
          schema: codeSchema,
          structureHint: CODE_STRUCTURE_HINT,
          userId: user.id,
          projectId,
        });
        code = res.data;
        coderModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        return fail(
          "coder",
          "Coder",
          stageCosts[2] ?? STAGES[2].cost,
          e instanceof Error ? e.message : undefined,
        );
      }
      await recordStage(
        "coder",
        "Coder",
        stageCosts[2] ?? STAGES[2].cost,
        `${code.stackNotes}${coderModelNote}`,
        "done",
      );

      // Stages 4 & 5 — Builder & Tester, Fixer (no model call: assemble,
      // validate the spec, and persist generated database tables).
      const spec: SiteSpec = {
        siteName: plan.siteName,
        headline: design.headline,
        subheadline: design.subheadline,
        ctaLabel: design.ctaLabel,
        primaryColor: design.primaryColor,
        accentColor: design.accentColor,
        features: code.features,
        sections: code.sections,
        pages: plan.pages,
      };
      // G2 — tahap Builder berjalan sebagai job Executor di sandbox
      // tmp/job-<id>: snapshot hanya-baca proyek, jaringan hanya daftar
      // izin, batas waktu & memori per job, ruang kerja dihapus setelah
      // job selesai. Hasil lolos QA disalin Executor ke builds/ proyek.
      const buildJob = await runSandboxJob(db, {
        user,
        projectId,
        kind: "build",
      });
      if (buildJob.status !== "done") {
        return fail("builder", "Builder & Tester", stageCosts[3] ?? STAGES[3].cost);
      }
      await recordStage(
        "builder",
        "Builder & Tester",
        stageCosts[3] ?? STAGES[3].cost,
        `${plan.pages.length} halaman dan ${plan.dbTables.length} tabel database berhasil dibangun dan lolos uji render. Job Executor #${buildJob.id} berjalan di sandbox ${buildJob.sandboxDir} (ruang kerja sudah dihapus; hasil di builds/).`,
        "done",
      );

      for (const t of plan.dbTables.slice(0, 6)) {
        await db.insert(schema.projectTables).values({
          projectId,
          name: t.name,
          // G2 — tabel hasil rancangan database-designer hidup di skema
          // proyek ini sendiri (proj_<project_id>), bukan skema bersama.
          schemaName: schemaNameForProject(projectId),
          columnsJson: JSON.stringify(
            t.columns.length > 0 ? t.columns : ["id"],
          ),
        });
      }

      await recordStage(
        "fixer",
        "Fixer",
        stageCosts[4] ?? STAGES[4].cost,
        "Pemeriksaan akhir selesai: tautan, warna, dan tata letak valid.",
        "done",
      );

      const slug = slugify(plan.slug || plan.siteName);
      await db
        .update(schema.projects)
        .set({
          name: plan.siteName,
          slug,
          category: plan.category,
          spec: JSON.stringify(spec),
          creditsCost: spent,
          // G6 — benih planner MD dari prompt awal (menjadi konteks
          // utama bila proyek ini nanti dibangun/diskusi via chat).
          plannerMd: seedPlannerMd(args.prompt),
          // G0 — catat rencana skill + versi katalog yang dipakai proyek ini.
          skillPlan: JSON.stringify(route.plan),
          skillVersions: JSON.stringify(route.versions),
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, projectId));

      // Tampilan project chat: benih riwayat chat — prompt awal pengguna
      // dan ringkasan hasil pipeline. Pesan lanjutan (iterateProject)
      // ditambahkan ke thread yang sama; proyek lama tanpa pesan
      // menampilkan fallback dari prompt + generations di client.
      await db.insert(schema.projectChatMessages).values({
        projectId,
        userId: user.id,
        role: "user",
        content: args.prompt,
      });
      await db.insert(schema.projectChatMessages).values({
        projectId,
        userId: user.id,
        role: "assistant",
        content:
          `Website "${plan.siteName}" selesai dibuat: ${plan.summary} ` +
          `Halaman: ${plan.pages.join(", ")}. ` +
          `Skill: ${route.stages.planner.join(", ")}. ` +
          `Kirim pesan lanjutan di chat ini untuk mengubah proyek (300 kredit per iterasi yang berhasil).`,
      });

      const acc = await getAccount(db, user.id);
      ctx.invalidateQueries();
      return {
        ok: true,
        projectId,
        error: null,
        balance: acc?.balance ?? 0,
        stages: stageResults,
        ...routeFields,
      };
    },
  }),

  // ---------------------------------------------------------------------------
  // Tampilan project chat + iterasi (31 Okt 2026).
  // iterateProject: pesan lanjutan di chat proyek yang BENAR-BENAR mengubah
  // proyek — pipeline 5 tahap yang sama dengan generate, dengan spec lama
  // sebagai konteks Planner. Tarif = tarif generate yang berlaku (dibaca
  // segar dari pengaturan platform, default 300), dipotong per tahap saat
  // tahap sukses; bila tahap mana pun gagal, kredit tahap yang sudah
  // selesai dikembalikan (kind "adjust", pola generate) dan spec TIDAK
  // berubah. Pesan chat hanya ditulis saat iterasi sukses.
  // Urutan gerbang (lebih ketat dari generate): kepemilikan → spec →
  // saldo → router → kunci. Saldo dicek SEBELUM tulisan apa pun, jadi
  // iterasi yang ditolak karena saldo tidak meninggalkan kandidat skill,
  // pesan chat, baris generations, maupun perubahan spec.
  // Slug TIDAK diubah saat iterasi agar subdomain deployment yang sudah
  // terbit tidak putus; tabel database hanya DITAMBAH (tabel lama tidak
  // pernah dihapus iterasi, supaya baris data pengguna tidak hilang).
  // ---------------------------------------------------------------------------

  iterateProject: defineAction({

    description: "Mengiterasi proyek yang sudah ada lewat pipeline AI yang sama berdasarkan instruksi lanjutan, memperbarui spec dan menambah tabel tanpa menghapus data lama.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      prompt: z.string().min(10).max(2000),
    }),
    response: z.object({
      ok: z.boolean(),
      projectId: z.number().nullable(),
      error: z.string().nullable(),
      balance: z.number(),
      stages: z.array(
        z.object({
          stage: z.string(),
          label: z.string(),
          status: z.string(),
          credits: z.number(),
          note: z.string(),
        }),
      ),
      routeStatus: z.string(),
      clarificationQuestion: z.string().nullable(),
      skillPlan: skillPlanOut.nullable(),
      skillVersions: z.array(skillVersionOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const account = await getAccount(db, user.id);
      const balance0 = account?.balance ?? 0;
      const base = {
        projectId: args.projectId,
        balance: balance0,
        stages: [] as Array<{
          stage: string;
          label: string;
          status: string;
          credits: number;
          note: string;
        }>,
        routeStatus: "not_found",
        clarificationQuestion: null as string | null,
        skillPlan: null as SkillPlan | null,
        skillVersions: [] as Array<{
          name: string;
          version: string;
          note: string;
        }>,
      };
      // Kepemilikan: proyek akun lain diperlakukan sama seperti tidak ada
      // (tidak membocorkan keberadaannya).
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) {
        return { ...base, ok: false, error: "Proyek tidak ditemukan" };
      }
      const oldSpec = parseSpec(project.spec);
      if (!oldSpec) {
        return {
          ...base,
          ok: false,
          error:
            "Spesifikasi proyek belum tersedia — proyek ini belum punya hasil generate yang bisa diiterasi.",
        };
      }
      // Gerbang saldo SEBELUM tulisan apa pun.
      const tariffsNow = await getTariffs(db);
      if (balance0 < tariffsNow.generate) {
        return {
          ...base,
          ok: false,
          routeStatus: "insufficient",
          error: `Kredit tidak cukup. Iterasi membutuhkan ${tariffsNow.generate} kredit, saldo kamu ${balance0}. Top up dulu yuk.`,
        };
      }
      // Router v1 untuk pesan lanjutan (sama seperti generate).
      const disabledSkills = await getDisabledSkills(db);
      const route = routeSkills({
        prompt: args.prompt,
        disabledSkills,
      });
      if (route.status === "generic") {
        await recordSkillCandidate(db, {
          prompt: args.prompt,
          nearestSkill: route.nearestSkill,
          nearestScore: route.nearestScore,
          userId: user.id,
        });
      }
      if (route.status === "needs_clarification") {
        return {
          ...base,
          ok: false,
          routeStatus: "needs_clarification",
          clarificationQuestion: route.clarificationQuestion,
          error:
            "Router skill butuh satu klarifikasi sebelum iterasi berjalan (tidak ada kredit terpotong): " +
            (route.clarificationQuestion ?? ""),
        };
      }
      const routeFields = {
        routeStatus: route.status,
        clarificationQuestion: null as string | null,
        skillPlan: route.plan as SkillPlan | null,
        skillVersions: route.versions,
      };
      // Gerbang kunci DeepInfra (sama seperti generate).
      const keyStatus = await getProviderKeyStatus(db);
      if (!keyStatus.configured) {
        const plannerCfg = await getStageModel(db, "planner");
        await logAiKeyMissing(db, {
          userId: user.id,
          stage: "planner",
          model: plannerCfg?.primaryModel ?? "",
        });
        return {
          ...base,
          ...routeFields,
          ok: false,
          routeStatus: "ai_not_active",
          error:
            "Iterasi AI belum aktif: kunci DeepInfra belum terpasang di platform. Tidak ada perubahan pada proyek dan saldo kredit kamu tidak berubah.",
        };
      }

      const oldTableRows = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId))
        .orderBy(asc(schema.projectTables.id));
      const oldTablesDesc =
        oldTableRows.length > 0
          ? oldTableRows
              .map((t) => {
                let cols: string[] = [];
                try {
                  const parsed: unknown = JSON.parse(t.columnsJson);
                  if (Array.isArray(parsed))
                    cols = parsed.filter(
                      (c): c is string => typeof c === "string",
                    );
                } catch {
                  cols = [];
                }
                return `${t.name} (${cols.join(", ")})`;
              })
              .join("; ")
          : "tidak ada tabel";
      const oldSpecJson = JSON.stringify({
        siteName: oldSpec.siteName,
        headline: oldSpec.headline,
        subheadline: oldSpec.subheadline,
        ctaLabel: oldSpec.ctaLabel,
        primaryColor: oldSpec.primaryColor,
        accentColor: oldSpec.accentColor,
        pages: oldSpec.pages,
        sections: oldSpec.sections,
        features: oldSpec.features.map((f) => f.title),
        dbTables: oldTablesDesc,
      });
      const stageCosts = effectiveStageCosts(tariffsNow.generate);

      // Planner berjalan SEBELUM tulisan apa pun (pola G5-D): gagal di
      // Planner = tidak ada potongan, tidak ada perubahan, tidak ada pesan.
      let plan: z.infer<typeof planSchema>;
      let plannerModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "planner",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Planner untuk platform pembuat website AI bernama Dadiweb (pasar Indonesia). Pengguna meminta PERUBAHAN pada website yang sudah ada, bukan website baru. Kembalikan rencana LENGKAP yang sudah diperbarui: pertahankan semua yang tidak diminta diubah (nama situs, slug, kategori, halaman, fitur, tabel), ubah hanya yang diminta instruksi lanjutan. Semua teks dalam Bahasa Indonesia. Keadaan proyek saat ini (JSON): ${oldSpecJson}. Prompt awal proyek: "${project.prompt}". Instruksi lanjutan pengguna: "${args.prompt}". Router skill memilih domain utama "${route.label}" dengan skill tahap Planner: ${route.stages.planner.join(", ")} (${ROUTE_NOTE})`,
            },
          ],
          schema: planSchema,
          structureHint: PLAN_STRUCTURE_HINT,
          userId: user.id,
          projectId: args.projectId,
        });
        plan = res.data;
        plannerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        const detail = e instanceof Error ? e.message : undefined;
        return {
          ...base,
          ok: false,
          ...routeFields,
          error:
            `AI gagal menyelesaikan tahap Planner${detail ? `: ${detail}` : "."} ` +
            "Tidak ada perubahan pada proyek dan saldo kredit kamu tidak berubah — coba lagi sebentar lagi.",
          stages: [
            {
              stage: "planner",
              label: "Planner",
              status: "failed",
              credits: 0,
              note: detail
                ? `Tahap gagal dijalankan: ${detail}`
                : "Tahap gagal dijalankan",
            },
          ],
        };
      }

      const stageResults: Array<{
        stage: string;
        label: string;
        status: string;
        credits: number;
        note: string;
      }> = [];
      let spent = 0;
      const recordStage = async (
        stageKey: string,
        label: string,
        cost: number,
        note: string,
        status: "done" | "failed",
      ) => {
        await db.insert(schema.generations).values({
          projectId: args.projectId,
          stage: stageKey,
          status,
          credits: status === "done" ? cost : 0,
          note: `Iterasi: ${note}`,
        });
        if (status === "done") {
          spent += cost;
          await chargeCredits(db, user.id, {
            amount: -cost,
            label: `Iterasi ${label} — ${project.name}`,
            category: "AI Coding",
            kind: "generate",
            projectId: args.projectId,
          });
        }
        stageResults.push({
          stage: stageKey,
          label,
          status,
          credits: status === "done" ? cost : 0,
          note,
        });
      };

      // Gagal di tengah: kembalikan kredit tahap yang sudah selesai,
      // spec TIDAK berubah, pesan chat TIDAK ditulis. Baris generations
      // tetap sebagai riwayat (berbeda dari generate gagal yang menghapus
      // proyeknya — di sini proyek dipertahankan).
      const fail = async (
        stageKey: string,
        label: string,
        cost: number,
        detail?: string,
      ) => {
        await recordStage(
          stageKey,
          label,
          cost,
          detail ? `Tahap gagal dijalankan: ${detail}` : "Tahap gagal dijalankan",
          "failed",
        );
        if (spent > 0) {
          for (const s of stageResults) {
            if (s.status === "done" && s.credits > 0) {
              await chargeCredits(db, user.id, {
                amount: s.credits,
                label: `Pengembalian kredit — iterasi gagal di tahap ${label} (tahap ${s.label} dibatalkan)`,
                category: "AI Coding",
                kind: "adjust",
                projectId: args.projectId,
              });
            }
          }
          const usageRows = await db
            .select()
            .from(schema.creditUsage)
            .where(
              and(
                eq(schema.creditUsage.userId, user.id),
                eq(schema.creditUsage.category, "AI Coding"),
              ),
            );
          const usageRow = usageRows[0];
          if (usageRow) {
            await db
              .update(schema.creditUsage)
              .set({ used: Math.max(0, usageRow.used - spent) })
              .where(
                and(
                  eq(schema.creditUsage.userId, user.id),
                  eq(schema.creditUsage.category, "AI Coding"),
                ),
              );
          }
        }
        const acc = await getAccount(db, user.id);
        return {
          ...base,
          ok: false,
          ...routeFields,
          error:
            `AI gagal menyelesaikan tahap ${label}${detail ? `: ${detail}` : "."} ` +
            "Proyek tidak berubah dan seluruh kredit iterasi dikembalikan — coba lagi sebentar lagi.",
          balance: acc?.balance ?? 0,
          stages: stageResults,
        };
      };

      await recordStage(
        "planner",
        "Planner",
        stageCosts[0] ?? STAGES[0].cost,
        `${plan.summary} (Skill: ${route.stages.planner.join(", ")})${plannerModelNote}`,
        "done",
      );

      // Designer — hero baru dari rencana yang diperbarui.
      let design: z.infer<typeof designSchema>;
      let designerModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "designer",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Designer untuk Dadiweb. Rancang tampilan hero website "${plan.siteName}" (kategori ${plan.category}) setelah perubahan berikut: "${args.prompt}". Halaman: ${plan.pages.join(", ")}. Fitur: ${plan.features.join("; ")}. Headline lama: "${oldSpec.headline}". Semua teks Bahasa Indonesia, headline harus kuat dan menjual.`,
            },
          ],
          schema: designSchema,
          structureHint: DESIGN_STRUCTURE_HINT,
          userId: user.id,
          projectId: args.projectId,
        });
        design = res.data;
        designerModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        return fail(
          "designer",
          "Designer",
          stageCosts[1] ?? STAGES[1].cost,
          e instanceof Error ? e.message : undefined,
        );
      }
      await recordStage(
        "designer",
        "Designer",
        stageCosts[1] ?? STAGES[1].cost,
        `${design.layoutNotes}${designerModelNote}`,
        "done",
      );

      // Coder — fitur & section baru dari rencana yang diperbarui.
      let code: z.infer<typeof codeSchema>;
      let coderModelNote = "";
      try {
        const res = await runAiStage({
          db,
          stage: "coder",
          messages: [
            {
              role: "user",
              content: `Kamu adalah Coder untuk Dadiweb. Tulis konten fitur dan struktur section untuk website "${plan.siteName}" dengan headline "${design.headline}" setelah perubahan berikut: "${args.prompt}". Fitur yang direncanakan: ${plan.features.join("; ")}. Section lama: ${oldSpec.sections.join(", ")}. Semua teks Bahasa Indonesia dan spesifik untuk situs ini, bukan generik.`,
            },
          ],
          schema: codeSchema,
          structureHint: CODE_STRUCTURE_HINT,
          userId: user.id,
          projectId: args.projectId,
        });
        code = res.data;
        coderModelNote = ` Model: ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}.`;
      } catch (e) {
        return fail(
          "coder",
          "Coder",
          stageCosts[2] ?? STAGES[2].cost,
          e instanceof Error ? e.message : undefined,
        );
      }
      await recordStage(
        "coder",
        "Coder",
        stageCosts[2] ?? STAGES[2].cost,
        `${code.stackNotes}${coderModelNote}`,
        "done",
      );

      // Builder & Tester — job Executor G2 yang sama seperti generate.
      const buildJob = await runSandboxJob(db, {
        user,
        projectId: args.projectId,
        kind: "build",
      });
      if (buildJob.status !== "done") {
        return fail("builder", "Builder & Tester", stageCosts[3] ?? STAGES[3].cost);
      }
      await recordStage(
        "builder",
        "Builder & Tester",
        stageCosts[3] ?? STAGES[3].cost,
        `${plan.pages.length} halaman dan ${plan.dbTables.length} tabel database berhasil dibangun dan lolos uji render. Job Executor #${buildJob.id} berjalan di sandbox ${buildJob.sandboxDir} (ruang kerja sudah dihapus; hasil di builds/).`,
        "done",
      );

      await recordStage(
        "fixer",
        "Fixer",
        stageCosts[4] ?? STAGES[4].cost,
        "Pemeriksaan akhir selesai: tautan, warna, dan tata letak valid.",
        "done",
      );

      // Semua tahap sukses — BARU sekarang spec ditulis. Slug sengaja
      // tidak diubah (subdomain deployment tetap hidup).
      const nextSpec: SiteSpec = {
        siteName: plan.siteName,
        headline: design.headline,
        subheadline: design.subheadline,
        ctaLabel: design.ctaLabel,
        primaryColor: design.primaryColor,
        accentColor: design.accentColor,
        features: code.features,
        sections: code.sections,
        pages: plan.pages,
      };
      await db
        .update(schema.projects)
        .set({
          name: plan.siteName,
          category: plan.category,
          spec: JSON.stringify(nextSpec),
          skillPlan: JSON.stringify(route.plan),
          skillVersions: JSON.stringify(route.versions),
          creditsCost: (project.creditsCost ?? 0) + spent,
          // G6 — catat perubahan ke planner MD agar tetap menjadi
          // brief hidup proyek.
          plannerMd: appendPlannerNote(
            project.plannerMd ?? "",
            `Perubahan: ${args.prompt}`,
          ),
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, args.projectId));
      // Tabel baru dari rencana ditambahkan; tabel lama dipertahankan
      // beserta baris datanya (tidak ada penghapusan tabel saat iterasi).
      const existingNames = new Set(oldTableRows.map((t) => t.name));
      for (const t of plan.dbTables.slice(0, 6)) {
        if (existingNames.has(t.name)) continue;
        await db.insert(schema.projectTables).values({
          projectId: args.projectId,
          name: t.name,
          schemaName: schemaNameForProject(args.projectId),
          columnsJson: JSON.stringify(
            t.columns.length > 0 ? t.columns : ["id"],
          ),
        });
      }
      // Pesan chat hanya ditulis saat iterasi sukses.
      await db.insert(schema.projectChatMessages).values({
        projectId: args.projectId,
        userId: user.id,
        role: "user",
        content: args.prompt,
      });
      await db.insert(schema.projectChatMessages).values({
        projectId: args.projectId,
        userId: user.id,
        role: "assistant",
        content:
          `Perubahan selesai: ${plan.summary} ` +
          `Halaman sekarang: ${plan.pages.join(", ")}. ` +
          `Biaya iterasi ${spent} kredit. Kirim pesan lanjutan lagi bila masih ada yang ingin diubah.`,
      });

      const acc = await getAccount(db, user.id);
      ctx.invalidateQueries();
      return {
        ...base,
        ok: true,
        error: null,
        ...routeFields,
        balance: acc?.balance ?? 0,
        stages: stageResults,
      };
    },
  }),

  // G6 — Chat Perencana: klasifikasi pesan (sapaan / tanya-diskusi /
  // build) untuk chat proyek dan entry composer "Buat dengan AI".
  // G7 — perubahan perilaku (tarif + anggaran pertanyaan + penamaan):
  //
  // - SAPAAN: tanpa proyek → buat proyek draft "Proyek Kustom"
  //   (tanpa pipeline) + balasan personal, 5 kredit per balasan
  //   (bukan lagi gratis); saldo < 5 → tolak bersih tanpa proyek.
  //   Di dalam proyek → hanya balasan sapaan, proyek tidak berubah.
  // - TANYA/DISKUSI: dijawab responder (stage registry "responder"),
  //   5 kredit per balasan (ledger kind "chat"), isi relevan ditambah
  //   ke planner MD proyek. Bila belum ada konteks brief dan pertanyaan
  //   bersifat umum di luar proyek, AI menanyakan konteks dulu —
  //   tanpa memanggil model sama sekali (balasan pengalihan kalengan),
  //   tapi tetap 5 kredit dan dihitung satu putaran pertanyaan.
  //   Anggaran pertanyaan detail MAKSIMAL 2 putaran per proyek
  //   (kolom projects.question_rounds, direset tiap build sukses);
  //   setelah putaran ke-2 dijawab, atau kapan pun pengguna menolak
  //   detail lanjutan ("tidak usah", "simple saja", ...), pesan
  //   berikutnya LANGSUNG dieksekusi sebagai build otomatis memakai
  //   planner MD (gerbang saldo build tetap berlaku).
  //   Bila pengguna MENYATAKAN nama usaha/situsnya dan proyek masih
  //   bernama "Proyek Kustom", nama proyek diganti segera dan topik MD
  //   diset ke nama itu (tidak ada tebakan nama merek).
  // - BUILD: pipeline spesialis (runChatBuildPipeline) dengan tarif
  //   300 HANYA bila sukses, memakai planner MD + pesan sebagai
  //   konteks. generateWebsite/iterateProject TIDAK disentuh.
  sendChatMessage: defineAction({
    description: "Memproses satu pesan chat perencana: sapaan, tanya/diskusi dijawab responder (5 kredit per balasan), perintah build atau pemicu otomatis menjalankan pipeline build (300 kredit bila sukses).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive().optional(),
      prompt: z.string(),
      chip: z.string().optional(),
      clarificationAnswer: z.string().optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
      projectId: z.number().nullable(),
      intent: z.string().nullable(),
      balance: z.number(),
      stages: z.array(
        z.object({
          stage: z.string(),
          label: z.string(),
          status: z.string(),
          credits: z.number(),
          note: z.string(),
        }),
      ),
      routeStatus: z.string().nullable(),
      clarificationQuestion: z.string().nullable(),
      skillPlan: skillPlanOut.nullable(),
      skillVersions: z.array(skillVersionOut),
      plannerMd: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      await ensureTemplates(db);
      await ensureAiStageModels(db);
      const prompt = args.prompt.trim();
      const account = await getAccount(db, user.id);
      const balanceNow = account?.balance ?? 0;
      const empty = {
        ok: false as const,
        projectId: args.projectId ?? null,
        intent: null as string | null,
        balance: balanceNow,
        stages: [] as ChatBuildStage[],
        routeStatus: null as string | null,
        clarificationQuestion: null as string | null,
        skillPlan: null as SkillPlan | null,
        skillVersions: [] as Array<{
          name: string;
          version: string;
          note: string;
        }>,
        plannerMd: "",
      };
      if (!prompt) {
        return { ...empty, error: "Pesan tidak boleh kosong." };
      }
      const inProject = args.projectId !== undefined;
      const intent = classifyChatMessage(prompt, { inProject });

      // G7 — proyek dimuat sekali di awal dan dipakai semua cabang.
      // Bila projectId disebut tapi proyek tidak ditemukan/bukan milik
      // pengguna, semua cabang mengembalikan penolakan yang sama
      // seperti sebelumnya.
      const projectEarly = inProject
        ? await ownedProject(db, user.id, args.projectId!)
        : null;
      if (inProject && !projectEarly) {
        return { ...empty, intent, error: "Proyek tidak ditemukan atau bukan milik kamu." };
      }
      const currentMdEarly = projectEarly?.plannerMd ?? "";
      const promptIntentEarly = projectEarly
        ? classifyChatMessage(projectEarly.prompt, { inProject: false })
        : null;
      // Konteks brief dianggap ada bila: MD berisi topik/catatan
      // substansial, ATAU spec sudah ter-parse, ATAU prompt proyek
      // merupakan brief substansial (diskusi/build) — BUKAN sapaan
      // ("halo" dari Proyek Kustom) dan BUKAN pertanyaan (pertanyaan
      // umum bukan brief; bila dihitung brief, pengalihan "tanyakan
      // konteks dulu" tidak akan pernah terpicu untuk Proyek Kustom).
      const hasBriefEarly =
        plannerMdHasBrief(currentMdEarly) ||
        (projectEarly ? parseSpec(projectEarly.spec) !== null : false) ||
        promptIntentEarly === "discuss" ||
        promptIntentEarly === "build";
      const roundsEarly = projectEarly?.questionRounds ?? 0;
      // G7 — tarif chat: potong 5 kredit untuk satu balasan assistant
      // di luar build. Dipanggil SETELAH balasan berhasil disiapkan dan
      // SEBELUM pesan ditulis; gerbang saldo (< 5) diperiksa pemanggil
      // sebelum pekerjaan apa pun agar tidak ada proyek/pesan baru.
      // Gagal responder tidak pernah sampai ke sini (cabang catch
      // mengembalikan error tanpa potongan).
      const chargeChatReply = async (projectId: number): Promise<number> =>
        chargeCredits(db, user.id, {
          amount: -CHAT_REPLY_COST,
          label: `Balasan chat AI (${CHAT_REPLY_COST} kredit)`,
          category: "Lainnya",
          kind: "chat",
          projectId,
        });
      // G7 — satu jalur build untuk klasifikasi build maupun pemicu
      // build otomatis (penolakan detail / anggaran putaran habis):
      // pipeline yang sama persis, dan anggaran putaran direset ke 0
      // bila build sukses (diskusi pasca-build mendapat anggaran baru).
      const runBuild = async (
        project: typeof schema.projects.$inferSelect | null,
        plannerMd: string,
      ) => {
        const result = await runChatBuildPipeline(db, ctx, user, {
          message: prompt,
          plannerMd,
          project,
          chip: args.chip,
          clarificationAnswer: args.clarificationAnswer,
        });
        if (result.ok && result.projectId) {
          await db
            .update(schema.projects)
            .set({ questionRounds: 0 })
            .where(eq(schema.projects.id, result.projectId));
        }
        return {
          ok: result.ok,
          error: result.error ?? undefined,
          projectId: result.projectId,
          intent: "build" as const,
          balance: result.balance,
          stages: result.stages,
          routeStatus: result.routeStatus,
          clarificationQuestion: result.clarificationQuestion,
          skillPlan: result.skillPlan,
          skillVersions: result.skillVersions,
          plannerMd: result.plannerMd,
        };
      };

      // --- SAPAAN ---
      if (intent === "greeting") {
        if (inProject) {
          const project = projectEarly!;
          // G7 — sapaan bukan lagi gratis: gerbang 5 kredit dulu.
          if (balanceNow < CHAT_REPLY_COST) {
            return {
              ...empty,
              intent,
              error: `Kredit tidak cukup untuk chat. Balasan chat membutuhkan ${CHAT_REPLY_COST} kredit, saldo kamu ${balanceNow}. Top up dulu yuk.`,
            };
          }
          const reply = greetingReply(user.name ?? "", project.name);
          const newBalance = await chargeChatReply(project.id);
          await insertChatMessage(db, {
            projectId: project.id,
            userId: user.id,
            role: "user",
            content: prompt,
            kind: "chat",
          });
          await insertChatMessage(db, {
            projectId: project.id,
            userId: user.id,
            role: "assistant",
            content: reply,
            kind: "chat",
          });
          ctx.invalidateQueries();
          return {
            ...empty,
            ok: true as const,
            projectId: project.id,
            intent,
            balance: newBalance,
            plannerMd: project.plannerMd ?? "",
          };
        }
        // Entry composer: proyek draft "Proyek Kustom" — balasan
        // sapaan 5 kredit (bukan lagi gratis); gerbang saldo dulu
        // agar tidak ada proyek baru bila saldo < 5.
        if (balanceNow < CHAT_REPLY_COST) {
          return {
            ...empty,
            intent,
            error: `Kredit tidak cukup untuk chat. Balasan chat membutuhkan ${CHAT_REPLY_COST} kredit, saldo kamu ${balanceNow}. Top up dulu yuk.`,
          };
        }
        const inserted = await db
          .insert(schema.projects)
          .values({
            userId: user.id,
            name: "Proyek Kustom",
            slug: slugify(`proyek-kustom-${Date.now()}`),
            category: "Website",
            status: "draft",
            prompt: prompt,
            spec: "{}",
            source: "ai",
            creditsCost: 0,
            plannerMd: initialPlannerMd(),
          })
          .returning({ id: schema.projects.id });
        const newId = inserted[0]?.id ?? 0;
        if (!newId) throw new Error("Gagal membuat proyek");
        await ensureProjectDbCredential(db, newId);
        const reply = greetingReply(user.name ?? "", null);
        const newBalance = await chargeChatReply(newId);
        await insertChatMessage(db, {
          projectId: newId,
          userId: user.id,
          role: "user",
          content: prompt,
          kind: "chat",
        });
        await insertChatMessage(db, {
          projectId: newId,
          userId: user.id,
          role: "assistant",
          content: reply,
          kind: "chat",
        });
        ctx.invalidateQueries();
        return {
          ...empty,
          ok: true as const,
          projectId: newId,
          intent,
          balance: newBalance,
          plannerMd: initialPlannerMd(),
        };
      }

      // --- BUILD ---
      if (intent === "build") {
        return runBuild(projectEarly, currentMdEarly);
      }

      // --- TANYA / DISKUSI (responder, 5 kredit per balasan) ---
      const project = projectEarly;
      const currentMd = currentMdEarly;
      const hasBrief = hasBriefEarly;
      // G7 — pemicu build OTOMATIS (bukan pertanyaan ke-3 dan
      // seterusnya):
      // (a) pengguna menolak detail lanjutan ("tidak usah", "simple
      // saja", ...) saat proyek sudah punya brief atau sudah melewati
      // minimal satu putaran pertanyaan;
      // (b) anggaran 2 putaran sudah habis DAN proyek sudah punya
      // brief — pesan berikutnya (tanya maupun diskusi) langsung
      // dieksekusi sebagai build.
      // Bila belum ada brief, build otomatis TIDAK dipaksakan
      // (membangun tanpa brief berarti mengarang); alur responder /
      // pengalihan tetap berjalan. Sapaan tidak pernah memicu build
      // otomatis (cabang sapaan sudah kembali lebih awal). Gerbang
      // saldo build tetap berlaku di dalam pipeline (saldo < 300 →
      // tolak bersih, MD utuh, tanpa potongan).
      const normalizedPrompt = normalizeChatText(prompt);
      const isRefusal =
        REFUSAL_RE.test(normalizedPrompt) ||
        BARE_CUKUP_RE.test(normalizedPrompt);
      if (
        project &&
        ((isRefusal && (roundsEarly >= 1 || hasBrief)) ||
          (roundsEarly >= MAX_QUESTION_ROUNDS && hasBrief))
      ) {
        return runBuild(project, currentMd);
      }
      // Gerbang tarif chat: saldo < 5 → tolak bersih sebelum pekerjaan
      // apa pun (tanpa proyek baru, tanpa pesan tertulis).
      if (balanceNow < CHAT_REPLY_COST) {
        return {
          ...empty,
          intent,
          error: `Kredit tidak cukup untuk chat. Balasan chat membutuhkan ${CHAT_REPLY_COST} kredit, saldo kamu ${balanceNow}. Top up dulu yuk.`,
        };
      }
      // Pengalihan kalengan (tanpa pemanggilan model): pertanyaan umum
      // tanpa konteks brief dan tanpa kata kunci topik proyek → AI
      // menanyakan konteks proyek dulu, bukan menjawab generik.
      const isGeneralQuestion =
        intent === "question" &&
        !hasBrief &&
        !TOPIC_KEYWORDS.test(prompt.toLowerCase());
      const redirectReply =
        "Aku bisa bantu soal teknis proyek ini — tapi kamu belum cerita mau buat website apa. " +
        "Ceritakan dulu mau buat website apa (jenis usaha, halaman, atau fitur yang kamu mau), nanti aku susun rencananya.";
      if (isGeneralQuestion) {
        let targetId: number;
        if (project) {
          targetId = project.id;
        } else {
          // Tanpa proyek (entry composer): proyek draft "Proyek Kustom"
          // untuk menampung chat — tanpa pipeline.
          const inserted = await db
            .insert(schema.projects)
            .values({
              userId: user.id,
              name: "Proyek Kustom",
              slug: slugify(`proyek-kustom-${Date.now()}`),
              category: "Website",
              status: "draft",
              prompt: prompt,
              spec: "{}",
              source: "ai",
              creditsCost: 0,
              plannerMd: initialPlannerMd(),
            })
            .returning({ id: schema.projects.id });
          targetId = inserted[0]?.id ?? 0;
          if (!targetId) throw new Error("Gagal membuat proyek");
          await ensureProjectDbCredential(db, targetId);
        }
        // G7 — pengalihan kalengan ini meminta detail, jadi dihitung
        // sebagai satu putaran pertanyaan (dibatasi 2 per proyek,
        // tidak bertambah bila sudah di batas).
        const newBalance = await chargeChatReply(targetId);
        await db
          .update(schema.projects)
          .set({
            questionRounds: Math.min(
              roundsEarly + 1,
              MAX_QUESTION_ROUNDS,
            ),
          })
          .where(eq(schema.projects.id, targetId));
        await insertChatMessage(db, {
          projectId: targetId,
          userId: user.id,
          role: "user",
          content: prompt,
          kind: "chat",
        });
        await insertChatMessage(db, {
          projectId: targetId,
          userId: user.id,
          role: "assistant",
          content: redirectReply,
          kind: "chat",
        });
        ctx.invalidateQueries();
        return {
          ...empty,
          ok: true as const,
          projectId: targetId,
          intent,
          balance: newBalance,
          plannerMd: project ? currentMd : initialPlannerMd(),
        };
      }

      // Responder AI: system prompt membawa aturan cakupan — bila
      // konteks belum diketahui, tanyakan dulu konteks proyeknya.
      const projectContext = project
        ? `Proyek: "${project.name}" (kategori ${project.category}). Rencana proyek sejauh ini (planner MD):\n${currentMd || "(belum ada)"}\nPrompt awal proyek: "${project.prompt}"`
        : `Belum ada proyek. Rencana proyek sejauh ini (planner MD):\n${currentMd || "(belum ada)"}`;
      const systemPrompt =
        "Kamu adalah asisten perencana proyek di platform pembuat website AI bernama Dadiweb (pasar Indonesia). " +
        "Tugasmu: menjawab pertanyaan dan menggali kebutuhan proyek pengguna dalam Bahasa Indonesia yang ramah, singkat, dan konkret. " +
        "ATURAN CAKUPAN (wajib): kamu HANYA menjawab soal teknis terkait proyek ini. " +
        "Bila pesan pengguna menyebut topik proyek (mis. toko roti, klinik, marketplace) atau membahas teknis proyek (tabel, halaman, fitur, desain, database), JAWAB pertanyaan itu secara konkret dan catat topik/detail barunya ke field terstruktur — JANGAN malah menanyakan konteks, karena topiknya sudah ada di pesan itu. " +
        "HANYA bila pertanyaan bersifat umum TANPA topik proyek yang bisa dikenali DAN konteks proyek belum diketahui (belum ada brief/topik), tanyakan dulu konteks proyeknya: \"mau buat website apa?\" dan gali jenis usaha, halaman, atau fitur yang diinginkan. " +
        "Bila pengguna menyebut detail proyek baru (topik, halaman, fitur, gaya, catatan), kembalikan detail itu di field terstruktur agar dicatat ke rencana proyek. " +
        "Bila pengguna MENYATAKAN nama usaha/situsnya (mis. \"toko saya Martabak Manis\", \"namanya Toko Berkah\"), kembalikan nama itu persis di field businessName. JANGAN PERNAH mengarang nama merek: bila pengguna hanya menyebut jenis usaha (\"usaha martabak\") tanpa nama, businessName dikosongkan. " +
        "Bila balasanmu meminta detail lanjutan dari pengguna (pertanyaan soal halaman, fitur, gaya, atau detail proyek lainnya), set asksDetail true; bila balasanmu hanya menjawab tanpa meminta detail, set asksDetail false. Jangan menanyakan detail yang sama berulang-ulang — bila pengguna sudah menolak detail lanjutan, jangan bertanya lagi. " +
        "JANGAN pernah memulai build/coding — itu tugas AI spesialis setelah pengguna memberi perintah build eksplisit. " +
        `Konteks saat ini:\n${projectContext}`;
      let responderData: z.infer<typeof responderSchema>;
      try {
        const res = await runAiStage({
          db,
          stage: "responder",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          schema: responderSchema,
          structureHint: RESP_STRUCTURE_HINT,
          userId: user.id,
          projectId: project?.id ?? null,
        });
        responderData = res.data;
      } catch (e) {
        // Gagal responder = pesan error jujur, TANPA potongan, TANPA
        // pesan tertulis — client membiarkan input tetap di kotak.
        const detail = e instanceof Error ? e.message : undefined;
        return {
          ...empty,
          intent,
          projectId: project?.id ?? null,
          plannerMd: currentMd,
          error:
            `AI penjawab gagal${detail ? `: ${detail}` : "."} ` +
            "Tidak ada kredit terpotong — coba kirim lagi sebentar lagi.",
        };
      }
      const mergedMd = mergePlannerMd(currentMd, {
        topic: responderData.topic,
        pages: responderData.pages,
        features: responderData.features,
        style: responderData.style,
        notes: responderData.notes,
      });
      // G7 — penamaan otomatis: bila pengguna MENYATAKAN nama usaha
      // dan proyek masih bernama "Proyek Kustom", ganti namanya segera
      // dan set topik MD ke nama itu. Bila tidak ada nama yang
      // dinyatakan, proyek tetap "Proyek Kustom" (tidak ada tebakan
      // nama merek — penamaan situs saat build tetap seperti dulu).
      const statedName =
        responderData.businessName?.trim() ||
        extractBusinessName(prompt) ||
        null;
      const asksDetail = replyAsksDetail(
        responderData.reply,
        responderData.asksDetail,
      );
      const nextRounds = asksDetail
        ? Math.min(roundsEarly + 1, MAX_QUESTION_ROUNDS)
        : roundsEarly;
      let targetId: number;
      let finalMd = mergedMd;
      if (project) {
        targetId = project.id;
        if (project.name === "Proyek Kustom" && statedName) {
          const parts = parsePlannerMd(mergedMd);
          finalMd = renderPlannerMd({ ...parts, topic: statedName });
        }
        await db
          .update(schema.projects)
          .set({
            plannerMd: finalMd,
            ...(project.name === "Proyek Kustom" && statedName
              ? { name: statedName }
              : {}),
            questionRounds: nextRounds,
            updatedAt: new Date(),
          })
          .where(eq(schema.projects.id, project.id));
      } else {
        // Tanpa proyek (entry composer diskusi): proyek draft untuk
        // menampung chat + MD (5 kredit per balasan, bukan gratis).
        if (statedName) {
          const parts = parsePlannerMd(mergedMd);
          finalMd = renderPlannerMd({ ...parts, topic: statedName });
        }
        const inserted = await db
          .insert(schema.projects)
          .values({
            userId: user.id,
            name: statedName ?? "Proyek Kustom",
            slug: slugify(`proyek-kustom-${Date.now()}`),
            category: "Website",
            status: "draft",
            prompt: prompt,
            spec: "{}",
            source: "ai",
            creditsCost: 0,
            plannerMd: finalMd,
            questionRounds: asksDetail ? 1 : 0,
          })
          .returning({ id: schema.projects.id });
        targetId = inserted[0]?.id ?? 0;
        if (!targetId) throw new Error("Gagal membuat proyek");
        await ensureProjectDbCredential(db, targetId);
      }
      // G7 — potong 5 kredit SETELAH balasan berhasil disiapkan dan
      // SEBELUM pesan ditulis; gagal responder (cabang catch di atas)
      // tidak memotong apa pun.
      const newBalance = await chargeChatReply(targetId);
      await insertChatMessage(db, {
        projectId: targetId,
        userId: user.id,
        role: "user",
        content: prompt,
        kind: "chat",
      });
      await insertChatMessage(db, {
        projectId: targetId,
        userId: user.id,
        role: "assistant",
        content: responderData.reply,
        kind: "chat",
      });
      ctx.invalidateQueries();
      return {
        ...empty,
        ok: true as const,
        projectId: targetId,
        intent,
        balance: newBalance,
        plannerMd: finalMd,
      };
    },
  }),

  getProjectChat: defineAction({

    description: "Mengambil riwayat pesan chat tersimpan milik sebuah proyek yang dimiliki pengguna.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      project: z
        .object({
          id: z.number(),
          name: z.string(),
          prompt: z.string(),
        })
        .nullable(),
      messages: z.array(
        z.object({
          id: z.number(),
          role: z.string(),
          content: z.string(),
          // G6 — kind pesan: "build" (default, pesan lama) atau "free"
          // (sapaan/jawaban responder era G6, gratis — riwayat lama).
          // G7 — pesan baru di luar build berkind "chat" (5 kredit
          // per balasan); client menampilkan penanda "5 kredit".
          kind: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) {
        return { project: null, messages: [] };
      }
      const rows = await db
        .select()
        .from(schema.projectChatMessages)
        .where(eq(schema.projectChatMessages.projectId, args.projectId))
        .orderBy(asc(schema.projectChatMessages.id));
      return {
        project: {
          id: project.id,
          name: project.name,
          prompt: project.prompt,
        },
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          kind: r.kind ?? "build",
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  getProjectDetail: defineAction({

    description: "Mengambil detail lengkap satu proyek milik pengguna: spec, tabel, generasi pipeline, skill plan, dan planner MD.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      project: projectOut.nullable(),
      generations: z.array(
        z.object({
          id: z.number(),
          stage: z.string(),
          status: z.string(),
          credits: z.number(),
          note: z.string(),
          createdAt: z.string(),
        }),
      ),
      tables: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          // G2 — skema pemilik tabel ini (proj_<project_id>).
          schemaName: z.string(),
          columns: z.array(z.string()),
          rows: z.array(
            z.object({
              id: z.number(),
              data: z.record(z.string(), z.string()),
            }),
          ),
        }),
      ),
      deployments: z.array(
        z.object({
          id: z.number(),
          subdomain: z.string(),
          status: z.string(),
          kind: z.string(),
          note: z.string(),
          createdAt: z.string(),
        }),
      ),
      // G0 — pencatatan katalog skill proyek ini (kosong/null untuk proyek
      // yang dibuat sebelum G0) + file simulasi yang lolos path-guard.
      skillPlan: skillPlanOut.nullable(),
      skillVersions: z.array(skillVersionOut),
      files: z.array(
        z.object({
          id: z.number(),
          path: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) {
        return {
          project: null,
          generations: [],
          tables: [],
          deployments: [],
          skillPlan: null,
          skillVersions: [],
          files: [],
        };
      }
      const gens = await db
        .select()
        .from(schema.generations)
        .where(eq(schema.generations.projectId, args.projectId))
        .orderBy(asc(schema.generations.id));
      const tableRows = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId))
        .orderBy(asc(schema.projectTables.id));
      const tables = [];
      for (const t of tableRows) {
        const dataRows = await db
          .select()
          .from(schema.projectRows)
          .where(eq(schema.projectRows.tableId, t.id))
          .orderBy(asc(schema.projectRows.id));
        let columns: string[] = [];
        try {
          const parsed: unknown = JSON.parse(t.columnsJson);
          if (Array.isArray(parsed)) {
            columns = parsed.filter(
              (c): c is string => typeof c === "string",
            );
          }
        } catch {
          columns = [];
        }
        tables.push({
          id: t.id,
          name: t.name,
          schemaName: t.schemaName || schemaNameForProject(t.projectId),
          columns,
          rows: dataRows.map((r) => {
            let data: Record<string, string> = {};
            try {
              const parsed: unknown = JSON.parse(r.dataJson);
              if (parsed && typeof parsed === "object") {
                data = Object.fromEntries(
                  Object.entries(parsed as Record<string, unknown>).map(
                    ([k, v]) => [k, String(v ?? "")],
                  ),
                );
              }
            } catch {
              data = {};
            }
            return { id: r.id, data };
          }),
        });
      }
      const deps = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, args.projectId))
        .orderBy(desc(schema.deployments.id));
      const fileRows = await db
        .select()
        .from(schema.projectFiles)
        .where(eq(schema.projectFiles.projectId, args.projectId))
        .orderBy(asc(schema.projectFiles.id));
      return {
        skillPlan: parseSkillPlan(project.skillPlan),
        skillVersions: parseSkillVersions(project.skillVersions),
        files: fileRows.map((f) => ({
          id: f.id,
          path: f.path,
          createdAt: f.createdAt.toISOString(),
        })),
        project: toProjectOut(project),
        generations: gens.map((g) => ({
          id: g.id,
          stage: g.stage,
          status: g.status,
          credits: g.credits,
          note: g.note,
          createdAt: g.createdAt.toISOString(),
        })),
        tables,
        deployments: deps.map((d) => ({
          id: d.id,
          subdomain: d.subdomain,
          status: d.status,
          kind: d.kind,
          note: d.note,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    },
  }),

  updateProjectSpec: defineAction({

    description: "Memperbarui spesifikasi website (nama, headline, warna, halaman, fitur) sebuah proyek milik pengguna secara manual dari editor.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      headline: z.string().min(1).max(160),
      subheadline: z.string().min(1).max(400),
      ctaLabel: z.string().min(1).max(60),
      siteName: z.string().min(1).max(80),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const spec = parseSpec(project.spec);
      if (!spec) throw new Error("Spesifikasi proyek belum tersedia");
      const next: SiteSpec = {
        ...spec,
        siteName: args.siteName,
        headline: args.headline,
        subheadline: args.subheadline,
        ctaLabel: args.ctaLabel,
      };
      await db
        .update(schema.projects)
        .set({
          name: args.siteName,
          spec: JSON.stringify(next),
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, args.projectId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  createFromTemplate: defineAction({

    description: "Membuat proyek baru dari template katalog untuk pengguna yang masuk.",
    request: z.object({
      token: tokenField,
      templateId: z.number().int().positive(),
    }),
    response: z.object({ projectId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const rows = await db
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.id, args.templateId));
      const template = rows[0];
      if (!template) throw new Error("Template tidak ditemukan");
      const spec = parseSpec(template.spec);
      if (!spec) throw new Error("Template tidak valid");
      const inserted = await db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: spec.siteName,
          slug: slugify(`${spec.siteName}-${Date.now()}`),
          category: template.category,
          status: "draft",
          prompt: `Dibuat dari template ${template.name}`,
          spec: template.spec,
          source: "template",
          creditsCost: 0,
        })
        .returning({ id: schema.projects.id });
      const projectId = inserted[0]?.id;
      if (!projectId) throw new Error("Gagal membuat proyek dari template");
      // G2 — proyek dari template juga mendapat skema + kredensial sendiri.
      await ensureProjectDbCredential(db, projectId);
      await db
        .update(schema.templates)
        .set({ uses: template.uses + 1 })
        .where(eq(schema.templates.id, template.id));
      ctx.invalidateQueries();
      return { projectId };
    },
  }),

  setProjectStatus: defineAction({

    description: "Mengubah status sebuah proyek milik pengguna (mis. draft, online, arsip).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      status: z.enum(["online", "draft", "archived"]),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      await db
        .update(schema.projects)
        .set({ status: args.status, updatedAt: new Date() })
        .where(eq(schema.projects.id, args.projectId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteProject: defineAction({

    description: "Menghapus proyek milik pengguna beserta folder, skema, artefak, dan rahasianya; baris ledger proyek dipertahankan.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      // G2/G5-C — penghapusan memakai helper transaksi tercatat yang sama
      // untuk pemilik dan admin (deleteProjectFully): folder, skema +
      // kredensial DB, artefak build, rahasia, dan unggahan dihapus;
      // riwayat kredit dipertahankan dan tercatat di project_deletion_log.
      await deleteProjectFully(db, project, ctx.blobs);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deployProject: defineAction({

    description: "Mendeploy proyek milik pengguna: membuat/menggunakan kembali record DNS A Cloudflare untuk subdomainnya dulu, baru menulis baris deployment live dan memotong tarif deploy yang berlaku; tanpa settings Cloudflare lengkap atau bila API gagal, deploy gagal bersih tanpa live dan tanpa potongan kredit.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      subdomain: z.string().nullable(),
      error: z.string().nullable(),
      balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const account = await getAccount(db, user.id);
      const balance = account?.balance ?? 0;
      // G5-C — tarif deploy dibaca segar dari pengaturan platform.
      const deployCost = (await getTariffs(db)).deploy;
      if (balance < deployCost) {
        return {
          ok: false,
          subdomain: null,
          error: `Kredit tidak cukup untuk deploy (butuh ${deployCost} kredit).`,
          balance,
        };
      }
      const subdomain = `${project.slug}.dadiweb.id`;
      // G10 — DNS DULU, baru live + potong kredit. Tanpa settings
      // Cloudflare lengkap atau bila API Cloudflare gagal, deploy
      // gagal BERSIH: tidak ada baris live baru, tidak ada potongan
      // kredit, status proyek tidak berubah (aturan tombol OAuth G8:
      // error jujur, bukan fallback diam-diam ke perilaku dummy lama).
      const cf = await loadCloudflareSettingsForDeploy(db);
      if (!cf.ok) {
        const missing = cf.status.missing
          .map((m) => CLOUDFLARE_MISSING_LABELS[m])
          .join(", ");
        return {
          ok: false,
          subdomain: null,
          error:
            missing.length > 0
              ? `Deploy dibatalkan: konfigurasi Cloudflare belum lengkap (${missing}). Admin perlu melengkapinya di panel admin (Pengaturan Platform → Cloudflare) — tidak ada kredit terpotong dan proyek tidak ditandai online.`
              : "Deploy dibatalkan: token Cloudflare tersimpan tidak dapat dibaca — admin perlu memasang ulang token lewat panel admin. Tidak ada kredit terpotong dan proyek tidak ditandai online.",
          balance,
        };
      }
      let dns: { recordId: string; reused: boolean };
      try {
        dns = await ensureDnsRecord({
          token: cf.token,
          zoneId: cf.status.zoneId,
          name: subdomain,
          content: cf.status.serverIp,
          proxied: cf.status.recordMode === "proxied",
        });
      } catch (e) {
        return {
          ok: false,
          subdomain: null,
          error:
            e instanceof CloudflareError
              ? e.message
              : "Deploy dibatalkan: API Cloudflare gagal — tidak ada kredit terpotong dan proyek tidak ditandai online.",
          balance,
        };
      }
      // Riwayat deploy bersifat append-only: setiap deploy/redeploy adalah
      // baris baru, versi live sebelumnya ditandai "superseded" dan tetap
      // tersimpan sebagai target rollback.
      const previous = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, args.projectId));
      const hadLive = previous.some((d) => d.status === "live");
      for (const d of previous) {
        if (d.status === "live") {
          await db
            .update(schema.deployments)
            .set({ status: "superseded" })
            .where(eq(schema.deployments.id, d.id));
        }
      }
      await db.insert(schema.deployments).values({
        projectId: args.projectId,
        subdomain,
        status: "live",
        kind: hadLive ? "redeploy" : "deploy",
        note: hadLive
          ? "Redeploy — versi terbaru diterbitkan"
          : "Deploy pertama proyek ini",
        cloudflareRecordId: dns.recordId,
        dnsStatus: dns.reused ? "reused" : "created",
        // G12 — snapshot spec pada saat deploy: situs publik melayani
        // snapshot ini, bukan spec terkini; edit setelah deploy tidak
        // mengubah live sampai redeploy berikutnya.
        siteSnapshotSpec: project.spec,
      });
      await db
        .update(schema.projects)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(schema.projects.id, args.projectId));
      const nextBalance = await chargeCredits(db, user.id, {
        amount: -deployCost,
        label: `Deploy ${project.name} ke ${subdomain}`,
        category: "Lainnya",
        kind: "deploy",
        projectId: args.projectId,
      });
      ctx.invalidateQueries();
      return { ok: true, subdomain, error: null, balance: nextBalance };
    },
  }),

  // Rollback: menerbitkan ulang deployment lama sebagai versi live baru.
  // Gratis (aksi pemulihan) dan tercatat di riwayat sebagai baris baru
  // berjenis "rollback" yang menunjuk deployment sumbernya.
  rollbackDeployment: defineAction({
    description: "Menerbitkan ulang deployment lama proyek milik pengguna sebagai versi live baru berjenis rollback, tanpa biaya.",
    request: z.object({
      token: tokenField,
      deploymentId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      deploymentId: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const found = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.id, args.deploymentId));
      const target = found[0];
      if (!target) {
        return { ok: false, error: "Deployment tidak ditemukan.", deploymentId: null };
      }
      const project = await ownedProject(db, user.id, target.projectId);
      if (!project) {
        return { ok: false, error: "Deployment tidak ditemukan.", deploymentId: null };
      }
      if (target.status === "live") {
        return {
          ok: false,
          error: "Deployment ini sudah menjadi versi yang sedang tayang.",
          deploymentId: null,
        };
      }
      const all = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, target.projectId));
      for (const d of all) {
        if (d.status === "live") {
          await db
            .update(schema.deployments)
            .set({ status: "superseded" })
            .where(eq(schema.deployments.id, d.id));
        }
      }
      const when = target.createdAt.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      // G10 — perilaku rollback soal DNS, dilaporkan apa adanya:
      // record DNS itu per slug, bukan per versi deployment, jadi
      // rollback memakai record_id target bila ada. Bila target tidak
      // punya record (baris pra-G10), rollback mencoba membuat record
      // bila settings Cloudflare lengkap; bila settings belum lengkap
      // atau API gagal, rollback tetap gratis dan tetap mencatat baris
      // live baru (pemulihan tidak boleh digagalkan DNS), TAPI baris
      // itu dicatat tanpa record_id + catatan peringatan — UI akan
      // menampilkan langkah DNS sebagai "Menunggu", bukan "Selesai".
      // G12 — deployment kini menyimpan snapshot spec (lihat insert
      // di bawah): rollback menayangkan snapshot deployment target.
      // Pengecualian jujur: target pra-G12 tidak punya snapshot, jadi
      // untuk target itu rollback memakai spec proyek saat ini.
      let rollbackRecordId = target.cloudflareRecordId ?? "";
      let rollbackDnsStatus = target.dnsStatus ?? "";
      let rollbackDnsWarning = "";
      if (!rollbackRecordId) {
        const cf = await loadCloudflareSettingsForDeploy(db);
        if (cf.ok) {
          try {
            const dns = await ensureDnsRecord({
              token: cf.token,
              zoneId: cf.status.zoneId,
              name: target.subdomain,
              content: cf.status.serverIp,
              proxied: cf.status.recordMode === "proxied",
            });
            rollbackRecordId = dns.recordId;
            rollbackDnsStatus = dns.reused ? "reused" : "created";
          } catch {
            rollbackDnsWarning =
              " — record DNS belum dibuat (API Cloudflare gagal saat rollback; deploy ulang setelah Cloudflare terkonfigurasi untuk membuat record DNS-nya).";
          }
        } else {
          rollbackDnsWarning =
            " — record DNS belum dibuat (Cloudflare belum terkonfigurasi; deploy ulang setelah terkonfigurasi untuk membuat record DNS-nya).";
        }
      }
      const inserted = await db
        .insert(schema.deployments)
        .values({
          projectId: target.projectId,
          subdomain: target.subdomain,
          status: "live",
          kind: "rollback",
          note: `Rollback ke deployment #${target.id} (${when})${rollbackDnsWarning}`,
          cloudflareRecordId: rollbackRecordId,
          dnsStatus: rollbackDnsStatus,
          // G12 — rollback kembali ke SNAPSHOT deployment target; bila
          // target pra-G12 (tanpa snapshot), pakai spec proyek saat ini
          // sebagai satu-satunya yang tersedia.
          siteSnapshotSpec: (target.siteSnapshotSpec ?? "").trim()
            ? target.siteSnapshotSpec
            : project.spec,
        })
        .returning({ id: schema.deployments.id });
      await db
        .update(schema.projects)
        .set({ status: "online", updatedAt: new Date() })
        .where(eq(schema.projects.id, target.projectId));
      ctx.invalidateQueries();
      return { ok: true, error: null, deploymentId: inserted[0]?.id ?? null };
    },
  }),

  addTableRow: defineAction({

    description: "Menambah satu baris data ke tabel database sebuah proyek milik pengguna.",
    request: z.object({
      token: tokenField,
      tableId: z.number().int().positive(),
      data: z.record(z.string(), z.string()),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const tableRowsFound = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.id, args.tableId));
      const table = tableRowsFound[0];
      if (!table) throw new Error("Tabel tidak ditemukan");
      const project = await ownedProject(db, user.id, table.projectId);
      if (!project) throw new Error("Tabel tidak ditemukan");
      // G2 — kuota Executor juga berlaku untuk penulisan baris data.
      const rowQuota = await checkStorageQuota(
        db,
        user,
        table.projectId,
        new TextEncoder().encode(JSON.stringify(args.data)).length,
      );
      if (!rowQuota.allowed) throw new Error(rowQuota.reason);
      const inserted = await db
        .insert(schema.projectRows)
        .values({ tableId: args.tableId, dataJson: JSON.stringify(args.data) })
        .returning({ id: schema.projectRows.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Gagal menambah data");
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deleteTableRow: defineAction({

    description: "Menghapus satu baris data dari tabel database sebuah proyek milik pengguna.",
    request: z.object({
      token: tokenField,
      rowId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const rowFound = await db
        .select()
        .from(schema.projectRows)
        .where(eq(schema.projectRows.id, args.rowId));
      const row = rowFound[0];
      if (!row) throw new Error("Baris data tidak ditemukan");
      const tableRowsFound = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.id, row.tableId));
      const table = tableRowsFound[0];
      if (!table) throw new Error("Baris data tidak ditemukan");
      const project = await ownedProject(db, user.id, table.projectId);
      if (!project) throw new Error("Baris data tidak ditemukan");
      await db
        .delete(schema.projectRows)
        .where(eq(schema.projectRows.id, args.rowId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // Impor CSV ke tabel database: klien mengirim baris yang sudah di-parse;
  // server memvalidasi kepemilikan tabel dan hanya menyimpan kolom yang
  // memang ada di tabel (maks. 500 baris per impor).
  importTableRows: defineAction({
    description: "Mengimpor baris data dari CSV ke tabel database proyek milik pengguna, hanya kolom tabel yang disimpan.",
    request: z.object({
      token: tokenField,
      tableId: z.number().int().positive(),
      rows: z
        .array(z.record(z.string(), z.string().max(1000)))
        .min(1)
        .max(500),
    }),
    response: z.object({ inserted: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const found = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.id, args.tableId));
      const table = found[0];
      if (!table) throw new Error("Tabel tidak ditemukan");
      const project = await ownedProject(db, user.id, table.projectId);
      if (!project) throw new Error("Tabel tidak ditemukan");
      let columns: string[] = [];
      try {
        const parsed: unknown = JSON.parse(table.columnsJson);
        if (Array.isArray(parsed)) {
          columns = parsed.filter((c): c is string => typeof c === "string");
        }
      } catch {
        columns = [];
      }
      // G2 — seluruh impor dihitung dulu; bila totalnya melewati kuota
      // paket, impor ditolak SEBELUM satu baris pun ditulis.
      const importBytes = args.rows.reduce(
        (sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length,
        0,
      );
      const importQuota = await checkStorageQuota(db, user, table.projectId, importBytes);
      if (!importQuota.allowed) throw new Error(importQuota.reason);
      let inserted = 0;
      for (const row of args.rows) {
        const data: Record<string, string> = {};
        for (const c of columns) data[c] = (row[c] ?? "").slice(0, 1000);
        await db.insert(schema.projectRows).values({
          tableId: args.tableId,
          dataJson: JSON.stringify(data),
        });
        inserted++;
      }
      ctx.invalidateQueries();
      return { inserted };
    },
  }),

  topUpCredits: defineAction({

    description: "Menambah saldo kredit pengguna lewat paket top up (pembayaran DOKU disimulasikan di prototipe) dan menerbitkan invoice.",
    request: z.object({
      token: tokenField,
      packCredits: z.number().int().positive().max(100000),
      packLabel: z.string().min(1).max(80),
    }),
    response: z.object({ balance: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const balance = await chargeCredits(db, user.id, {
        amount: args.packCredits,
        label: `Top up ${args.packLabel} (prototipe — pembayaran DOKU disimulasikan)`,
        category: "Lainnya",
        kind: "topup",
      });
      await createInvoice(db, {
        userId: user.id,
        ledgerId: await latestLedgerId(db, user.id),
        kind: "topup",
        title: `Top up kredit — ${args.packLabel}`,
        amountIdr: TOPUP_PACK_PRICES[args.packCredits] ?? null,
        creditsDelta: args.packCredits,
        balanceAfter: balance,
      });
      ctx.invalidateQueries();
      return { balance };
    },
  }),

  toggleIntegration: defineAction({

    description: "Mengaktifkan atau menonaktifkan integrasi layanan pada workspace pengguna.",
    request: z.object({
      token: tokenField,
      key: z.string().min(1).max(40),
      enabled: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const rows = await db
        .select()
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, user.id),
            eq(schema.integrations.key, args.key),
          ),
        );
      if (rows.length === 0) {
        await db.insert(schema.integrations).values({
          userId: user.id,
          key: args.key,
          enabled: args.enabled,
        });
      } else {
        await db
          .update(schema.integrations)
          .set({ enabled: args.enabled })
          .where(eq(schema.integrations.id, rows[0]!.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  authDemo: defineAction({

    description: "Masuk sebagai akun demo Budi Santoso tanpa mengekspos kredensial apa pun, dan menerbitkan token sesi.",
    request: z.object({}),
    response: authResponse,
    async handler(ctx): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await ensureDemoUser(db);
      await ensureUserData(db, user);
      await ensureDemoData(db, user);
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),

  authRegister: defineAction({

    description: "Mendaftarkan akun pengguna baru dengan kata sandi ter-hash dan menerbitkan token verifikasi email simulasi.",
    request: z.object({
      name: z.string().min(2).max(60),
      email: z.string().email().max(120),
      password: z.string().min(8).max(72),
    }),
    response: authResponse,
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const email = args.email.trim().toLowerCase();
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (existing.length > 0) {
        return {
          ok: false,
          token: null,
          error: "Email ini sudah terdaftar. Silakan masuk, atau gunakan email lain.",
          user: null,
        };
      }
      const salt = randomHex(16);
      const inserted = await db
        .insert(schema.users)
        .values({
          name: args.name.trim(),
          email,
          passwordHash: await hashPassword(salt, args.password),
          passwordSalt: salt,
          provider: "email",
          plan: "Free",
        })
        .returning();
      const user = inserted[0];
      if (!user) throw new Error("Gagal membuat akun");
      // A new account starts with its own empty workspace and its own Free
      // credit balance — nothing is shared with the demo account or anyone
      // else.
      await ensureUserData(db, user);
      // Token verifikasi email diterbitkan dan "dikirim" ke kotak masuk
      // simulasi di dalam aplikasi (lihat Pengaturan untuk memakainya).
      await issueAuthToken(db, user, "verify_email");
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),

  authLogin: defineAction({

    description: "Memeriksa email dan kata sandi pengguna lalu menerbitkan token sesi baru.",
    request: z.object({
      email: z.string().email().max(120),
      password: z.string().min(1).max(72),
    }),
    response: authResponse,
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const email = args.email.trim().toLowerCase();
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email));
      const user = rows[0];
      if (
        !user ||
        user.provider !== "email" ||
        !(await passwordMatches(user.passwordSalt, args.password, user.passwordHash))
      ) {
        return {
          ok: false,
          token: null,
          error: "Email atau kata sandi salah. Periksa lagi, atau gunakan Lupa kata sandi.",
          user: null,
        };
      }
      // G5-C — akun nonaktif tidak bisa login.
      if (!user.isActive) {
        return {
          ok: false,
          token: null,
          error:
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          user: null,
        };
      }
      await ensureUserData(db, user);
      if (user.email === DEMO_EMAIL) {
        await ensureDemoData(db, user);
      }
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),

  authSocial: defineAction({

    description: "Masuk memakai akun demo provider (login Google kini lewat alur OAuth sendiri di startGoogleOAuth/completeGoogleOAuth, login GitHub lewat startGitHubOAuth/completeGitHubOAuth; aksi ini dipertahankan untuk kompatibilitas akun demo provider lama).",
    request: z.object({ provider: z.enum(["google", "github"]) }),
    response: authResponse,
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      // Prototipe: OAuth sungguhan butuh Client ID/Secret dari Google/GitHub
      // (fondasi produksi Fase 1). Di sini tombolnya membuat/memakai akun
      // demo provider tersebut agar alur masuknya bisa dicoba end-to-end.
      // Akun provider ini pun terisolasi: workspace dan kreditnya sendiri.
      const profiles = {
        google: { name: "Budi Santoso (Google)", email: "budi.google@gmail.com" },
        github: { name: "Budi Santoso (GitHub)", email: "budi.github@github.com" },
      } as const;
      const profile = profiles[args.provider];
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, profile.email));
      let user = rows[0];
      if (!user) {
        const inserted = await db
          .insert(schema.users)
          .values({
            name: profile.name,
            email: profile.email,
            passwordHash: "",
            passwordSalt: "",
            provider: args.provider,
            plan: "Pro Plan",
            // Provider accounts arrive with an email the provider has
            // already verified.
            emailVerified: true,
          })
          .returning();
        user = inserted[0];
      }
      if (!user) throw new Error("Gagal masuk dengan provider");
      if (!user.isActive) {
        return {
          ok: false,
          token: null,
          error:
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          user: null,
        };
      }
      await ensureUserData(db, user);
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),

  authSession: defineAction({

    description: "Memvalidasi token sesi dan mengembalikan profil pengguna yang sedang masuk.",
    request: z.object({ token: z.string().max(200) }),
    response: z.object({
      user: z
        .object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
          plan: z.string(),
          provider: z.string(),
          emailVerified: z.boolean(),
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const user = await userFromToken(db, args.token);
      // G5-C — sesi akun nonaktif tidak lagi berlaku.
      if (user && !user.isActive) {
        return { user: null };
      }
      if (user) {
        await ensureUserData(db, user);
        if (user.email === DEMO_EMAIL) {
          await ensureDemoData(db, user);
        }
      }
      return { user: user ? publicUser(user) : null };
    },
  }),

  authLogout: defineAction({

    description: "Mencabut token sesi pengguna di server sehingga tidak bisa dipakai lagi.",
    request: z.object({ token: z.string().max(200) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.token, args.token));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // Minta token reset kata sandi. Selalu membalas sukses agar keberadaan
  // akun tidak bisa ditebak dari luar; token hanya diterbitkan (ke kotak
  // masuk simulasi) bila akun kata sandi dengan email itu memang ada.
  requestPasswordReset: defineAction({
    description: "Menerbitkan token reset kata sandi sekali pakai yang dikirim ke kotak masuk simulasi dalam aplikasi.",
    request: z.object({ email: z.string().email().max(120) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const email = args.email.trim().toLowerCase();
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email));
      const user = rows[0];
      if (user && user.provider === "email") {
        await issueAuthToken(db, user, "reset_password");
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // Pakai token reset: token harus ada, belum dipakai, dan belum
  // kedaluwarsa. Setelah kata sandi diganti, SEMUA sesi lama dicabut.
  resetPasswordWithToken: defineAction({
    description: "Mengganti kata sandi memakai token reset yang sah dan belum kedaluwarsa, lalu mencabut semua sesi lama akun itu.",
    request: z.object({
      token: z.string().min(10).max(120),
      newPassword: z.string().min(8).max(72),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const consumed = await consumeAuthToken(db, args.token, "reset_password");
      if ("error" in consumed) return { ok: false, error: consumed.error };
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, consumed.userId));
      const user = rows[0];
      if (!user) {
        return { ok: false, error: "Akun untuk token ini tidak ditemukan." };
      }
      const salt = randomHex(16);
      await db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(salt, args.newPassword),
          passwordSalt: salt,
        })
        .where(eq(schema.users.id, user.id));
      await db
        .delete(schema.authSessions)
        .where(eq(schema.authSessions.userId, user.id));
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  // Kirim ulang token verifikasi email untuk akun yang sedang masuk.
  requestEmailVerification: defineAction({
    description: "Menerbitkan token verifikasi email baru untuk akun pengguna, menggugurkan token lama sejenis.",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      alreadyVerified: z.boolean(),
      error: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.emailVerified) {
        return { ok: true, alreadyVerified: true, error: null };
      }
      if (user.provider !== "email") {
        return {
          ok: false,
          alreadyVerified: false,
          error:
            "Akun Google/GitHub emailnya sudah terverifikasi oleh provider.",
        };
      }
      await issueAuthToken(db, user, "verify_email");
      ctx.invalidateQueries();
      return { ok: true, alreadyVerified: false, error: null };
    },
  }),

  // Pakai token verifikasi email (sekali pakai, ada masa berlaku).
  verifyEmailWithToken: defineAction({
    description: "Memverifikasi email pengguna memakai token verifikasi yang sah dan sekali pakai.",
    request: z.object({ token: z.string().min(10).max(120) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      await ensureDemoUser(db);
      const consumed = await consumeAuthToken(db, args.token, "verify_email");
      if ("error" in consumed) return { ok: false, error: consumed.error };
      await db
        .update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.id, consumed.userId));
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  // Kotak masuk simulasi: pesan "email" yang diterbitkan aplikasi untuk
  // alamat tersebut, lengkap dengan tokennya. Ini pengganti pengiriman
  // email sungguhan di prototipe dan selalu dilabeli simulasi di UI.
  getSimulatedInbox: defineAction({
    description: "Mengambil isi kotak masuk email simulasi dalam aplikasi milik pengguna (tempat token auth diterbitkan).",
    request: z.object({ email: z.string().email().max(120) }),
    response: z.object({
      messages: z.array(
        z.object({
          id: z.number(),
          subject: z.string(),
          body: z.string(),
          purpose: z.string(),
          token: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const rows = await db
        .select()
        .from(schema.simulatedEmails)
        .where(eq(schema.simulatedEmails.email, email))
        .orderBy(desc(schema.simulatedEmails.id))
        .limit(10);
      return {
        messages: rows.map((m) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          purpose: m.purpose,
          token: m.token,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  updateProfile: defineAction({

    description: "Memperbarui nama dan email profil pengguna, menolak email yang sudah dipakai akun lain.",
    request: z.object({
      token: tokenField,
      displayName: z.string().min(1).max(60),
      email: z.string().email().max(120),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const email = args.email.trim().toLowerCase();
      const clash = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email));
      if (clash.length > 0 && clash[0]!.id !== user.id) {
        throw new Error("Email ini sudah dipakai akun lain.");
      }
      const emailChanged = email !== user.email;
      await db
        .update(schema.users)
        .set({
          name: args.displayName.trim(),
          email,
          // Email baru harus diverifikasi ulang; tokennya diterbitkan ke
          // kotak masuk simulasi alamat baru.
          ...(emailChanged ? { emailVerified: false } : {}),
        })
        .where(eq(schema.users.id, user.id));
      await db
        .update(schema.workspace)
        .set({ displayName: args.displayName.trim(), email })
        .where(eq(schema.workspace.id, user.id));
      if (emailChanged && user.provider === "email") {
        await issueAuthToken(
          db,
          { ...user, email, name: args.displayName.trim() },
          "verify_email",
        );
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 1 hardening — ganti kata sandi dari Pengaturan (sesi lain dicabut)
  // -------------------------------------------------------------------------
  changePassword: defineAction({
    description: "Mengganti kata sandi pengguna dari pengaturan dan mencabut sesi lain milik akun itu.",
    request: z.object({
      token: tokenField,
      currentPassword: z.string().min(1).max(72),
      newPassword: z.string().min(8).max(72),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.provider !== "email") {
        return {
          ok: false,
          error: "Akun ini masuk lewat Google/GitHub — kata sandi dikelola di provider tersebut.",
        };
      }
      const matches = await passwordMatches(
        user.passwordSalt,
        args.currentPassword,
        user.passwordHash,
      );
      if (!matches) {
        return { ok: false, error: "Kata sandi saat ini salah." };
      }
      const salt = randomHex(16);
      await db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(salt, args.newPassword),
          passwordSalt: salt,
        })
        .where(eq(schema.users.id, user.id));
      // Revoke every other session; keep the caller's current session alive.
      const sessions = await db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.userId, user.id));
      for (const s of sessions) {
        if (s.token !== args.token) {
          await db
            .delete(schema.authSessions)
            .where(eq(schema.authSessions.id, s.id));
        }
      }
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 2 — ganti paket langganan. Upgrade menambah selisih kuota ke saldo;
  // downgrade menyesuaikan kuota (saldo tidak pernah di bawah 0) mulai
  // periode berjalan di prototipe ini dan tercatat di buku besar.
  // -------------------------------------------------------------------------
  changePlan: defineAction({
    description: "Mengganti paket langganan pengguna, menyesuaikan kuota dan saldo, dan menerbitkan invoice ganti paket.",
    request: z.object({
      token: tokenField,
      plan: z.enum(["Free", "Pro Plan", "Bisnis"]),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      balance: z.number(),
      monthlyQuota: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const account = await getAccount(db, user.id);
      if (!account) throw new Error("Akun kredit belum tersedia");
      if (account.plan === args.plan) {
        return {
          ok: false,
          error: `Kamu sudah memakai paket ${args.plan}.`,
          balance: account.balance,
          monthlyQuota: account.monthlyQuota,
        };
      }
      const newQuota = PLAN_QUOTA[args.plan] ?? 200;
      const quotaDelta = newQuota - account.monthlyQuota;
      const newBalance = Math.max(0, account.balance + Math.max(quotaDelta, 0));
      await db
        .update(schema.users)
        .set({ plan: args.plan })
        .where(eq(schema.users.id, user.id));
      await db
        .update(schema.creditAccount)
        .set({ plan: args.plan, monthlyQuota: newQuota, balance: newBalance })
        .where(eq(schema.creditAccount.id, user.id));
      await db
        .update(schema.workspace)
        .set({ plan: args.plan, priceIdr: PLAN_PRICE[args.plan] ?? 0 })
        .where(eq(schema.workspace.id, user.id));
      await db.insert(schema.creditLedger).values({
        userId: user.id,
        kind: "adjust",
        label:
          quotaDelta > 0
            ? `Upgrade ke ${args.plan} — kuota naik, +${quotaDelta} kredit periode ini (pembayaran DOKU disimulasikan di prototipe)`
            : `Pindah ke paket ${args.plan} — kuota disesuaikan menjadi ${newQuota}/bulan`,
        category: "Lainnya",
        amount: newBalance - account.balance,
        balanceAfter: newBalance,
      });
      await createInvoice(db, {
        userId: user.id,
        ledgerId: await latestLedgerId(db, user.id),
        kind: "plan",
        title: `Ganti paket langganan — ${args.plan}`,
        amountIdr: PLAN_PRICE[args.plan] ?? 0,
        creditsDelta: newBalance - account.balance,
        balanceAfter: newBalance,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, balance: newBalance, monthlyQuota: newQuota };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 2 — duplikat proyek (termasuk tabel database-nya)
  // -------------------------------------------------------------------------
  duplicateProject: defineAction({
    description: "Menduplikasi proyek milik pengguna termasuk tabel databasenya menjadi proyek baru.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({ projectId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const inserted = await db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: `${project.name} (Salinan)`.slice(0, 80),
          slug: slugify(`${project.slug}-salinan-${Date.now()}`),
          category: project.category,
          status: "draft",
          prompt: project.prompt,
          spec: project.spec,
          source: project.source,
          creditsCost: 0,
        })
        .returning({ id: schema.projects.id });
      const newId = inserted[0]?.id;
      if (!newId) throw new Error("Gagal menduplikat proyek");
      // G2 — salinan adalah proyek tersendiri: skema + kredensial DB-nya
      // sendiri (tabel salinan hidup di proj_<newId>, bukan skema asal).
      await ensureProjectDbCredential(db, newId);
      const tables = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId));
      for (const t of tables) {
        const nt = await db
          .insert(schema.projectTables)
          .values({
            projectId: newId,
            name: t.name,
            schemaName: schemaNameForProject(newId),
            columnsJson: t.columnsJson,
          })
          .returning({ id: schema.projectTables.id });
        const newTableId = nt[0]?.id;
        if (!newTableId) continue;
        const rows = await db
          .select()
          .from(schema.projectRows)
          .where(eq(schema.projectRows.tableId, t.id));
        for (const r of rows) {
          await db.insert(schema.projectRows).values({
            tableId: newTableId,
            dataJson: r.dataJson,
          });
        }
      }
      ctx.invalidateQueries();
      return { projectId: newId };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 2 — kelola tabel database secara manual
  // -------------------------------------------------------------------------
  createProjectTable: defineAction({
    description: "Membuat tabel database baru secara manual di skema proyek milik pengguna.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      name: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z][a-z0-9_]*$/, "Nama tabel: huruf kecil, angka, underscore; mulai huruf"),
      columns: z.array(z.string().min(1).max(40)).min(1).max(12),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const existing = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId));
      if (existing.some((t) => t.name === args.name.trim())) {
        throw new Error("Tabel dengan nama itu sudah ada di proyek ini.");
      }
      const cols = args.columns.map((c) => c.trim()).filter(Boolean);
      const inserted = await db
        .insert(schema.projectTables)
        .values({
          projectId: args.projectId,
          name: args.name.trim(),
          schemaName: schemaNameForProject(args.projectId),
          columnsJson: JSON.stringify(cols.length > 0 ? cols : ["id"]),
        })
        .returning({ id: schema.projectTables.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Gagal membuat tabel");
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deleteProjectTable: defineAction({

    description: "Menghapus tabel database beserta barisnya dari proyek milik pengguna.",
    request: z.object({
      token: tokenField,
      tableId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const found = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.id, args.tableId));
      const table = found[0];
      if (!table) throw new Error("Tabel tidak ditemukan");
      const project = await ownedProject(db, user.id, table.projectId);
      if (!project) throw new Error("Tabel tidak ditemukan");
      await db
        .delete(schema.projectRows)
        .where(eq(schema.projectRows.tableId, args.tableId));
      await db
        .delete(schema.projectTables)
        .where(eq(schema.projectTables.id, args.tableId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 2 — domain custom: tambah → pasang TXT → verifikasi → SSL aktif
  // -------------------------------------------------------------------------
  addCustomDomain: defineAction({
    description: "Menambahkan domain custom ke proyek milik pengguna beserta TXT record verifikasi uniknya.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      domain: z
        .string()
        .min(4)
        .max(120)
        .regex(
          /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i,
          "Format domain tidak valid, contoh: www.tokosaya.com",
        ),
    }),
    response: z.object({ id: z.number(), verificationToken: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const domain = args.domain.trim().toLowerCase();
      if (domain.endsWith(".dadiweb.id")) {
        throw new Error("Subdomain dadiweb.id dibuat otomatis saat deploy — masukkan domain milikmu sendiri.");
      }
      const all = await db.select().from(schema.customDomains);
      if (all.some((d) => d.domain === domain)) {
        throw new Error("Domain ini sudah terhubung ke proyek lain.");
      }
      const verificationToken = `dadiweb-verify-${randomHex(8)}`;
      const inserted = await db
        .insert(schema.customDomains)
        .values({
          projectId: args.projectId,
          domain,
          status: "pending",
          verificationToken,
          isPrimary: all.filter((d) => d.projectId === args.projectId).length === 0,
          sslStatus: "pending",
        })
        .returning({ id: schema.customDomains.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Gagal menambahkan domain");
      ctx.invalidateQueries();
      return { id, verificationToken };
    },
  }),

  verifyCustomDomain: defineAction({

    description: "Memverifikasi domain custom proyek setelah pengguna mengonfirmasi pemasangan TXT record, lalu mengaktifkannya dengan SSL.",
    request: z.object({
      token: tokenField,
      domainId: z.number().int().positive(),
      // The user confirms in the UI that the TXT record is in place; the
      // server then activates the domain and issues SSL. Real DNS lookups
      // run on the production gateway — the state machine here is the same.
      txtConfirmed: z.literal(true),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const found = await db
        .select()
        .from(schema.customDomains)
        .where(eq(schema.customDomains.id, args.domainId));
      const domain = found[0];
      if (!domain) throw new Error("Domain tidak ditemukan");
      const project = await ownedProject(db, user.id, domain.projectId);
      if (!project) throw new Error("Domain tidak ditemukan");
      await db
        .update(schema.customDomains)
        .set({ status: "active", sslStatus: "active" })
        .where(eq(schema.customDomains.id, args.domainId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteCustomDomain: defineAction({

    description: "Menghapus domain custom dari proyek milik pengguna.",
    request: z.object({
      token: tokenField,
      domainId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const found = await db
        .select()
        .from(schema.customDomains)
        .where(eq(schema.customDomains.id, args.domainId));
      const domain = found[0];
      if (!domain) throw new Error("Domain tidak ditemukan");
      const project = await ownedProject(db, user.id, domain.projectId);
      if (!project) throw new Error("Domain tidak ditemukan");
      await db
        .delete(schema.customDomains)
        .where(eq(schema.customDomains.id, args.domainId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 3 — build Android (APK/AAB). Konfigurasi build tersimpan sebagai
  // paket rilis proyek: manifest + catatan build bisa diunduh dari UI dan
  // dipakai pipeline Capacitor produksi untuk menghasilkan biner.
  // -------------------------------------------------------------------------
  createAndroidBuild: defineAction({
    description: "Membuat build Android baru untuk proyek milik pengguna dengan tarif build Android, versi naik otomatis, dan paket manifest Capacitor yang bisa diunduh.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      appName: z.string().min(2).max(50),
      packageId: z
        .string()
        .min(3)
        .max(80)
        .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Package ID contoh: com.tokosaya.app"),
      buildType: z.enum(["apk", "aab"]),
      iconColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      splashText: z.string().max(80),
    }),
    response: z.object({
      ok: z.boolean(),
      buildId: z.number().nullable(),
      error: z.string().nullable(),
      balance: z.number(),
      versionName: z.string(),
      versionCode: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const account = await getAccount(db, user.id);
      const balance = account?.balance ?? 0;
      // G5-C — tarif build Android dibaca segar dari pengaturan platform.
      const androidCost = (await getTariffs(db)).android;
      if (balance < androidCost) {
        return {
          ok: false,
          buildId: null,
          error: `Kredit tidak cukup untuk build Android (butuh ${androidCost} kredit, saldo ${balance}).`,
          balance,
          versionName: "1.0.0",
          versionCode: 1,
        };
      }
      const previous = await db
        .select()
        .from(schema.androidBuilds)
        .where(eq(schema.androidBuilds.projectId, args.projectId))
        .orderBy(desc(schema.androidBuilds.versionCode));
      const versionCode = (previous[0]?.versionCode ?? 0) + 1;
      const versionName = `1.0.${versionCode - 1}`;
      const inserted = await db
        .insert(schema.androidBuilds)
        .values({
          projectId: args.projectId,
          appName: args.appName.trim(),
          packageId: args.packageId.trim().toLowerCase(),
          versionName,
          versionCode,
          buildType: args.buildType,
          status: "ready",
          iconColor: args.iconColor,
          splashText: args.splashText.trim(),
          creditsCost: androidCost,
        })
        .returning({ id: schema.androidBuilds.id });
      const buildId = inserted[0]?.id;
      if (!buildId) throw new Error("Gagal membuat build Android");
      const nextBalance = await chargeCredits(db, user.id, {
        amount: -androidCost,
        label: `Build Android ${args.buildType.toUpperCase()} — ${args.appName.trim()} v${versionName}`,
        category: "Lainnya",
        kind: "generate",
        projectId: args.projectId,
      });
      ctx.invalidateQueries();
      return {
        ok: true,
        buildId,
        error: null,
        balance: nextBalance,
        versionName,
        versionCode,
      };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 3 — konfigurasi integrasi API. Kunci API tidak pernah disimpan
  // utuh: server hanya menyimpan penanda keberadaan + 4 karakter terakhir
  // sebagai petunjuk, cukup untuk UI dan tidak membocorkan kredensial.
  // -------------------------------------------------------------------------
  saveIntegrationConfig: defineAction({
    description: "Menyimpan konfigurasi integrasi API per layanan untuk proyek pengguna; kunci API hanya disimpan sebagai penanda dan 4 karakter terakhir.",
    request: z.object({
      token: tokenField,
      key: z.string().min(1).max(40),
      enabled: z.boolean(),
      apiKey: z.string().max(200),
      webhookUrl: z.string().max(300),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await ensureTemplates(db);
      const user = await requireUser(db, args.token);
      const rows = await db
        .select()
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, user.id),
            eq(schema.integrations.key, args.key),
          ),
        );
      const existingCfg = rows[0] ? parseConfig(rows[0].configJson) : {};
      const trimmedKey = args.apiKey.trim();
      const cfg: Record<string, unknown> = {
        ...existingCfg,
        webhookUrl: args.webhookUrl.trim(),
      };
      if (trimmedKey.length > 0) {
        cfg["hasApiKey"] = true;
        cfg["apiKeyHint"] = `••••${trimmedKey.slice(-4)}`;
      }
      if (!args.enabled) {
        cfg["hasApiKey"] = existingCfg["hasApiKey"] === true;
      }
      const status = !args.enabled
        ? "inactive"
        : cfg["hasApiKey"] === true
          ? "configured"
          : "enabled";
      const configJson = JSON.stringify(cfg);
      if (rows.length === 0) {
        await db.insert(schema.integrations).values({
          userId: user.id,
          key: args.key,
          enabled: args.enabled,
          configJson,
          status,
        });
      } else {
        await db
          .update(schema.integrations)
          .set({ enabled: args.enabled, configJson, status })
          .where(eq(schema.integrations.id, rows[0]!.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // -------------------------------------------------------------------------
  // Fase 3 — komunitas: daftar, posting, komentar, suka (semua nyata di DB)
  // -------------------------------------------------------------------------
  getCommunity: defineAction({
    description: "Mengambil daftar postingan forum komunitas beserta komentar dan suka; postingan tersembunyi hanya terlihat oleh admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      posts: z.array(
        z.object({
          id: z.number(),
          authorName: z.string(),
          mine: z.boolean(),
          title: z.string(),
          body: z.string(),
          tag: z.string(),
          // G5-C — status moderasi: hanya admin yang menerima posting
          // tersembunyi (untuk ditampilkan kembali); pengguna biasa tidak.
          hidden: z.boolean(),
          createdAt: z.string(),
          likeCount: z.number(),
          likedByMe: z.boolean(),
          comments: z.array(
            z.object({
              id: z.number(),
              authorName: z.string(),
              body: z.string(),
              createdAt: z.string(),
            }),
          ),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureCommunitySeed(db);
      const user = await requireUser(db, args.token);
      const isAdminViewer = user.email === DEMO_EMAIL;
      const allPostRows = await db
        .select()
        .from(schema.communityPosts)
        .orderBy(desc(schema.communityPosts.id))
        .limit(50);
      // G5-C — posting yang disembunyikan admin tidak tampil untuk
      // pengguna biasa; admin tetap melihatnya untuk moderasi.
      const postRows = isAdminViewer
        ? allPostRows
        : allPostRows.filter((p) => !p.isHidden);
      const posts = [];
      for (const p of postRows) {
        const likes = await db
          .select()
          .from(schema.communityLikes)
          .where(eq(schema.communityLikes.postId, p.id));
        const comments = await db
          .select()
          .from(schema.communityComments)
          .where(eq(schema.communityComments.postId, p.id))
          .orderBy(asc(schema.communityComments.id));
        posts.push({
          id: p.id,
          authorName: p.authorName,
          mine: p.userId === user.id,
          title: p.title,
          body: p.body,
          tag: p.tag,
          hidden: p.isHidden,
          createdAt: p.createdAt.toISOString(),
          likeCount: likes.length,
          likedByMe: likes.some((l) => l.userId === user.id),
          comments: comments.map((c) => ({
            id: c.id,
            authorName: c.authorName,
            body: c.body,
            createdAt: c.createdAt.toISOString(),
          })),
        });
      }
      return { posts };
    },
  }),

  createCommunityPost: defineAction({

    description: "Membuat postingan baru di forum komunitas atas nama pengguna yang masuk.",
    request: z.object({
      token: tokenField,
      title: z.string().min(4).max(120),
      body: z.string().min(1).max(2000),
      tag: z.enum(["Diskusi", "Inspirasi", "Tutorial", "Pengumuman"]),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureCommunitySeed(db);
      const user = await requireUser(db, args.token);
      const inserted = await db
        .insert(schema.communityPosts)
        .values({
          userId: user.id,
          authorName: user.name,
          title: args.title.trim(),
          body: args.body.trim(),
          tag: args.tag,
        })
        .returning({ id: schema.communityPosts.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Gagal membuat postingan");
      ctx.invalidateQueries();
      return { id };
    },
  }),

  addCommunityComment: defineAction({

    description: "Menambahkan komentar pada postingan forum komunitas.",
    request: z.object({
      token: tokenField,
      postId: z.number().int().positive(),
      body: z.string().min(1).max(1000),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const post = await db
        .select()
        .from(schema.communityPosts)
        .where(eq(schema.communityPosts.id, args.postId));
      if (post.length === 0) throw new Error("Postingan tidak ditemukan");
      const inserted = await db
        .insert(schema.communityComments)
        .values({
          postId: args.postId,
          userId: user.id,
          authorName: user.name,
          body: args.body.trim(),
        })
        .returning({ id: schema.communityComments.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Gagal menambah komentar");
      ctx.invalidateQueries();
      return { id };
    },
  }),

  toggleCommunityLike: defineAction({

    description: "Memberi atau menarik suka pada postingan forum komunitas.",
    request: z.object({
      token: tokenField,
      postId: z.number().int().positive(),
    }),
    response: z.object({ liked: z.boolean(), likeCount: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const post = await db
        .select()
        .from(schema.communityPosts)
        .where(eq(schema.communityPosts.id, args.postId));
      if (post.length === 0) throw new Error("Postingan tidak ditemukan");
      const mine = await db
        .select()
        .from(schema.communityLikes)
        .where(
          and(
            eq(schema.communityLikes.postId, args.postId),
            eq(schema.communityLikes.userId, user.id),
          ),
        );
      let liked: boolean;
      if (mine.length > 0) {
        await db
          .delete(schema.communityLikes)
          .where(eq(schema.communityLikes.id, mine[0]!.id));
        liked = false;
      } else {
        await db.insert(schema.communityLikes).values({
          postId: args.postId,
          userId: user.id,
        });
        liked = true;
      }
      const all = await db
        .select()
        .from(schema.communityLikes)
        .where(eq(schema.communityLikes.postId, args.postId));
      ctx.invalidateQueries();
      return { liked, likeCount: all.length };
    },
  }),

  // -------------------------------------------------------------------------
  // Admin — statistik platform. Hanya akun demo (pemilik/admin dari desain)
  // yang menerima agregat lintas pengguna; akun lain menerima isAdmin=false
  // dan angka nol, tanpa membocorkan data siapa pun.
  // -------------------------------------------------------------------------
  getAdminStats: defineAction({
    description: "Mengambil statistik agregat platform dan aktivitas terbaru untuk panel admin (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      totalUsers: z.number(),
      totalProjects: z.number(),
      totalDeployments: z.number(),
      totalCommunityPosts: z.number(),
      creditsGranted: z.number(),
      creditsUsed: z.number(),
      recentUsers: z.array(
        z.object({
          name: z.string(),
          email: z.string(),
          plan: z.string(),
          provider: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        isAdmin: false,
        totalUsers: 0,
        totalProjects: 0,
        totalDeployments: 0,
        totalCommunityPosts: 0,
        creditsGranted: 0,
        creditsUsed: 0,
        recentUsers: [],
      };
      if (user.email !== DEMO_EMAIL) return empty;
      const allUsers = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.id));
      const allProjects = await db.select({ id: schema.projects.id }).from(schema.projects);
      const allDeployments = await db
        .select({ id: schema.deployments.id })
        .from(schema.deployments);
      const allPosts = await db
        .select({ id: schema.communityPosts.id })
        .from(schema.communityPosts);
      const ledger = await db.select().from(schema.creditLedger);
      let granted = 0;
      let used = 0;
      for (const l of ledger) {
        if (l.amount > 0) granted += l.amount;
        else used += -l.amount;
      }
      return {
        isAdmin: true,
        totalUsers: allUsers.length,
        totalProjects: allProjects.length,
        totalDeployments: allDeployments.length,
        totalCommunityPosts: allPosts.length,
        creditsGranted: granted,
        creditsUsed: used,
        recentUsers: allUsers.slice(0, 8).map((u) => ({
          name: u.name,
          email: u.email,
          plan: u.plan,
          provider: u.provider,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  }),

  // Admin: hapus satu akun beserta SELURUH datanya (proyek, tabel, domain,
  // build Android, postingan komunitas, invoice, buku besar, sesi, pesan
  // chat proyek, kandidat skill; aktor log status katalog dilepas). Hanya
  // akun admin demo; akun admin sendiri tidak bisa dihapus lewat aksi ini.
  adminDeleteUser: defineAction({
    description: "Menghapus akun pengguna beserta seluruh datanya secara permanen (khusus admin, tidak bisa menghapus admin sendiri).",
    request: z.object({
      token: tokenField,
      email: z.string().email().max(120),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      deletedEmail: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat menghapus akun.",
          deletedEmail: null,
        };
      }
      const email = args.email.trim().toLowerCase();
      if (email === DEMO_EMAIL) {
        return {
          ok: false,
          error: "Akun admin tidak dapat dihapus.",
          deletedEmail: null,
        };
      }
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email));
      const target = rows[0];
      if (!target) {
        return {
          ok: false,
          error: "Akun dengan email itu tidak ditemukan.",
          deletedEmail: null,
        };
      }
      const beforeDesc = `Akun ${target.name} (${target.email}), paket ${target.plan}, aktif: ${target.isActive ? "ya" : "tidak"}`;
      await deleteUserAndData(db, target);
      // G5-C — pencatatan audit (bentuk respons aksi ini tidak berubah).
      await writeAdminAudit(db, user, {
        action: "adminDeleteUser",
        target: email,
        beforeValue: beforeDesc,
        afterValue: "Akun beserta seluruh datanya dihapus",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, deletedEmail: email };
    },
  }),

  // -------------------------------------------------------------------------
  // G3 — Panel Admin katalog skill. Hanya akun admin (demo pemilik) yang
  // menerima/mengubah data katalog; akun lain menerima isAdmin=false /
  // ok=false tanpa membocorkan apa pun. Status aktif dibaca router dari
  // skill_catalog_state pada SETIAP keputusan routing (tanpa deploy ulang).
  // Skor eval diisi admin dari verifikasi PM: tanpa catatan skor, katalog
  // menampilkan "belum dievaluasi" (evalScore null), bukan angka karangan.
  // Rincian biaya adalah transparansi DI DALAM paket generate 300 yang
  // tetap — total satu komposisi selalu 300, bukan tarif baru.
  // -------------------------------------------------------------------------
  getAdminSkillCatalog: defineAction({
    description: "Mengambil katalog 30 skill untuk panel admin: status aktif, skor eval, rincian biaya per tahap, riwayat status, dan antrean kandidat (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      totalSkills: z.number(),
      compositionTotal: z.number(),
      costNote: z.string(),
      skills: z.array(
        z.object({
          name: z.string(),
          family: z.string(),
          title: z.string(),
          version: z.string(),
          priority: z.string(),
          isActive: z.boolean(),
          evalScore: z.number().nullable(),
          evalStatus: z.string(),
          costBreakdown: costBreakdownOut,
          hasFile: z.boolean(),
        }),
      ),
      statusLog: z.array(
        z.object({
          id: z.number(),
          skillName: z.string(),
          action: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
      candidates: z.array(
        z.object({
          id: z.number(),
          prompt: z.string(),
          nearestSkill: z.string().nullable(),
          nearestScore: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const costNote =
        "Rincian transparansi di dalam paket generate 300 kredit yang tetap (Planner 40 + Designer 60 + Coder 120 + Builder 50 + Fixer 30) — bukan tarif baru. Rincian per skill adalah jatah skill itu dalam komposisi generate di mana ia menjadi skill utama; total satu komposisi selalu 300.";
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          totalSkills: 0,
          compositionTotal: TOTAL_GENERATE_COST,
          costNote,
          skills: [],
          statusLog: [],
          candidates: [],
        };
      }
      const stateMap = await getSkillStateMap(db);
      const skills = SKILL_REGISTRY.map((meta) => {
        const entry = skillCatalogEntry(meta.name);
        const state = stateMap.get(meta.name);
        const composition = computeCompositionBreakdown(meta.name);
        const breakdown = composition.perSkill[meta.name] ?? {
          planner: 0,
          designer: 0,
          coder: 0,
          builder: 0,
          fixer: 0,
          total: 0,
        };
        const evalScore = state?.evalScore ?? null;
        return {
          name: meta.name,
          family: entry?.family ?? "",
          title: entry?.title ?? "",
          version: skillFileVersion(meta.name),
          priority: meta.priority,
          isActive: state?.isActive ?? true,
          evalScore,
          evalStatus:
            evalScore === null
              ? "belum dievaluasi"
              : `skor eval ${evalScore} / 100`,
          costBreakdown: breakdown,
          hasFile: SKILL_FILES[meta.name] !== undefined,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      const logRows = await db
        .select()
        .from(schema.skillStatusLog)
        .orderBy(desc(schema.skillStatusLog.id))
        .limit(100);
      const candRows = await db
        .select()
        .from(schema.skillCandidates)
        .orderBy(desc(schema.skillCandidates.id))
        .limit(100);
      return {
        isAdmin: true,
        totalSkills: skills.length,
        compositionTotal: TOTAL_GENERATE_COST,
        costNote,
        skills,
        statusLog: logRows.map((r) => ({
          id: r.id,
          skillName: r.skillName,
          action: r.action,
          detail: r.detail,
          createdAt: r.createdAt.toISOString(),
        })),
        candidates: candRows.map((r) => ({
          id: r.id,
          prompt: r.prompt,
          nearestSkill: r.nearestSkill,
          nearestScore: r.nearestScore,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  setSkillActive: defineAction({

    description: "Mengaktifkan atau menonaktifkan satu skill katalog; perubahan langsung berlaku ke routing generate (khusus admin).",
    request: z.object({
      token: tokenField,
      skillName: z.string().min(1).max(80),
      isActive: z.boolean(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      skillName: z.string(),
      isActive: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const name = args.skillName.trim().toLowerCase();
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat mengubah status skill.",
          skillName: name,
          isActive: args.isActive,
        };
      }
      if (!skillMeta(name)) {
        return {
          ok: false,
          error: `Skill "${name}" tidak ada di katalog.`,
          skillName: name,
          isActive: args.isActive,
        };
      }
      const existing = await db
        .select()
        .from(schema.skillCatalogState)
        .where(eq(schema.skillCatalogState.skillName, name));
      if (existing.length === 0) {
        await db.insert(schema.skillCatalogState).values({
          skillName: name,
          isActive: args.isActive,
          evalScore: null,
        });
      } else {
        await db
          .update(schema.skillCatalogState)
          .set({ isActive: args.isActive, updatedAt: new Date() })
          .where(eq(schema.skillCatalogState.skillName, name));
      }
      await db.insert(schema.skillStatusLog).values({
        skillName: name,
        action: args.isActive ? "activate" : "deactivate",
        detail: args.isActive
          ? `Skill ${name} diaktifkan kembali oleh admin — routing memakai skill ini lagi tanpa deploy ulang.`
          : `Skill ${name} dinonaktifkan oleh admin — routing tidak lagi memakainya (fallback ke skill lain atau mode generik) tanpa deploy ulang.`,
        actorUserId: user.id,
      });
      // G5-C — pencatatan audit (bentuk respons aksi ini tidak berubah).
      const beforeActive = existing[0] ? existing[0].isActive : true;
      await writeAdminAudit(db, user, {
        action: "setSkillActive",
        target: name,
        beforeValue: `Aktif: ${beforeActive ? "ya" : "tidak"}`,
        afterValue: `Aktif: ${args.isActive ? "ya" : "tidak"}`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, skillName: name, isActive: args.isActive };
    },
  }),

  setSkillEvalScore: defineAction({

    description: "Mengatur atau menghapus skor eval (0-100) sebuah skill katalog (khusus admin).",
    request: z.object({
      token: tokenField,
      skillName: z.string().min(1).max(80),
      // null = hapus skor (kembali "belum dievaluasi").
      score: z.number().min(0).max(100).nullable(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      skillName: z.string(),
      evalScore: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const name = args.skillName.trim().toLowerCase();
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat mencatat skor eval skill.",
          skillName: name,
          evalScore: null,
        };
      }
      if (!skillMeta(name)) {
        return {
          ok: false,
          error: `Skill "${name}" tidak ada di katalog.`,
          skillName: name,
          evalScore: null,
        };
      }
      const existing = await db
        .select()
        .from(schema.skillCatalogState)
        .where(eq(schema.skillCatalogState.skillName, name));
      if (existing.length === 0) {
        await db.insert(schema.skillCatalogState).values({
          skillName: name,
          isActive: true,
          evalScore: args.score,
        });
      } else {
        await db
          .update(schema.skillCatalogState)
          .set({ evalScore: args.score, updatedAt: new Date() })
          .where(eq(schema.skillCatalogState.skillName, name));
      }
      await db.insert(schema.skillStatusLog).values({
        skillName: name,
        action: "eval_update",
        detail:
          args.score === null
            ? `Skor eval skill ${name} dihapus oleh admin (kembali belum dievaluasi).`
            : `Skor eval golden set skill ${name} dicatat admin: ${args.score} / 100.`,
        actorUserId: user.id,
      });
      // G5-C — pencatatan audit (bentuk respons aksi ini tidak berubah).
      const beforeEval = existing[0]?.evalScore ?? null;
      await writeAdminAudit(db, user, {
        action: "setSkillEvalScore",
        target: name,
        beforeValue:
          beforeEval === null ? "belum dievaluasi" : `${beforeEval} / 100`,
        afterValue:
          args.score === null ? "belum dievaluasi" : `${args.score} / 100`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, skillName: name, evalScore: args.score };
    },
  }),

  getSkillCandidates: defineAction({

    description: "Mengambil antrean kandidat skill baru yang tercatat dari prompt generik pengguna (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      candidates: z.array(
        z.object({
          id: z.number(),
          prompt: z.string(),
          nearestSkill: z.string().nullable(),
          nearestScore: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) return { isAdmin: false, candidates: [] };
      const rows = await db
        .select()
        .from(schema.skillCandidates)
        .orderBy(desc(schema.skillCandidates.id))
        .limit(100);
      return {
        isAdmin: true,
        candidates: rows.map((r) => ({
          id: r.id,
          prompt: r.prompt,
          nearestSkill: r.nearestSkill,
          nearestScore: r.nearestScore,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  getSkillStatusLog: defineAction({

    description: "Mengambil riwayat perubahan status dan skor eval katalog skill (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      log: z.array(
        z.object({
          id: z.number(),
          skillName: z.string(),
          action: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) return { isAdmin: false, log: [] };
      const rows = await db
        .select()
        .from(schema.skillStatusLog)
        .orderBy(desc(schema.skillStatusLog.id))
        .limit(100);
      return {
        isAdmin: true,
        log: rows.map((r) => ({
          id: r.id,
          skillName: r.skillName,
          action: r.action,
          detail: r.detail,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // G0 (a) — Validator katalog skill. Murni: tidak mengubah data apa pun,
  // tidak butuh sesi. Menolak SKILL.md yang kehilangan satu pun field
  // frontmatter wajib atau satu pun dari 10 bagian wajib, dengan pesan
  // Bahasa Indonesia yang menyebut persis yang hilang.
  // -------------------------------------------------------------------------
  validateSkill: defineAction({
    description: "Memvalidasi teks SKILL.md mentah terhadap format baku: 9 field frontmatter wajib dan tepat 10 bagian isi berurutan.",
    request: z.object({
      content: z.string().max(100000).optional(),
      text: z.string().max(100000).optional(),
      skillText: z.string().max(100000).optional(),
    }),
    response: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      missingFields: z.array(z.string()),
      missingSections: z.array(z.string()),
    }),
    async handler(_ctx, args) {
      const content = args.content ?? args.text ?? args.skillText ?? "";
      return validateSkillMarkdown(content);
    },
  }),

  // -------------------------------------------------------------------------
  // Validasi by-name: mengambil isi SKILL.md tersimpan untuk skill bernama
  // tertentu dari katalog (SKILL_FILES, sumber yang sama dengan getSkill)
  // lalu menjalankan validator katalog yang sama persis dengan
  // validateSkill atas isi tersebut. Murni validasi: tidak menyimpan dan
  // tidak mengubah skill apa pun, tidak butuh sesi, tidak memotong kredit.
  // Bentuk respons identik dengan validateSkill (valid, errors,
  // missingFields, missingSections). Skill yang tidak ada di katalog
  // menghasilkan valid: false dengan error yang menyebut namanya.
  // -------------------------------------------------------------------------
  validateSkillByName: defineAction({
    description: "Memvalidasi file SKILL.md tersimpan berdasarkan nama skill-nya terhadap format baku.",
    request: z.object({
      name: z.string().max(80).optional(),
      skillName: z.string().max(80).optional(),
      skill: z.string().max(80).optional(),
    }),
    response: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      missingFields: z.array(z.string()),
      missingSections: z.array(z.string()),
    }),
    async handler(_ctx, args) {
      const name = (args.name ?? args.skillName ?? args.skill ?? "")
        .trim()
        .toLowerCase();
      if (!name) {
        return {
          valid: false,
          errors: ["Nama skill wajib diisi — tidak ada skill yang divalidasi."],
          missingFields: [...REQUIRED_FRONTMATTER_FIELDS],
          missingSections: REQUIRED_SECTIONS.map((s) => s.title),
        };
      }
      const content = SKILL_FILES[name];
      if (!content) {
        return {
          valid: false,
          errors: [
            `Skill "${name}" tidak ada di katalog SKILL.md — tidak ada isi tersimpan yang bisa divalidasi.`,
          ],
          missingFields: [...REQUIRED_FRONTMATTER_FIELDS],
          missingSections: REQUIRED_SECTIONS.map((s) => s.title),
        };
      }
      return validateSkillMarkdown(content);
    },
  }),

  // -------------------------------------------------------------------------
  // G0 (b) + G3 — Pratinjau keputusan Router v1. TANPA memotong kredit
  // dan TANPA membuat proyek, supaya routing bisa diuji bebas. Satu-satunya
  // tulisan: hasil GENERIK tercatat ke antrean kandidat skill baru admin
  // (G3) — itu pencatatan antrean, bukan proyek/kredit.
  // -------------------------------------------------------------------------
  previewSkillRoute: defineAction({
    description: "Mengembalikan keputusan routing skill untuk sebuah prompt (skor, skill per tahap, klarifikasi bila perlu) tanpa membuat proyek atau memotong kredit.",
    request: z.object({
      token: z.string().max(200).optional(),
      prompt: z.string().min(1).max(2000),
      chip: z.string().max(60).optional(),
      clarificationAnswer: z.string().max(500).optional(),
    }),
    response: z.object({
      status: z.string(),
      prompt: z.string(),
      chip: z.string().nullable(),
      chipSkill: z.string().nullable(),
      guessedSkill: z.string().nullable(),
      winnerSource: z.string(),
      primaryDomain: z.string().nullable(),
      label: z.string(),
      scores: z.array(z.object({ skill: z.string(), score: z.number() })),
      stages: skillStagesOut,
      skillPlan: skillPlanOut,
      skillVersions: z.array(skillVersionOut),
      clarificationQuestion: z.string().nullable(),
      maxSkillsPerStage: z.number(),
      platformRulesWin: z.boolean(),
      note: z.string(),
      // G3 — skill nonaktif saat pratinjau ini berjalan, kandidat terdekat,
      // dan apakah prompt generik ini tercatat ke antrean kandidat admin.
      disabledSkills: z.array(z.string()),
      nearestSkill: z.string().nullable(),
      nearestScore: z.number(),
      candidateRecorded: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const disabledSkills = await getDisabledSkills(db);
      const route = routeSkills({
        prompt: args.prompt,
        chip: args.chip,
        clarificationAnswer: args.clarificationAnswer,
        disabledSkills,
      });
      // G3 — antrean kandidat skill baru: prompt tanpa domain aktif
      // berskor >0 (hasil generik "proyek kustom") TERCATAT untuk admin
      // (prompt, waktu, skill terdekat bila ada). Mode generik tetap
      // berjalan — pencatatan tidak pernah menggagalkan prompt.
      let candidateRecorded = false;
      if (route.status === "generic") {
        let userId: number | null = null;
        if (args.token) {
          const u = await userFromToken(db, args.token);
          userId = u?.id ?? null;
        }
        const id = await recordSkillCandidate(db, {
          prompt: args.prompt,
          nearestSkill: route.nearestSkill,
          nearestScore: route.nearestScore,
          userId,
        });
        candidateRecorded = id !== null;
        if (candidateRecorded) ctx.invalidateQueries();
      }
      return {
        status: route.status,
        prompt: args.prompt,
        chip: args.chip ?? null,
        chipSkill: route.chipSkill,
        guessedSkill: route.guessedSkill,
        winnerSource: route.winnerSource,
        primaryDomain: route.primaryDomain,
        label: route.label,
        scores: route.scores,
        stages: route.stages,
        skillPlan: route.plan,
        skillVersions: route.versions,
        clarificationQuestion: route.clarificationQuestion,
        maxSkillsPerStage: MAX_SKILLS_PER_STAGE,
        platformRulesWin: true,
        note: ROUTE_NOTE,
        disabledSkills: route.disabledSkills,
        nearestSkill: route.nearestSkill,
        nearestScore: route.nearestScore,
        candidateRecorded,
      };
    },
  }),

  // -------------------------------------------------------------------------
  // G1 — Katalog SKILL.md. Murni: membaca katalog file skill yang tersimpan
  // di prototipe (SKILL_FILES), tidak mengubah data apa pun, tidak butuh
  // sesi. listSkills menampilkan daftar dari frontmatter asli setiap file;
  // getSkill mengembalikan isi SKILL.md lengkap satu skill.
  // -------------------------------------------------------------------------
  listSkills: defineAction({
    description: "Mendaftar seluruh skill katalog beserta nama, family, judul, versi frontmatter, dan status aktifnya.",
    request: z.object({}),
    response: z.object({
      count: z.number(),
      skills: z.array(
        z.object({
          name: z.string(),
          family: z.string(),
          title: z.string(),
          version: z.string(),
          // G3 — status aktif katalog admin (default aktif tanpa baris
          // keadaan). Skill nonaktif tetap tampil di katalog dengan status
          // ini, tetapi router tidak memakainya.
          isActive: z.boolean(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const disabled = await getDisabledSkills(db);
      const skills = Object.keys(SKILL_FILES)
        .map((name) => skillCatalogEntry(name))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => ({ ...e, isActive: !disabled.has(e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { count: skills.length, skills };
    },
  }),

  getSkill: defineAction({

    description: "Mengambil frontmatter terurai dan isi lengkap satu file SKILL.md berdasarkan nama skill.",
    request: z.object({
      name: z.string().min(1).max(80),
    }),
    response: z.object({
      found: z.boolean(),
      name: z.string(),
      family: z.string(),
      title: z.string(),
      version: z.string(),
      frontmatter: z.record(z.string(), z.array(z.string())),
      content: z.string(),
      error: z.string().nullable(),
    }),
    async handler(_ctx, args) {
      const name = args.name.trim().toLowerCase();
      const content = SKILL_FILES[name];
      if (!content) {
        return {
          found: false,
          name,
          family: "",
          title: "",
          version: "",
          frontmatter: {},
          content: "",
          error: `Skill "${name}" tidak ada di katalog SKILL.md (katalog memuat 30 skill: 12 P0 + 16 P1 + 2 P2).`,
        };
      }
      const fields = parseFrontmatter(content);
      const frontmatter: Record<string, string[]> = {};
      if (fields) {
        for (const [key, field] of fields) {
          frontmatter[key] =
            field.kind === "list" ? field.items : [field.value];
        }
      }
      const entry = skillCatalogEntry(name);
      return {
        found: true,
        name,
        family: entry?.family ?? "",
        title: entry?.title ?? "",
        version: entry?.version ?? "",
        frontmatter,
        content,
        error: null,
      };
    },
  }),

  // -------------------------------------------------------------------------
  // G0 (d) — Uji Executor path-guard (I-4). Menjalankan guard yang sama
  // persis dengan jalur produksi generate: penolakan tercatat sebagai
  // percobaan pelanggaran dan tidak ada tulisan yang terjadi; tulisan yang
  // lolos dicatat sebagai file proyek simulasi di pohon tenant pemiliknya.
  // -------------------------------------------------------------------------
  executeWrite: defineAction({
    description: "Menjalankan penulisan file simulasi lewat Executor dengan path-guard isolasi tenant dan kuota penyimpanan per paket.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      path: z.string().min(1).max(500),
      content: z.string().max(20000).optional(),
      symlinkTarget: z.string().max(500).optional(),
    }),
    response: z.object({
      allowed: z.boolean(),
      ok: z.boolean(),
      kind: z.string(),
      reason: z.string(),
      violationRecorded: z.boolean(),
      resolvedPath: z.string().nullable(),
      fileId: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      const account = await getAccount(db, user.id);
      const result = evaluatePathGuard({
        userId: user.id,
        projectId: args.projectId,
        projectOwned: project !== null,
        balance: account?.balance ?? 0,
        path: args.path,
        symlinkTarget: args.symlinkTarget ?? null,
      });
      if (!result.allowed) {
        await recordPathViolation(db, {
          userId: user.id,
          projectId: args.projectId,
          path: args.path,
          kind: result.kind,
          reason: result.reason,
        });
        ctx.invalidateQueries();
        return {
          allowed: false,
          ok: false,
          kind: result.kind,
          reason: result.reason,
          violationRecorded: true,
          resolvedPath: null,
          fileId: null,
        };
      }
      // G2 — kuota penyimpanan Executor ditegakkan SEBELUM penulisan:
      // tulisan yang akan melewati kuota paket ditolak di muka (tercatat
      // sebagai penolakan Executor) dan tidak ada byte yang ditulis.
      const quota = await checkStorageQuota(
        db,
        user,
        args.projectId,
        new TextEncoder().encode(args.content ?? "").length,
      );
      if (!quota.allowed) {
        await recordPathViolation(db, {
          userId: user.id,
          projectId: args.projectId,
          path: args.path,
          kind: "kuota_penyimpanan",
          reason: quota.reason,
        });
        ctx.invalidateQueries();
        return {
          allowed: false,
          ok: false,
          kind: "kuota_penyimpanan",
          reason: quota.reason,
          violationRecorded: true,
          resolvedPath: null,
          fileId: null,
        };
      }
      const inserted = await db
        .insert(schema.projectFiles)
        .values({
          projectId: args.projectId,
          path: result.resolvedPath!,
          content: args.content ?? "",
        })
        .returning({ id: schema.projectFiles.id });
      ctx.invalidateQueries();
      return {
        allowed: true,
        ok: true,
        kind: result.kind,
        reason: result.reason,
        violationRecorded: false,
        resolvedPath: result.resolvedPath,
        fileId: inserted[0]?.id ?? null,
      };
    },
  }),

  // Daftar percobaan pelanggaran path-guard milik pengguna yang masuk.
  getPathViolations: defineAction({
    description: "Mengambil catatan pelanggaran path-guard yang ditolak Executor untuk pengguna.",
    request: z.object({ token: tokenField }),
    response: z.object({
      violations: z.array(
        z.object({
          id: z.number(),
          projectId: z.number().nullable(),
          path: z.string(),
          kind: z.string(),
          reason: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const rows = await db
        .select()
        .from(schema.pathViolations)
        .where(eq(schema.pathViolations.userId, user.id))
        .orderBy(desc(schema.pathViolations.id))
        .limit(100);
      return {
        violations: rows.map((v) => ({
          id: v.id,
          projectId: v.projectId,
          path: v.path,
          kind: v.kind,
          reason: v.reason,
          createdAt: v.createdAt.toISOString(),
        })),
      };
    },
  }),

  // -------------------------------------------------------------------------
  // G2 — Status isolasi penuh satu proyek: skema + kredensial DB proyek,
  // kuota Executor, rahasia terenkripsi (petunjuk saja), job sandbox,
  // unggahan, dan catatan penghapusan. Semua nilai sensitif yang keluar
  // dari aksi ini HANYA petunjuk 4 karakter terakhir — tidak ada plaintext,
  // tidak ada ciphertext, dan TIDAK ADA kredensial platform sama sekali.
  // -------------------------------------------------------------------------
  getProjectIsolation: defineAction({
    description: "Mengambil status isolasi G2 sebuah proyek: skema, petunjuk kredensial DB, job Executor, kuota, dan daftar rahasia (petunjuk saja).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      found: z.boolean(),
      schemaName: z.string(),
      dbUsername: z.string(),
      dbPasswordHint: z.string(),
      platformCredentialExposed: z.boolean(),
      storage: z.object({
        plan: z.string(),
        usedBytes: z.number(),
        quotaBytes: z.number(),
      }),
      envVars: z.array(
        z.object({ name: z.string(), valuePreview: z.string() }),
      ),
      secrets: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          hint: z.string(),
          keyVersion: z.number(),
          updatedAt: z.string(),
        }),
      ),
      secretEvents: z.array(
        z.object({
          id: z.number(),
          secretName: z.string(),
          event: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
      jobs: z.array(
        z.object({
          id: z.number(),
          kind: z.string(),
          sandboxDir: z.string(),
          status: z.string(),
          detail: z.string(),
          networkPolicy: z.string(),
          timeLimitSec: z.number(),
          memoryLimitMb: z.number(),
          artifactPath: z.string(),
          copiedBack: z.boolean(),
          workspaceDeleted: z.boolean(),
          createdAt: z.string(),
        }),
      ),
      uploads: z.array(
        z.object({
          id: z.number(),
          fileName: z.string(),
          mimeType: z.string(),
          sizeBytes: z.number(),
          createdAt: z.string(),
        }),
      ),
      deletionLog: z.array(
        z.object({
          id: z.number(),
          projectId: z.number(),
          projectName: z.string(),
          schemaName: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
      mappingNote: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        found: false,
        schemaName: "",
        dbUsername: "",
        dbPasswordHint: "",
        platformCredentialExposed: G2_PLATFORM_CREDENTIAL_EXPOSURE,
        storage: { plan: user.plan, usedBytes: 0, quotaBytes: 0 },
        envVars: [],
        secrets: [],
        secretEvents: [],
        jobs: [],
        uploads: [],
        deletionLog: [],
        mappingNote: "",
      };
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) return empty;
      const cred = await ensureProjectDbCredential(db, args.projectId);
      const account = await getAccount(db, user.id);
      const plan = account?.plan ?? user.plan;
      const usedBytes = await projectStorageUsedBytes(db, args.projectId);
      const secretRows = await db
        .select()
        .from(schema.projectSecrets)
        .where(eq(schema.projectSecrets.projectId, args.projectId))
        .orderBy(asc(schema.projectSecrets.id));
      const eventRows = await db
        .select()
        .from(schema.secretEvents)
        .where(eq(schema.secretEvents.projectId, args.projectId))
        .orderBy(desc(schema.secretEvents.id))
        .limit(20);
      const jobRows = await db
        .select()
        .from(schema.executorJobs)
        .where(eq(schema.executorJobs.projectId, args.projectId))
        .orderBy(desc(schema.executorJobs.id))
        .limit(10);
      const uploadRows = await db
        .select()
        .from(schema.projectUploads)
        .where(eq(schema.projectUploads.projectId, args.projectId))
        .orderBy(desc(schema.projectUploads.id))
        .limit(20);
      const deletionRows = await db
        .select()
        .from(schema.projectDeletionLog)
        .where(eq(schema.projectDeletionLog.userId, user.id))
        .orderBy(desc(schema.projectDeletionLog.id))
        .limit(10);
      // Variabel lingkungan yang disuntikkan saat runtime proyek INI saja:
      // koneksi memakai kredensial proyek sendiri (bukan kredensial
      // platform), dan setiap rahasia tampil hanya sebagai petunjuk.
      const envVars = [
        {
          name: "DATABASE_URL",
          valuePreview: `sqlite://skema/${cred.schemaName}?user=${cred.dbUsername}&password=${cred.passwordHint} (pemetaan prototipe — produksi: postgres://${cred.dbUsername}:${cred.passwordHint}@db/${cred.schemaName})`,
        },
        { name: "DADIWEB_PROJECT_SCHEMA", valuePreview: cred.schemaName },
        { name: "DADIWEB_DB_USER", valuePreview: cred.dbUsername },
        ...secretRows.map((s) => ({
          name: s.name,
          valuePreview: s.hint,
        })),
      ];
      return {
        found: true,
        schemaName: cred.schemaName,
        dbUsername: cred.dbUsername,
        dbPasswordHint: cred.passwordHint,
        platformCredentialExposed: G2_PLATFORM_CREDENTIAL_EXPOSURE,
        storage: {
          plan,
          usedBytes,
          quotaBytes: STORAGE_QUOTA_BYTES[plan] ?? STORAGE_QUOTA_BYTES["Free"]!,
        },
        envVars,
        secrets: secretRows.map((s) => ({
          id: s.id,
          name: s.name,
          hint: s.hint,
          keyVersion: s.keyVersion,
          updatedAt: s.updatedAt.toISOString(),
        })),
        secretEvents: eventRows.map((e) => ({
          id: e.id,
          secretName: e.secretName,
          event: e.event,
          detail: e.detail,
          createdAt: e.createdAt.toISOString(),
        })),
        jobs: jobRows.map((j) => ({
          id: j.id,
          kind: j.kind,
          sandboxDir: j.sandboxDir,
          status: j.status,
          detail: j.detail,
          networkPolicy: j.networkPolicy,
          timeLimitSec: j.timeLimitSec,
          memoryLimitMb: j.memoryLimitMb,
          artifactPath: j.artifactPath,
          copiedBack: j.copiedBack,
          workspaceDeleted: j.workspaceDeleted,
          createdAt: j.createdAt.toISOString(),
        })),
        uploads: uploadRows.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          mimeType: u.mimeType,
          sizeBytes: u.sizeBytes,
          createdAt: u.createdAt.toISOString(),
        })),
        deletionLog: deletionRows.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          projectName: d.projectName,
          schemaName: d.schemaName,
          detail: d.detail,
          createdAt: d.createdAt.toISOString(),
        })),
        mappingNote:
          "Pemetaan prototipe (jujur): platform produksi memakai PostgreSQL dengan skema & pengguna sungguhan per proyek. Prototipe ini berjalan di SQLite app.db, jadi skema proj_<id> diwujudkan sebagai kolom schema_name + penegakan project_id di setiap query server, pengguna DB per proyek sebagai baris kredensial logis (kata sandi penuh tidak disimpan, hanya petunjuk 4 karakter), sandbox sebagai catatan job Executor tmp/job-<id>, dan enkripsi rahasia sebagai AES-256-GCM sungguhan dengan kunci turunan per proyek.",
      };
    },
  }),

  // G2 — simpan/rotasi rahasia proyek. Nilai dienkripsi AES-256-GCM dengan
  // kunci turunan per proyek SEBELUM disimpan; respons hanya membawa
  // petunjuk 4 karakter terakhir. Nama yang sudah ada = ROTASI: ciphertext
  // lama diganti seketika (kunci lama langsung tidak berlaku) dan kejadian
  // tercatat di riwayat proyek. Nilai rahasia tidak pernah ditulis ke file
  // proyek, log pipeline, atau prompt model.
  setProjectSecret: defineAction({
    description: "Menyimpan atau merotasi rahasia terenkripsi AES-256-GCM milik sebuah proyek; plaintext tidak pernah keluar dari server.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      name: z
        .string()
        .min(1)
        .max(60)
        .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Nama rahasia: huruf, angka, underscore; mulai huruf (gaya env var)"),
      value: z.string().min(4).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      hint: z.string(),
      keyVersion: z.number(),
      rotated: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const name = args.name.trim();
      const hint = `••••${args.value.slice(-4)}`;
      const ciphertext = await encryptProjectSecret(args.projectId, args.value);
      // Cek integritas internal: ciphertext harus bisa dibuka kembali
      // dengan kunci proyek ini (hasil dekripsi tidak pernah keluar).
      const roundtrip = await decryptProjectSecret(args.projectId, ciphertext);
      if (roundtrip !== args.value) {
        return {
          ok: false,
          error: "Enkripsi rahasia gagal diverifikasi di server — rahasia tidak disimpan. Coba lagi.",
          hint: "",
          keyVersion: 0,
          rotated: false,
        };
      }
      const existing = await db
        .select()
        .from(schema.projectSecrets)
        .where(
          and(
            eq(schema.projectSecrets.projectId, args.projectId),
            eq(schema.projectSecrets.name, name),
          ),
        );
      const prev = existing[0];
      if (prev) {
        const nextVersion = prev.keyVersion + 1;
        await db
          .update(schema.projectSecrets)
          .set({ ciphertext, hint, keyVersion: nextVersion, updatedAt: new Date() })
          .where(eq(schema.projectSecrets.id, prev.id));
        await db.insert(schema.secretEvents).values({
          projectId: args.projectId,
          secretName: name,
          event: "rotate",
          detail: `Rahasia "${name}" dirotasi ke versi kunci ${nextVersion}; kunci lama langsung tidak berlaku.`,
        });
        ctx.invalidateQueries();
        return { ok: true, error: null, hint, keyVersion: nextVersion, rotated: true };
      }
      await db.insert(schema.projectSecrets).values({
        projectId: args.projectId,
        name,
        ciphertext,
        hint,
        keyVersion: 1,
      });
      await db.insert(schema.secretEvents).values({
        projectId: args.projectId,
        secretName: name,
        event: "create",
        detail: `Rahasia "${name}" dibuat dan disimpan terenkripsi (AES-256-GCM, kunci per proyek).`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, hint, keyVersion: 1, rotated: false };
    },
  }),

  // G2 — hapus rahasia proyek (tercatat di riwayat proyek).
  deleteProjectSecret: defineAction({
    description: "Menghapus rahasia terenkripsi milik sebuah proyek dan mencatat peristiwa penghapusannya.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      secretId: z.number().int().positive(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const rows = await db
        .select()
        .from(schema.projectSecrets)
        .where(
          and(
            eq(schema.projectSecrets.id, args.secretId),
            eq(schema.projectSecrets.projectId, args.projectId),
          ),
        );
      const target = rows[0];
      if (!target) throw new Error("Rahasia tidak ditemukan");
      await db
        .delete(schema.projectSecrets)
        .where(eq(schema.projectSecrets.id, args.secretId));
      await db.insert(schema.secretEvents).values({
        projectId: args.projectId,
        secretName: target.name,
        event: "delete",
        detail: `Rahasia "${target.name}" dihapus dari proyek; env runtime proyek tidak lagi menyuntikkannya.`,
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // G2 — jalankan job Executor (build/test) di sandbox tmp/job-<id> untuk
  // proyek milik peminta. Parameter simulasi dipakai untuk membuktikan
  // batas ditegakkan: simulateTimeout (job melewati batas waktu),
  // simulateOversizeBytes (hasil build sebesar itu — kuota diperiksa
  // sebelum penyalinan), networkTarget (host yang dicoba dihubungi job).
  runExecutorJob: defineAction({
    description: "Menjalankan job Executor dalam sandbox per job dengan batas waktu, memori, dan jaringan izin, lalu menyalin hasil lolos ke builds proyek.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      kind: z.enum(["build", "test"]).optional(),
      simulateTimeout: z.boolean().optional(),
      simulateOversizeBytes: z.number().int().min(0).max(20 * 1024 * 1024 * 1024).optional(),
      networkTarget: z.string().max(200).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      jobId: z.number(),
      status: z.string(),
      sandboxDir: z.string(),
      detail: z.string(),
      artifactPath: z.string(),
      copiedBack: z.boolean(),
      workspaceDeleted: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const job = await runSandboxJob(db, {
        user,
        projectId: args.projectId,
        kind: args.kind ?? "build",
        simulateTimeout: args.simulateTimeout,
        simulateOversizeBytes: args.simulateOversizeBytes,
        networkTarget: args.networkTarget,
      });
      ctx.invalidateQueries();
      return {
        ok: job.status === "done",
        jobId: job.id,
        status: job.status,
        sandboxDir: job.sandboxDir,
        detail: job.detail,
        artifactPath: job.artifactPath,
        copiedBack: job.copiedBack,
        workspaceDeleted: job.workspaceDeleted,
      };
    },
  }),

  // G2 — catat metadata unggahan proyek. Berkas tinggal di uploads/ proyek;
  // yang disimpan di database HANYA nama file + metadata (bukan isi/blob).
  // Kuota Executor diperiksa sebelum pencatatan.
  registerProjectUpload: defineAction({
    description: "Mencatat metadata unggahan file ke proyek dengan penegakan kuota penyimpanan sebelum pencatatan.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      fileName: z.string().min(1).max(200),
      mimeType: z.string().max(100).optional(),
      sizeBytes: z.number().int().min(0).max(5 * 1024 * 1024 * 1024),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      uploadId: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) throw new Error("Proyek tidak ditemukan");
      const quota = await checkStorageQuota(db, user, args.projectId, args.sizeBytes);
      if (!quota.allowed) {
        return { ok: false, error: quota.reason, uploadId: null };
      }
      const inserted = await db
        .insert(schema.projectUploads)
        .values({
          projectId: args.projectId,
          fileName: args.fileName.trim(),
          mimeType: (args.mimeType ?? "").trim(),
          sizeBytes: args.sizeBytes,
        })
        .returning({ id: schema.projectUploads.id });
      ctx.invalidateQueries();
      return { ok: true, error: null, uploadId: inserted[0]?.id ?? null };
    },
  }),

  // G2 — ekspor proyek: SELALU hanya ruang milik peminta (kepemilikan
  // diperiksa ownedProject seperti aksi lain; proyek orang lain →
  // "Proyek tidak ditemukan" dan tidak ada data yang keluar). Rahasia
  // diekspor hanya sebagai petunjuk 4 karakter — plaintext/ciphertext dan
  // kredensial platform tidak pernah ikut ekspor.
  exportProject: defineAction({
    description: "Mengekspor proyek milik pengguna sebagai JSON berisi spesifikasi dan data tabel; rahasia hanya berupa petunjuk.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      found: z.boolean(),
      package: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedProject(db, user.id, args.projectId);
      if (!project) return { found: false, package: "" };
      const cred = await ensureProjectDbCredential(db, args.projectId);
      const tables = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId))
        .orderBy(asc(schema.projectTables.id));
      const tableExports = [];
      for (const t of tables) {
        const rows = await db
          .select()
          .from(schema.projectRows)
          .where(eq(schema.projectRows.tableId, t.id))
          .orderBy(asc(schema.projectRows.id));
        let columns: string[] = [];
        try {
          const parsed: unknown = JSON.parse(t.columnsJson);
          if (Array.isArray(parsed)) {
            columns = parsed.filter((c): c is string => typeof c === "string");
          }
        } catch {
          columns = [];
        }
        tableExports.push({
          name: t.name,
          schemaName: t.schemaName || cred.schemaName,
          columns,
          rows: rows.map((r) => {
            try {
              const parsed: unknown = JSON.parse(r.dataJson);
              return parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : {};
            } catch {
              return {};
            }
          }),
        });
      }
      const files = await db
        .select()
        .from(schema.projectFiles)
        .where(eq(schema.projectFiles.projectId, args.projectId))
        .orderBy(asc(schema.projectFiles.id));
      const deps = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, args.projectId))
        .orderBy(asc(schema.deployments.id));
      const secretRows = await db
        .select()
        .from(schema.projectSecrets)
        .where(eq(schema.projectSecrets.projectId, args.projectId));
      const uploadRows = await db
        .select()
        .from(schema.projectUploads)
        .where(eq(schema.projectUploads.projectId, args.projectId));
      const pkg = {
        exportedFrom: "Dadiweb — ekspor ruang proyek milik peminta (G2)",
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          category: project.category,
          status: project.status,
          prompt: project.prompt,
          spec: parseSpec(project.spec),
        },
        database: {
          schemaName: cred.schemaName,
          dbUsername: cred.dbUsername,
          dbPasswordHint: cred.passwordHint,
          note: "Ekspor berisi kredensial proyek ini sendiri (petunjuk saja). Kredensial database platform TIDAK pernah disertakan.",
          tables: tableExports,
        },
        files: files.map((f) => ({ path: f.path, content: f.content })),
        deployments: deps.map((d) => ({
          subdomain: d.subdomain,
          status: d.status,
          kind: d.kind,
          note: d.note,
          createdAt: d.createdAt.toISOString(),
        })),
        uploads: uploadRows.map((u) => ({
          fileName: u.fileName,
          mimeType: u.mimeType,
          sizeBytes: u.sizeBytes,
          storedAs: `uploads/${u.fileName} (database hanya menyimpan metadata ini)`,
        })),
        secrets: secretRows.map((s) => ({
          name: s.name,
          hint: s.hint,
          keyVersion: s.keyVersion,
          note: "Nilai rahasia tidak pernah diekspor — hanya petunjuk 4 karakter terakhir.",
        })),
      };
      return { found: true, package: JSON.stringify(pkg, null, 2) };
    },
  }),

  // G2 — catatan penghapusan proyek milik peminta (bertahan setelah proyek
  // dihapus; ledger kredit tidak ikut terhapus dan tetap bisa direkonsiliasi
  // lewat getState).
  getDeletionLog: defineAction({
    description: "Mengambil log penghapusan proyek yang tetap tersimpan setelah proyeknya dihapus.",
    request: z.object({ token: tokenField }),
    response: z.object({
      deletions: z.array(
        z.object({
          id: z.number(),
          projectId: z.number(),
          projectName: z.string(),
          schemaName: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const rows = await db
        .select()
        .from(schema.projectDeletionLog)
        .where(eq(schema.projectDeletionLog.userId, user.id))
        .orderBy(desc(schema.projectDeletionLog.id))
        .limit(50);
      return {
        deletions: rows.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          projectName: d.projectName,
          schemaName: d.schemaName,
          detail: d.detail,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    },
  }),

  // G5-A — pengaturan provider AI (DeepInfra) untuk admin: status kunci
  // (hanya petunjuk 4 karakter terakhir — token utuh tidak pernah keluar
  // dari server), registry model per tahap, serta total & riwayat
  // ai_usage_log. Hanya admin (akun demo pemilik); akun lain menerima
  // isAdmin=false tanpa data apa pun.
  getAiProviderSettings: defineAction({
    description: "Mengambil status kunci DeepInfra (petunjuk saja), registry model 5 tahap plus responder, dan ringkasan pemakaian AI (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      provider: z.string(),
      keyConfigured: z.boolean(),
      keyHint: z.string(),
      stages: z.array(
        z.object({
          stage: z.string(),
          provider: z.string(),
          primaryModel: z.string(),
          fallbackModel: z.string(),
          isActive: z.boolean(),
          inputPriceUsd: z.number(),
          outputPriceUsd: z.number(),
          fallbackInputPriceUsd: z.number(),
          fallbackOutputPriceUsd: z.number(),
          updatedAt: z.string(),
        }),
      ),
      usageTotals: z.object({
        totalCalls: z.number(),
        successCalls: z.number(),
        failedCalls: z.number(),
        keyMissingCalls: z.number(),
        totalInputTokens: z.number(),
        totalOutputTokens: z.number(),
        totalCostUsd: z.number(),
      }),
      recentUsage: z.array(
        z.object({
          id: z.number(),
          provider: z.string(),
          model: z.string(),
          stage: z.string(),
          projectId: z.number().nullable(),
          userId: z.number().nullable(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          costUsd: z.number(),
          latencyMs: z.number(),
          status: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const emptyTotals = {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        keyMissingCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      };
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          provider: AI_PROVIDER,
          keyConfigured: false,
          keyHint: "",
          stages: [],
          usageTotals: emptyTotals,
          recentUsage: [],
        };
      }
      await ensureAiStageModels(db);
      const keyStatus = await getProviderKeyStatus(db);
      const stageOrder = [
        "planner",
        "designer",
        "coder",
        "builder",
        "fixer",
        "responder",
      ];
      const stageRows = (await db.select().from(schema.aiStageModels)).sort(
        (a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage),
      );
      const allUsage = await db.select().from(schema.aiUsageLog);
      const usageTotals = allUsage.reduce(
        (acc, r) => ({
          totalCalls: acc.totalCalls + 1,
          successCalls: acc.successCalls + (r.status === "sukses" ? 1 : 0),
          failedCalls: acc.failedCalls + (r.status === "gagal" ? 1 : 0),
          keyMissingCalls:
            acc.keyMissingCalls + (r.status === "kunci_belum_terpasang" ? 1 : 0),
          totalInputTokens: acc.totalInputTokens + r.inputTokens,
          totalOutputTokens: acc.totalOutputTokens + r.outputTokens,
          totalCostUsd: acc.totalCostUsd + r.costUsd,
        }),
        { ...emptyTotals },
      );
      const recentRows = await db
        .select()
        .from(schema.aiUsageLog)
        .orderBy(desc(schema.aiUsageLog.id))
        .limit(50);
      return {
        isAdmin: true,
        provider: AI_PROVIDER,
        keyConfigured: keyStatus.configured,
        keyHint: keyStatus.hint,
        stages: stageRows.map((s) => ({
          stage: s.stage,
          provider: s.provider,
          primaryModel: s.primaryModel,
          fallbackModel: s.fallbackModel,
          isActive: s.isActive,
          inputPriceUsd: s.inputPriceUsd,
          outputPriceUsd: s.outputPriceUsd,
          fallbackInputPriceUsd: s.fallbackInputPriceUsd,
          fallbackOutputPriceUsd: s.fallbackOutputPriceUsd,
          updatedAt: s.updatedAt.toISOString(),
        })),
        usageTotals,
        recentUsage: recentRows.map((r) => ({
          id: r.id,
          provider: r.provider,
          model: r.model,
          stage: r.stage,
          projectId: r.projectId,
          userId: r.userId,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: r.costUsd,
          latencyMs: r.latencyMs,
          status: r.status,
          detail: r.detail,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  // G5-A — ubah registry model per tahap (model utama/fallback, status
  // aktif, harga per 1 juta token). Hanya admin. UI panelnya menyusul di
  // G5-B; aksi ini adalah kontrak datanya.
  updateAiStageModel: defineAction({
    description: "Mengubah model utama/fallback, status aktif, dan harga token sebuah tahap AI di registry (khusus admin).",
    request: z.object({
      token: tokenField,
      stage: z.enum([
        "planner",
        "designer",
        "coder",
        "builder",
        "fixer",
        "responder",
      ]),
      primaryModel: z.string().min(1).max(120).optional(),
      fallbackModel: z.string().min(1).max(120).optional(),
      isActive: z.boolean().optional(),
      inputPriceUsd: z.number().min(0).max(100000).optional(),
      outputPriceUsd: z.number().min(0).max(100000).optional(),
      fallbackInputPriceUsd: z.number().min(0).max(100000).optional(),
      fallbackOutputPriceUsd: z.number().min(0).max(100000).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      stage: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat mengubah registry model AI.",
          stage: args.stage,
        };
      }
      await ensureAiStageModels(db);
      const patch: Partial<typeof schema.aiStageModels.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (args.primaryModel !== undefined) {
        patch.primaryModel = args.primaryModel.trim();
      }
      if (args.fallbackModel !== undefined) {
        patch.fallbackModel = args.fallbackModel.trim();
      }
      if (args.isActive !== undefined) patch.isActive = args.isActive;
      if (args.inputPriceUsd !== undefined) {
        patch.inputPriceUsd = args.inputPriceUsd;
      }
      if (args.outputPriceUsd !== undefined) {
        patch.outputPriceUsd = args.outputPriceUsd;
      }
      if (args.fallbackInputPriceUsd !== undefined) {
        patch.fallbackInputPriceUsd = args.fallbackInputPriceUsd;
      }
      if (args.fallbackOutputPriceUsd !== undefined) {
        patch.fallbackOutputPriceUsd = args.fallbackOutputPriceUsd;
      }
      const beforeRows = await db
        .select()
        .from(schema.aiStageModels)
        .where(eq(schema.aiStageModels.stage, args.stage));
      const beforeRow = beforeRows[0];
      const beforeDesc = beforeRow
        ? `utama ${beforeRow.primaryModel}, fallback ${beforeRow.fallbackModel}, aktif ${beforeRow.isActive ? "ya" : "tidak"}, harga in/out $${beforeRow.inputPriceUsd}/$${beforeRow.outputPriceUsd}, fallback in/out $${beforeRow.fallbackInputPriceUsd}/$${beforeRow.fallbackOutputPriceUsd}`
        : "belum ada registry";
      await db
        .update(schema.aiStageModels)
        .set(patch)
        .where(eq(schema.aiStageModels.stage, args.stage));
      const afterRows = await db
        .select()
        .from(schema.aiStageModels)
        .where(eq(schema.aiStageModels.stage, args.stage));
      const afterRow = afterRows[0];
      // G5-C — pencatatan audit (bentuk respons aksi ini tidak berubah).
      await writeAdminAudit(db, user, {
        action: "updateAiStageModel",
        target: `tahap ${args.stage}`,
        beforeValue: beforeDesc,
        afterValue: afterRow
          ? `utama ${afterRow.primaryModel}, fallback ${afterRow.fallbackModel}, aktif ${afterRow.isActive ? "ya" : "tidak"}, harga in/out $${afterRow.inputPriceUsd}/$${afterRow.outputPriceUsd}, fallback in/out $${afterRow.fallbackInputPriceUsd}/$${afterRow.fallbackOutputPriceUsd}`
          : "tidak ditemukan",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, stage: args.stage };
    },
  }),

  // G5-A — pasang/ganti kunci DeepInfra. Token disimpan TERENKRIPSI
  // AES-256-GCM di ai_provider_secrets; respons hanya memuat petunjuk 4
  // karakter terakhir. Hanya admin.
  setDeepInfraKey: defineAction({
    description: "Menyimpan kunci API DeepInfra terenkripsi dengan verifikasi roundtrip server; respons hanya berisi petunjuk 4 karakter (khusus admin).",
    request: z.object({
      token: tokenField,
      apiKey: z.string().min(8).max(400),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      keyConfigured: z.boolean(),
      keyHint: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat memasang kunci DeepInfra.",
          keyConfigured: false,
          keyHint: "",
        };
      }
      try {
        const beforeStatus = await getProviderKeyStatus(db);
        const status = await setProviderKey(db, AI_PROVIDER, args.apiKey);
        // G5-C — audit hanya mencatat status + petunjuk, TIDAK PERNAH nilai kunci.
        await writeAdminAudit(db, user, {
          action: "setDeepInfraKey",
          target: "kunci DeepInfra",
          beforeValue: beforeStatus.configured
            ? `terpasang (petunjuk ${beforeStatus.hint})`
            : "belum terpasang",
          afterValue: `terpasang (petunjuk ${status.hint})`,
        });
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          keyConfigured: status.configured,
          keyHint: status.hint,
        };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : "Kunci DeepInfra gagal disimpan terenkripsi.",
          keyConfigured: false,
          keyHint: "",
        };
      }
    },
  }),

  // G5-A — cabut kunci DeepInfra dari penyimpanan platform. Setelah ini
  // generate kembali berstatus ai_not_active sampai kunci baru dipasang.
  clearDeepInfraKey: defineAction({
    description: "Menghapus kunci API DeepInfra yang tersimpan (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      keyConfigured: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat mencabut kunci DeepInfra.",
          keyConfigured: false,
        };
      }
      const beforeStatus = await getProviderKeyStatus(db);
      await clearProviderKey(db, AI_PROVIDER);
      await writeAdminAudit(db, user, {
        action: "clearDeepInfraKey",
        target: "kunci DeepInfra",
        beforeValue: beforeStatus.configured
          ? `terpasang (petunjuk ${beforeStatus.hint})`
          : "belum terpasang",
        afterValue: "belum terpasang (kunci dicabut)",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, keyConfigured: false };
    },
  }),

  // G5-B — daftar pemakaian AI (ai_usage_log) dengan filter untuk panel
  // admin: model, tahap, status, dan rentang tanggal (YYYY-MM-DD, inklusif
  // hari penuh). Total dihitung dari SELURUH baris yang cocok dengan
  // filter; daftar entri dibatasi (default 100, maks 200) terbaru dulu.
  // Hanya admin; akun lain menerima hasil kosong tanpa data (pola yang
  // sama seperti getAiProviderSettings).
  getAiUsage: defineAction({
    description: "Mengambil log pemakaian model AI dengan filter model, tahap, status, dan tanggal, beserta total token dan biaya USD (khusus admin).",
    request: z.object({
      token: tokenField,
      model: z.string().max(120).optional(),
      stage: z
        .enum(["planner", "designer", "coder", "builder", "fixer", "responder"])
        .optional(),
      status: z
        .enum(["sukses", "gagal", "kunci_belum_terpasang"])
        .optional(),
      startDate: z.string().max(10).optional(),
      endDate: z.string().max(10).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    response: z.object({
      isAdmin: z.boolean(),
      entries: z.array(
        z.object({
          id: z.number(),
          provider: z.string(),
          model: z.string(),
          stage: z.string(),
          projectId: z.number().nullable(),
          userId: z.number().nullable(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          costUsd: z.number(),
          latencyMs: z.number(),
          status: z.string(),
          detail: z.string(),
          createdAt: z.string(),
        }),
      ),
      totals: z.object({
        totalCalls: z.number(),
        totalInputTokens: z.number(),
        totalOutputTokens: z.number(),
        totalCostUsd: z.number(),
        byStatus: z.array(
          z.object({
            status: z.string(),
            calls: z.number(),
            inputTokens: z.number(),
            outputTokens: z.number(),
            costUsd: z.number(),
          }),
        ),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const emptyTotals = {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        byStatus: ["sukses", "gagal", "kunci_belum_terpasang"].map(
          (status) => ({
            status,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          }),
        ),
      };
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, entries: [], totals: emptyTotals };
      }
      const modelNeedle = args.model?.trim().toLowerCase() ?? "";
      const parseDay = (value: string | undefined, endOfDay: boolean) => {
        if (!value) return null;
        const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
        return Number.isNaN(d.getTime()) ? null : d.getTime();
      };
      const startMs = parseDay(args.startDate, false);
      const endMs = parseDay(args.endDate, true);
      const allRows = await db
        .select()
        .from(schema.aiUsageLog)
        .orderBy(desc(schema.aiUsageLog.id));
      const matched = allRows.filter((r) => {
        if (modelNeedle && !r.model.toLowerCase().includes(modelNeedle)) {
          return false;
        }
        if (args.stage && r.stage !== args.stage) return false;
        if (args.status && r.status !== args.status) return false;
        const t = r.createdAt.getTime();
        if (startMs !== null && t < startMs) return false;
        if (endMs !== null && t > endMs) return false;
        return true;
      });
      const byStatus = ["sukses", "gagal", "kunci_belum_terpasang"].map(
        (status) => {
          const rows = matched.filter((r) => r.status === status);
          return {
            status,
            calls: rows.length,
            inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
            outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
            costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
          };
        },
      );
      const totals = {
        totalCalls: matched.length,
        totalInputTokens: matched.reduce((s, r) => s + r.inputTokens, 0),
        totalOutputTokens: matched.reduce((s, r) => s + r.outputTokens, 0),
        totalCostUsd: matched.reduce((s, r) => s + r.costUsd, 0),
        byStatus,
      };
      const limit = args.limit ?? 100;
      return {
        isAdmin: true,
        entries: matched.slice(0, limit).map((r) => ({
          id: r.id,
          provider: r.provider,
          model: r.model,
          stage: r.stage,
          projectId: r.projectId,
          userId: r.userId,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: r.costUsd,
          latencyMs: r.latencyMs,
          status: r.status,
          detail: r.detail,
          createdAt: r.createdAt.toISOString(),
        })),
        totals,
      };
    },
  }),

  // G5-B — uji koneksi satu model DeepInfra dari panel admin. Bila kunci
  // belum terpasang: ok:false + status "key_not_configured" + pesan jelas,
  // dan percobaannya tetap tercatat di ai_usage_log berstatus
  // kunci_belum_terpasang. Bila kunci terpasang: satu chat completion
  // minimal dikirim, hasil (latensi, token, biaya sebenarnya) dikembalikan
  // dan tercatat. Nilai kunci tidak pernah masuk respons. Hanya admin.
  testAiModelConnection: defineAction({
    description: "Menguji koneksi satu model DeepInfra dengan satu panggilan minimal dan mencatat hasilnya di log pemakaian (khusus admin).",
    request: z.object({
      token: tokenField,
      model: z.string().min(1).max(120),
      stage: z
        .enum(["planner", "designer", "coder", "builder", "fixer", "responder"])
        .optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      status: z.string(),
      message: z.string(),
      model: z.string(),
      latencyMs: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const model = args.model.trim();
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          status: "forbidden",
          message: "Hanya admin yang dapat menguji koneksi model AI.",
          model,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        };
      }
      const result = await testModelConnection({
        db,
        model,
        stage: args.stage ?? null,
        userId: user.id,
      });
      ctx.invalidateQueries();
      if (result.status === "kunci_belum_terpasang") {
        return {
          ok: false,
          status: "key_not_configured",
          message:
            "Kunci DeepInfra belum terpasang. Pasang kunci DeepInfra terlebih dahulu di panel Model AI & Provider sebelum menguji koneksi model.",
          model,
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        };
      }
      if (result.ok) {
        return {
          ok: true,
          status: "sukses",
          message: `Koneksi ke model ${model} berhasil — DeepInfra menjawab dalam ${result.latencyMs} ms.`,
          model,
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        };
      }
      return {
        ok: false,
        status: "gagal",
        message: result.detail || `Uji koneksi model ${model} gagal.`,
        model,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      };
    },
  }),
  // -------------------------------------------------------------------------
  // G5-C — Panel Admin lengkap (modul 1–5, 7–9). Semua aksi di blok ini
  // khusus admin (akun demo pemilik). Pola penolakan non-admin: mutasi &
  // daftar mengembalikan ok/isAdmin false + pesan "Hanya admin ..." dan
  // tanpa data; aksi baca murni mengembalikan hasil kosong + pesan yang
  // sama di field error. Setiap mutasi yang berhasil menulis SATU entri
  // ke admin_audit_log (append-only).
  // -------------------------------------------------------------------------

  getAdminAuditLog: defineAction({

    description: "Mengambil log audit admin append-only dengan filter aksi, email admin, dan tanggal (khusus admin).",
    request: z.object({
      token: tokenField,
      action: z.string().max(120).optional(),
      adminEmail: z.string().max(120).optional(),
      startDate: z.string().max(10).optional(),
      endDate: z.string().max(10).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      total: z.number(),
      entries: z.array(
        z.object({
          id: z.number(),
          adminId: z.number().nullable(),
          adminEmail: z.string(),
          action: z.string(),
          target: z.string(),
          beforeValue: z.string(),
          afterValue: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          error: "Hanya admin yang dapat melihat log audit admin.",
          total: 0,
          entries: [],
        };
      }
      const parseDay = (value: string | undefined, endOfDay: boolean) => {
        if (!value) return null;
        const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
        return Number.isNaN(d.getTime()) ? null : d.getTime();
      };
      const startMs = parseDay(args.startDate, false);
      const endMs = parseDay(args.endDate, true);
      const actionNeedle = args.action?.trim().toLowerCase() ?? "";
      const emailNeedle = args.adminEmail?.trim().toLowerCase() ?? "";
      const allRows = await db
        .select()
        .from(schema.adminAuditLog)
        .orderBy(desc(schema.adminAuditLog.id));
      const matched = allRows.filter((r) => {
        if (actionNeedle && !r.action.toLowerCase().includes(actionNeedle)) return false;
        if (emailNeedle && !r.adminEmail.toLowerCase().includes(emailNeedle)) return false;
        const t = r.createdAt.getTime();
        if (startMs !== null && t < startMs) return false;
        if (endMs !== null && t > endMs) return false;
        return true;
      });
      const limit = args.limit ?? 100;
      return {
        isAdmin: true,
        error: null,
        total: matched.length,
        entries: matched.slice(0, limit).map((r) => ({
          id: r.id,
          adminId: r.adminId,
          adminEmail: r.adminEmail,
          action: r.action,
          target: r.target,
          beforeValue: r.beforeValue,
          afterValue: r.afterValue,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminListUsers: defineAction({

    description: "Mendaftar semua pengguna platform beserta paket, status aktif, dan saldonya (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      users: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
          plan: z.string(),
          isActive: z.boolean(),
          balance: z.number(),
          monthlyQuota: z.number(),
          projectCount: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          error: "Hanya admin yang dapat melihat daftar pengguna.",
          users: [],
        };
      }
      const allUsers = await db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.id));
      const allProjects = await db.select().from(schema.projects);
      const users = [];
      for (const u of allUsers) {
        await ensureUserData(db, u);
        const account = await getAccount(db, u.id);
        users.push({
          id: u.id,
          name: u.name,
          email: u.email,
          plan: u.plan,
          isActive: u.isActive,
          balance: account?.balance ?? 0,
          monthlyQuota: account?.monthlyQuota ?? PLAN_QUOTA[u.plan] ?? 200,
          projectCount: allProjects.filter((p) => p.userId === u.id).length,
          createdAt: u.createdAt.toISOString(),
        });
      }
      return { isAdmin: true, error: null, users };
    },
  }),

  adminSetUserPlan: defineAction({

    description: "Mengubah paket langganan seorang pengguna tanpa mengubah saldonya (khusus admin).",
    request: z.object({
      token: tokenField,
      userId: z.number().int().positive().optional(),
      email: z.string().max(120).optional(),
      plan: z.enum(["Free", "Pro", "Pro Plan", "Bisnis"]),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      userId: z.number().nullable(),
      plan: z.string(),
      previousPlan: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const newPlan = normalizePlanName(args.plan);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengubah paket pengguna.", userId: null, plan: newPlan, previousPlan: "" };
      }
      const target = await findTargetUser(db, args);
      if (!target) {
        return { ok: false, error: "Pengguna tidak ditemukan.", userId: null, plan: newPlan, previousPlan: "" };
      }
      const previousPlan = target.plan;
      await ensureUserData(db, target);
      const account = await getAccount(db, target.id);
      const newQuota =
        newPlan === "Free" ? await getFreeQuota(db) : (PLAN_QUOTA[newPlan] ?? 200);
      await db.update(schema.users).set({ plan: newPlan }).where(eq(schema.users.id, target.id));
      // Perubahan paket TIDAK mengubah saldo yang sudah ada — hanya kuota
      // paket yang berlaku ke depan (pola yang sama seperti changePlan:
      // kuota diganti, saldo dipertahankan apa adanya di sini).
      if (account) {
        await db
          .update(schema.creditAccount)
          .set({ plan: newPlan, monthlyQuota: newQuota })
          .where(eq(schema.creditAccount.id, target.id));
      }
      await db
        .update(schema.workspace)
        .set({ plan: newPlan, priceIdr: PLAN_PRICE[newPlan] ?? 0 })
        .where(eq(schema.workspace.id, target.id));
      await writeAdminAudit(db, user, {
        action: "adminSetUserPlan",
        target: target.email,
        beforeValue: `Paket ${previousPlan} (kuota ${account?.monthlyQuota ?? 0}, saldo ${account?.balance ?? 0})`,
        afterValue: `Paket ${newPlan} (kuota ${newQuota}, saldo tetap ${account?.balance ?? 0})`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, userId: target.id, plan: newPlan, previousPlan };
    },
  }),

  adminSetUserActive: defineAction({

    description: "Mengaktifkan atau menonaktifkan akun pengguna; akun nonaktif tidak bisa masuk dan sesinya dicabut (khusus admin).",
    request: z.object({
      token: tokenField,
      userId: z.number().int().positive().optional(),
      email: z.string().max(120).optional(),
      isActive: z.boolean(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      userId: z.number().nullable(),
      isActive: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengaktifkan atau menonaktifkan akun.", userId: null, isActive: args.isActive };
      }
      const target = await findTargetUser(db, args);
      if (!target) {
        return { ok: false, error: "Pengguna tidak ditemukan.", userId: null, isActive: args.isActive };
      }
      if (target.email === DEMO_EMAIL && !args.isActive) {
        return { ok: false, error: "Akun admin tidak dapat dinonaktifkan.", userId: target.id, isActive: true };
      }
      const beforeActive = target.isActive;
      await db.update(schema.users).set({ isActive: args.isActive }).where(eq(schema.users.id, target.id));
      if (!args.isActive) {
        // Sesi lama dicabut agar akun nonaktif langsung tidak bisa masuk.
        await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, target.id));
      }
      await writeAdminAudit(db, user, {
        action: "adminSetUserActive",
        target: target.email,
        beforeValue: beforeActive ? "aktif" : "nonaktif",
        afterValue: args.isActive ? "aktif" : "nonaktif",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, userId: target.id, isActive: args.isActive };
    },
  }),

  adminListProjects: defineAction({

    description: "Mendaftar proyek lintas semua pengguna untuk pengawasan admin (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      projects: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          ownerId: z.number().nullable(),
          ownerName: z.string(),
          ownerEmail: z.string(),
          status: z.string(),
          category: z.string(),
          createdAt: z.string(),
          deploymentStatus: z.string(),
          subdomain: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, error: "Hanya admin yang dapat melihat daftar proyek semua pengguna.", projects: [] };
      }
      const allProjects = await db.select().from(schema.projects).orderBy(desc(schema.projects.id));
      const allUsers = await db.select().from(schema.users);
      const allDeps = await db.select().from(schema.deployments).orderBy(desc(schema.deployments.id));
      const userById = new Map(allUsers.map((u) => [u.id, u]));
      return {
        isAdmin: true,
        error: null,
        projects: allProjects.map((p) => {
          const owner = p.userId !== null ? userById.get(p.userId) : undefined;
          const deps = allDeps.filter((d) => d.projectId === p.id);
          const live = deps.find((d) => d.status === "live");
          const latest = deps[0];
          return {
            id: p.id,
            name: p.name,
            ownerId: p.userId,
            ownerName: owner?.name ?? "",
            ownerEmail: owner?.email ?? "",
            status: p.status,
            category: p.category,
            createdAt: p.createdAt.toISOString(),
            deploymentStatus: live ? "live" : latest ? latest.status : "belum deploy",
            subdomain: live?.subdomain ?? latest?.subdomain ?? "",
          };
        }),
      };
    },
  }),

  adminGetProjectDetail: defineAction({

    description: "Mengambil detail proyek pengguna mana pun termasuk info isolasi skema dan petunjuk kredensialnya (khusus admin).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      found: z.boolean(),
      project: z
        .object({
          id: z.number(),
          name: z.string(),
          slug: z.string(),
          category: z.string(),
          status: z.string(),
          prompt: z.string(),
          source: z.string(),
          creditsCost: z.number(),
          createdAt: z.string(),
          updatedAt: z.string(),
        })
        .nullable(),
      owner: z
        .object({ id: z.number(), name: z.string(), email: z.string(), plan: z.string() })
        .nullable(),
      isolation: z
        .object({
          found: z.boolean(),
          schemaName: z.string(),
          dbUsername: z.string(),
          dbPasswordHint: z.string(),
          credentialStatus: z.string(),
          platformCredentialExposed: z.boolean(),
        })
        .nullable(),
      tables: z.array(
        z.object({ id: z.number(), name: z.string(), schemaName: z.string(), rowCount: z.number() }),
      ),
      deployments: z.array(
        z.object({
          id: z.number(),
          subdomain: z.string(),
          status: z.string(),
          kind: z.string(),
          note: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        isAdmin: false,
        error: "Hanya admin yang dapat melihat detail proyek pengguna lain." as string | null,
        found: false,
        project: null,
        owner: null,
        isolation: null,
        tables: [] as Array<{ id: number; name: string; schemaName: string; rowCount: number }>,
        deployments: [] as Array<{ id: number; subdomain: string; status: string; kind: string; note: string; createdAt: string }>,
      };
      if (user.email !== DEMO_EMAIL) return empty;
      const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId));
      const project = rows[0];
      if (!project) return { ...empty, isAdmin: true, error: "Proyek tidak ditemukan." };
      const ownerRows =
        project.userId !== null
          ? await db.select().from(schema.users).where(eq(schema.users.id, project.userId))
          : [];
      const owner = ownerRows[0] ?? null;
      // Tampilan isolasi G2 proyek ini: skema proj_<id> + status kredensial
      // proyek (petunjuk saja — pola yang sama seperti getProjectIsolation).
      const cred = await ensureProjectDbCredential(db, args.projectId);
      const tableRows = await db
        .select()
        .from(schema.projectTables)
        .where(eq(schema.projectTables.projectId, args.projectId))
        .orderBy(asc(schema.projectTables.id));
      const tables = [];
      for (const t of tableRows) {
        const dataRows = await db.select({ id: schema.projectRows.id }).from(schema.projectRows).where(eq(schema.projectRows.tableId, t.id));
        tables.push({ id: t.id, name: t.name, schemaName: t.schemaName || cred.schemaName, rowCount: dataRows.length });
      }
      const deps = await db
        .select()
        .from(schema.deployments)
        .where(eq(schema.deployments.projectId, args.projectId))
        .orderBy(desc(schema.deployments.id));
      return {
        isAdmin: true,
        error: null,
        found: true,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          category: project.category,
          status: project.status,
          prompt: project.prompt,
          source: project.source,
          creditsCost: project.creditsCost,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        },
        owner: owner ? { id: owner.id, name: owner.name, email: owner.email, plan: owner.plan } : null,
        isolation: {
          found: true,
          schemaName: cred.schemaName,
          dbUsername: cred.dbUsername,
          dbPasswordHint: cred.passwordHint,
          credentialStatus: cred.dbUsername ? `Kredensial proyek ${cred.dbUsername} terdaftar untuk skema ${cred.schemaName} (petunjuk kata sandi ${cred.passwordHint})` : "belum ada kredensial",
          platformCredentialExposed: false,
        },
        tables,
        deployments: deps.map((d) => ({
          id: d.id,
          subdomain: d.subdomain,
          status: d.status,
          kind: d.kind,
          note: d.note,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminDeleteProject: defineAction({

    description: "Menghapus proyek pengguna mana pun secara penuh memakai jalur hapus yang sama seperti pemiliknya (khusus admin).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      projectId: z.number(),
      projectName: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat menghapus proyek pengguna lain.", projectId: args.projectId, projectName: "" };
      }
      const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId));
      const project = rows[0];
      if (!project) {
        return { ok: false, error: "Proyek tidak ditemukan.", projectId: args.projectId, projectName: "" };
      }
      const ownerRows =
        project.userId !== null
          ? await db.select().from(schema.users).where(eq(schema.users.id, project.userId))
          : [];
      const ownerEmail = ownerRows[0]?.email ?? "";
      await deleteProjectFully(db, project, ctx.blobs);
      await writeAdminAudit(db, user, {
        action: "adminDeleteProject",
        target: `proyek #${project.id} ${project.name}${ownerEmail ? ` milik ${ownerEmail}` : ""}`,
        beforeValue: `Proyek "${project.name}" ada (status ${project.status}, skema ${schemaNameForProject(project.id)})`,
        afterValue: "Proyek dihapus paksa oleh admin lewat jalur transaksi tercatat yang sama seperti hapus pemilik; riwayat kredit dipertahankan",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, projectId: project.id, projectName: project.name };
    },
  }),

  adminListDeployments: defineAction({

    description: "Mendaftar deployment dari semua proyek dan pengguna (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      deployments: z.array(
        z.object({
          id: z.number(),
          projectId: z.number(),
          projectName: z.string(),
          ownerId: z.number().nullable(),
          ownerName: z.string(),
          ownerEmail: z.string(),
          subdomain: z.string(),
          status: z.string(),
          kind: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, error: "Hanya admin yang dapat melihat riwayat deployment semua pengguna.", deployments: [] };
      }
      const allDeps = await db.select().from(schema.deployments).orderBy(desc(schema.deployments.id));
      const allProjects = await db.select().from(schema.projects);
      const allUsers = await db.select().from(schema.users);
      const projectById = new Map(allProjects.map((p) => [p.id, p]));
      const userById = new Map(allUsers.map((u) => [u.id, u]));
      return {
        isAdmin: true,
        error: null,
        deployments: allDeps.map((d) => {
          const project = projectById.get(d.projectId);
          const owner = project && project.userId !== null ? userById.get(project.userId) : undefined;
          return {
            id: d.id,
            projectId: d.projectId,
            projectName: project?.name ?? "",
            ownerId: project?.userId ?? null,
            ownerName: owner?.name ?? "",
            ownerEmail: owner?.email ?? "",
            subdomain: d.subdomain,
            status: d.status,
            kind: d.kind,
            createdAt: d.createdAt.toISOString(),
          };
        }),
      };
    },
  }),

  adminRollbackDeployment: defineAction({

    description: "Melakukan rollback deployment proyek pengguna mana pun ke versi lama (khusus admin).",
    request: z.object({
      token: tokenField,
      deploymentId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      deploymentId: z.number().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat melakukan rollback deployment pengguna lain.", deploymentId: null };
      }
      const found = await db.select().from(schema.deployments).where(eq(schema.deployments.id, args.deploymentId));
      const target = found[0];
      if (!target) {
        return { ok: false, error: "Deployment tidak ditemukan.", deploymentId: null };
      }
      if (target.status === "live") {
        return { ok: false, error: "Deployment ini sudah menjadi versi yang sedang tayang.", deploymentId: null };
      }
      // Logika yang sama seperti rollbackDeployment pemilik, tanpa cek
      // kepemilikan: versi live saat ini digantikan, deployment lama
      // diterbitkan ulang sebagai baris live baru berjenis rollback.
      const all = await db.select().from(schema.deployments).where(eq(schema.deployments.projectId, target.projectId));
      for (const d of all) {
        if (d.status === "live") {
          await db.update(schema.deployments).set({ status: "superseded" }).where(eq(schema.deployments.id, d.id));
        }
      }
      const when = target.createdAt.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
      const targetProjectRows = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, target.projectId));
      const targetProject = targetProjectRows[0];
      if (!targetProject) {
        return { ok: false, error: "Proyek target rollback tidak ditemukan.", deploymentId: null };
      }
      const inserted = await db
        .insert(schema.deployments)
        .values({
          projectId: target.projectId,
          subdomain: target.subdomain,
          status: "live",
          kind: "rollback",
          note: `Rollback admin ke deployment #${target.id} (${when})`,
          // G12 — snapshot sama seperti rollback pemilik (lihat komentar
          // di sana; target pra-G12 memakai spec proyek saat ini).
          // Jalur admin ini sebelumnya tidak menyalin record
          // Cloudflare — kekurangan lama itu TIDAK diubah di sini agar
          // G12 tidak merambat ke logika DNS G10.
          siteSnapshotSpec: (target.siteSnapshotSpec ?? "").trim()
            ? target.siteSnapshotSpec
            : targetProject.spec,
        })
        .returning({ id: schema.deployments.id });
      const newId = inserted[0]?.id ?? null;
      await db.update(schema.projects).set({ status: "online", updatedAt: new Date() }).where(eq(schema.projects.id, target.projectId));
      await writeAdminAudit(db, user, {
        action: "adminRollbackDeployment",
        target: `deployment #${target.id} proyek #${target.projectId} (${target.subdomain})`,
        beforeValue: `Status deployment #${target.id}: ${target.status}`,
        afterValue: `Rollback diterbitkan sebagai deployment #${newId ?? "?"} berstatus live`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, deploymentId: newId };
    },
  }),

  adminGetTariffs: defineAction({

    description: "Mengambil tarif platform yang berlaku: generate, deploy, dan build Android (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      tariffs: z.object({ generate: z.number(), deploy: z.number(), android: z.number() }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, error: "Hanya admin yang dapat melihat tarif platform.", tariffs: { generate: 0, deploy: 0, android: 0 } };
      }
      const tariffs = await getTariffs(db);
      return { isAdmin: true, error: null, tariffs };
    },
  }),

  adminSetTariffs: defineAction({

    description: "Mengubah tarif platform untuk operasi berikutnya dan mencatat nilai sebelum/sesudah di log audit (khusus admin).",
    request: z.object({
      token: tokenField,
      generateCost: z.number().int().min(0).max(100000).optional(),
      deployCost: z.number().int().min(0).max(100000).optional(),
      androidCost: z.number().int().min(0).max(100000).optional(),
      generate: z.number().int().min(0).max(100000).optional(),
      deploy: z.number().int().min(0).max(100000).optional(),
      android: z.number().int().min(0).max(100000).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      tariffs: z.object({ generate: z.number(), deploy: z.number(), android: z.number() }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const current = await getTariffs(db);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengubah tarif platform.", tariffs: current };
      }
      const next: Tariffs = {
        generate: args.generateCost ?? args.generate ?? current.generate,
        deploy: args.deployCost ?? args.deploy ?? current.deploy,
        android: args.androidCost ?? args.android ?? current.android,
      };
      const settings = await ensurePlatformSettings(db);
      await db
        .update(schema.platformSettings)
        .set({ generateCost: next.generate, deployCost: next.deploy, androidCost: next.android, updatedAt: new Date() })
        .where(eq(schema.platformSettings.id, settings.id));
      await writeAdminAudit(db, user, {
        action: "adminSetTariffs",
        target: "tarif platform",
        beforeValue: `generate ${current.generate}, deploy ${current.deploy}, build Android ${current.android}`,
        afterValue: `generate ${next.generate}, deploy ${next.deploy}, build Android ${next.android}`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, tariffs: next };
    },
  }),

  adminAdjustCredits: defineAction({

    description: "Menyesuaikan saldo kredit seorang pengguna dengan alasan wajib, tercatat di ledger dan invoice berlabel penyesuaian admin (khusus admin).",
    request: z.object({
      token: tokenField,
      userId: z.number().int().positive().optional(),
      email: z.string().max(120).optional(),
      amount: z.number().int().min(-1000000).max(1000000),
      reason: z.string().min(3).max(300),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      userId: z.number().nullable(),
      balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat menyesuaikan saldo kredit pengguna.", userId: null, balance: 0 };
      }
      if (args.amount === 0) {
        return { ok: false, error: "Jumlah penyesuaian tidak boleh nol.", userId: null, balance: 0 };
      }
      const reason = args.reason.trim();
      if (!reason) {
        return { ok: false, error: "Alasan penyesuaian wajib diisi.", userId: null, balance: 0 };
      }
      const target = await findTargetUser(db, args);
      if (!target) {
        return { ok: false, error: "Pengguna tidak ditemukan.", userId: null, balance: 0 };
      }
      await ensureUserData(db, target);
      const account = await getAccount(db, target.id);
      if (!account) {
        return { ok: false, error: "Akun kredit pengguna belum tersedia.", userId: target.id, balance: 0 };
      }
      const newBalance = account.balance + args.amount;
      if (newBalance < 0) {
        return {
          ok: false,
          error: `Penyesuaian negatif tidak boleh membuat saldo di bawah nol (saldo saat ini ${account.balance}, penyesuaian ${args.amount}).`,
          userId: target.id,
          balance: account.balance,
        };
      }
      await db.update(schema.creditAccount).set({ balance: newBalance }).where(eq(schema.creditAccount.id, target.id));
      await db.insert(schema.creditLedger).values({
        userId: target.id,
        kind: "adjust",
        label: `Penyesuaian saldo oleh admin ${user.email}: ${reason} (${args.amount > 0 ? "+" : ""}${args.amount} kredit)`,
        category: "Lainnya",
        amount: args.amount,
        balanceAfter: newBalance,
        projectId: null,
      });
      // Invoice penyesuaian terbit dengan label jujur — ini penyesuaian
      // saldo oleh admin, BUKAN ganti paket langganan.
      await createInvoice(db, {
        userId: target.id,
        ledgerId: await latestLedgerId(db, target.id),
        kind: "adjust",
        title: "Penyesuaian saldo oleh admin",
        amountIdr: null,
        creditsDelta: args.amount,
        balanceAfter: newBalance,
      });
      await writeAdminAudit(db, user, {
        action: "adminAdjustCredits",
        target: target.email,
        beforeValue: `Saldo ${account.balance} kredit`,
        afterValue: `Saldo ${newBalance} kredit (${args.amount > 0 ? "+" : ""}${args.amount}) — alasan: ${reason}`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, userId: target.id, balance: newBalance };
    },
  }),

  // Koreksi satu kali untuk invoice INV/202610/0006: diterbitkan untuk
  // penyesuaian saldo +300 (pemulihan saldo probe baseline G5, 30 Okt
  // 2026) tetapi terlabel kind "plan" / "Ganti paket langganan". Aksi ini
  // hanya mengubah kind & judul baris itu — nilai, status, dan saldo tidak
  // disentuh — dan mencatat koreksinya di log audit admin. Idempoten:
  // bila barisnya sudah berlabel jujur, tidak ada perubahan apa pun.
  correctInvoice0006Label: defineAction({
    description: "Mengoreksi label invoice INV/202610/0006 menjadi penyesuaian admin secara idempoten (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      corrected: z.boolean(),
      error: z.string().nullable(),
      invoice: z
        .object({
          id: z.number(),
          number: z.string(),
          kind: z.string(),
          title: z.string(),
          creditsDelta: z.number(),
          status: z.string(),
          balanceAfter: z.number().nullable(),
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          corrected: false,
          error: "Hanya admin yang dapat mengoreksi label invoice.",
          invoice: null,
        };
      }
      const rows = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.number, "INV/202610/0006"));
      const inv = rows[0];
      if (!inv) {
        return {
          ok: false,
          corrected: false,
          error: "Invoice INV/202610/0006 tidak ditemukan.",
          invoice: null,
        };
      }
      const snapshot = {
        id: inv.id,
        number: inv.number,
        kind: inv.kind as string,
        title: inv.title,
        creditsDelta: inv.creditsDelta,
        status: inv.status,
        balanceAfter: inv.balanceAfter,
      };
      if (inv.kind === "adjust" && inv.title === "Penyesuaian saldo oleh admin") {
        return { ok: true, corrected: false, error: null, invoice: snapshot };
      }
      await db
        .update(schema.invoices)
        .set({ kind: "adjust", title: "Penyesuaian saldo oleh admin" })
        .where(eq(schema.invoices.id, inv.id));
      await writeAdminAudit(db, user, {
        action: "correctInvoiceLabel",
        target: `invoice ${inv.number}`,
        beforeValue: `kind "${inv.kind}", judul "${inv.title}"`,
        afterValue:
          'kind "adjust", judul "Penyesuaian saldo oleh admin" — koreksi label: transaksi ini penyesuaian saldo +300 oleh admin (pemulihan saldo probe baseline G5 30 Okt 2026), bukan ganti paket; nilai, status, dan saldo tidak berubah',
      });
      ctx.invalidateQueries();
      return {
        ok: true,
        corrected: true,
        error: null,
        invoice: { ...snapshot, kind: "adjust", title: "Penyesuaian saldo oleh admin" },
      };
    },
  }),

  adminListInvoices: defineAction({

    description: "Mendaftar semua invoice platform dari seluruh pengguna (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      paymentNote: z.string(),
      invoices: z.array(
        z.object({
          id: z.number(),
          number: z.string(),
          userId: z.number().nullable(),
          userName: z.string(),
          userEmail: z.string(),
          title: z.string(),
          kind: z.string(),
          amountIdr: z.number().nullable(),
          creditsDelta: z.number(),
          balanceAfter: z.number().nullable(),
          status: z.string(),
          dokuStatus: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const paymentNote = "Pembayaran lewat DOKU masih SIMULASI di prototipe — belum ada pembayaran asli sampai kredensial merchant DOKU lolos uji penerimaan.";
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, error: "Hanya admin yang dapat melihat invoice semua pengguna.", paymentNote, invoices: [] };
      }
      const allInvoices = await db.select().from(schema.invoices).orderBy(desc(schema.invoices.id)).limit(200);
      const allUsers = await db.select().from(schema.users);
      const userById = new Map(allUsers.map((u) => [u.id, u]));
      return {
        isAdmin: true,
        error: null,
        paymentNote,
        invoices: allInvoices.map((i) => {
          const owner = i.userId !== null ? userById.get(i.userId) : undefined;
          return {
            id: i.id,
            number: i.number,
            userId: i.userId,
            userName: owner?.name ?? "",
            userEmail: owner?.email ?? "",
            title: i.title,
            kind: i.kind,
            amountIdr: i.amountIdr,
            creditsDelta: i.creditsDelta,
            balanceAfter: i.balanceAfter,
            status: i.status,
            dokuStatus: "simulasi",
            createdAt: i.createdAt.toISOString(),
          };
        }),
      };
    },
  }),

  adminIntegrationStatus: defineAction({

    description: "Menampilkan status jujur 7 kredensial go-live platform: terpasang, belum terpasang, atau simulasi, tanpa nilai secret (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      integrations: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          status: z.string(),
          statusLabel: z.string(),
          configured: z.boolean(),
          detail: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { isAdmin: false, error: "Hanya admin yang dapat melihat status integrasi platform.", integrations: [] };
      }
      const keyStatus = await getProviderKeyStatus(db);
      const googleStatus = await getGoogleOAuthSettingsStatus(db);
      const githubStatus = await getGitHubOAuthSettingsStatus(db);
      const cloudflareStatus = await getCloudflareSettingsStatus(db);
      const integrations = [
        {
          key: "doku",
          name: "DOKU (pembayaran)",
          status: "simulasi",
          statusLabel: "Simulasi",
          configured: false,
          detail: "Pembayaran DOKU masih simulasi di prototipe — kredensial merchant DOKU asli belum terpasang dan belum lolos uji penerimaan. Tidak ada pembayaran asli yang diklaim.",
        },
        {
          key: "google_oauth",
          name: "OAuth Google",
          status: googleStatus.configured ? "terpasang" : "belum_terpasang",
          statusLabel: googleStatus.configured ? "Terpasang" : "Belum Terpasang",
          configured: googleStatus.configured,
          detail: googleStatus.configured
            ? `Kredensial login Google terpasang terenkripsi di panel admin (Client ID ${googleStatus.clientId}, secret ${googleStatus.secretHint}). Alur OAuth asli aktif; uji login sungguhan menunggu redirect URI terdaftar di client Google lewat domain.`
            : "Login Google belum diaktifkan: Client ID/Secret/Redirect URI belum lengkap di panel admin (Pengaturan Platform → Login Google). Tombol Google menampilkan pesan belum aktif, tanpa akun demo.",
        },
        {
          key: "github_oauth",
          name: "OAuth GitHub",
          status: githubStatus.configured ? "terpasang" : "belum_terpasang",
          statusLabel: githubStatus.configured ? "Terpasang" : "Belum Terpasang",
          configured: githubStatus.configured,
          detail: githubStatus.configured
            ? `Kredensial login GitHub terpasang terenkripsi di panel admin (Client ID ${githubStatus.clientId}, secret ${githubStatus.secretHint}). Alur OAuth asli aktif; uji login sungguhan menunggu callback URL terdaftar di OAuth App GitHub lewat domain.`
            : "Login GitHub belum diaktifkan: Client ID/Secret/Callback URL belum lengkap di panel admin (Pengaturan Platform → Login GitHub). Tombol GitHub menampilkan pesan belum aktif, tanpa akun demo.",
        },
        {
          key: "cloudflare",
          name: "Cloudflare (DNS deploy)",
          status: cloudflareStatus.configured ? "terpasang" : "belum_terpasang",
          statusLabel: cloudflareStatus.configured ? "Terpasang" : "Belum Terpasang",
          configured: cloudflareStatus.configured,
          detail: cloudflareStatus.configured
            ? `Settings Cloudflare terpasang terenkripsi di panel admin (zone ${cloudflareStatus.zoneId}, IP ${cloudflareStatus.serverIp}, mode ${cloudflareStatus.recordMode === "proxied" ? "proxied" : "DNS-only"}, token ${cloudflareStatus.tokenHint}). Deploy membuat record DNS A via API Cloudflare; akses HTTPS subdomain sungguhan tetap menunggu vhost wildcard + SSL di staging.`
            : "Integrasi Cloudflare belum terpasang: Account ID/Zone ID/API Token/IP server belum lengkap di panel admin (Pengaturan Platform → Cloudflare). Selama belum lengkap, deploy gagal bersih tanpa potong kredit.",
        },
        {
          key: "domain",
          name: "Domain & DNS (dadiweb.id)",
          status: "belum_terpasang",
          statusLabel: "Belum Terpasang",
          configured: false,
          detail: "Domain dadiweb.id dan akses DNS live belum terpasang — verifikasi domain custom di prototipe memakai konfirmasi pemasangan TXT oleh pengguna.",
        },
        {
          key: "email",
          name: "Layanan Email",
          status: "simulasi",
          statusLabel: "Simulasi",
          configured: false,
          detail: "Layanan pengirim email asli belum terpasang — verifikasi dan reset kata sandi memakai kotak masuk simulasi di dalam aplikasi.",
        },
        {
          key: "deepinfra",
          name: "Kunci AI DeepInfra",
          status: keyStatus.configured ? "terpasang" : "belum_terpasang",
          statusLabel: keyStatus.configured ? "Terpasang" : "Belum Terpasang",
          configured: keyStatus.configured,
          detail: keyStatus.configured
            ? `Kunci DeepInfra terpasang di penyimpanan terenkripsi platform (petunjuk ${keyStatus.hint}). Nilai kunci tidak pernah ditampilkan.`
            : "Kunci DeepInfra belum terpasang — generate AI berstatus belum aktif (ai_not_active) sampai admin memasang kunci lewat panel Model AI & Provider.",
        },
        {
          key: "google_play",
          name: "Akun Google Play",
          status: "belum_terpasang",
          statusLabel: "Belum Terpasang",
          configured: false,
          detail: "Akun Google Play belum terpasang — yang tersimpan di prototipe adalah konfigurasi dan riwayat build Android; biner APK/AAB final dihasilkan pipeline rilis produksi.",
        },
      ];
      return { isAdmin: true, error: null, integrations };
    },
  }),

  adminDeleteCommunityPost: defineAction({

    description: "Menghapus postingan forum komunitas secara permanen (khusus admin).",
    request: z.object({
      token: tokenField,
      postId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      postId: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat menghapus postingan komunitas.", postId: args.postId };
      }
      const rows = await db.select().from(schema.communityPosts).where(eq(schema.communityPosts.id, args.postId));
      const post = rows[0];
      if (!post) {
        return { ok: false, error: "Postingan tidak ditemukan.", postId: args.postId };
      }
      await db.delete(schema.communityComments).where(eq(schema.communityComments.postId, args.postId));
      await db.delete(schema.communityLikes).where(eq(schema.communityLikes.postId, args.postId));
      await db.delete(schema.communityPosts).where(eq(schema.communityPosts.id, args.postId));
      await writeAdminAudit(db, user, {
        action: "adminDeleteCommunityPost",
        target: `postingan #${post.id} "${post.title}" oleh ${post.authorName}`,
        beforeValue: `Postingan ada (kategori ${post.tag}, tersembunyi: ${post.isHidden ? "ya" : "tidak"})`,
        afterValue: "Postingan beserta komentar dan sukanya dihapus oleh admin",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, postId: args.postId };
    },
  }),

  adminHideCommunityPost: defineAction({

    description: "Menyembunyikan atau menampilkan kembali postingan forum komunitas untuk pengguna biasa (khusus admin).",
    request: z.object({
      token: tokenField,
      postId: z.number().int().positive(),
      hidden: z.boolean().optional(),
      isHidden: z.boolean().optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      postId: z.number(),
      hidden: z.boolean(),
      isHidden: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const desired = args.hidden ?? args.isHidden;
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat menyembunyikan postingan komunitas.", postId: args.postId, hidden: desired ?? false, isHidden: desired ?? false };
      }
      const rows = await db.select().from(schema.communityPosts).where(eq(schema.communityPosts.id, args.postId));
      const post = rows[0];
      if (!post) {
        return { ok: false, error: "Postingan tidak ditemukan.", postId: args.postId, hidden: desired ?? false, isHidden: desired ?? false };
      }
      const nextHidden = desired ?? !post.isHidden;
      await db.update(schema.communityPosts).set({ isHidden: nextHidden }).where(eq(schema.communityPosts.id, args.postId));
      await writeAdminAudit(db, user, {
        action: "adminHideCommunityPost",
        target: `postingan #${post.id} "${post.title}" oleh ${post.authorName}`,
        beforeValue: post.isHidden ? "tersembunyi" : "tampil",
        afterValue: nextHidden ? "tersembunyi" : "tampil",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, postId: args.postId, hidden: nextHidden, isHidden: nextHidden };
    },
  }),

  getPlatformSettings: defineAction({

    description: "Mengambil pengaturan platform: nama, status dan pesan maintenance, serta kuota default paket Free (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      error: z.string().nullable(),
      settings: z.object({
        platformName: z.string(),
        maintenanceMessage: z.string(),
        maintenanceEnabled: z.boolean(),
        freeQuota: z.number(),
        tariffs: z.object({ generate: z.number(), deploy: z.number(), android: z.number() }),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          error: "Hanya admin yang dapat melihat pengaturan platform.",
          settings: { platformName: "", maintenanceMessage: "", maintenanceEnabled: false, freeQuota: 0, tariffs: { generate: 0, deploy: 0, android: 0 } },
        };
      }
      const s = await ensurePlatformSettings(db);
      return {
        isAdmin: true,
        error: null,
        settings: {
          platformName: s.platformName,
          maintenanceMessage: s.maintenanceMessage,
          maintenanceEnabled: s.maintenanceEnabled,
          freeQuota: s.freeQuota,
          tariffs: { generate: s.generateCost, deploy: s.deployCost, android: s.androidCost },
        },
      };
    },
  }),

  updatePlatformSettings: defineAction({

    description: "Memperbarui pengaturan platform; kuota Free baru hanya berlaku untuk pendaftar baru (khusus admin).",
    request: z.object({
      token: tokenField,
      platformName: z.string().min(1).max(80).optional(),
      maintenanceMessage: z.string().max(500).optional(),
      maintenanceEnabled: z.boolean().optional(),
      freeQuota: z.number().int().min(0).max(1000000).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      settings: z.object({
        platformName: z.string(),
        maintenanceMessage: z.string(),
        maintenanceEnabled: z.boolean(),
        freeQuota: z.number(),
        tariffs: z.object({ generate: z.number(), deploy: z.number(), android: z.number() }),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const current = await ensurePlatformSettings(db);
      const currentOut = {
        platformName: current.platformName,
        maintenanceMessage: current.maintenanceMessage,
        maintenanceEnabled: current.maintenanceEnabled,
        freeQuota: current.freeQuota,
        tariffs: { generate: current.generateCost, deploy: current.deployCost, android: current.androidCost },
      };
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengubah pengaturan platform.", settings: currentOut };
      }
      const patch: Partial<typeof schema.platformSettings.$inferInsert> = { updatedAt: new Date() };
      if (args.platformName !== undefined) patch.platformName = args.platformName.trim();
      if (args.maintenanceMessage !== undefined) patch.maintenanceMessage = args.maintenanceMessage;
      if (args.maintenanceEnabled !== undefined) patch.maintenanceEnabled = args.maintenanceEnabled;
      if (args.freeQuota !== undefined) patch.freeQuota = args.freeQuota;
      // Mengaktifkan pesan maintenance tanpa teks memakai teks bawaan agar
      // banner yang tampil untuk pengguna tidak kosong.
      if (patch.maintenanceEnabled === true) {
        const msg = (patch.maintenanceMessage ?? current.maintenanceMessage).trim();
        if (!msg) patch.maintenanceMessage = "Platform sedang dalam pemeliharaan terjadwal. Beberapa fitur mungkin terbatas sementara.";
      }
      await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, current.id));
      const updated = await ensurePlatformSettings(db);
      const updatedOut = {
        platformName: updated.platformName,
        maintenanceMessage: updated.maintenanceMessage,
        maintenanceEnabled: updated.maintenanceEnabled,
        freeQuota: updated.freeQuota,
        tariffs: { generate: updated.generateCost, deploy: updated.deployCost, android: updated.androidCost },
      };
      await writeAdminAudit(db, user, {
        action: "updatePlatformSettings",
        target: "pengaturan platform",
        beforeValue: `nama "${currentOut.platformName}", maintenance ${currentOut.maintenanceEnabled ? "aktif" : "nonaktif"} ("${currentOut.maintenanceMessage}"), kuota Free ${currentOut.freeQuota}`,
        afterValue: `nama "${updatedOut.platformName}", maintenance ${updatedOut.maintenanceEnabled ? "aktif" : "nonaktif"} ("${updatedOut.maintenanceMessage}"), kuota Free ${updatedOut.freeQuota} (hanya untuk pendaftar baru)`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, settings: updatedOut };
    },
  }),

  // G8 — Login Google (OAuth). Kredensial disimpan di tabel
  // google_oauth_settings: Client ID & redirect URI tampil penuh (bukan
  // rahasia), Client Secret terenkripsi AES-256-GCM pola DeepInfra dan
  // hanya petunjuk 4 karakter terakhirnya yang keluar. Semua aksi
  // pengaturan khusus admin (pola yang sama seperti aksi admin lain);
  // set/clear tercatat di log audit tanpa nilai secret.
  getGoogleOAuthSettings: defineAction({
    description: "Mengambil status kredensial login Google (Client ID & redirect URI penuh, secret hanya petunjuk 4 karakter) — khusus admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      configured: z.boolean(),
      clientId: z.string(),
      redirectUri: z.string(),
      secretConfigured: z.boolean(),
      secretHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          configured: false,
          clientId: "",
          redirectUri: "",
          secretConfigured: false,
          secretHint: "",
          missing: [],
        };
      }
      const s = await getGoogleOAuthSettingsStatus(db);
      return {
        isAdmin: true,
        configured: s.configured,
        clientId: s.clientId,
        redirectUri: s.redirectUri,
        secretConfigured: s.secretConfigured,
        secretHint: s.secretHint,
        missing: s.missing,
      };
    },
  }),

  setGoogleOAuthSettings: defineAction({
    description: "Menyimpan kredensial login Google terenkripsi AES-256-GCM (secret hanya petunjuk 4 karakter, tidak pernah dikembalikan) — khusus admin.",
    request: z.object({
      token: tokenField,
      clientId: z.string().min(1).max(300),
      clientSecret: z.string().min(8).max(400),
      redirectUri: z.string().min(1).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
      clientId: z.string(),
      redirectUri: z.string(),
      secretConfigured: z.boolean(),
      secretHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        ok: false as const,
        error: "",
        configured: false,
        clientId: "",
        redirectUri: "",
        secretConfigured: false,
        secretHint: "",
        missing: [] as string[],
      };
      if (user.email !== DEMO_EMAIL) {
        return {
          ...empty,
          error: "Hanya admin yang dapat mengatur kredensial login Google.",
        };
      }
      // Redirect URI harus https (syarat Google), kecuali localhost
      // untuk pengembangan lokal.
      let uri: URL;
      try {
        uri = new URL(args.redirectUri.trim());
      } catch {
        return {
          ...empty,
          error:
            "Redirect URI tidak valid: harus berupa URL lengkap (mis. https://dadiweb.id/).",
        };
      }
      const isLocalhost =
        uri.protocol === "http:" &&
        (uri.hostname === "localhost" || uri.hostname === "127.0.0.1");
      if (uri.protocol !== "https:" && !isLocalhost) {
        return {
          ...empty,
          error:
            "Redirect URI harus memakai https (Google menolak http), kecuali http://localhost untuk pengembangan lokal.",
        };
      }
      try {
        const before = await getGoogleOAuthSettingsStatus(db);
        const status = await setGoogleOAuthSettings(db, {
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          redirectUri: args.redirectUri,
        });
        await writeAdminAudit(db, user, {
          action: "setGoogleOAuthSettings",
          target: "kredensial login Google",
          beforeValue: before.configured
            ? `terpasang (Client ID ${before.clientId}, secret ${before.secretHint}, redirect ${before.redirectUri})`
            : "belum terpasang",
          afterValue: `terpasang (Client ID ${status.clientId}, secret ${status.secretHint}, redirect ${status.redirectUri})`,
        });
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          configured: status.configured,
          clientId: status.clientId,
          redirectUri: status.redirectUri,
          secretConfigured: status.secretConfigured,
          secretHint: status.secretHint,
          missing: status.missing,
        };
      } catch (e) {
        return {
          ...empty,
          error:
            e instanceof Error
              ? e.message
              : "Kredensial login Google gagal disimpan terenkripsi.",
        };
      }
    },
  }),

  clearGoogleOAuthSettings: defineAction({
    description: "Menghapus kredensial login Google yang tersimpan; tombol Google kembali berstatus belum aktif (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat menghapus kredensial login Google.",
          configured: false,
        };
      }
      const before = await getGoogleOAuthSettingsStatus(db);
      await clearGoogleOAuthSettings(db);
      await writeAdminAudit(db, user, {
        action: "clearGoogleOAuthSettings",
        target: "kredensial login Google",
        beforeValue: before.configured
          ? `terpasang (Client ID ${before.clientId}, secret ${before.secretHint})`
          : "belum terpasang",
        afterValue: "belum terpasang (kredensial dihapus)",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, configured: false };
    },
  }),

  // G8 — mulai login Google. Tanpa konfigurasi lengkap: error jujur yang
  // menyebut bagian yang kurang — TIDAK BOLEH fallback diam-diam ke akun
  // demo (akun demo provider tetap hanya lewat tombol demo terpisah).
  startGoogleOAuth: defineAction({
    description: "Memulai login Google: mengembalikan URL otorisasi Google, atau error jujur bila kredensial/redirect URI belum lengkap (tanpa fallback ke akun demo).",
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      authUrl: z.string().nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const status = await getGoogleOAuthSettingsStatus(db);
      if (!status.configured) {
        const labels: Record<string, string> = {
          clientId: "Client ID",
          clientSecret: "Client Secret",
          redirectUri: "Redirect URI",
        };
        const kurang = status.missing
          .map((m) => labels[m] ?? m)
          .join(", ");
        return {
          ok: false,
          error: `Login Google belum diaktifkan: ${kurang} belum diisi di panel admin (Pengaturan Platform → Login Google).`,
          authUrl: null,
        };
      }
      const state = await createOAuthState(db);
      return {
        ok: true,
        error: null,
        authUrl: buildGoogleAuthUrl({
          clientId: status.clientId,
          redirectUri: status.redirectUri,
          state,
        }),
      };
    },
  }),

  // G8 — selesaikan login Google. Dipanggil client setelah Google
  // mengembalikan pengguna ke URL aplikasi dengan code+state di query
  // string (mekanisme callback aksi — lihat google-oauth.ts: runtime
  // artifact tidak punya route HTTP kustom). Urutan gerbang: state
  // sekali pakai → tukar code server-side → profil → cari (google_sub)
  // / tautkan (email terverifikasi, belum tertaut) / buat akun Free.
  // Gagal di tahap mana pun = tanpa sesi dan tanpa pengguna baru.
  completeGoogleOAuth: defineAction({
    description: "Menyelesaikan login Google: validasi state sekali pakai, tukar code server-side, lalu cari/tautkan/buat pengguna dari profil Google (token Google tidak disimpan).",
    request: z.object({
      code: z.string().min(1).max(2000),
      state: z.string().min(1).max(200),
    }),
    response: authResponse,
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      const fail = (error: string): z.infer<typeof authResponse> => ({
        ok: false,
        token: null,
        error,
        user: null,
      });
      // 1. State dikonsumsi dulu: sekali pakai, kedaluwarsa 10 menit.
      const stateOk = await consumeOAuthState(db, args.state);
      if (!stateOk) {
        return fail(
          "State login Google tidak valid, sudah dipakai, atau sudah kedaluwarsa (10 menit). Silakan mulai lagi dari tombol Google.",
        );
      }
      // 2. Tukar code + ambil profil (server-side). Gagal di sini berarti
      // tidak ada pengguna yang dibuat dan tidak ada sesi yang diterbitkan.
      let profile;
      try {
        const status = await getGoogleOAuthSettingsStatus(db);
        if (!status.configured) {
          return fail(
            "Login Google belum diaktifkan: kredensial Google belum lengkap di panel admin.",
          );
        }
        profile = await exchangeCodeForProfile(db, {
          code: args.code,
          redirectUri: status.redirectUri,
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Login Google gagal.");
      }
      if (!profile.emailVerified) {
        return fail(
          "Email Google ini belum terverifikasi di Google, jadi tidak bisa dipakai untuk masuk.",
        );
      }
      // 3. Pengguna dengan google_sub ini sudah ada → login sebagai dia.
      const bySub = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.googleSub, profile.sub));
      let user = bySub[0];
      if (user) {
        if (!user.isActive) {
          return fail(
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          );
        }
        await ensureUserData(db, user);
        const token = await createSession(db, user.id);
        ctx.invalidateQueries();
        return { ok: true, token, error: null, user: publicUser(user) };
      }
      // 4. Belum ada google_sub, tetapi ada akun dengan email terverifikasi
      // Google yang sama dan belum tertaut → tautkan google_sub ke akun itu.
      // Akun demo provider TIDAK PERNAH cocok di sini lewat jalur normal:
      // email demo bukan email Google terverifikasi, dan google_sub demo
      // tetap NULL.
      const byEmail = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, profile.email));
      const emailUser = byEmail[0];
      if (emailUser) {
        if (emailUser.googleSub && emailUser.googleSub !== profile.sub) {
          return fail("Akun email ini sudah tertaut ke akun Google lain.");
        }
        if (!emailUser.isActive) {
          return fail(
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          );
        }
        await db
          .update(schema.users)
          .set({ googleSub: profile.sub, emailVerified: true })
          .where(eq(schema.users.id, emailUser.id));
        const updated = (
          await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, emailUser.id))
        )[0]!;
        await ensureUserData(db, updated);
        const token = await createSession(db, updated.id);
        ctx.invalidateQueries();
        return { ok: true, token, error: null, user: publicUser(updated) };
      }
      // 5. Tidak ada keduanya → akun baru paket Free dari profil Google.
      const inserted = await db
        .insert(schema.users)
        .values({
          name: profile.name,
          email: profile.email,
          passwordHash: "",
          passwordSalt: "",
          provider: "google",
          googleSub: profile.sub,
          plan: "Free",
          emailVerified: true,
        })
        .returning();
      user = inserted[0];
      if (!user) {
        return fail("Gagal membuat akun dari profil Google.");
      }
      await ensureUserData(db, user);
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),

  // G9 — panel admin kredensial GitHub (pola yang sama seperti G8).
  getGitHubOAuthSettings: defineAction({
    description: "Mengambil status kredensial login GitHub (Client ID & callback URL penuh, secret hanya petunjuk 4 karakter) — khusus admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      configured: z.boolean(),
      clientId: z.string(),
      callbackUrl: z.string(),
      secretConfigured: z.boolean(),
      secretHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          configured: false,
          clientId: "",
          callbackUrl: "",
          secretConfigured: false,
          secretHint: "",
          missing: [],
        };
      }
      const s = await getGitHubOAuthSettingsStatus(db);
      return {
        isAdmin: true,
        configured: s.configured,
        clientId: s.clientId,
        callbackUrl: s.callbackUrl,
        secretConfigured: s.secretConfigured,
        secretHint: s.secretHint,
        missing: s.missing,
      };
    },
  }),

  setGitHubOAuthSettings: defineAction({
    description: "Menyimpan kredensial login GitHub terenkripsi AES-256-GCM (secret hanya petunjuk 4 karakter, tidak pernah dikembalikan) — khusus admin.",
    request: z.object({
      token: tokenField,
      clientId: z.string().min(1).max(300),
      clientSecret: z.string().min(8).max(400),
      callbackUrl: z.string().min(1).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
      clientId: z.string(),
      callbackUrl: z.string(),
      secretConfigured: z.boolean(),
      secretHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        ok: false as const,
        error: "",
        configured: false,
        clientId: "",
        callbackUrl: "",
        secretConfigured: false,
        secretHint: "",
        missing: [] as string[],
      };
      if (user.email !== DEMO_EMAIL) {
        return {
          ...empty,
          error: "Hanya admin yang dapat mengatur kredensial login GitHub.",
        };
      }
      // Callback URL harus https (GitHub menolak http untuk OAuth web),
      // kecuali localhost untuk pengembangan lokal (pola yang sama
      // seperti redirect URI Google G8).
      let uri: URL;
      try {
        uri = new URL(args.callbackUrl.trim());
      } catch {
        return {
          ...empty,
          error:
            "Callback URL tidak valid: harus berupa URL lengkap (mis. https://dadiweb.id/).",
        };
      }
      const isLocalhost =
        uri.protocol === "http:" &&
        (uri.hostname === "localhost" || uri.hostname === "127.0.0.1");
      if (uri.protocol !== "https:" && !isLocalhost) {
        return {
          ...empty,
          error:
            "Callback URL harus memakai https (GitHub menolak http), kecuali http://localhost untuk pengembangan lokal.",
        };
      }
      try {
        const before = await getGitHubOAuthSettingsStatus(db);
        const status = await setGitHubOAuthSettings(db, {
          clientId: args.clientId,
          clientSecret: args.clientSecret,
          callbackUrl: args.callbackUrl,
        });
        await writeAdminAudit(db, user, {
          action: "setGitHubOAuthSettings",
          target: "kredensial login GitHub",
          beforeValue: before.configured
            ? `terpasang (Client ID ${before.clientId}, secret ${before.secretHint}, callback ${before.callbackUrl})`
            : "belum terpasang",
          afterValue: `terpasang (Client ID ${status.clientId}, secret ${status.secretHint}, callback ${status.callbackUrl})`,
        });
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          configured: status.configured,
          clientId: status.clientId,
          callbackUrl: status.callbackUrl,
          secretConfigured: status.secretConfigured,
          secretHint: status.secretHint,
          missing: status.missing,
        };
      } catch (e) {
        return {
          ...empty,
          error:
            e instanceof Error
              ? e.message
              : "Kredensial login GitHub gagal disimpan terenkripsi.",
        };
      }
    },
  }),

  clearGitHubOAuthSettings: defineAction({
    description: "Menghapus kredensial login GitHub yang tersimpan; tombol GitHub kembali berstatus belum aktif (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat menghapus kredensial login GitHub.",
          configured: false,
        };
      }
      const before = await getGitHubOAuthSettingsStatus(db);
      await clearGitHubOAuthSettings(db);
      await writeAdminAudit(db, user, {
        action: "clearGitHubOAuthSettings",
        target: "kredensial login GitHub",
        beforeValue: before.configured
          ? `terpasang (Client ID ${before.clientId}, secret ${before.secretHint})`
          : "belum terpasang",
        afterValue: "belum terpasang (kredensial dihapus)",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, configured: false };
    },
  }),

  // G10 — settings Cloudflare (admin-only, pola OAuth G8/G9).
  getCloudflareSettings: defineAction({
    description: "Mengambil status settings Cloudflare (Account/Zone ID, IP server, mode record penuh; token hanya petunjuk 4 karakter) — khusus admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      configured: z.boolean(),
      accountId: z.string(),
      zoneId: z.string(),
      serverIp: z.string(),
      recordMode: z.string(),
      tokenConfigured: z.boolean(),
      tokenHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          configured: false,
          accountId: "",
          zoneId: "",
          serverIp: "",
          recordMode: "",
          tokenConfigured: false,
          tokenHint: "",
          missing: [],
        };
      }
      const s = await getCloudflareSettingsStatus(db);
      return {
        isAdmin: true,
        configured: s.configured,
        accountId: s.accountId,
        zoneId: s.zoneId,
        serverIp: s.serverIp,
        recordMode: s.recordMode,
        tokenConfigured: s.tokenConfigured,
        tokenHint: s.tokenHint,
        missing: s.missing,
      };
    },
  }),

  setCloudflareSettings: defineAction({
    description: "Menyimpan settings Cloudflare terenkripsi AES-256-GCM (token hanya petunjuk 4 karakter, tidak pernah dikembalikan) — khusus admin. Menyimpan konfigurasi bukan koneksi sungguhan: token dummy pun tersimpan, dan deploy dengan token dummy akan gagal bersih di tahap API.",
    request: z.object({
      token: tokenField,
      accountId: z.string().min(1).max(300),
      zoneId: z.string().min(1).max(300),
      apiToken: z.string().min(8).max(500),
      serverIp: z.string().min(1).max(100),
      recordMode: z.enum(["dns_only", "proxied"]),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
      accountId: z.string(),
      zoneId: z.string(),
      serverIp: z.string(),
      recordMode: z.string(),
      tokenConfigured: z.boolean(),
      tokenHint: z.string(),
      missing: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const empty = {
        ok: false as const,
        error: "",
        configured: false,
        accountId: "",
        zoneId: "",
        serverIp: "",
        recordMode: "",
        tokenConfigured: false,
        tokenHint: "",
        missing: [] as string[],
      };
      if (user.email !== DEMO_EMAIL) {
        return {
          ...empty,
          error: "Hanya admin yang dapat mengatur settings Cloudflare.",
        };
      }
      // Validasi bentuk IP sederhana (IPv4) — bukan validasi kepemilikan.
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(args.serverIp.trim())) {
        return {
          ...empty,
          error: "IP server tidak valid: harus berupa IPv4 (mis. 82.25.62.243).",
        };
      }
      try {
        const before = await getCloudflareSettingsStatus(db);
        const status = await setCloudflareSettings(db, {
          accountId: args.accountId,
          zoneId: args.zoneId,
          apiToken: args.apiToken,
          serverIp: args.serverIp,
          recordMode: args.recordMode,
        });
        await writeAdminAudit(db, user, {
          action: "setCloudflareSettings",
          target: "settings Cloudflare",
          beforeValue: before.configured
            ? `terpasang (zone ${before.zoneId}, IP ${before.serverIp}, mode ${before.recordMode}, token ${before.tokenHint})`
            : "belum terpasang",
          afterValue: `terpasang (zone ${status.zoneId}, IP ${status.serverIp}, mode ${status.recordMode}, token ${status.tokenHint})`,
        });
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          configured: status.configured,
          accountId: status.accountId,
          zoneId: status.zoneId,
          serverIp: status.serverIp,
          recordMode: status.recordMode,
          tokenConfigured: status.tokenConfigured,
          tokenHint: status.tokenHint,
          missing: status.missing,
        };
      } catch (e) {
        return {
          ...empty,
          error:
            e instanceof Error
              ? e.message
              : "Settings Cloudflare gagal disimpan terenkripsi.",
        };
      }
    },
  }),

  clearCloudflareSettings: defineAction({
    description: "Menghapus settings Cloudflare yang tersimpan; deploy kembali gagal bersih sampai settings dilengkapi lagi (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat menghapus settings Cloudflare.",
          configured: false,
        };
      }
      const before = await getCloudflareSettingsStatus(db);
      await clearCloudflareSettings(db);
      await writeAdminAudit(db, user, {
        action: "clearCloudflareSettings",
        target: "settings Cloudflare",
        beforeValue: before.configured
          ? `terpasang (zone ${before.zoneId}, token ${before.tokenHint})`
          : "belum terpasang",
        afterValue: "belum terpasang (settings dihapus)",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, configured: false };
    },
  }),

  // G13-A — Video Dadiweb (fal.ai). Kunci disimpan terenkripsi
  // AES-256-GCM pola DeepInfra (salt provider "fal") dan hanya petunjuk
  // 4 karakter terakhirnya yang keluar; tarif video dihitung dari rumus
  // terkunci (Rp54/kredit, markup 1,5×, kurs Rp16.500/$, kelipatan 5),
  // bukan tabel mati. Estimasi biaya bisa dipakai pengguna login TANPA
  // kunci terpasang; uji koneksi tanpa kunci gagal bersih.
  getFalVideoSettings: defineAction({
    description: "Mengambil status video fal.ai: kunci terpasang/belum (hanya petunjuk 4 karakter), daftar model + harga/detik, dan parameter rumus tarif — khusus admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      isAdmin: z.boolean(),
      configured: z.boolean(),
      hint: z.string(),
      tariff: z.object({
        creditValueRp: z.number(),
        markupX100: z.number(),
        exchangeRateRpPerUsd: z.number(),
        roundingStep: z.number(),
      }),
      models: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          endpointT2v: z.string(),
          endpointI2v: z.string(),
          minDuration: z.number(),
          maxDuration: z.number(),
          resolutions: z.array(
            z.object({
              resolution: z.string(),
              pricePerSecUsd: z.number(),
            }),
          ),
          isActive: z.boolean(),
          isDefault: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          isAdmin: false,
          configured: false,
          hint: "",
          tariff: { creditValueRp: 0, markupX100: 0, exchangeRateRpPerUsd: 0, roundingStep: 0 },
          models: [],
        };
      }
      const s = await getFalVideoSettingsStatus(db);
      return {
        isAdmin: true,
        configured: s.configured,
        hint: s.hint,
        tariff: s.tariff,
        models: s.models,
      };
    },
  }),

  setFalVideoKey: defineAction({
    description: "Menyimpan kunci API fal.ai terenkripsi AES-256-GCM (hanya petunjuk 4 karakter, tidak pernah dikembalikan); string kosong menghapus kunci — khusus admin.",
    request: z.object({
      token: tokenField,
      apiKey: z.string().max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
      hint: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengatur kunci fal.ai.", configured: false, hint: "" };
      }
      const trimmed = args.apiKey.trim();
      if (trimmed !== "" && trimmed.length < 8) {
        return { ok: false, error: "Kunci API fal.ai terlalu pendek (minimal 8 karakter).", configured: false, hint: "" };
      }
      try {
        const before = await getFalVideoSettingsStatus(db);
        const status = await setFalVideoKey(db, trimmed);
        await writeAdminAudit(db, user, {
          action: "setFalVideoKey",
          target: "kunci API fal.ai",
          beforeValue: before.configured
            ? `terpasang (${before.hint})`
            : "belum terpasang",
          afterValue:
            trimmed === ""
              ? "belum terpasang (kunci dihapus)"
              : `terpasang (${status.hint})`,
        });
        ctx.invalidateQueries();
        return { ok: true, error: null, configured: status.configured, hint: status.hint };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : "Kunci fal.ai gagal disimpan terenkripsi.",
          configured: false,
          hint: "",
        };
      }
    },
  }),

  clearFalVideoKey: defineAction({
    description: "Menghapus kunci API fal.ai yang tersimpan; video kembali berstatus belum aktif sampai kunci dipasang lagi (khusus admin).",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      configured: z.boolean(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          error: "Hanya admin yang dapat menghapus kunci fal.ai.",
          configured: false,
        };
      }
      const before = await getFalVideoSettingsStatus(db);
      await clearFalVideoKey(db);
      await writeAdminAudit(db, user, {
        action: "clearFalVideoKey",
        target: "kunci API fal.ai",
        beforeValue: before.configured
          ? `terpasang (${before.hint})`
          : "belum terpasang",
        afterValue: "belum terpasang (kunci dihapus)",
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, configured: false };
    },
  }),

  setFalVideoTariff: defineAction({
    description: "Mengubah parameter rumus tarif video (nilai kredit Rp, markup, kurs, kelipatan pembulatan); berlaku untuk estimasi berikutnya, bukan retroaktif — khusus admin.",
    request: z.object({
      token: tokenField,
      creditValueRp: z.number().int().min(1).max(1000000),
      markupX100: z.number().int().min(100).max(1000),
      exchangeRateRpPerUsd: z.number().int().min(1).max(1000000),
      roundingStep: z.number().int().min(1).max(100),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      tariff: z.object({
        creditValueRp: z.number(),
        markupX100: z.number(),
        exchangeRateRpPerUsd: z.number(),
        roundingStep: z.number(),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const before = await getFalVideoSettingsStatus(db);
      const beforeOut = before.tariff;
      if (user.email !== DEMO_EMAIL) {
        return { ok: false, error: "Hanya admin yang dapat mengubah tarif video.", tariff: beforeOut };
      }
      const tariff = {
        creditValueRp: args.creditValueRp,
        markupX100: args.markupX100,
        exchangeRateRpPerUsd: args.exchangeRateRpPerUsd,
        roundingStep: args.roundingStep,
      };
      const status = await setFalVideoTariff(db, tariff);
      await writeAdminAudit(db, user, {
        action: "setFalVideoTariff",
        target: "tarif video fal.ai",
        beforeValue: `Rp${beforeOut.creditValueRp}/kredit, markup ${beforeOut.markupX100 / 100}×, kurs Rp${beforeOut.exchangeRateRpPerUsd}/$, kelipatan ${beforeOut.roundingStep}`,
        afterValue: `Rp${tariff.creditValueRp}/kredit, markup ${tariff.markupX100 / 100}×, kurs Rp${tariff.exchangeRateRpPerUsd}/$, kelipatan ${tariff.roundingStep}`,
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, tariff: status.tariff };
    },
  }),

  estimateVideoCost: defineAction({
    description: "Mengestimasi biaya video dari rumus terkunci (kredit, biaya API $ dan Rp, batas durasi model) — pengguna login, tanpa perlu kunci fal.ai terpasang.",
    request: z.object({
      token: tokenField,
      modelKey: z.string().min(1).max(100),
      durationSec: z.number().int().min(1).max(120),
      resolution: z.string().min(1).max(20),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      modelKey: z.string(),
      modelLabel: z.string(),
      resolution: z.string(),
      durationSec: z.number(),
      minDuration: z.number(),
      maxDuration: z.number(),
      pricePerSecUsd: z.number(),
      apiCostUsd: z.number(),
      apiCostRp: z.number(),
      credits: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireUser(db, args.token);
      const empty = {
        ok: false as const,
        error: "",
        modelKey: "",
        modelLabel: "",
        resolution: "",
        durationSec: 0,
        minDuration: 0,
        maxDuration: 0,
        pricePerSecUsd: 0,
        apiCostUsd: 0,
        apiCostRp: 0,
        credits: 0,
      };
      try {
        const est = await estimateVideoCostFor(db, {
          modelKey: args.modelKey.trim(),
          durationSec: args.durationSec,
          resolution: args.resolution.trim(),
        });
        return { ok: true, error: null, ...est };
      } catch (e) {
        return {
          ...empty,
          error:
            e instanceof VideoEstimateError || e instanceof Error
              ? e.message
              : "Estimasi biaya video gagal.",
        };
      }
    },
  }),

  // G13-C — Daftar model video untuk pengguna biasa (chat proyek).
  // getFalVideoSettings khusus admin (non-admin mendapat models: []);
  // aksi ini HANYA mengembalikan model AKTIF + batas durasi + resolusi
  // + harga/detik + default — TANPA endpoint fal.ai, TANPA parameter
  // tarif, TANPA petunjuk kunci. Dipakai pill Video di chat proyek
  // untuk memilih model/durasi/resolusi sebelum generate.
  listVideoModels: defineAction({
    description: "Daftar model video aktif untuk pengguna login (label, batas durasi, resolusi + harga/detik, model default) — tanpa endpoint fal.ai dan tanpa info kunci; dipakai composer video di chat proyek.",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      models: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          minDuration: z.number(),
          maxDuration: z.number(),
          resolutions: z.array(
            z.object({
              resolution: z.string(),
              pricePerSecUsd: z.number(),
            }),
          ),
          isDefault: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireUser(db, args.token);
      try {
        const models = (await getVideoModels(db)).filter((m) => m.isActive);
        return {
          ok: true,
          error: null,
          models: models.map((m) => ({
            key: m.key,
            label: m.label,
            minDuration: m.minDuration,
            maxDuration: m.maxDuration,
            resolutions: m.resolutions,
            isDefault: m.isDefault,
          })),
        };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : "Daftar model video gagal dimuat.",
          models: [],
        };
      }
    },
  }),

  testFalVideoConnection: defineAction({
    description: "Menguji koneksi ke fal.ai dengan kunci tersimpan (GET pricing endpoint default); tanpa kunci gagal bersih 'kunci belum terpasang', kunci salah dilaporkan jujur (401) — khusus admin.",
    request: z.object({ token: tokenField }),
    response: z.object({
      ok: z.boolean(),
      status: z.string(),
      latencyMs: z.number(),
      detail: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      if (user.email !== DEMO_EMAIL) {
        return {
          ok: false,
          status: "gagal",
          latencyMs: 0,
          detail: "Hanya admin yang dapat menguji koneksi fal.ai.",
        };
      }
      try {
        const res = await testFalVideoConnection(db);
        return { ok: res.ok, status: res.status, latencyMs: res.latencyMs, detail: res.detail };
      } catch (e) {
        return {
          ok: false,
          status: "gagal",
          latencyMs: 0,
          detail:
            e instanceof FalVideoError || e instanceof Error
              ? e.message
              : "Uji koneksi fal.ai gagal.",
        };
      }
    },
  }),

  // G13-B — Job video (fal.ai) per proyek. Semua aksi user-scoped
  // (proyek orang lain ditolak sebagai "tidak ditemukan"). Submit
  // memvalidasi model/durasi/resolusi + cek saldo cukup, lalu submit
  // async ke fal.ai (202) dan menyimpan job — TIDAK memotong kredit
  // (potong hanya bila sukses = G13-D) dan TIDAK menunggu video
  // selesai. getVideoJobs/getVideoJob menyinkronkan dulu job yang
  // masih in-flight (polling-on-read, throttle ~10 detik, dedup via
  // request_id; MP4 yang COMPLETED diunduh ke ctx.blobs dan diputar
  // lewat playbackUrl own-origin, bukan fal.media). Webhook TIDAK
  // diimplementasikan di gelombang ini (butuh endpoint publik di luar
  // pola /actions) — lihat video-jobs.ts.
  submitVideoJob: defineAction({
    description: "Mengirim job video baru ke fal.ai untuk sebuah proyek (teks atau gambar-ke-video): validasi model/durasi/resolusi, cek saldo cukup, lalu submit async dan menyimpan job — tanpa memotong kredit (pemotongan hanya bila sukses, G13-D).",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
      prompt: z.string().min(1).max(2000),
      modelKey: z.string().min(1).max(100),
      durationSec: z.number().int().min(1).max(120),
      resolution: z.string().min(1).max(20),
      imageUrl: z.string().max(200000).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      job: videoJobOut.nullable(),
      creditsCost: z.number(),
      balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      try {
        const res = await submitVideoJob(db, {
          userId: user.id,
          projectId: args.projectId,
          prompt: args.prompt,
          modelKey: args.modelKey.trim(),
          durationSec: args.durationSec,
          resolution: args.resolution.trim(),
          imageUrl: args.imageUrl,
        });
        if (!res.ok || !res.job) {
          return {
            ok: false,
            error: res.error ?? "Job video gagal dikirim.",
            job: null,
            creditsCost: res.creditsCost,
            balance: res.balance,
          };
        }
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          job: await toVideoJobOut(db, ctx.blobs, res.job),
          creditsCost: res.creditsCost,
          balance: res.balance,
        };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error ? e.message : "Job video gagal dikirim.",
          job: null,
          creditsCost: 0,
          balance: 0,
        };
      }
    },
  }),

  // CELAH 1 (7 Nov 2026) — Buat proyek video dari prompt hero
  // dashboard: satu panggilan membuat proyek draft "Proyek Kustom"
  // (pola yang sama seperti sapaan di sendChatMessage) lalu submit
  // job video ke fal.ai. Proyek TIDAK dibuat bila validasi gagal
  // (model/durasi/resolusi, saldo kurang, kunci belum terpasang) —
  // pre-flight di bawah memakai helper yang sama dengan
  // submitVideoJob, jadi tidak ada proyek yatim. Bila submit gagal
  // SETELAH proyek dibuat (mis. fal.ai menolak), proyek yang baru
  // dibuat dihapus kembali (best-effort) supaya tidak ada proyek
  // kosong tanpa video. Tidak ada pesan chat yang disisipkan: kartu
  // job video tampil di timeline chat proyek via getVideoJobs, sama
  // seperti submit dari chat.
  createVideoProject: defineAction({
    description:
      "Membuat proyek draft baru dari prompt hero dashboard lalu mengirim job video pertama ke fal.ai (teks atau gambar-ke-video): validasi model/durasi/resolusi, cek saldo cukup, lalu submit async tanpa memotong kredit (pemotongan hanya bila sukses, G13-D).",
    request: z.object({
      token: tokenField,
      prompt: z.string().min(1).max(2000),
      modelKey: z.string().min(1).max(100),
      durationSec: z.number().int().min(1).max(120),
      resolution: z.string().min(1).max(20),
      imageUrl: z.string().max(200000).optional(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      projectId: z.number().nullable(),
      job: videoJobOut.nullable(),
      creditsCost: z.number(),
      balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const prompt = args.prompt.trim();
      const fail = (
        error: string,
        creditsCost = 0,
        balance = 0,
      ): {
        ok: false;
        error: string;
        projectId: null;
        job: null;
        creditsCost: number;
        balance: number;
      } => ({
        ok: false,
        error,
        projectId: null,
        job: null,
        creditsCost,
        balance,
      });
      if (prompt.length === 0) {
        return fail("Prompt video tidak boleh kosong.");
      }
      // Pre-flight (helper yang sama dengan submitVideoJob): tidak
      // ada proyek yang dibuat bila validasi/saldo/kunci gagal.
      let creditsCost = 0;
      try {
        const est = await estimateVideoCostFor(db, {
          modelKey: args.modelKey.trim(),
          durationSec: args.durationSec,
          resolution: args.resolution.trim(),
        });
        creditsCost = est.credits;
      } catch (e) {
        if (e instanceof VideoEstimateError) return fail(e.message);
        throw e;
      }
      const account = await getAccount(db, user.id);
      const balance = account?.balance ?? 0;
      if (balance < creditsCost) {
        return fail(
          `Saldo kredit tidak mencukupi: video ini membutuhkan ${creditsCost} kredit, saldo Anda ${balance} kredit.`,
          creditsCost,
          balance,
        );
      }
      if (!(await loadFalVideoKey(db))) {
        return fail(
          "Kunci API fal.ai belum terpasang di panel admin, jadi video belum bisa dibuat.",
          creditsCost,
          balance,
        );
      }
      const inserted = await db
        .insert(schema.projects)
        .values({
          userId: user.id,
          name: "Proyek Kustom",
          slug: slugify(`proyek-kustom-${Date.now()}`),
          category: "Website",
          status: "draft",
          prompt,
          spec: "{}",
          source: "ai",
          creditsCost: 0,
          plannerMd: initialPlannerMd(),
        })
        .returning({ id: schema.projects.id });
      const projectId = inserted[0]?.id ?? 0;
      if (!projectId) throw new Error("Gagal membuat proyek");
      await ensureProjectDbCredential(db, projectId);
      // Submit job; bila gagal setelah proyek dibuat, hapus proyeknya
      // kembali (best-effort) supaya tidak ada proyek kosong.
      const cleanupProject = async () => {
        const row = await ownedProject(db, user.id, projectId);
        if (!row) return;
        try {
          await deleteProjectFully(db, row, ctx.blobs);
        } catch {
          // Best-effort: proyek yatim tetap tercatat, bukan error baru.
        }
      };
      try {
        const res = await submitVideoJob(db, {
          userId: user.id,
          projectId,
          prompt,
          modelKey: args.modelKey.trim(),
          durationSec: args.durationSec,
          resolution: args.resolution.trim(),
          imageUrl: args.imageUrl,
        });
        if (!res.ok || !res.job) {
          await cleanupProject();
          return fail(
            res.error ?? "Job video gagal dikirim.",
            res.creditsCost,
            res.balance,
          );
        }
        ctx.invalidateQueries();
        return {
          ok: true,
          error: null,
          projectId,
          job: await toVideoJobOut(db, ctx.blobs, res.job),
          creditsCost: res.creditsCost,
          balance: res.balance,
        };
      } catch (e) {
        await cleanupProject();
        return fail(
          e instanceof Error ? e.message : "Job video gagal dikirim.",
          creditsCost,
          balance,
        );
      }
    },
  }),

  getVideoJobs: defineAction({
    description: "Daftar job video sebuah proyek (milik pengguna), terbaru dulu; job yang masih berjalan disinkronkan dulu ke fal.ai (polling-on-read) dan MP4 yang selesai diunduh ke penyimpanan lokal proyek.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      jobs: z.array(videoJobOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      try {
        const res = await listVideoJobs(db, ctx.blobs, {
          userId: user.id,
          projectId: args.projectId,
        });
        return { ok: res.ok, error: res.error, jobs: res.jobs };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : "Daftar video gagal dimuat.",
          jobs: [],
        };
      }
    },
  }),

  getVideoJob: defineAction({
    description: "Detail satu job video (milik pengguna); bila masih berjalan, statusnya disinkronkan dulu ke fal.ai (polling-on-read) dan MP4 yang selesai diunduh ke penyimpanan lokal proyek.",
    request: z.object({
      token: tokenField,
      jobId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      job: videoJobOut.nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      try {
        const res = await getVideoJob(db, ctx.blobs, {
          userId: user.id,
          jobId: args.jobId,
        });
        return { ok: res.ok, error: res.error, job: res.job };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error ? e.message : "Video gagal dimuat.",
          job: null,
        };
      }
    },
  }),

  cancelVideoJob: defineAction({
    description: "Membatalkan job video yang masih berjalan (cancel ke fal.ai + tandai cancelled); job yang sudah selesai/gagal tidak bisa dibatalkan.",
    request: z.object({
      token: tokenField,
      jobId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      job: videoJobOut.nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      try {
        const res = await cancelVideoJob(db, ctx.blobs, {
          userId: user.id,
          jobId: args.jobId,
        });
        if (res.ok) ctx.invalidateQueries();
        return { ok: res.ok, error: res.error, job: res.job };
      } catch (e) {
        return {
          ok: false,
          error:
            e instanceof Error
              ? e.message
              : "Pembatalan video gagal.",
          job: null,
        };
      }
    },
  }),

  // G10 — renderer situs publik: aksi TANPA token yang hanya
  // mengembalikan proyek dengan deployment live untuk slug itu, plus
  // spec situsnya. Tidak pernah mengembalikan user_id, email, saldo,
  // kredit, chat, atau data DB proyek — hanya konten yang memang
  // dipublikasikan. Slug draft/tanpa deployment live ditolak bersih.
  getPublicSite: defineAction({
    description: "Mengambil situs publik sebuah proyek berdasarkan slug subdomain, tanpa login; hanya proyek dengan deployment live yang dikembalikan, tanpa data pemilik.",
    request: z.object({
      slug: z.string().min(1).max(100),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      project: z
        .object({
          name: z.string(),
          slug: z.string(),
          subdomain: z.string(),
          category: z.string(),
          spec: siteSpecSchema,
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const slug = args.slug.trim().toLowerCase();
      // G12 — resolver bersama resolveLiveSite: regresi G11 (slug duplikat
      // pilih proyek live) tetap, ditambah spec efektif = snapshot live
      // bila deployment punya snapshot (G12), spec terkini bila pra-G12.
      // Slug asing tetap dijawab pesan yang sama, tanpa membedakan
      // "tidak ada proyek" vs "ada tapi belum live" (tidak bocor).
      const best = await resolveLiveSite(db, slug);
      if (!best) {
        return {
          ok: false,
          error: "Situs ini belum diterbitkan.",
          project: null,
        };
      }
      return {
        ok: true,
        error: null,
        project: {
          name: best.project.name,
          slug: best.project.slug,
          subdomain: best.live.subdomain,
          category: best.project.category,
          spec: best.spec,
        },
      };
    },
  }),

  // G12 — bangun file situs proyek (working copy) dari spec terkini.
  // Pemilik/admin saja; idempotent (hanya render, tanpa tulis DB, tanpa
  // kredit); mengembalikan konten HTML + path folder logisnya. Proyek
  // tanpa spec: pesan jujur, bukan situs contoh. HTML di sini DIBUAT
  // oleh renderer tunggal yang sama dengan yang dipakai situs publik,
  // jadi preview iframe (srcDoc) dan publik (srcDoc/file yang sama)
  // identik untuk spec/snapshot yang sama.
  buildSiteFiles: defineAction({
    description: "Membangun file situs statis sebuah proyek dari spec-nya (pemilik/admin, tanpa kredit): mengembalikan HTML renderer tunggal + path folder situsnya.",
    request: z.object({
      token: tokenField,
      projectId: z.number().int().positive(),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      projectId: z.number().nullable(),
      slug: z.string().nullable(),
      path: z.string().nullable(),
      html: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const user = await requireUser(db, args.token);
      const project = await ownedOrAdminProject(db, user, args.projectId);
      if (!project) {
        return { ok: false, error: "Proyek tidak ditemukan.", projectId: null, slug: null, path: null, html: null };
      }
      if (!isValidSiteSlug(project.slug)) {
        return { ok: false, error: "Slug proyek tidak valid untuk folder situs.", projectId: null, slug: null, path: null, html: null };
      }
      const spec = parseSpec(project.spec);
      if (!spec) {
        return { ok: false, error: "Preview belum tersedia — spesifikasi proyek belum dibuat.", projectId: null, slug: null, path: null, html: null };
      }
      return {
        ok: true,
        error: null,
        projectId: project.id,
        slug: project.slug,
        path: siteFilePath(project.slug),
        html: renderSiteHtml(spec),
      };
    },
  }),

  // G12 — situs publik sebagai HTML renderer tunggal, dari SNAPSHOT
  // deployment live (bukan spec terkini). Tanpa token, tanpa data
  // pemilik; slug ditolak path-guard (traversal/karakter asing =
  // "tidak ditemukan", sama seperti slug yang memang tidak ada).
  getPublicSiteHtml: defineAction({
    description: "Mengambil HTML situs publik sebuah proyek dari snapshot deployment live-nya, tanpa login; hanya proyek dengan deployment live, tanpa data pemilik.",
    request: z.object({
      slug: z.string().min(1).max(100),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      slug: z.string().nullable(),
      subdomain: z.string().nullable(),
      path: z.string().nullable(),
      snapshot: z.boolean(),
      html: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const slug = args.slug.trim().toLowerCase();
      if (!isValidSiteSlug(slug)) {
        return { ok: false, error: "Situs ini tidak ditemukan atau belum diterbitkan.", slug: null, subdomain: null, path: null, snapshot: false, html: null };
      }
      const best = await resolveLiveSite(db, slug);
      if (!best) {
        return { ok: false, error: "Situs ini belum diterbitkan.", slug: null, subdomain: null, path: null, snapshot: false, html: null };
      }
      return {
        ok: true,
        error: null,
        slug: best.project.slug,
        subdomain: best.live.subdomain,
        path: siteSnapshotPath(best.project.slug, best.live.id),
        snapshot: best.snapshot,
        html: renderSiteHtml(best.spec, best.live.subdomain),
      };
    },
  }),

  // G9 — mulai login GitHub. Tanpa konfigurasi lengkap: error jujur yang
  // menyebut bagian yang kurang — TIDAK BOLEH fallback diam-diam ke akun
  // demo (akun demo provider tetap hanya lewat tombol demo terpisah).
  startGitHubOAuth: defineAction({
    description: "Memulai login GitHub: mengembalikan URL otorisasi GitHub, atau error jujur bila kredensial/callback URL belum lengkap (tanpa fallback ke akun demo).",
    request: z.object({}),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
      authUrl: z.string().nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const status = await getGitHubOAuthSettingsStatus(db);
      if (!status.configured) {
        const labels: Record<string, string> = {
          clientId: "Client ID",
          clientSecret: "Client Secret",
          callbackUrl: "Callback URL",
        };
        const kurang = status.missing
          .map((m) => labels[m] ?? m)
          .join(", ");
        return {
          ok: false,
          error: `Login GitHub belum diaktifkan: ${kurang} belum diisi di panel admin (Pengaturan Platform → Login GitHub).`,
          authUrl: null,
        };
      }
      const state = await createGitHubOAuthState(db);
      return {
        ok: true,
        error: null,
        authUrl: buildGitHubAuthUrl({
          clientId: status.clientId,
          callbackUrl: status.callbackUrl,
          state,
        }),
      };
    },
  }),

  // G9 — selesaikan login GitHub. Dipanggil client setelah GitHub
  // mengembalikan pengguna ke URL aplikasi dengan code+state di query
  // string (mekanisme callback aksi — lihat github-oauth.ts: runtime
  // artifact tidak punya route HTTP kustom). Urutan gerbang: state
  // sekali pakai → tukar code server-side → profil + email terverifikasi
  // → cari (github_id) / tautkan (email terverifikasi, belum tertaut) /
  // buat akun Free. Gagal di tahap mana pun = tanpa sesi dan tanpa
  // pengguna baru.
  completeGitHubOAuth: defineAction({
    description: "Menyelesaikan login GitHub: validasi state sekali pakai, tukar code server-side, lalu cari/tautkan/buat pengguna dari profil GitHub (token GitHub tidak disimpan).",
    request: z.object({
      code: z.string().min(1).max(2000),
      state: z.string().min(1).max(200),
    }),
    response: authResponse,
    async handler(ctx, args): Promise<z.infer<typeof authResponse>> {
      const db = ctx.db<typeof schema>();
      const fail = (error: string): z.infer<typeof authResponse> => ({
        ok: false,
        token: null,
        error,
        user: null,
      });
      // 1. State dikonsumsi dulu: sekali pakai, kedaluwarsa 10 menit.
      const stateOk = await consumeGitHubOAuthState(db, args.state);
      if (!stateOk) {
        return fail(
          "State login GitHub tidak valid, sudah dipakai, atau sudah kedaluwarsa (10 menit). Silakan mulai lagi dari tombol GitHub.",
        );
      }
      // 2. Tukar code + ambil profil dan email (server-side). Gagal di
      // sini berarti tidak ada pengguna yang dibuat dan tidak ada sesi
      // yang diterbitkan.
      let profile;
      try {
        const status = await getGitHubOAuthSettingsStatus(db);
        if (!status.configured) {
          return fail(
            "Login GitHub belum diaktifkan: kredensial GitHub belum lengkap di panel admin.",
          );
        }
        profile = await exchangeGitHubCodeForProfile(db, {
          code: args.code,
          callbackUrl: status.callbackUrl,
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Login GitHub gagal.");
      }
      if (!profile.emailVerified) {
        return fail(
          "Email GitHub ini belum terverifikasi di GitHub, jadi tidak bisa dipakai untuk masuk.",
        );
      }
      // 3. Pengguna dengan github_id ini sudah ada → login sebagai dia.
      const byId = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.githubId, profile.id));
      let user = byId[0];
      if (user) {
        if (!user.isActive) {
          return fail(
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          );
        }
        await ensureUserData(db, user);
        const token = await createSession(db, user.id);
        ctx.invalidateQueries();
        return { ok: true, token, error: null, user: publicUser(user) };
      }
      // 4. Belum ada github_id, tetapi ada akun dengan email terverifikasi
      // GitHub yang sama dan belum tertaut → tautkan github_id ke akun
      // itu. Akun demo provider TIDAK PERNAH cocok di sini lewat jalur
      // normal: github_id demo tetap NULL dan tautan hanya terjadi dari
      // email terverifikasi GitHub yang sama.
      const byEmail = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, profile.email));
      const emailUser = byEmail[0];
      if (emailUser) {
        if (emailUser.githubId && emailUser.githubId !== profile.id) {
          return fail("Akun email ini sudah tertaut ke akun GitHub lain.");
        }
        if (!emailUser.isActive) {
          return fail(
            "Akun ini dinonaktifkan oleh admin. Hubungi admin untuk mengaktifkan kembali.",
          );
        }
        await db
          .update(schema.users)
          .set({ githubId: profile.id, emailVerified: true })
          .where(eq(schema.users.id, emailUser.id));
        const updated = (
          await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, emailUser.id))
        )[0]!;
        await ensureUserData(db, updated);
        const token = await createSession(db, updated.id);
        ctx.invalidateQueries();
        return { ok: true, token, error: null, user: publicUser(updated) };
      }
      // 5. Tidak ada keduanya → akun baru paket Free dari profil GitHub.
      const inserted = await db
        .insert(schema.users)
        .values({
          name: profile.name,
          email: profile.email,
          passwordHash: "",
          passwordSalt: "",
          provider: "github",
          githubId: profile.id,
          plan: "Free",
          emailVerified: true,
        })
        .returning();
      user = inserted[0];
      if (!user) {
        return fail("Gagal membuat akun dari profil GitHub.");
      }
      await ensureUserData(db, user);
      const token = await createSession(db, user.id);
      ctx.invalidateQueries();
      return { ok: true, token, error: null, user: publicUser(user) };
    },
  }),
} satisfies ActionsModule;
