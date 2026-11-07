UPDATE `invoices`
SET `kind` = 'adjust', `title` = 'Penyesuaian saldo oleh admin'
WHERE `number` = 'INV/202610/0006' AND `kind` = 'plan' AND `title` = 'Ganti paket langganan';
--> statement-breakpoint
INSERT INTO `admin_audit_log` (`admin_id`, `admin_email`, `action`, `target`, `before_value`, `after_value`, `created_at`)
SELECT u.`id`, u.`email`, 'correctInvoiceLabel', 'invoice INV/202610/0006',
  'kind "plan", judul "Ganti paket langganan"',
  'kind "adjust", judul "Penyesuaian saldo oleh admin" — koreksi label: transaksi ini penyesuaian saldo +300 oleh admin (pemulihan saldo probe baseline G5 30 Okt 2026), bukan ganti paket; nilai, status, dan saldo tidak berubah',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `users` u
WHERE u.`email` = 'budi@email.com'
  AND EXISTS (
    SELECT 1 FROM `invoices` i
    WHERE i.`number` = 'INV/202610/0006' AND i.`kind` = 'adjust' AND i.`title` = 'Penyesuaian saldo oleh admin'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `admin_audit_log` a
    WHERE a.`action` = 'correctInvoiceLabel' AND a.`target` = 'invoice INV/202610/0006'
  );
