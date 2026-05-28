-- Dọn dữ liệu tiền tệ legacy bị float trong products.
-- Chuẩn hóa VNĐ: gia_ban / gia_von / gia_si -> số nguyên (ROUND).

UPDATE public.products
SET
  gia_ban = ROUND(COALESCE(gia_ban, 0)),
  gia_von = ROUND(COALESCE(gia_von, 0)),
  gia_si = ROUND(COALESCE(gia_si, 0))
WHERE
  gia_ban IS DISTINCT FROM ROUND(COALESCE(gia_ban, 0))
  OR gia_von IS DISTINCT FROM ROUND(COALESCE(gia_von, 0))
  OR gia_si IS DISTINCT FROM ROUND(COALESCE(gia_si, 0));
