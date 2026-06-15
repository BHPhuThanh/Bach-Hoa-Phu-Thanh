-- Bật Supabase Realtime cho bảng `products` để client nhận postgres_changes (INSERT/UPDATE/DELETE)
-- thay cho việc polling/auto-fetch danh mục định kỳ.
--
-- • Thêm `products` vào publication `supabase_realtime` (idempotent).
-- • REPLICA IDENTITY FULL: payload event DELETE/UPDATE mang đủ cột (gồm `ma_hang`)
--   để client cập nhật/loại đúng biến thể mà không cần fetch lại toàn bộ catalog.

-- Đảm bảo publication tồn tại (project Supabase mặc định đã có; tạo phòng khi thiếu).
DO $realtime_pub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$realtime_pub$;

-- Thêm bảng vào publication nếu chưa có (ADD TABLE báo lỗi nếu đã tồn tại → bọc trong DO).
DO $realtime_add$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;
END
$realtime_add$;

ALTER TABLE public.products REPLICA IDENTITY FULL;
