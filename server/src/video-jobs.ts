// G13-B — Job video Dadiweb (fal.ai) + proyek.
//
// Logika job video dipisah dari actions.ts (pola yang sama seperti
// fal-video.ts G13-A) supaya bisa diuji langsung melawan mock fal.ai
// tanpa lapisan aksi: submit → simpan job → polling-on-read → unduh
// MP4 ke blob storage → cancel. Aksi di actions.ts hanya memeriksa
// sesi + memanggil fungsi di sini dengan ctx.blobs / ctx.db.
//
// Aturan yang ditegakkan di sini:
// - Semua fungsi user-scoped: proyek orang lain DITOLAK (pesan yang
//   sama seperti "tidak ditemukan", tanpa membocorkan kepemilikan).
// - Generate video dipotong HANYA bila sukses — pemotongan dilakukan
//   G13-D di deductVideoJobCredits saat job bertransisi ke completed
//   (jalur sinkronisasi di bawah), lewat chargeCredits yang sama dengan
//   generate/chat. Di submit hanya: cek saldo cukup sebelum submit
//   (saldo kurang → gagal bersih, job TIDAK dibuat, saldo TIDAK berubah)
//   dan simpan credits_cost di job. Failed/cancelled/queued TIDAK
//   dipotong.
// - Kunci fal.ai belum terpasang → gagal bersih, job TIDAK dibuat.
// - Durasi HANYA 8 / 16 / 24 / 30 detik (keputusan terkunci; 32 detik
//   tidak bisa sekali jalan, maks fal.ai 30 detik). Model, batas
//   durasi, dan resolusi dibaca dari registry video_models (bukan
//   hardcode); tarif dari rumus terkunci video-credits.ts via
//   estimateVideoCostFor.
// - TIDAK ADA webhook di gelombang ini (butuh endpoint publik di luar
//   pola /actions): status disinkronkan saat dibaca (polling-on-read),
//   dengan throttle ~10 detik per job (acuan updated_at). Poll yang
//   gagal (jaringan / 429 / 5xx) TIDAK menandai job gagal — job tetap
//   in-flight dan dicoba lagi pada pembacaan berikutnya.
// - Dedup via request_id: poll berulang tidak pernah membuat job baru;
//   MP4 yang sudah terunduh (local_path + blob masih ada) tidak
//   diunduh ulang.
// - video_url (fal CDN, v3b.fal.media) HANYA jejak sementara — publik
//   dan kedaluwarsa ≥7 hari, JANGAN dipakai untuk pemutaran/daftar.
//   Sumber pemutaran adalah file lokal di ctx.blobs:
//   kunci `video-files/<slug-proyek>/<jobId>.mp4`, URL pemutaran
//   own-origin dari ctx.blobs.getUrl() (`./blobs/...`, tanpa
//   kedaluwarsa). Blob disimpan private (default ctx.blobs) karena
//   video adalah milik pemilik proyek, bukan konten publik.
// - Submit TIDAK memblokir menunggu video selesai (async): aksi
//   submit kembali segera setelah fal.ai menjawab 202.

import { and, desc, eq } from "drizzle-orm";
import * as schema from "./schema";
import { chargeCredits } from "./credit-charges";
import {
  cancelVideo,
  estimateVideoCostFor,
  getVideoModels,
  getVideoResult,
  getVideoStatus,
  loadFalVideoKey,
  submitVideo,
  FalVideoError,
  VideoEstimateError,
  type FalClientOptions,
  type FalVideoDb,
} from "./fal-video";

export type VideoJobStatus =
  | "queued"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type VideoJobRow = typeof schema.videoJobs.$inferSelect;

// Durasi yang diizinkan (keputusan terkunci Eka 7 Nov 2026): 8 / 16 /
// 24 / 30 detik, default 8. Batas min/max per model (2–30 Wan, 3–30
// Kling) tetap ditegakkan estimateVideoCostFor sebagai lapis kedua.
export const VIDEO_JOB_DURATIONS = [8, 16, 24, 30] as const;

// Jeda minimum antar poll fal.ai untuk job yang sama (acuan
// updated_at). Poll yang gagal tetap menyentuh updated_at supaya
// percobaan berikutnya tidak membanjiri fal.ai.
export const VIDEO_POLL_THROTTLE_MS = 10_000;

// Batas kewarasan unduhan MP4 (500 MB) — klip 30 detik 1080p dari
// fal.ai jauh di bawah ini; bila terlampaui, job ditandai gagal
// daripada memenuhi blob storage.
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

// Nama parameter input gambar I2V PER MODEL di fal.ai — nama ini
// berbeda-beda antar model, jadi dipetakan di sini supaya model
// mendatang yang memakai nama lain tinggal ditambah tanpa mengubah
// struktur submit. KOREKSI 7 Nov 2026 (docs resmi fal.ai):
// Wan 3.0 I2V dan Kling 4.0 I2V sama-sama mewajibkan
// `start_image_url` (required), BUKAN `image_url` — mengirim
// `image_url` ditolak fal.ai (422), dan 422 BISA tetap ditagih bila
// GPU sudah jalan. Sumber:
// https://fal.ai/models/alibaba/wan-3.0/image-to-video/api
// https://fal.ai/models/kling/v4/image-to-video/api
// Nama parameter model lain BELUM diverifikasi — JANGAN menebak;
// tambahkan ke peta ini hanya setelah dicek ke docs resmi fal.ai.
export const IMAGE_INPUT_PARAM: Record<string, string> = {
  "wan-3.0": "start_image_url",
  "kling-4.0": "start_image_url",
};

// Penyimpanan blob minimal yang dipakai modul ini — dipenuhi langsung
// oleh ctx.blobs di aksi (BlobClient), atau oleh fake di skrip uji.
// getUrl() runtime MELEMPAR bila kunci belum ada, jadi pemanggil hanya
// boleh memanggilnya untuk local_path yang sudah terverifikasi lewat
// head().
export interface VideoBlobStore {
  put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    options?: { contentType?: string },
  ): Promise<void>;
  getUrl(key: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  // CELAH 2 (7 Nov 2026): hapus proyek harus membersihkan MP4-nya.
  // BlobClient runtime punya delete(); fake store di skrip uji juga
  // menyediakannya.
  delete(key: string): Promise<void>;
}

export interface VideoJobOut {
  id: number;
  projectId: number;
  modelKey: string;
  modelLabel: string;
  prompt: string;
  imageUrl: string | null;
  durationSec: number;
  resolution: string;
  creditsCost: number;
  status: VideoJobStatus;
  // URL pemutaran own-origin (./blobs/...) — SATU-SATUNYA sumber
  // pemutaran/daftar. null sampai MP4 selesai diunduh.
  playbackUrl: string | null;
  // Kunci blob MP4 lokal (video-files/<slug>/<jobId>.mp4).
  localPath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// Kunci blob MP4 sebuah job. Slug sudah lolos path-guard proyek
// ([a-z0-9-]) dan jobId numerik, jadi kunci ini aman dari traversal.
export function videoBlobKey(projectSlug: string, jobId: number): string {
  return `video-files/${projectSlug}/${jobId}.mp4`;
}

// CELAH 2 (7 Nov 2026) — Hapus semua file MP4 video milik sebuah
// proyek dari blob storage. Dipanggil deleteProjectFully SEBELUM baris
// video_jobs dihapus (agar local_path masih bisa dibaca).
// Best-effort per file: blob yang sudah hilang (head null / delete
// melempar) dilewati tanpa menggagalkan penghapusan proyek — tidak ada
// file yatim yang tersisa untuk job yang masih tercatat, dan proyek
// lain tidak pernah disentuh (kunci selalu di bawah
// video-files/<slug-proyek-ini>/).
export async function deleteProjectVideoBlobs(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  projectId: number,
): Promise<{ deleted: number }> {
  const rows = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.projectId, projectId));
  let deleted = 0;
  for (const row of rows) {
    if (!row.localPath) continue;
    try {
      await blobs.delete(row.localPath);
      deleted++;
    } catch {
      // Blob hilang/rusak: lewati — baris job tetap dihapus pemanggil.
    }
  }
  return { deleted };
}

export function isVideoJobInFlight(status: VideoJobStatus): boolean {
  return status === "submitted" || status === "processing";
}

function isValidImageUrl(value: string): boolean {
  return (
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("data:image/")
  );
}

async function ownedProject(
  db: FalVideoDb,
  userId: number,
  projectId: number,
) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ),
    );
  return rows[0] ?? null;
}

async function ownedVideoJob(
  db: FalVideoDb,
  userId: number,
  jobId: number,
): Promise<{
  job: VideoJobRow;
  project: typeof schema.projects.$inferSelect;
} | null> {
  const jobs = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId));
  const job = jobs[0];
  if (!job) return null;
  const project = await ownedProject(db, userId, job.projectId);
  if (!project) return null;
  return { job, project };
}

async function reloadJob(
  db: FalVideoDb,
  jobId: number,
): Promise<VideoJobRow | null> {
  const rows = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId));
  return rows[0] ?? null;
}

async function touchJob(db: FalVideoDb, jobId: number): Promise<void> {
  await db
    .update(schema.videoJobs)
    .set({ updatedAt: new Date() })
    .where(eq(schema.videoJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// G13-D — Pemotongan kredit saat job video sukses (completed)
// ---------------------------------------------------------------------------

export interface DeductVideoJobResult {
  // true bila pemotongan baru saja dilakukan oleh panggilan ini.
  deducted: boolean;
  // Saldo setelah pemotongan (null bila tidak ada pemotongan).
  balanceAfter: number | null;
}

// Potong credits_cost yang TERCATAT di job (dari rumus terkunci saat
// submit — BUKAN hitung ulang dari tarif saat ini) dari saldo pemilik job,
// lewat chargeCredits yang sama dengan generate/chat. Hanya bila:
// - job berstatus completed,
// - credits_cost > 0,
// - creditsDeducted masih 0 (anti-dobel, lihat klaim di bawah),
// - userId job terisi.
// Job failed/cancelled/queued TIDAK PERNAH sampai ke sini (pemanggil
// hanya memanggil setelah transisi ke completed).
//
// Anti-dobel: klaim atomik UPDATE ... WHERE credits_deducted = 0
// RETURNING — hanya satu pemanggil yang menang bila dua sinkronisasi
// berlomba. Klaim dilakukan SEBELUM charge; bila charge gagal (satu-
// satunya kegagalan realistis: akun kredit hilang setelah submit —
// chargeCredits melempar sebelum menulis apa pun), klaim dibatalkan
// supaya sinkronisasi berikutnya mencoba lagi. Saldo kurang saat job
// selesai TIDAK ditolak: chargeCredits memang mengizinkan saldo menjadi
// negatif (perilaku helper yang sama untuk semua alur; lihat
// credit-charges.ts) — saldo negatif + balanceAfter negatif tercatat
// apa adanya di ledger. Itu TEMUAN untuk koordinator, bukan aturan baru.
export async function deductVideoJobCredits(
  db: FalVideoDb,
  jobId: number,
): Promise<DeductVideoJobResult> {
  const job = await reloadJob(db, jobId);
  if (!job) return { deducted: false, balanceAfter: null };
  if (job.status !== "completed") return { deducted: false, balanceAfter: null };
  if (job.creditsCost <= 0) return { deducted: false, balanceAfter: null };
  if (job.creditsDeducted) return { deducted: false, balanceAfter: null };
  if (job.userId == null) return { deducted: false, balanceAfter: null };

  const claimed = await db
    .update(schema.videoJobs)
    .set({ creditsDeducted: 1 })
    .where(
      and(
        eq(schema.videoJobs.id, job.id),
        eq(schema.videoJobs.creditsDeducted, 0),
      ),
    )
    .returning({ id: schema.videoJobs.id });
  if (claimed.length === 0) return { deducted: false, balanceAfter: null };

  try {
    const models = await getVideoModels(db);
    const model = models.find((m) => m.key === job.modelKey);
    const label = `Video ${model?.label ?? job.modelKey} ${job.duration} detik (${job.resolution})`;
    const balanceAfter = await chargeCredits(db, job.userId, {
      amount: -job.creditsCost,
      label,
      category: "Video",
      kind: "video",
      projectId: job.projectId,
    });
    await db
      .update(schema.videoJobs)
      .set({ deductedAt: new Date() })
      .where(eq(schema.videoJobs.id, job.id));
    return { deducted: true, balanceAfter };
  } catch (e) {
    // Batalkan klaim supaya sinkronisasi berikutnya mencoba lagi.
    await db
      .update(schema.videoJobs)
      .set({ creditsDeducted: 0 })
      .where(eq(schema.videoJobs.id, job.id));
    throw e;
  }
}

// Pemotongan tidak boleh merusak pembacaan video yang sudah selesai:
// bila charge gagal, klaim sudah dibatalkan di dalam
// deductVideoJobCredits dan sinkronisasi berikutnya mencoba lagi.
async function deductOnComplete(db: FalVideoDb, jobId: number): Promise<void> {
  try {
    await deductVideoJobCredits(db, jobId);
  } catch {
    // Sengaja ditelan: video sudah selesai dan harus tetap terbaca.
  }
}

export async function toVideoJobOut(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  job: VideoJobRow,
): Promise<VideoJobOut> {
  const models = await getVideoModels(db);
  const model = models.find((m) => m.key === job.modelKey);
  let playbackUrl: string | null = null;
  if (job.localPath) {
    try {
      const head = await blobs.head(job.localPath);
      if (head) playbackUrl = await blobs.getUrl(job.localPath);
    } catch {
      playbackUrl = null;
    }
  }
  return {
    id: job.id,
    projectId: job.projectId,
    modelKey: job.modelKey,
    modelLabel: model?.label ?? job.modelKey,
    prompt: job.prompt,
    imageUrl: job.imageUrl,
    durationSec: job.duration,
    resolution: job.resolution,
    creditsCost: job.creditsCost,
    status: job.status as VideoJobStatus,
    playbackUrl,
    localPath: job.localPath,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitVideoJobArgs {
  userId: number;
  projectId: number;
  prompt: string;
  modelKey: string;
  durationSec: number;
  resolution: string;
  // Opsional, untuk image-to-video: URL http(s) atau data URI gambar.
  // Diteruskan ke fal.ai sebagai `start_image_url` (lihat peta
  // IMAGE_INPUT_PARAM di bawah).
  imageUrl?: string;
}

export interface SubmitVideoJobResult {
  ok: boolean;
  error: string | null;
  job: VideoJobRow | null;
  // Estimasi kredit saat submit (0 bila validasi gagal sebelum estimasi).
  creditsCost: number;
  // Saldo kredit pengguna saat submit (0 bila proyek tidak ditemukan).
  balance: number;
}

export async function submitVideoJob(
  db: FalVideoDb,
  args: SubmitVideoJobArgs,
  opts?: { fal?: FalClientOptions },
): Promise<SubmitVideoJobResult> {
  const fail = (
    error: string,
    creditsCost = 0,
    balance = 0,
  ): SubmitVideoJobResult => ({
    ok: false,
    error,
    job: null,
    creditsCost,
    balance,
  });

  const project = await ownedProject(db, args.userId, args.projectId);
  if (!project) {
    return fail("Proyek tidak ditemukan.");
  }

  const prompt = args.prompt.trim();
  if (prompt.length === 0) {
    return fail("Prompt video tidak boleh kosong.");
  }
  if (prompt.length > 2000) {
    return fail("Prompt video terlalu panjang (maksimal 2000 karakter).");
  }
  const imageUrl = (args.imageUrl ?? "").trim();
  if (imageUrl !== "" && !isValidImageUrl(imageUrl)) {
    return fail(
      "URL gambar tidak valid: pakai URL http(s) atau data URI gambar (data:image/...).",
    );
  }
  if (
    !VIDEO_JOB_DURATIONS.includes(
      args.durationSec as (typeof VIDEO_JOB_DURATIONS)[number],
    )
  ) {
    return fail(
      `Durasi video harus salah satu dari ${VIDEO_JOB_DURATIONS.join(", ")} detik.`,
    );
  }

  // Validasi model aktif + durasi min/max model + resolusi, sekaligus
  // hitung credits_cost dari rumus terkunci (parameter setting admin).
  let creditsCost = 0;
  let endpoint = "";
  let isI2v = false;
  try {
    const est = await estimateVideoCostFor(db, {
      modelKey: args.modelKey.trim(),
      durationSec: args.durationSec,
      resolution: args.resolution.trim(),
    });
    creditsCost = est.credits;
    const models = await getVideoModels(db);
    const model = models.find((m) => m.key === est.modelKey);
    if (!model) {
      return fail(`Model video "${args.modelKey}" tidak ditemukan.`);
    }
    isI2v = imageUrl !== "";
    endpoint = isI2v ? model.endpointI2v : model.endpointT2v;
  } catch (e) {
    if (e instanceof VideoEstimateError) return fail(e.message);
    throw e;
  }

  // Cek saldo cukup — gagal bersih bila kurang: job TIDAK dibuat,
  // saldo TIDAK berubah, TIDAK ADA pemotongan (G13-D).
  const accountRows = await db
    .select()
    .from(schema.creditAccount)
    .where(eq(schema.creditAccount.id, args.userId));
  const balance = accountRows[0]?.balance ?? 0;
  if (balance < creditsCost) {
    return fail(
      `Saldo kredit tidak mencukupi: video ini membutuhkan ${creditsCost} kredit, saldo Anda ${balance} kredit.`,
      creditsCost,
      balance,
    );
  }

  // Kunci fal.ai belum terpasang → gagal bersih, job TIDAK dibuat.
  const apiKey = await loadFalVideoKey(db);
  if (!apiKey) {
    return fail(
      "Kunci API fal.ai belum terpasang di panel admin, jadi video belum bisa dibuat.",
      creditsCost,
      balance,
    );
  }

  // Submit ke fal.ai (async — TIDAK menunggu video selesai). Input
  // diteruskan apa adanya: {prompt, duration, resolution} untuk T2V,
  // ditambah parameter gambar I2V per model (IMAGE_INPUT_PARAM).
  // KOREKSI 7 Nov 2026: sebelumnya I2V mengirim `image_url` — SALAH.
  // Wan 3.0 dan Kling 4.0 I2V mewajibkan `start_image_url` (required)
  // menurut docs resmi fal.ai; `image_url` ditolak (422) dan 422 BISA
  // tetap ditagih bila GPU sudah jalan. Sumber:
  // https://fal.ai/models/alibaba/wan-3.0/image-to-video/api
  // https://fal.ai/models/kling/v4/image-to-video/api
  // Uji live (G13-D, kunci asli) tetap diperlukan untuk membuktikan
  // nama parameter I2V tiap model di sisi fal.ai yang sebenarnya.
  const input: Record<string, unknown> = {
    prompt,
    duration: args.durationSec,
    resolution: args.resolution.trim(),
  };
  if (isI2v) {
    input[IMAGE_INPUT_PARAM[args.modelKey.trim()] ?? "start_image_url"] =
      imageUrl;
  }
  let submitted;
  try {
    submitted = await submitVideo(
      apiKey,
      { modelEndpoint: endpoint, input },
      opts?.fal,
    );
  } catch (e) {
    if (e instanceof FalVideoError) return fail(e.message, creditsCost, balance);
    throw e;
  }

  const inserted = await db
    .insert(schema.videoJobs)
    .values({
      projectId: project.id,
      userId: args.userId,
      modelKey: args.modelKey.trim(),
      endpoint,
      prompt,
      imageUrl: imageUrl === "" ? null : imageUrl,
      duration: args.durationSec,
      resolution: args.resolution.trim(),
      creditsCost,
      falRequestId: submitted.requestId,
      status: "submitted",
      statusUrl: submitted.statusUrl,
      responseUrl: submitted.responseUrl,
      cancelUrl: submitted.cancelUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const job = inserted[0];
  if (!job) {
    return fail(
      "Job video gagal disimpan setelah submit ke fal.ai.",
      creditsCost,
      balance,
    );
  }
  return { ok: true, error: null, job, creditsCost, balance };
}

// ---------------------------------------------------------------------------
// Sinkronisasi status (polling-on-read)
// ---------------------------------------------------------------------------

async function downloadVideoBytes(
  url: string,
  opts?: FalClientOptions,
): Promise<ArrayBuffer> {
  const fetchFn =
    opts?.fetchFn ?? ((input: string, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Unduhan video dari fal.ai gagal (HTTP ${response.status}).`,
      );
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength === 0) {
      throw new Error("Unduhan video kosong (0 byte).");
    }
    if (buf.byteLength > VIDEO_MAX_BYTES) {
      throw new Error(
        `Unduhan video terlalu besar (${buf.byteLength} byte, batas ${VIDEO_MAX_BYTES} byte).`,
      );
    }
    return buf;
  } catch (e) {
    if (
      typeof e === "object" &&
      e !== null &&
      (e as { name?: unknown }).name === "AbortError"
    ) {
      throw new Error(
        `Timeout ${timeoutMs / 1000} detik mengunduh video dari fal.ai.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Sinkronkan SATU job in-flight ke fal.ai. Mengembalikan baris terbaru
// (atau baris lama bila poll dilewati / gagal sementara). `force=true`
// melewati throttle — hanya dipakai jalur cancel (fal.ai menjawab
// ALREADY_COMPLETED) supaya status akhir job segera diketahui.
export async function syncVideoJob(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  job: VideoJobRow,
  project: typeof schema.projects.$inferSelect,
  opts?: { fal?: FalClientOptions },
  force = false,
): Promise<VideoJobRow> {
  if (!isVideoJobInFlight(job.status as VideoJobStatus)) return job;
  if (!job.falRequestId) return job;
  if (!force) {
    const last =
      job.updatedAt instanceof Date
        ? job.updatedAt.getTime()
        : Number(job.updatedAt);
    if (Date.now() - last < VIDEO_POLL_THROTTLE_MS) return job;
  }

  const apiKey = await loadFalVideoKey(db);
  if (!apiKey) {
    // Kunci dicabut setelah submit: tidak bisa poll — biarkan job
    // in-flight (bukan gagal), supaya bisa dilanjutkan setelah kunci
    // dipasang kembali.
    return job;
  }

  let statusRes;
  try {
    statusRes = await getVideoStatus(
      apiKey,
      {
        requestId: job.falRequestId,
        statusUrl: job.statusUrl ?? undefined,
        modelEndpoint: job.endpoint,
      },
      opts?.fal,
    );
  } catch {
    // Poll gagal sementara (jaringan / 429 / 5xx / kunci ditolak):
    // JANGAN tandai job gagal — sentuh updated_at agar throttle
    // menahan poll berikutnya, lalu kembalikan status lama.
    await touchJob(db, job.id);
    return (await reloadJob(db, job.id)) ?? job;
  }

  if (statusRes.status === "IN_QUEUE") {
    await db
      .update(schema.videoJobs)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, job.id));
    return (await reloadJob(db, job.id)) ?? job;
  }
  if (statusRes.status === "IN_PROGRESS") {
    await db
      .update(schema.videoJobs)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, job.id));
    return (await reloadJob(db, job.id)) ?? job;
  }

  // COMPLETED di sisi fal.ai.
  if (statusRes.error) {
    await db
      .update(schema.videoJobs)
      .set({
        status: "failed",
        error: statusRes.error,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(schema.videoJobs.id, job.id));
    return (await reloadJob(db, job.id)) ?? job;
  }

  let result;
  try {
    result = await getVideoResult(
      apiKey,
      {
        requestId: job.falRequestId,
        responseUrl: job.responseUrl ?? undefined,
        modelEndpoint: job.endpoint,
      },
      opts?.fal,
    );
  } catch {
    // Hasil belum bisa diambil: tetap processing, coba lagi di
    // pembacaan berikutnya (throttle lewat updated_at).
    await touchJob(db, job.id);
    return (await reloadJob(db, job.id)) ?? job;
  }

  // Dedup unduhan: MP4 sudah ada di blob → jangan unduh ulang, cukup
  // tandai completed (poll berulang setelah completed tidak sampai ke
  // sini karena status sudah completed, tapi guard ini menutup jeda
  // antara put() dan update status bila proses terpotong).
  const blobKey = videoBlobKey(project.slug, job.id);
  let localPath = job.localPath;
  if (localPath) {
    const head = await blobs.head(localPath).catch(() => null);
    if (head) {
      await db
        .update(schema.videoJobs)
        .set({
          status: "completed",
          videoUrl: result.videoUrl,
          localPath,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(schema.videoJobs.id, job.id));
      // G13-D — job baru saja completed: potong credits_cost tercatat.
      await deductOnComplete(db, job.id);
      return (await reloadJob(db, job.id)) ?? job;
    }
    // local_path tercatat tapi blob hilang: unduh ulang ke kunci yang sama.
    localPath = null;
  }
  try {
    const bytes = await downloadVideoBytes(result.videoUrl, opts?.fal);
    await blobs.put(blobKey, bytes, { contentType: "video/mp4" });
    localPath = blobKey;
  } catch (e) {
    // Unduhan gagal sementara: simpan video_url sebagai jejak, job
    // tetap processing agar pembacaan berikutnya mencoba unduh lagi
    // (video_url fal.ai berlaku ≥7 hari).
    await db
      .update(schema.videoJobs)
      .set({ videoUrl: result.videoUrl, updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, job.id));
    return (await reloadJob(db, job.id)) ?? job;
  }
  await db
    .update(schema.videoJobs)
    .set({
      status: "completed",
      videoUrl: result.videoUrl,
      localPath,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(schema.videoJobs.id, job.id));
  // G13-D — job baru saja completed: potong credits_cost tercatat.
  await deductOnComplete(db, job.id);
  return (await reloadJob(db, job.id)) ?? job;
}

// ---------------------------------------------------------------------------
// Daftar / detail / cancel
// ---------------------------------------------------------------------------

export async function listVideoJobs(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  args: { userId: number; projectId: number },
  opts?: { fal?: FalClientOptions },
): Promise<{
  ok: boolean;
  error: string | null;
  jobs: VideoJobOut[];
}> {
  const project = await ownedProject(db, args.userId, args.projectId);
  if (!project) {
    return { ok: false, error: "Proyek tidak ditemukan.", jobs: [] };
  }
  const rows = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.projectId, project.id))
    .orderBy(desc(schema.videoJobs.id));
  const out: VideoJobOut[] = [];
  for (const row of rows) {
    const synced = isVideoJobInFlight(row.status as VideoJobStatus)
      ? await syncVideoJob(db, blobs, row, project, opts)
      : row;
    out.push(await toVideoJobOut(db, blobs, synced));
  }
  return { ok: true, error: null, jobs: out };
}

export async function getVideoJob(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  args: { userId: number; jobId: number },
  opts?: { fal?: FalClientOptions },
): Promise<{
  ok: boolean;
  error: string | null;
  job: VideoJobOut | null;
}> {
  const owned = await ownedVideoJob(db, args.userId, args.jobId);
  if (!owned) {
    return { ok: false, error: "Video tidak ditemukan.", job: null };
  }
  const synced = isVideoJobInFlight(owned.job.status as VideoJobStatus)
    ? await syncVideoJob(db, blobs, owned.job, owned.project, opts)
    : owned.job;
  return {
    ok: true,
    error: null,
    job: await toVideoJobOut(db, blobs, synced),
  };
}

export async function cancelVideoJob(
  db: FalVideoDb,
  blobs: VideoBlobStore,
  args: { userId: number; jobId: number },
  opts?: { fal?: FalClientOptions },
): Promise<{
  ok: boolean;
  error: string | null;
  job: VideoJobOut | null;
}> {
  const owned = await ownedVideoJob(db, args.userId, args.jobId);
  if (!owned) {
    return { ok: false, error: "Video tidak ditemukan.", job: null };
  }
  const { job, project } = owned;
  const status = job.status as VideoJobStatus;
  if (status === "completed") {
    return {
      ok: false,
      error: "Video sudah selesai dan tidak bisa dibatalkan.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  if (status === "failed") {
    return {
      ok: false,
      error: "Video sudah gagal dan tidak bisa dibatalkan.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  if (status === "cancelled") {
    return {
      ok: false,
      error: "Video sudah dibatalkan.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  if (!job.falRequestId) {
    return {
      ok: false,
      error: "Video ini belum terkirim ke fal.ai, jadi tidak ada yang bisa dibatalkan.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  const apiKey = await loadFalVideoKey(db);
  if (!apiKey) {
    return {
      ok: false,
      error:
        "Kunci API fal.ai belum terpasang, jadi pembatalan ke fal.ai tidak bisa dilakukan. Job tetap berjalan di antrean fal.ai.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  try {
    await cancelVideo(
      apiKey,
      {
        requestId: job.falRequestId,
        cancelUrl: job.cancelUrl ?? undefined,
        modelEndpoint: job.endpoint,
      },
      opts?.fal,
    );
  } catch (e) {
    // fal.ai menjawab 400 ALREADY_COMPLETED: job ternyata sudah
    // selesai di sisi fal.ai — sinkronkan paksa supaya status akhir
    // (completed + MP4 terunduh) tercatat, lalu tolak pembatalan.
    if (e instanceof FalVideoError && e.httpStatus === 400) {
      const synced = await syncVideoJob(db, blobs, job, project, opts, true);
      return {
        ok: false,
        error:
          synced.status === "completed"
            ? "Video sudah selesai di fal.ai dan tidak bisa dibatalkan."
            : "Video tidak bisa dibatalkan (fal.ai menolak).",
        job: await toVideoJobOut(db, blobs, synced),
      };
    }
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Pembatalan video ke fal.ai gagal.",
      job: await toVideoJobOut(db, blobs, job),
    };
  }
  await db
    .update(schema.videoJobs)
    .set({ status: "cancelled", updatedAt: new Date(), completedAt: new Date() })
    .where(eq(schema.videoJobs.id, job.id));
  const updated = (await reloadJob(db, job.id)) ?? job;
  return {
    ok: true,
    error: null,
    job: await toVideoJobOut(db, blobs, updated),
  };
}
