-- Xóa mềm `public.products` — client (catalogRepository.js) lọc `is_deleted`
-- khi đọc catalog và đánh dấu `is_deleted = true` (UPDATE) thay vì DELETE hẳn dòng,
-- để giải phóng `ma_hang` / `ma_vach` gốc cho sản phẩm tạo mới mà không đụng unique constraint.
--
-- Thiếu cột này khiến mọi query `.neq('is_deleted', true)` lỗi
-- ("column products.is_deleted does not exist") → catalog không tải được
-- (POS, tab Hàng hóa, Kiểm hàng đều trống / báo lỗi đồng bộ).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS products_is_deleted_idx ON public.products (is_deleted);

COMMENT ON COLUMN public.products.is_deleted IS 'Xóa mềm — true = ẩn khỏi catalog (POS/Hàng hóa/Kiểm hàng) nhưng vẫn giữ lịch sử.';
