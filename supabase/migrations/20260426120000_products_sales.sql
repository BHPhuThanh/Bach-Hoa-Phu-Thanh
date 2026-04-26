-- Chạy toàn bộ trong Supabase → SQL Editor (một lần cho project mới).
--
-- • catalog_snapshots — JSON danh mục cho app POS (id = 'catalog').
-- • products — mỗi dòng = một mã hàng từ export Kiot (cột khớp kiotnew.csv).
-- • sales — đơn bán / doanh thu (payload JSON).
-- • bootstrap_store_schema() — gọi từ web (anon) để đảm bảo bảng + RLS tồn tại (SECURITY DEFINER).

-- --- Nâng cấp từ bản cũ (bảng products chỉ có snapshot JSON) -----------------
DO $legacy$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'snapshot'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'ma_hang'
  ) THEN
    EXECUTE 'ALTER TABLE public.products RENAME TO products_legacy_jsonb_v1';
    CREATE TABLE IF NOT EXISTS public.catalog_snapshots (
      id text PRIMARY KEY,
      snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.catalog_snapshots (id, snapshot, updated_at)
    SELECT id, snapshot, updated_at FROM public.products_legacy_jsonb_v1
    ON CONFLICT (id) DO UPDATE SET
      snapshot = EXCLUDED.snapshot,
      updated_at = EXCLUDED.updated_at;
  END IF;
END
$legacy$;

-- --- Bảng chính -------------------------------------------------------------
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
  kh_dat text,
  du_kien_het_hang text,
  ton_nho_nhat text,
  ton_lon_nhat text,
  dvt text,
  ma_dvt_co_ban text,
  quy_doi text,
  thuoc_tinh text,
  ma_hh_lien_quan text,
  trong_luong text,
  dang_kinh_doanh text,
  duoc_ban_truc_tiep text,
  gia_si text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales (created_at DESC);

COMMENT ON TABLE public.catalog_snapshots IS 'Snapshot JSON danh mục POS (id = catalog).';
COMMENT ON TABLE public.products IS 'Dòng phẳng từ CSV Kiot (Mã hàng, Tên hàng, Giá bán, …).';
COMMENT ON TABLE public.sales IS 'Đơn bán: payload = object đơn hàng đầy đủ.';

-- --- RLS (kiosk / MVP — siết chặt khi có auth thật) -------------------------
ALTER TABLE public.catalog_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_snapshots TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;

-- --- RPC: app gọi để đảm bảo schema (kể cả project chưa chạy file SQL tay) ---
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
    kh_dat text,
    du_kien_het_hang text,
    ton_nho_nhat text,
    ton_lon_nhat text,
    dvt text,
    ma_dvt_co_ban text,
    quy_doi text,
    thuoc_tinh text,
    ma_hh_lien_quan text,
    trong_luong text,
    dang_kinh_doanh text,
    duoc_ban_truc_tiep text,
    gia_si text,
    imported_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.sales (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sales_created_at_idx ON public.sales (created_at DESC);

  ALTER TABLE public.catalog_snapshots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

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

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_snapshots TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO anon, authenticated;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.bootstrap_store_schema() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_store_schema() TO anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_store_schema() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_store_schema() TO service_role;
