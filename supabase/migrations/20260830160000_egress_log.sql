-- Egress đo TỪ TRÌNH DUYỆT (client), không qua báo cáo Supabase — báo cáo egress trong dashboard
-- Supabase chỉ có độ phân giải theo NGÀY, muốn biết trong ngày tính năng nào đang tốn nhiều thì
-- phải chờ hôm sau mới thấy. Bảng này ghi lại dung lượng response PostgREST đo ngay trên trình
-- duyệt (Content-Length, xem src/egressMonitor.js), gộp theo đợt flush (không ghi từng request lẻ
-- — tự ghi log cũng tốn egress/ingress nếu ghi quá dày) rồi cộng dồn theo bảng + khoảng thời gian.
--
-- LƯU Ý: chỉ đo được traffic đi qua `fetch` (REST/PostgREST) — KHÔNG bao gồm kênh Realtime
-- (WebSocket, không qua fetch). Theo pie chart Supabase, Realtime thường chỉ ~1-2% tổng egress.

CREATE TABLE IF NOT EXISTS public.egress_log (
  id bigserial PRIMARY KEY,
  bucket_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  bytes bigint NOT NULL,
  request_count integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS egress_log_bucket_at_idx ON public.egress_log (bucket_at DESC);

COMMENT ON TABLE public.egress_log IS
  'Egress ước lượng đo từ trình duyệt (Content-Length response PostgREST), gộp theo đợt flush (~5 phút/tab). Không bao gồm Realtime (WebSocket).';

ALTER TABLE public.egress_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "egress_log_allow_all_anon" ON public.egress_log;
CREATE POLICY "egress_log_allow_all_anon"
  ON public.egress_log FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "egress_log_allow_all_auth" ON public.egress_log;
CREATE POLICY "egress_log_allow_all_auth"
  ON public.egress_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Chỉ SELECT + INSERT — client chỉ ghi thêm (không sửa/xoá dòng cũ), khỏi lỡ tay cấp thừa quyền.
GRANT SELECT, INSERT ON public.egress_log TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.egress_log_id_seq TO anon, authenticated;

-- View gộp theo NGÀY GIỜ VIỆT NAM (Asia/Ho_Chi_Minh, không phải ngày UTC — lệch múi giờ +7 dễ xô
-- ca đêm sang nhầm ngày) + bảng. Admin đọc qua view này (vài chục dòng/2 tuần), không kéo thẳng
-- egress_log thô (có thể tới hàng nghìn dòng/ngày nếu mở nhiều tab cả ngày).
CREATE OR REPLACE VIEW public.egress_log_daily AS
SELECT
  (bucket_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
  table_name,
  sum(bytes)::bigint AS bytes,
  sum(request_count)::bigint AS request_count
FROM public.egress_log
GROUP BY 1, 2;

GRANT SELECT ON public.egress_log_daily TO anon, authenticated;
