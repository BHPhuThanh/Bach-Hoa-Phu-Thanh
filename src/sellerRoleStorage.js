/** Đồng bộ vai trò POS giữa các tab (Admin / Nhân viên) — không thay thế xác thực máy chủ */

export const POS_ACTIVE_SELLER_STORAGE_KEY = 'csv-preview-pos-active-seller-id-v1'

export function readStoredSellerId() {
  try {
    const v = localStorage.getItem(POS_ACTIVE_SELLER_STORAGE_KEY)
    if (v === 'admin' || v === 'staff') return v
  } catch {
    /* ignore */
  }
  return null
}

export function writeStoredSellerId(id) {
  try {
    if (id === 'admin' || id === 'staff') {
      localStorage.setItem(POS_ACTIVE_SELLER_STORAGE_KEY, id)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('csv-preview-seller-role-changed'))
      }
    }
  } catch {
    /* ignore */
  }
}

function absUrlUnderBase(slug) {
  const base = import.meta.env.BASE_URL || '/'
  const root = new URL(base, window.location.href)
  const prefix = root.pathname.replace(/\/$/, '')
  const path = `${prefix}/${slug}`.replace(/\/+/g, '/')
  return `${root.origin}${path}`
}

/** URL tuyệt đối tới trang báo cáo (tôn trọng import.meta.env.BASE_URL). */
export function getDoanhThuAbsUrl() {
  return absUrlUnderBase('doanh-thu')
}

/** Màn tạo phiếu điều chỉnh giá vốn — tab mới. */
export function getCostAdjustCreateAbsUrl() {
  return absUrlUnderBase('dieu-chinh-gia/tao-moi')
}

/** Màn tạo phiếu kiểm hàng — tab mới. */
export function getStockCheckCreateAbsUrl() {
  return absUrlUnderBase('kiem-hang/tao-moi')
}

/** Màn tạo đơn nhập hàng — tab mới. */
export function getInboundCreateAbsUrl() {
  return absUrlUnderBase('nhap-hang/tao-moi')
}

/** Mở Admin Hub tab Đơn hàng — tab mới, không rời POS (slug SPA). */
export function getHubDanhSachDonHangAbsUrl() {
  return absUrlUnderBase('danh-sach-don-hang')
}

/** Mở Admin Hub tab Doanh thu (bảng có hoàn trả) — tab mới cho luồng đổi trả. */
export function getHubDoiTraHangAbsUrl() {
  return absUrlUnderBase('doi-tra-hang')
}

/** Danh sách đơn (Admin Hub) — đường dẫn chuẩn SPA `/admin/orders`. */
export function getAdminOrdersAbsUrl() {
  return absUrlUnderBase('admin/orders')
}

/**
 * Chi tiết đơn để đổi trả — `/admin/return-order/:orderId` (mở hub chi tiết đơn POS).
 * @param {string} orderId
 */
export function getAdminReturnOrderAbsUrl(orderId) {
  const id = String(orderId ?? '').trim()
  if (!id) return getAdminOrdersAbsUrl()
  const base = import.meta.env.BASE_URL || '/'
  const root = new URL(base, window.location.href)
  const prefix = root.pathname.replace(/\/$/, '')
  const path = `${prefix}/admin/return-order/${encodeURIComponent(id)}`.replace(/\/+/g, '/')
  return `${root.origin}${path}`
}
