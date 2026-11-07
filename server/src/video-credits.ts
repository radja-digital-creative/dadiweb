// G13-A — Rumus tarif kredit video Dadiweb (fal.ai).
//
// Keputusan terkunci Eka 7 Nov 2026 (rekonsiliasi tarif, diverifikasi
// Python): kredit = ceil(biaya API (Rp) / Rp54 × markup 1,5), dibulatkan
// ke atas kelipatan 5. Rp54 = nilai kredit termurah yang teruji (Bisnis);
// bila harga paket final (D4) berubah, angka ini ikut berubah — makanya
// rumus disimpan sebagai parameter setting admin (fal_video_settings),
// BUKAN hardcode dan BUKAN tabel tarif mati. Modul ini murni: tanpa DB,
// tanpa fetch, tanpa efek samping — bisa diuji langsung.
//
// Contoh kunci: Wan 3.0 720p 8 detik ($0,10/dtk → $0,80 → Rp13.200)
// = ceil(13200 / 54 × 1,5) = ceil(366,67) = 367 → 370 kredit.

export interface VideoCreditParams {
  // Harga API model per detik, USD (dari registry video_models).
  pricePerSecUsd: number;
  // Durasi klip yang diminta, detik.
  durationSec: number;
  // Kurs Rp per USD (setting admin, default 16500).
  exchangeRateRpPerUsd: number;
  // Nilai 1 kredit dalam Rupiah (setting admin, default 54).
  creditValueRp: number;
  // Markup ×100 (setting admin, default 150 = 1,5×).
  markupX100: number;
  // Pembulatan ke atas kelipatan ini (setting admin, default 5).
  roundingStep: number;
}

export interface VideoCreditResult {
  credits: number;
  apiCostUsd: number;
  apiCostRp: number;
}

// Ceil dengan toleransi epsilon: hitungan desimal seperti 0,20 × 24 ×
// 16500 / 54 × 1,5 secara matematis tepat 2200, tetapi floating point
// bisa menghasilkannya 2200,0000000005 — tanpa epsilon, ceil akan
// melompat ke 2201 dan tarif terkunci ikut bergeser. Epsilon 1e-9 jauh
// lebih kecil dari selisih tarif mana pun (kelipatan 5), jadi tidak
// pernah mengubah hasil yang memang bukan bilangan bulat.
function ceilEps(x: number): number {
  return Math.ceil(x - 1e-9);
}

export function calcVideoCredits(
  params: VideoCreditParams,
): VideoCreditResult {
  const apiCostUsd = params.pricePerSecUsd * params.durationSec;
  const apiCostRp = apiCostUsd * params.exchangeRateRpPerUsd;
  const raw =
    (apiCostRp / params.creditValueRp) * (params.markupX100 / 100);
  const rounded = ceilEps(raw);
  const credits =
    ceilEps(rounded / params.roundingStep) * params.roundingStep;
  return { credits, apiCostUsd, apiCostRp };
}

// Parameter rumus tarif baku (keputusan terkunci) — dipakai sebagai
// fallback bila baris fal_video_settings belum ada; nilai yang berlaku
// selalu dibaca dari database oleh aksi admin.
export const DEFAULT_VIDEO_TARIFF: Omit<
  VideoCreditParams,
  "pricePerSecUsd" | "durationSec"
> = {
  exchangeRateRpPerUsd: 16500,
  creditValueRp: 54,
  markupX100: 150,
  roundingStep: 5,
};
