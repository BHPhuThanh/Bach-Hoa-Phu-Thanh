-- Lịch sử phiếu nhập đã «Hoàn thành» — app ghi sau khi upsert products/tồn thành công.

CREATE TABLE IF NOT EXISTS public.inbound_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  order_code text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS inbound_history_created_at_desc_idx ON public.inbound_history (created_at DESC);
CREATE INDEX IF NOT EXISTS inbound_history_order_code_idx ON public.inbound_history (order_code);

COMMENT ON TABLE public.inbound_history IS 'Phiếu nhập hoàn thành: order_code + payload (JSON phiếu đầy đủ).';

ALTER TABLE public.inbound_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_history_allow_all_anon" ON public.inbound_history;
CREATE POLICY "inbound_history_allow_all_anon"
  ON public.inbound_history FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "inbound_history_allow_all_auth" ON public.inbound_history;
CREATE POLICY "inbound_history_allow_all_auth"
  ON public.inbound_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_history TO anon, authenticated;

-- Đồng bộ bootstrap_store_schema (fresh DB / RPC từ web)
CREATE OR REPLACE FUNCTION public.bootstrap_store_schema()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  CREATE TABLE IF NOT EXISTS public.catalog_snapshots (
    id text PRIMARY KEY,
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.products (
    ma_hang text PRIMARY KEY,
    ma_vach text,
    ten_hang text,
    thuong_hieu text,
    gia_ban text,
    gia_von text,
    ton_kho text,
    ton_nho_nhat text,
    ton_lon_nhat text,
    dvt text,
    ma_dvt_co_ban text,
    quy_doi text,
    ma_hh_lien_quan text,
    trong_luong text,
    gia_si text,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

  CREATE INDEX IF NOT EXISTS products_created_at_desc_idx ON public.products (created_at DESC);

  CREATE TABLE IF NOT EXISTS public.sales (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales (created_at DESC);

  CREATE TABLE IF NOT EXISTS public.inbound_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    order_code text NOT NULL DEFAULT '',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE INDEX IF NOT EXISTS inbound_history_created_at_desc_idx ON public.inbound_history (created_at DESC);
  CREATE INDEX IF NOT EXISTS inbound_history_order_code_idx ON public.inbound_history (order_code);

  ALTER TABLE public.catalog_snapshots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.inbound_history ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "catalog_snapshots_allow_all_anon" ON public.catalog_snapshots;
  CREATE POLICY "catalog_snapshots_allow_all_anon"
    ON public.catalog_snapshots FOR ALL TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "catalog_snapshots_allow_all_auth" ON public.catalog_snapshots;
  CREATE POLICY "catalog_snapshots_allow_all_auth"
    ON public.catalog_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "products_allow_all_anon" ON public.products;
  CREATE POLICY "products_allow_all_anon"
    ON public.products FOR ALL TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "products_allow_all_auth" ON public.products;
  CREATE POLICY "products_allow_all_auth"
    ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "sales_allow_all_anon" ON public.sales;
  CREATE POLICY "sales_allow_all_anon"
    ON public.sales FOR ALL TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "sales_allow_all_auth" ON public.sales;
  CREATE POLICY "sales_allow_all_auth"
    ON public.sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "inbound_history_allow_all_anon" ON public.inbound_history;
  CREATE POLICY "inbound_history_allow_all_anon"
    ON public.inbound_history FOR ALL TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "inbound_history_allow_all_auth" ON public.inbound_history;
  CREATE POLICY "inbound_history_allow_all_auth"
    ON public.inbound_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_snapshots TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_history TO anon, authenticated;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
