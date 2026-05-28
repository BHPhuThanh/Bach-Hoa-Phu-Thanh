-- Cấu hình ứng dụng dùng chung (PIN Admin, ...).
-- Lưu ý: bản hiện tại lưu PIN dạng text theo yêu cầu nghiệp vụ.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES ('admin_pin', '123456')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_app_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_touch_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_app_settings_updated_at();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_allow_all_anon" ON public.app_settings;
CREATE POLICY "app_settings_allow_all_anon"
  ON public.app_settings FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app_settings_allow_all_auth" ON public.app_settings;
CREATE POLICY "app_settings_allow_all_auth"
  ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;
