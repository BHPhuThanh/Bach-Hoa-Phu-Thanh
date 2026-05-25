-- Gom lịch sử tồn kho theo sản phẩm (product_id) + biến thể giao dịch (variant_id).

ALTER TABLE public.inventory_log
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS variant_id text,
  ADD COLUMN IF NOT EXISTS txn_qty double precision,
  ADD COLUMN IF NOT EXISTS txn_unit_label text,
  ADD COLUMN IF NOT EXISTS base_unit_label text;

CREATE INDEX IF NOT EXISTS inventory_log_product_id_created_at_desc_idx
  ON public.inventory_log (product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

COMMENT ON COLUMN public.inventory_log.product_id IS 'Id nhóm catalog (display product) — gom mọi ĐVT.';
COMMENT ON COLUMN public.inventory_log.variant_id IS 'Biến thể / ĐVT thực hiện giao dịch.';
COMMENT ON COLUMN public.inventory_log.txn_qty IS 'Số lượng theo ĐVT giao dịch (vd. 1 Lốc).';
COMMENT ON COLUMN public.inventory_log.txn_unit_label IS 'Tên ĐVT giao dịch.';
COMMENT ON COLUMN public.inventory_log.base_unit_label IS 'ĐVT cơ bản cho change_qty (vd. Chai).';
