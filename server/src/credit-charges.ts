// Pemotongan kredit Dadiweb — SATU-SATUNYA helper pemotongan.
//
// Dipindah ke sini (G13-D) dari actions.ts TANPA mengubah logika apa pun:
// actions.ts mengimpor video-jobs.ts, jadi video-jobs.ts tidak bisa
// mengimpor helper ini dari actions.ts (circular import). Semua alur yang
// memakai helper ini — generate (300), deploy (25), build Android (150),
// chat (5), dan video (G13-D, hanya bila sukses) — memanggil fungsi yang
// sama di sini.
//
// Perilaku yang dipertahankan persis:
// - amount negatif = potong, positif = tambah; TIDAK ADA gerbang saldo
//   di sini — penolakan saldo kurang dilakukan pemanggil SEBELUM memanggil
//   (submit video, gerbang chat, gerbang generate). Bila pemanggil
//   memanggil dengan saldo kurang, saldo BOLEH menjadi negatif dan
//   balanceAfter negatif tercatat apa adanya di ledger. Itu perilaku
//   helper ini sejak awal, bukan aturan baru G13-D; pemotongan video
//   saat job selesai mengikuti perilaku yang sama (lihat
//   deductVideoJobCredits di video-jobs.ts).
// - Setiap pemotongan menulis satu baris credit_ledger (kind, label,
//   category, amount, balanceAfter, projectId) dan mengakumulasi
//   credit_usage per kategori (dipakai donut pemakaian dashboard).

import { and, eq } from "drizzle-orm";
import type { Ctx } from "./sdk-shim";
import * as schema from "./schema";

function dbOf(ctx: Ctx) {
  return ctx.db<typeof schema>();
}
export type CreditDb = ReturnType<typeof dbOf>;

export type CreditKind =
  | "generate"
  | "deploy"
  | "topup"
  | "adjust"
  | "bonus"
  | "chat"
  // G13-D — pemotongan video (fal.ai), hanya bila job completed.
  // DDL credit_ledger.kind TIDAK punya CHECK constraint (drizzle/0002:
  // TEXT NOT NULL DEFAULT 'generate'), jadi nilai baru ini tidak butuh
  // pembangunan ulang tabel; enum di schema.ts hanya penanda TS.
  | "video";

export async function chargeCredits(
  db: CreditDb,
  userId: number,
  args: {
    amount: number;
    label: string;
    category: string;
    kind: CreditKind;
    projectId?: number;
  },
): Promise<number> {
  const accountRows = await db
    .select()
    .from(schema.creditAccount)
    .where(eq(schema.creditAccount.id, userId));
  const account = accountRows[0] ?? null;
  if (!account) throw new Error("Akun kredit belum tersedia");
  const next = account.balance + args.amount;
  await db
    .update(schema.creditAccount)
    .set({ balance: next })
    .where(eq(schema.creditAccount.id, userId));
  await db.insert(schema.creditLedger).values({
    userId,
    kind: args.kind,
    label: args.label,
    category: args.category,
    amount: args.amount,
    balanceAfter: next,
    projectId: args.projectId ?? null,
  });
  if (args.amount < 0) {
    const usage = await db
      .select()
      .from(schema.creditUsage)
      .where(
        and(
          eq(schema.creditUsage.userId, userId),
          eq(schema.creditUsage.category, args.category),
        ),
      );
    const current = usage[0]?.used ?? 0;
    if (usage.length === 0) {
      await db.insert(schema.creditUsage).values({
        userId,
        category: args.category,
        used: -args.amount,
      });
    } else {
      await db
        .update(schema.creditUsage)
        .set({ used: current + -args.amount })
        .where(
          and(
            eq(schema.creditUsage.userId, userId),
            eq(schema.creditUsage.category, args.category),
          ),
        );
    }
  }
  return next;
}
