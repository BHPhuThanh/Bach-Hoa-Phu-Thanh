-- Cột created_at cho public.products — sắp xếp sản phẩm mới nhất trước khi đọc từ Supabase.
-- Chạy thêm vào DB đã tồn tại (Hoặc dùng bootstrap_store_schema trong app sau khi cập nhật).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.products.created_at IS 'Thời điểm ghi nhận dòng; mặc định now() khi insert.';

CREATE INDEX IF NOT EXISTS products_created_at_desc_idx ON public.products (created_at DESC);
