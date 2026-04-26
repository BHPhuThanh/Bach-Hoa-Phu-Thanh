-- Chạy toàn bộ file này trong Supabase → SQL Editor → New query → Run.
-- Bảng products: một dòng singleton (id = 'catalog') chứa snapshot JSON toàn danh mục.
-- Bảng sales: mỗi dòng = một đơn POS (payload JSON).

CREATE TABLE IF NOT EXISTS public.products (
  id text PRIMARY KEY,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales (created_at DESC);

COMMENT ON TABLE public.products IS 'Danh mục: snapshot JSON (v, fileName, savedAt, products[]) — id cố định catalog.';
COMMENT ON TABLE public.sales IS 'Doanh thu / đơn bán: payload = toàn bộ object đơn hàng ứng dụng.';

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

-- Cảnh báo bảo mật: policy mở cho anon phù hợp kiosk nội bộ / MVP. Production nên dùng auth + policy chặt.
DROP POLICY IF EXISTS "products_allow_all_anon" ON public.products;
CREATE POLICY "products_allow_all_anon"
  ON public.products
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "sales_allow_all_anon" ON public.sales;
CREATE POLICY "sales_allow_all_anon"
  ON public.sales
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "products_allow_all_authenticated" ON public.products;
CREATE POLICY "products_allow_all_authenticated"
  ON public.products
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "sales_allow_all_authenticated" ON public.sales;
CREATE POLICY "sales_allow_all_authenticated"
  ON public.sales
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;
