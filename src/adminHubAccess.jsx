/** Tab id dùng chung App ↔ AdminHub khi kiểm tra quyền Nhân viên. */
export const HUB_TAB_OVERVIEW = 'overview'
export const HUB_TAB_GOODS = 'goods'
export const HUB_TAB_ORDERS = 'orders'

const POS_ORDER_DETAIL_PREFIX = 'pos_order_detail:'
const POS_RETURN_DETAIL_PREFIX = 'pos_return_detail:'
const SOLO_PRODUCT_TAB_PREFIX = 'solo_product:'
const INBOUND_DETAIL_PREFIX = 'inbound_detail:'

export function isPosOrderDetailTabId(tab) {
  return String(tab ?? '').startsWith(POS_ORDER_DETAIL_PREFIX)
}

export function isPosReturnDetailTabId(tab) {
  return String(tab ?? '').startsWith(POS_RETURN_DETAIL_PREFIX)
}

export function isSoloProductTabIdForAccess(tab) {
  return String(tab ?? '').startsWith(SOLO_PRODUCT_TAB_PREFIX)
}

function isInboundDetailTabIdForAccess(tab) {
  return String(tab ?? '').startsWith(INBOUND_DETAIL_PREFIX)
}

/** Tab Nhân viên được vào không cần PIN Admin. */
export function isStaffAllowedHubTabWithoutPin(tabId) {
  const t = String(tabId ?? '')
  if (t === HUB_TAB_ORDERS) return true
  if (isPosOrderDetailTabId(t)) return true
  if (isPosReturnDetailTabId(t)) return true
  return false
}

/** Tab cần quyền Admin (Doanh thu, Hàng hóa, …). */
export function isAdminRestrictedHubTab(tabId) {
  const t = String(tabId ?? '')
  if (!t) return false
  if (isStaffAllowedHubTabWithoutPin(t)) return false
  return true
}

export function staffSafeHubTabId() {
  return HUB_TAB_ORDERS
}

/** Màn chặn đen — lớp 2 khi staff lọt vào tab hạn chế. */
export function AdminHubRestrictedFallback() {
  return (
    <div
      style={{ backgroundColor: 'black', height: '100vh', width: '100%' }}
      aria-hidden
    />
  )
}
