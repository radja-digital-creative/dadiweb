// Pemotongan kredit Dadiweb — SATU-SATUNYA helper pemotongan.
//
// Dipindah ke sini dari actions.ts TANPA mengubah logika apa pun (agar
// tidak circular import). Semua alur yang memakai helper ini — generate
// (300), deploy (25), build Android (150), chat (5) — memanggil fungsi
// yang sama di sini.
//
// Perilaku yang dipertahankan persis:
// - amount negatif = potong, positif = tambah; TIDAK ADA gerbang saldo
//   di sini — penolakan saldo kurang dilakukan pemanggil SEBELUM memanggil
//   (gerbang chat, gerbang generate). Bila pemanggil memanggil dengan
//   saldo kurang, saldo BOLEH menjadi negatif dan balanceAfter negatif
//   tercatat apa adanya di ledger. Itu perilaku helper ini sejak awal.
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
  | "chat";

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
