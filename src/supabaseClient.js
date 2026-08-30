import { createClient } from '@supabase/supabase-js'
import { createEgressTrackingFetch } from './egressMonitor.js'

// Lấy trực tiếp từ Vite, không qua trung gian
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabaseReady =
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim().length > 0 &&
  typeof supabaseAnonKey === 'string' &&
  supabaseAnonKey.trim().length > 0

/**
 * `auth` tắt hẳn — app chỉ dùng anon key công khai (RLS cho phép `anon`), không có ai đăng nhập
 * qua supabase.auth.* (không 1 chỗ nào trong repo gọi tới). Mặc định supabase-js vẫn tự bật
 * persistSession/autoRefreshToken dù không dùng, và dùng Web Locks API (navigator.locks) để
 * đồng bộ refresh token giữa nhiều tab — cơ chế này hoàn toàn thừa với app này nhưng thỉnh
 * thoảng "steal" khóa của 1 request khác đang chạy dở (đặc biệt khi mở nhiều tab, đúng cách
 * dùng thực tế của cửa hàng), làm request đó bị hủy giữa chừng (AbortError: Lock broken…) —
 * đây là nguyên nhân của nhiều lần "lỗi đồng bộ ngẫu nhiên khi nhập hàng lớn" trước đây. Tắt hẳn
 * ở đây loại bỏ toàn bộ cơ chế khóa không cần thiết này.
 */
export const supabase = supabaseReady
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      // Đo egress ngay trong trình duyệt (không qua báo cáo Supabase, vốn chỉ theo ngày) — xem
      // egressMonitor.js. Không đổi hành vi fetch, chỉ đo dung lượng response rồi ghi log định kỳ.
      global: { fetch: createEgressTrackingFetch() },
    })
  : null

export const getSupabaseClient = () => supabase
export const isSupabaseConfigured = () => supabaseReady

/** Nếu sau này dùng `client.channel(...).subscribe(...)`, bắt buộc gọi `removeChannel` / `unsubscribe` trong cleanup `useEffect`. */