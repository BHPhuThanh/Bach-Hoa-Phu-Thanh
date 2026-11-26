-- Đảm bảo app được UPDATE phiếu nhập (Lưu tạm → Hoàn thành, sửa phiếu, xóa mềm).
-- Nếu thiếu policy/quyền UPDATE, PostgREST trả 0 dòng → lỗi «Cannot coerce the result to a single JSON object».

ALTER TABLE public.inbound_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_history_allow_all_anon" ON public.inbound_history;
CREATE POLICY "inbound_history_allow_all_anon"
  ON public.inbound_history FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "inbound_history_allow_all_auth" ON public.inbound_history;
CREATE POLICY "inbound_history_allow_all_auth"
  ON public.inbound_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_history TO anon, authenticated;
