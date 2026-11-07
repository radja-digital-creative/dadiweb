-- G13-D — Pemotongan kredit video: penanda anti-dobel di video_jobs.
-- credits_deducted 0/1 + deducted_at dicatat saat job completed dipotong
-- (lihat deductVideoJobCredits di server/src/video-jobs.ts); sinkronisasi
-- berulang setelah completed tidak boleh memotong dua kali.
-- Pola ALTER TABLE yang sama seperti 0020 (kolom baru di tabel yang ada);
-- migrator drizzle melacak migrasi yang sudah diterapkan di journal,
-- sehingga file ini tidak pernah diaplikasikan ulang di produksi.
ALTER TABLE `video_jobs` ADD COLUMN `credits_deducted` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `video_jobs` ADD COLUMN `deducted_at` integer;
