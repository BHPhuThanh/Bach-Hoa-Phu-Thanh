/**
 * Banner nhắc tải lại khi có bản build mới trên server (xem appUpdateCheck.js). Nằm cố định trên
 * cùng, không tự động reload — POS đang mở đơn dở dang thì để người dùng chủ động bấm lúc rảnh tay
 * (nháp giỏ hàng đã tự lưu theo tab, tải lại không mất — xem posSessionDraft.js).
 */
export default function AppUpdateBanner({ visible, onReload }) {
  if (!visible) return null
  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <span className="app-update-banner-text">
        Có bản cập nhật mới cho phần mềm — tải lại để dùng bản mới nhất.
      </span>
      <button type="button" className="app-update-banner-btn" onClick={onReload}>
        Tải lại ngay
      </button>
    </div>
  )
}
