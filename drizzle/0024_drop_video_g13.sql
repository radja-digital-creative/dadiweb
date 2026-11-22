-- Drop G13 video (fal.ai) — keputusan Eka 22 Nov 2026: full drop video,
-- fokus web saja. Kode G13 sudah dihapus dari server + client; migrasi
-- ini membersihkan tabel video di DB staging yang sudah menerapkan
-- 0021–0023. DROP IF EXISTS agar aman dijalankan di DB yang sudah
-- maupun belum menerapkan migrasi video (idempotent).
DROP TABLE IF EXISTS `video_jobs`;
--> statement-breakpoint
DROP TABLE IF EXISTS `video_models`;
--> statement-breakpoint
DROP TABLE IF EXISTS `fal_video_settings`;
--> statement-breakpoint
DROP INDEX IF EXISTS `video_jobs_project_id_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `video_jobs_fal_request_id_idx`;
--> statement-breakpoint
DELETE FROM `credit_usage` WHERE `category` = 'Video';
