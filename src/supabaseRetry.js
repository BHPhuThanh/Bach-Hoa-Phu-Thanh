/**
 * Retry cho các lệnh ghi Supabase đơn lẻ hay gặp lỗi mạng/timeout thoáng qua
 * (đặc biệt khi 1 thao tác gồm nhiều request tuần tự — vd. nhập hàng nhiều dòng:
 * một request bị chập chờn giữa chừng làm hỏng cả chuỗi dù phần lớn đã ghi xong).
 *
 * CHỈ dùng cho thao tác idempotent (UPDATE theo khóa chính, hoặc có kiểm tra tồn tại
 * trước khi ghi) — KHÔNG dùng cho INSERT thuần vì gọi lại có thể tạo dòng trùng khi
 * lần gọi trước thật ra đã thành công nhưng phản hồi bị rớt mạng.
 */
export async function withSupabaseRetry(fn, { attempts = 3, baseDelayMs = 400 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)))
      }
    }
  }
  throw lastErr
}
