-- Xóa thông báo cũ hơn 7 ngày (gọi từ app khi khởi động).
CREATE OR REPLACE FUNCTION public.clean_old_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.notifications
  WHERE created_at < (now() - interval '7 days');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clean_old_notifications() TO authenticated, anon, service_role;
