-- Nhật ký biến động tồn kho (đơn vị cơ bản / DB ton_kho).

CREATE TABLE IF NOT EXISTS public.inventory_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  ma_hang text NOT NULL,
  transaction_type text NOT NULL,
  document_code text NOT NULL,
  change_qty double precision NOT NULL,
  stock_after double precision NOT NULL,
  staff_name text,
  pos_order_id text,
  inbound_order_id text
);

CREATE INDEX IF NOT EXISTS inventory_log_created_at_desc_idx ON public.inventory_log (created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_log_ma_hang_created_at_desc_idx ON public.inventory_log (ma_hang, created_at DESC);

COMMENT ON TABLE public.inventory_log IS 'Biến động tồn kho: ma_hang + change_qty (cơ bản) + stock_after sau giao dịch.';

ALTER TABLE public.inventory_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_log_allow_all_anon" ON public.inventory_log;
CREATE POLICY "inventory_log_allow_all_anon"
  ON public.inventory_log FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_log_allow_all_auth" ON public.inventory_log;
CREATE POLICY "inventory_log_allow_all_auth"
  ON public.inventory_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_log TO anon, authenticated;

-- Bổ sung bootstrap (project cũ chỉ gọi RPC thì vẫn có bảng)
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

  CREATE TABLE IF NOT EXISTS public.inventory_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    ma_hang text NOT NULL,
    transaction_type text NOT NULL,
    document_code text NOT NULL,
    change_qty double precision NOT NULL,
    stock_after double precision NOT NULL,
    staff_name text,
    pos_order_id text,
    inbound_order_id text
  );

  CREATE INDEX IF NOT EXISTS inventory_log_created_at_desc_idx ON public.inventory_log (created_at DESC);
  CREATE INDEX IF NOT EXISTS inventory_log_ma_hang_created_at_desc_idx ON public.inventory_log (ma_hang, created_at DESC);

  ALTER TABLE public.catalog_snapshots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.inventory_log ENABLE ROW LEVEL SECURITY;

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

  DROP POLICY IF EXISTS "inventory_log_allow_all_anon" ON public.inventory_log;
  CREATE POLICY "inventory_log_allow_all_anon"
    ON public.inventory_log FOR ALL TO anon USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS "inventory_log_allow_all_auth" ON public.inventory_log;
  CREATE POLICY "inventory_log_allow_all_auth"
    ON public.inventory_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_snapshots TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_log TO anon, authenticated;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;
