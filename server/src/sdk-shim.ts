// Pengganti lokal untuk `./sdk-shim` (khusus versi staging Dadiweb).
//
// Di prototipe Muse, server actions berjalan lewat runtime Muse: runtime
// menyediakan `Ctx` (akses database, inference AI, invalidasi query) dan
// memanggil `handler` tiap action. Di server staging tidak ada runtime
// itu, jadi file ini menyediakan kontrak yang sama persis, secukupnya,
// agar `server/src/actions.ts` tidak perlu diubah sama sekali:
//
// - `z`      : skema validasi dari zod (sama seperti yang dipakai SDK).
// - `Ctx`    : konteks yang diberikan server staging (`server/index.ts`)
//              ke tiap handler: `ctx.db()` (drizzle + bun:sqlite di atas
//              `app.db`, atau path dari env DADIWEB_DB), `ctx.inference`
//              (penjaga jalur-mati — selalu gagal jujur bila dipanggil,
//              lihat bawah), dan `ctx.invalidateQueries()` (no-op di
//              staging, karena client me-refresh lewat react-query-nya
//              sendiri).
// - `defineAction` : membungkus definisi action apa adanya (request,
//   response, handler) seperti SDK, sehingga server staging bisa memanggil
//   `action.handler(ctx, parsedArgs)` secara langsung.
// - `ActionsModule` : tipe untuk objek `Actions` di `actions.ts`.
// - `blobs` : penyimpanan file (blob) di atas disk lokal
//   (`<root>/blobs/`, lihat `createLocalBlobStore` di bawah) —
//   pengganti `ctx.blobs` (BlobClient) runtime Muse.
//   `getUrl()` mengembalikan `./blobs/<key>` yang dilayani route
//   `/blobs/*` di `server/index.ts`.
//
// PENJAGA JALUR-MATI — BUKAN STUB GENERATE: `ctx.inference.complete` di
// sini selalu melempar error, dan itu SENGAJA. Tidak ada aksi saat ini
// yang memanggilnya (pipeline AI berjalan lewat klien DeepInfra di
// `server/src/ai-provider.ts`, dan `generateWebsite` diteruskan ke
// handler aslinya oleh `server/index.ts` — tidak ada intersepsi).
// Bila suatu jalur tak terduga memanggilnya, gagal dengan jujur lebih
// baik daripada berpura-pura sukses.
// Untuk mengaktifkan AI sungguhan, lihat bagian "Generate AI" di
// README-CARA-JALANKAN-STAGING.md: pasang kunci lewat panel Admin
// (aksi `setdeepinfrakey`), JANGAN pernah hardcode kunci di file.

import { z } from "zod";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export { z };

// Blob storage lokal (khusus staging). Runtime Muse menyediakan
// ctx.blobs (BlobClient); di staging tidak ada runtime itu, jadi shim
// ini menyediakan implementasi yang sama persis di atas disk lokal
// (root dari `createLocalBlobStore`, default `<root>/blobs/` di
// server/index.ts). Folder blobs/ adalah data runtime
// seperti site-files/ — dipertahankan saat swap code, JANGAN ikut paket.
export interface LocalBlobStore {
  put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    options?: { contentType?: string },
  ): Promise<void>;
  getUrl(key: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

function resolveBlobPath(root: string, key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\")) {
    throw new Error(`Kunci blob tidak valid: ${key}`);
  }
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`Kunci blob tidak valid: ${key}`);
  }
  const candidate = resolve(root, ...parts);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Kunci blob tidak valid: ${key}`);
  }
  return candidate;
}

export function createLocalBlobStore(root: string): LocalBlobStore {
  const absRoot = resolve(root);
  return {
    async put(key, data) {
      const file = resolveBlobPath(absRoot, key);
      await mkdir(dirname(file), { recursive: true });
      await Bun.write(file, data);
    },
    async getUrl(key) {
      resolveBlobPath(absRoot, key);
      return `./blobs/${key}`;
    },
    async head(key) {
      const file = resolveBlobPath(absRoot, key);
      const f = Bun.file(file);
      if (!(await f.exists())) return null;
      return { size: f.size };
    },
    async delete(key) {
      const file = resolveBlobPath(absRoot, key);
      await unlink(file).catch(() => {});
    },
  };
}

// Konteks handler. `db<S>()` mengembalikan instance drizzle yang sudah
// terikat ke skema proyek (dipakai actions sebagai `ctx.db<typeof schema>()`).
export interface Ctx {
  db<S extends Record<string, unknown>>(): BunSQLiteDatabase<S>;
  inference: {
    complete(
      prompt: string,
      options: { schema: z.ZodTypeAny },
    ): Promise<never>;
  };
  invalidateQueries(): void;
  // Penyimpanan file (blob) lokal (lihat createLocalBlobStore).
  blobs: LocalBlobStore;
}

export interface ActionDef<
  R extends z.ZodTypeAny = z.ZodTypeAny,
  P extends z.ZodTypeAny = z.ZodTypeAny,
> {
  __brand: "@dadiweb-staging/action/v1";
  request: R;
  response: P;
  // G7 — prototipe menambahkan `description` di setiap defineAction
  // (diterima space-sdk asli); shim staging ikut menerimanya agar
  // typecheck paket staging tetap lolos tanpa mengubah actions.ts.
  description?: string;
  handler: (ctx: Ctx, args: z.infer<R>) => Promise<z.infer<P>>;
  privileged?: unknown;
}

export type ActionsModule = Record<string, ActionDef>;

export function defineAction<
  R extends z.ZodTypeAny,
  P extends z.ZodTypeAny,
>(spec: {
  request: R;
  response: P;
  description?: string;
  handler: (ctx: Ctx, args: z.infer<R>) => Promise<z.infer<P>>;
  privileged?: unknown;
}): ActionDef<R, P> {
  return {
    __brand: "@dadiweb-staging/action/v1",
    request: spec.request,
    response: spec.response,
    ...(spec.description !== undefined
      ? { description: spec.description }
      : {}),
    ...(spec.privileged !== undefined
      ? { privileged: spec.privileged }
      : {}),
    handler: spec.handler,
  };
}
