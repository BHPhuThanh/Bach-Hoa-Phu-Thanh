/**
 * Đồng bộ URL ↔ tab chính Admin Hub (Quản lý).
 * Tránh dùng `/doanh-thu` (route báo cáo độc lập) — tab «Doanh thu» trong hub dùng `/tong-quan`.
 */

/** @param {string} pathname */
function pathSegments(pathname) {
  return String(pathname || '')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
}

/**
 * Tab chính (id như trong AdminHub `TAB_*`) từ pathname, hoặc `null` nếu không khớp slug hub.
 * `/hang-hoa/:id` → `null` (để App xử lý deep link sản phẩm).
 * @param {string} pathname
 * @returns {string | null}
 */
export function hubMainTabFromPathname(pathname) {
  const segs = pathSegments(pathname)
  if (segs.length === 0) return null
  if (segs[0] === 'hang-hoa' && segs.length >= 2) return null
  const slug = segs[segs.length - 1]
  const map = {
    'tong-quan': 'overview',
    'hang-hoa': 'goods',
    'kiem-hang': 'stock_check',
    'dieu-chinh-gia': 'cost_adjust',
    'nhap-hang': 'inbound',
    'don-hang': 'orders',
    'khach-hang': 'customers',
    'nhan-vien': 'staff',
  }
  const tab = map[slug]
  return tab ?? null
}

/**
 * @param {string} tabId — `overview` | `goods` | … | `inbound_draft`
 * @returns {string | null} đường dẫn tuyệt đối trong app (có dấu `/` đầu), hoặc `null` nếu không map
 */
export function pathForMainNavTab(tabId) {
  const id = String(tabId || '')
  const map = {
    overview: '/tong-quan',
    goods: '/hang-hoa',
    stock_check: '/kiem-hang',
    cost_adjust: '/dieu-chinh-gia',
    inbound: '/nhap-hang',
    inbound_draft: '/nhap-hang',
    orders: '/don-hang',
    customers: '/khach-hang',
    staff: '/nhan-vien',
  }
  const p = map[id]
  return p ?? null
}

/**
 * Pathname cần mở shell dashboard (không phải POS) khi tải trang.
 * Không gồm `/hang-hoa/:id` (đã xử lý qua parseHangHoaGoodsOpenFromLocation).
 * @param {string} pathname
 */
export function pathnameOpensHubStandaloneDashboard(pathname) {
  const segs = pathSegments(pathname)
  if (segs.length === 0) return false
  const hub = new Set([
    'nhap-hang',
    'kiem-hang',
    'tong-quan',
    'don-hang',
    'khach-hang',
    'nhan-vien',
    'dieu-chinh-gia',
  ])
  if (segs.some((s) => hub.has(s))) return true
  return segs.length === 1 && segs[0] === 'hang-hoa'
}
