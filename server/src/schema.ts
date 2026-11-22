// Drizzle schema for Dadiweb MVP prototype.
//
// Per-user data isolation: every user-owned row carries the owner's user
// id (directly, or through its project). Workspace and credit account rows
// are keyed by the owner's user id (workspace.id / credit_account.id ==
// users.id), so each account has exactly one workspace and one credit
// account. Templates stay a shared global catalog.

import {
integer,
primaryKey,
real,
sqliteTable,
text,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull().default(""),
  passwordSalt: text("password_salt").notNull().default(""),
  provider: text("provider", { enum: ["email", "google", "github"] })
    .notNull()
    .default("email"),
  plan: text("plan").notNull().default("Pro Plan"),
  // G8 — kunci tautan login Google: subject ("sub") unik dari profil
  // Google pengguna. NULL untuk akun yang belum pernah login lewat
  // Google (termasuk akun demo provider lama — google_sub mereka tetap
  // NULL karena demo tidak pernah melewati OAuth sungguhan, sehingga
  // alur baru tidak akan pernah mencocokkan akun demo). Unique index di
  // migrasi 0016; SQLite mengizinkan banyak NULL di kolom unique.
  googleSub: text("google_sub").unique(),
  // G9 — kunci tautan login GitHub: ID numerik unik dari profil GitHub
  // pengguna (disimpan sebagai teks). NULL untuk akun yang belum pernah
  // login lewat GitHub (termasuk akun demo provider lama — github_id
  // mereka tetap NULL karena demo tidak pernah melewati OAuth sungguhan,
  // sehingga alur baru tidak akan pernah mencocokkan akun demo).
  // Unique index di migrasi 0017; SQLite mengizinkan banyak NULL di
  // kolom unique.
  githubId: text("github_id").unique(),
  // G5-C — akun nonaktif tidak bisa login/generate; datanya tidak dihapus.
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date(Date.now() + 30 * 24 * 3600_000)),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  category: text("category").notNull().default("Website"),
  status: text("status", { enum: ["online", "draft", "archived"] })
    .notNull()
    .default("draft"),
  prompt: text("prompt").notNull().default(""),
  // G0 — pencatatan katalog skill: rencana skill per tahap (JSON) dan versi
  // katalog yang dipakai saat proyek dibuat (JSON). Kosong untuk proyek
  // yang dibuat sebelum G0.
  skillPlan: text("skill_plan").notNull().default(""),
  skillVersions: text("skill_versions").notNull().default(""),
  spec: text("spec").notNull().default("{}"),
  // G6 — planner MD proyek (dokumen markdown brief hasil diskusi chat
  // perencana). Disimpan sebagai kolom di baris proyek (bukan tabel
  // baru) sehingga ikut terhapus otomatis saat proyek/akun dihapus —
  // tidak ada risiko foreign key seperti tabel turunan baru.
  plannerMd: text("planner_md").notNull().default(""),
  // G7 — anggaran pertanyaan detail chat perencana: jumlah putaran
  // pertanyaan detail yang sudah diajukan assistant untuk proyek ini
  // (maksimal 2; putaran ke-3 tidak ada — pesan berikutnya memicu build
  // otomatis bila ada brief). Kolom di baris proyek, jadi ikut terhapus
  // otomatis saat proyek/akun dihapus; direset ke 0 setiap build sukses
  // lewat chat. Sapaan pembuka TIDAK dihitung sebagai putaran.
  questionRounds: integer("question_rounds").notNull().default(0),
  source: text("source", { enum: ["ai", "template", "example"] })
    .notNull()
    .default("ai"),
  creditsCost: integer("credits_cost").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const generations = sqliteTable("generations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  stage: text("stage").notNull(),
  status: text("status", { enum: ["done", "failed"] })
    .notNull()
    .default("done"),
  credits: integer("credits").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per user, keyed by the owner's user id.
export const creditAccount = sqliteTable("credit_account", {
  id: integer("id").primaryKey(),
  plan: text("plan").notNull().default("Pro Plan"),
  monthlyQuota: integer("monthly_quota").notNull().default(5000),
  balance: integer("balance").notNull().default(0),
});

export const creditLedger = sqliteTable("credit_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  kind: text("kind", {
    // Enum ini hanya penanda TS: DDL SQLite (drizzle/0002) tidak punya
    // CHECK constraint untuk kind, jadi tidak ada pembangunan ulang tabel.
    enum: ["generate", "deploy", "topup", "adjust", "bonus", "chat"],
  })
    .notNull()
    .default("generate"),
  label: text("label").notNull(),
  category: text("category").notNull().default("AI Coding"),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  projectId: integer("project_id").references(() => projects.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const creditUsage = sqliteTable(
  "credit_usage",
  {
    userId: integer("user_id").notNull(),
    category: text("category").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.category] }) }),
);

export const templates = sqliteTable("templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tagline: text("tagline").notNull().default(""),
  hue: integer("hue").notNull().default(230),
  uses: integer("uses").notNull().default(0),
  spec: text("spec").notNull().default("{}"),
});

export const projectTables = sqliteTable("project_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  // G2 — nama skema logis pemilik tabel ini: selalu proj_<project_id>.
  // Di prototipe (SQLite app.db) tidak ada skema PostgreSQL sungguhan;
  // kolom ini + filter project_id di setiap query adalah wujud skemanya.
  schemaName: text("schema_name").notNull().default(""),
  columnsJson: text("columns_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectRows = sqliteTable("project_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id")
    .notNull()
    .references(() => projectTables.id),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const deployments = sqliteTable("deployments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  subdomain: text("subdomain").notNull(),
  // "live" = versi yang sedang tayang; "superseded" = pernah tayang lalu
  // digantikan deploy/redeploy/rollback yang lebih baru (target rollback).
  status: text("status", { enum: ["live", "building", "failed", "superseded"] })
    .notNull()
    .default("live"),
  kind: text("kind", { enum: ["deploy", "redeploy", "rollback"] })
    .notNull()
    .default("deploy"),
  note: text("note").notNull().default(""),
  // G10 — ID record DNS Cloudflare untuk subdomain ini (kosong = belum
  // ada record; baris deployment pra-G10 tetap kosong dan UI menandainya
  // "Menunggu", bukan "Selesai"). dns_status: "created" (record baru
  // dibuat saat deploy ini) atau "reused" (redeploy memakai record yang
  // sudah ada untuk slug yang sama).
  cloudflareRecordId: text("cloudflare_record_id").notNull().default(""),
  dnsStatus: text("dns_status").notNull().default(""),
  // G12 — snapshot spec situs pada saat deployment ini diterbitkan.
  // Kosong ("") = deployment pra-G12: situs publik memakai spec proyek
  // terkini sebagai jalur kompatibilitas sampai redeploy berikutnya.
  siteSnapshotSpec: text("site_snapshot_spec").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Invoice/kuitansi untuk setiap transaksi berbayar (top up kredit & ganti
// paket). Terhubung ke baris buku besar pemicunya lewat ledger_id agar
// rekonsiliasi invoice ↔ ledger selalu bisa diperiksa.
export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  ledgerId: integer("ledger_id").references(() => creditLedger.id),
  number: text("number").notNull().default(""),
  kind: text("kind", { enum: ["topup", "plan", "adjust"] }).notNull().default("topup"),
  title: text("title").notNull(),
  amountIdr: integer("amount_idr"),
  creditsDelta: integer("credits_delta").notNull().default(0),
  balanceAfter: integer("balance_after"),
  status: text("status").notNull().default("paid"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Token sekali pakai untuk verifikasi email & reset kata sandi. Yang
// disimpan hanya hash SHA-256 tokennya; token mentah hanya muncul di pesan
// kotak masuk simulasi. Setiap token punya masa berlaku dan gugur setelah
// dipakai atau digantikan token baru untuk keperluan yang sama.
export const authTokens = sqliteTable("auth_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  purpose: text("purpose", { enum: ["verify_email", "reset_password"] })
    .notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Kotak masuk simulasi di dalam aplikasi: pengganti pengiriman email
// sungguhan sampai layanan email produksi dipasang. Pesan di sini memuat
// token mentah agar alur verifikasi/reset bisa dijalankan end-to-end di
// prototipe; UI selalu melabelinya sebagai simulasi.
export const simulatedEmails = sqliteTable("simulated_emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull().default(""),
  purpose: text("purpose").notNull().default(""),
  token: text("token").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per user, keyed by the owner's user id.
export const workspace = sqliteTable("workspace", {
  id: integer("id").primaryKey(),
  displayName: text("display_name").notNull().default("Budi Santoso"),
  email: text("email").notNull().default("budi@email.com"),
  plan: text("plan").notNull().default("Pro Plan"),
  priceIdr: real("price_idr").notNull().default(299000),
});

export const integrations = sqliteTable("integrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  key: text("key").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  configJson: text("config_json").notNull().default("{}"),
  status: text("status").notNull().default("inactive"),
});

// Fase 2 — domain custom per proyek (dimiliki lewat proyek pemiliknya).
export const customDomains = sqliteTable("custom_domains", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  domain: text("domain").notNull(),
  status: text("status", { enum: ["pending", "verified", "active"] })
    .notNull()
    .default("pending"),
  verificationToken: text("verification_token").notNull().default(""),
  isPrimary: integer("is_primary", { mode: "boolean" })
    .notNull()
    .default(false),
  sslStatus: text("ssl_status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fase 3 — riwayat build Android (APK/AAB) per proyek.
export const androidBuilds = sqliteTable("android_builds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  appName: text("app_name").notNull(),
  packageId: text("package_id").notNull(),
  versionName: text("version_name").notNull().default("1.0.0"),
  versionCode: integer("version_code").notNull().default(1),
  buildType: text("build_type", { enum: ["apk", "aab"] })
    .notNull()
    .default("apk"),
  status: text("status", { enum: ["queued", "building", "ready", "failed"] })
    .notNull()
    .default("ready"),
  iconColor: text("icon_color").notNull().default("#2E6BFF"),
  splashText: text("splash_text").notNull().default(""),
  creditsCost: integer("credits_cost").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Fase 3 — forum komunitas (konten bersama, penulis tercatat per akun).
export const communityPosts = sqliteTable("community_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  authorName: text("author_name").notNull().default(""),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tag: text("tag").notNull().default("Diskusi"),
  // G5-C — moderasi: posting tersembunyi tidak tampil untuk pengguna biasa.
  isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const communityComments = sqliteTable("community_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id")
    .notNull()
    .references(() => communityPosts.id),
  userId: integer("user_id").references(() => users.id),
  authorName: text("author_name").notNull().default(""),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// G0 — file proyek simulasi yang lolos Executor path-guard. Hanya path di
// dalam pohon tenant pemiliknya (tenants/<user_id>/<project_id>/…) yang
// boleh tercatat di sini; penulisan yang ditolak guard tidak pernah masuk.
export const projectFiles = sqliteTable("project_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// G0 — catatan percobaan pelanggaran Executor path-guard (uji isolasi I-4).
// Setiap penolakan guard tercatat di sini atas nama pengguna peminta.
export const pathViolations = sqliteTable("path_violations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  projectId: integer("project_id"),
  path: text("path").notNull().default(""),
  kind: text("kind").notNull().default(""),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// G2 — Isolasi Penuh. Pemetaan jujur ke storage prototipe (SQLite app.db,
// BUKAN PostgreSQL produksi):
// - "Skema per proyek proj_<project_id>" = kolom schema_name pada
//   project_tables + penegakan project_id di setiap query server. Tidak ada
//   tabel proyek yang bisa dibaca lintas proyek, bahkan antar proyek milik
//   pengguna yang sama, karena semua akses wajib lewat ownedProject().
// - "Pengguna DB per proyek" = baris project_db_credentials: nama pengguna
//   logis proj_<project_id>_app yang hanya berhak atas skema proyeknya.
//   Kata sandi penuh TIDAK disimpan di app.db — hanya petunjuk 4 karakter
//   terakhir; di produksi kata sandi tinggal di secret manager.
// - "Sandbox tmp/<job_id>" = baris executor_jobs dengan sandbox_dir
//   tmp/job-<id>; status workspace_deleted menandai ruang kerja sudah
//   dihapus setelah job selesai (prototipe tidak punya filesystem proyek
//   sungguhan — file proyek adalah baris project_files).
// - "Enkripsi rahasia per proyek" = project_secrets.ciphertext terenkripsi
//   AES-256-GCM dengan kunci turunan per proyek; plaintext tidak pernah
//   disimpan, hanya hint 4 karakter terakhir untuk UI.
// ---------------------------------------------------------------------------

// Satu baris per proyek: kredensial database logis milik proyek itu sendiri.
export const projectDbCredentials = sqliteTable("project_db_credentials", {
  projectId: integer("project_id").primaryKey(),
  schemaName: text("schema_name").notNull().default(""),
  dbUsername: text("db_username").notNull().default(""),
  passwordHint: text("password_hint").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Rahasia per proyek (kunci API dsb.) — hanya ciphertext + hint yang
// disimpan; plaintext tidak pernah masuk database, file, log, atau prompt.
export const projectSecrets = sqliteTable("project_secrets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  ciphertext: text("ciphertext").notNull().default(""),
  hint: text("hint").notNull().default(""),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Riwayat kejadian rahasia per proyek (buat/rotasi/hapus) — nilai rahasia
// tidak pernah ditulis di sini, hanya nama + jenis kejadian.
export const secretEvents = sqliteTable("secret_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  secretName: text("secret_name").notNull().default(""),
  event: text("event", { enum: ["create", "rotate", "delete"] })
    .notNull()
    .default("create"),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Job Executor (build & test) yang berjalan di sandbox tmp/<job_id>.
// copiedBack = hasil lolos QA disalin ke builds/ proyek; workspaceDeleted =
// ruang kerja sandbox sudah dihapus setelah job selesai.
export const executorJobs = sqliteTable("executor_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  userId: integer("user_id").references(() => users.id),
  kind: text("kind").notNull().default("build"),
  sandboxDir: text("sandbox_dir").notNull().default(""),
  status: text("status", {
    enum: ["running", "done", "failed", "timeout"],
  })
    .notNull()
    .default("running"),
  detail: text("detail").notNull().default(""),
  networkPolicy: text("network_policy").notNull().default(""),
  timeLimitSec: integer("time_limit_sec").notNull().default(120),
  memoryLimitMb: integer("memory_limit_mb").notNull().default(512),
  artifactPath: text("artifact_path").notNull().default(""),
  copiedBack: integer("copied_back", { mode: "boolean" })
    .notNull()
    .default(false),
  workspaceDeleted: integer("workspace_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

// Metadata unggahan per proyek: berkasnya tinggal di uploads/ proyek
// (disimulasikan sebagai baris metadata ini); database hanya menyimpan
// nama file + metadata, BUKAN isi/blob berkas.
export const projectUploads = sqliteTable("project_uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  fileName: text("file_name").notNull().default(""),
  mimeType: text("mime_type").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Catatan penghapusan proyek yang BERTAHAN setelah proyeknya hilang:
// membuktikan folder+skema+artefak proyek dihapus dalam satu transaksi
// tercatat, sementara riwayat kredit di credit_ledger tetap dipertahankan.
export const projectDeletionLog = sqliteTable("project_deletion_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  projectId: integer("project_id").notNull(),
  projectName: text("project_name").notNull().default(""),
  schemaName: text("schema_name").notNull().default(""),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const communityLikes = sqliteTable("community_likes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id")
    .notNull()
    .references(() => communityPosts.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
});

// ---------------------------------------------------------------------------
// G3 — Panel Admin katalog skill + antrean kandidat.
// - skill_catalog_state: satu baris per skill yang pernah diubah admin
//   (status aktif/nonaktif + skor eval). Skill tanpa baris = aktif dan
//   belum dievaluasi (eval_score NULL) — BUKAN angka karangan.
// - skill_status_log: riwayat perubahan status/eval yang bisa dilihat admin.
// - skill_candidates: prompt generik (tanpa domain berskor >0 yang aktif)
//   yang tercatat sebagai kandidat skill baru untuk ditinjau admin.
// ---------------------------------------------------------------------------

export const skillCatalogState = sqliteTable("skill_catalog_state", {
  skillName: text("skill_name").primaryKey(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  evalScore: real("eval_score"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const skillStatusLog = sqliteTable("skill_status_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  skillName: text("skill_name").notNull().default(""),
  action: text("action").notNull().default(""),
  detail: text("detail").notNull().default(""),
  actorUserId: integer("actor_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// G5-A — Integrasi AI DeepInfra (single provider, multi-model).
// - ai_stage_models: registry model per tahap pipeline (Planner, Designer,
//   Coder, Builder, Fixer). Pipeline membaca registry ini saat generate —
//   model & harga TIDAK di-hardcode di kode. Harga dalam USD per 1 juta
//   token; harga fallback disimpan terpisah karena model fallback berbeda.
// - ai_usage_log: SATU baris per pemanggilan model (termasuk yang gagal dan
//   yang tertahan karena kunci belum terpasang). Biaya dihitung dari harga
//   registry yang berlaku saat pemanggilan itu terjadi.
// - ai_provider_secrets: token provider (DeepInfra) tersimpan TERENKRIPSI
//   AES-256-GCM (pola yang sama seperti rahasia proyek G2). Yang disimpan
//   hanya ciphertext + petunjuk 4 karakter terakhir; token utuh tidak
//   pernah tampil di UI, ekspor, log, atau prompt.
// ---------------------------------------------------------------------------

export const aiStageModels = sqliteTable("ai_stage_models", {
  stage: text("stage", {
    enum: ["planner", "designer", "coder", "builder", "fixer", "responder"],
  }).primaryKey(),
  provider: text("provider").notNull().default("deepinfra"),
  primaryModel: text("primary_model").notNull(),
  fallbackModel: text("fallback_model").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  inputPriceUsd: real("input_price_usd").notNull().default(0),
  outputPriceUsd: real("output_price_usd").notNull().default(0),
  fallbackInputPriceUsd: real("fallback_input_price_usd").notNull().default(0),
  fallbackOutputPriceUsd: real("fallback_output_price_usd").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiUsageLog = sqliteTable("ai_usage_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().default("deepinfra"),
  model: text("model").notNull().default(""),
  stage: text("stage").notNull().default(""),
  // Null bila generate gagal sebelum proyek dibuat (mis. kunci belum
  // terpasang) — baris log tetap wajib ada.
  projectId: integer("project_id"),
  userId: integer("user_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  status: text("status", {
    enum: ["sukses", "gagal", "kunci_belum_terpasang"],
  })
    .notNull()
    .default("sukses"),
  // Penjelasan kegagalan (jenis error saja — tidak pernah memuat token
  // provider, isi prompt, atau respons mentah model).
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiProviderSecrets = sqliteTable("ai_provider_secrets", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull().default(""),
  hint: text("hint").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// G5-C — Panel Admin lengkap.
// - admin_audit_log: APPEND-ONLY. Tidak ada aksi yang mengubah/menghapus
//   barisnya; setiap aksi admin (baru & lama) menulis tepat satu entri.
// - platform_settings: satu baris (id=1) berisi nama platform, pesan
//   maintenance, kuota default Free (hanya untuk pendaftar baru), dan
//   tarif platform (generate/deploy/Android). Nilai awal persis tarif
//   yang berlaku sebelum G5-C: 300/25/150 dan kuota Free 200.
// ---------------------------------------------------------------------------

export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  adminId: integer("admin_id"),
  adminEmail: text("admin_email").notNull().default(""),
  action: text("action").notNull().default(""),
  target: text("target").notNull().default(""),
  beforeValue: text("before_value").notNull().default(""),
  afterValue: text("after_value").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const platformSettings = sqliteTable("platform_settings", {
  id: integer("id").primaryKey(),
  platformName: text("platform_name").notNull().default("Dadiweb"),
  maintenanceMessage: text("maintenance_message").notNull().default(""),
  maintenanceEnabled: integer("maintenance_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  freeQuota: integer("free_quota").notNull().default(200),
  generateCost: integer("generate_cost").notNull().default(300),
  deployCost: integer("deploy_cost").notNull().default(25),
  androidCost: integer("android_cost").notNull().default(150),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const skillCandidates = sqliteTable("skill_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prompt: text("prompt").notNull().default(""),
  nearestSkill: text("nearest_skill"),
  nearestScore: integer("nearest_score").notNull().default(0),
  userId: integer("user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Tampilan project chat + iterasi (31 Okt 2026).
// - project_chat_messages: riwayat chat per proyek. Satu baris per pesan;
//   role "user" = prompt/permintaan pengguna, role "assistant" = ringkasan
//   hasil pipeline. Pesan hanya ditulis saat iterasi SUKSES (dan dua pesan
//   benih saat generate pertama sukses); iterasi yang gagal tidak
//   meninggalkan pesan apa pun, sama seperti generate gagal yang tidak
//   meninggalkan proyek. Pesan ikut terhapus saat proyek dihapus
//   (deleteProjectFully menghapus baris turunan proyek — lihat aksi itu).
//   Isolasi: baris membawa user_id pemilik DAN project_id; aksi chat selalu
//   memvalidasi kepemilikan proyek (ownedProject) sebelum membaca/menulis.
// ---------------------------------------------------------------------------

export const projectChatMessages = sqliteTable("project_chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  userId: integer("user_id").references(() => users.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull().default(""),
  // G6 — jenis pesan: "build" = pesan generate/iterasi (berbayar bila
  // sukses), "free" = sapaan/jawaban responder era G6 (gratis, 0 kredit,
  // hanya tinggal sebagai riwayat lama).
  // G7 — jenis pesan baru "chat" = sapaan/jawaban responder berbayar
  // (5 kredit per balasan assistant, tercatat di ledger kind "chat").
  // Nilai default "build" menjaga pesan lama (generate/iterate) tetap
  // tampil tanpa penanda. Client menampilkan penanda "5 kredit" untuk
  // pesan "chat" dan "Tanpa potongan kredit" hanya untuk "free" lama.
  kind: text("kind").notNull().default("build"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// G8 — Login Google (OAuth).
// - google_oauth_settings: SATU baris (id=1) berisi kredensial OAuth
//   Google dari panel admin. Client ID & redirect URI bukan rahasia
//   (boleh tampil penuh di panel admin); Client Secret disimpan
//   TERENKRIPSI AES-256-GCM dengan pola persis kunci DeepInfra (G5:
//   HKDF-SHA256 dari material master server, salt per provider) — yang
//   tersimpan hanya ciphertext + petunjuk 4 karakter terakhir. Secret
//   tidak pernah dikembalikan ke browser, ditulis ke log, atau masuk
//   ekspor.
// - google_oauth_states: state OAuth acak sekali pakai (PK = nilai state),
//   kedaluwarsa singkat (10 menit), ditandai consumed saat dipakai.
//   Disimpan server-side dan divalidasi di callback; state kedaluwarsa
//   dibersihkan saat start baru dibuat. Tidak ber-FK ke users, jadi
//   tidak menambah beban hapus akun.
// ---------------------------------------------------------------------------

export const googleOAuthSettings = sqliteTable("google_oauth_settings", {
  id: integer("id").primaryKey(),
  clientId: text("client_id").notNull().default(""),
  secretCiphertext: text("secret_ciphertext").notNull().default(""),
  secretHint: text("secret_hint").notNull().default(""),
  redirectUri: text("redirect_uri").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const googleOAuthStates = sqliteTable("google_oauth_states", {
  state: text("state").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// G9 — Login GitHub (OAuth).
// Tabel kredensial (satu baris id=1) dan state sekali pakai — pola yang
// sama persis seperti Google (G8), hanya nama field callback yang
// berbeda (callback_url, sesuai istilah GitHub). Tidak ber-FK ke users,
// jadi tidak menambah beban hapus akun.
// ---------------------------------------------------------------------------

export const githubOAuthSettings = sqliteTable("github_oauth_settings", {
  id: integer("id").primaryKey(),
  clientId: text("client_id").notNull().default(""),
  secretCiphertext: text("secret_ciphertext").notNull().default(""),
  secretHint: text("secret_hint").notNull().default(""),
  callbackUrl: text("callback_url").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const githubOAuthStates = sqliteTable("github_oauth_states", {
  state: text("state").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// G10 — Integrasi Cloudflare (deploy subdomain benar-benar live).
// - cloudflare_settings: SATU baris (id=1), pola persis OAuth G8/G9:
//   Account ID & Zone ID bukan rahasia (boleh tampil penuh di panel
//   admin); API token disimpan TERENKRIPSI AES-256-GCM dengan helper
//   persis kunci DeepInfra (salt provider "cloudflare"), hanya petunjuk
//   4 karakter terakhir yang dikembalikan. server_ip = IP origin yang
//   dituju record A (default IP staging saat ini, bisa diubah admin).
//   record_mode: "dns_only" (default) atau "proxied".
// - Tabel ini TIDAK ber-FK ke users/projects, jadi tidak menambah beban
//   hapus akun/proyek (deleteUserAndData/deleteProjectFully tidak perlu
//   diubah untuk G10; settings adalah milik platform, bukan pengguna).
// ---------------------------------------------------------------------------

export const cloudflareSettings = sqliteTable("cloudflare_settings", {
  id: integer("id").primaryKey(),
  accountId: text("account_id").notNull().default(""),
  zoneId: text("zone_id").notNull().default(""),
  tokenCiphertext: text("token_ciphertext").notNull().default(""),
  tokenHint: text("token_hint").notNull().default(""),
  serverIp: text("server_ip").notNull().default("82.25.62.243"),
  recordMode: text("record_mode", {
    enum: ["dns_only", "proxied"],
  })
    .notNull()
    .default("dns_only"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

