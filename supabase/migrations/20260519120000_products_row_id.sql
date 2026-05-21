-- UUID ổn định cho mỗi dòng `products` — upsert `onConflict: id`, đổi `ma_hang` không nhân bản.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE public.products
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.products
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.products
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_row_id_unique ON public.products (id);

COMMENT ON COLUMN public.products.id IS 'Khóa upsert ổn định (UUID); ma_hang có thể đổi mà không tạo dòng mới.';
