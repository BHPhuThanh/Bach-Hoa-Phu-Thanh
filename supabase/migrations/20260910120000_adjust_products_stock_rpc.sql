-- RPC cộng/trừ TỒN KHO TƯƠNG ĐỐI ngay tại server — thay cho cách cũ (đọc tồn ở máy khách, tính
-- tồn mới, ghi đè số tuyệt đối) đang dùng ở luồng thanh toán POS. Cách cũ có lỗi mất cập nhật
-- (lost update): nếu tab thu ngân mở lâu chưa kịp nhận Realtime của 1 lần nhập hàng/sửa tồn ở nơi
-- khác, lần bán tiếp theo tính trên tồn CŨ trong bộ nhớ rồi ghi đè — xoá mất thay đổi vừa xảy ra ở
-- nơi khác, dù đơn bán đó tự nó hoàn toàn đúng. Cộng/trừ tương đối ngay tại DB (ton_kho = ton_kho +
-- delta) miễn nhiễm với việc máy khách có dữ liệu cũ hay không, vì luôn tính trên số THẬT hiện tại
-- của chính DB, không phải số máy khách nhớ.
--
-- `products.ton_kho` là cột `text` (theo đúng cấu trúc CSV Kiot cũ) — ép kiểu numeric khi tính,
-- ép lại về text khi lưu. Nhận 1 mảng jsonb [{ma_hang, delta}, ...] để cộng/trừ nhiều mã hàng
-- trong 1 lần gọi (1 giỏ hàng có thể có nhiều dòng) — mỗi phần tử là 1 UPDATE độc lập, không phải
-- 1 câu lệnh gộp, nên trùng ma_hang trong cùng mảng vẫn cộng dồn đúng.

CREATE OR REPLACE FUNCTION public.adjust_products_stock(patches jsonb)
RETURNS TABLE(ma_hang text, ton_kho text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  p jsonb;
BEGIN
  IF patches IS NULL OR jsonb_typeof(patches) <> 'array' THEN
    RETURN;
  END IF;

  FOR p IN SELECT * FROM jsonb_array_elements(patches)
  LOOP
    UPDATE public.products AS pr
    SET ton_kho = (
      COALESCE(NULLIF(pr.ton_kho, '')::numeric, 0) + (p->>'delta')::numeric
    )::text
    WHERE pr.ma_hang = (p->>'ma_hang');
  END LOOP;

  RETURN QUERY
  SELECT pr.ma_hang, pr.ton_kho
  FROM public.products pr
  WHERE pr.ma_hang IN (
    SELECT DISTINCT (elem->>'ma_hang') FROM jsonb_array_elements(patches) elem
  );
END;
$fn$;

-- RLS trên `products` đang cho anon/authenticated UPDATE trực tiếp rồi (xem migration gốc) — hàm
-- này không cần SECURITY DEFINER, chạy đúng bằng quyền của người gọi (RLS vẫn áp dụng bình thường).
GRANT EXECUTE ON FUNCTION public.adjust_products_stock(jsonb) TO anon, authenticated;
