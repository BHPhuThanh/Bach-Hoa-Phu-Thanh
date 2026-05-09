-- Đồng bộ tên cột staff_name với schema app (ghi/lọc nhật ký kho).

DO $migrate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_log' AND column_name = 'staff_label'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_log' AND column_name = 'staff_name'
  ) THEN
    ALTER TABLE public.inventory_log RENAME COLUMN staff_label TO staff_name;
  END IF;
END
$migrate$;
