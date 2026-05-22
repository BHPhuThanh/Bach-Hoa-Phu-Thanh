-- Thông báo POS / Hub: tồn thấp, giá vốn, …

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  kind text NOT NULL DEFAULT 'general',
  variant_id text,
  product_code text,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS notifications_created_at_desc_idx
  ON public.notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS notifications_low_stock_variant_day_idx
  ON public.notifications (variant_id, kind, created_at DESC)
  WHERE kind = 'low_stock' AND is_read = false;

COMMENT ON TABLE public.notifications IS 'Thông báo cửa hàng: is_read, kind (low_stock, cost_change, …).';

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_allow_all_anon" ON public.notifications;
CREATE POLICY "notifications_allow_all_anon"
  ON public.notifications FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_allow_all_auth" ON public.notifications;
CREATE POLICY "notifications_allow_all_auth"
  ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO anon, authenticated;
