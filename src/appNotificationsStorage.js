/**
 * Thông báo chung (chuông) — lưu localStorage, đồng bộ tab qua CustomEvent + storage.
 */

export const APP_NOTIFICATIONS_STORAGE_KEY = 'csv-preview-app-notifications-v1'
export const APP_NOTIFICATIONS_BUMP_EVENT = 'csv-preview:notifications-bump'

const MAX_ITEMS = 80

function bump() {
  try {
    window.dispatchEvent(new Event(APP_NOTIFICATIONS_BUMP_EVENT))
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Array<{ id: string, kind: 'cost_change', variantId: string, code: string, name: string, oldCost: number, newCost: number, message: string, createdAtMs: number }>}
 */
export function loadAppNotifications() {
  try {
    const raw = localStorage.getItem(APP_NOTIFICATIONS_STORAGE_KEY)
    if (!raw) return []
    const j = JSON.parse(raw)
    if (!Array.isArray(j)) return []
    return j.filter((x) => x && x.kind === 'cost_change' && x.id)
  } catch {
    return []
  }
}

function saveAppNotifications(list) {
  try {
    localStorage.setItem(APP_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
  } catch {
    /* ignore */
  }
  bump()
}

function formatMoneyVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `${Math.round(x).toLocaleString('vi-VN')} đ`
}

/**
 * @param {Array<{ variantId?: string, code?: string, ma_hang?: string, name?: string, oldCost?: number, newCost?: number }>} diffs — từ `computeInboundFulfillmentPlan`
 */
export function appendInboundCostChangeNotifications(diffs) {
  if (!Array.isArray(diffs) || diffs.length === 0) return
  if (typeof window === 'undefined') return
  const prev = loadAppNotifications()
  const now = Date.now()
  const incoming = diffs.map((d, i) => {
    const name = String(d.name ?? '').trim() || '—'
    const code = String(d.ma_hang ?? d.code ?? '').trim()
    const variantId = String(d.variantId ?? '').trim()
    const oldCost = Number(d.oldCost) || 0
    const newCost = Number(d.newCost) || 0
    const message = `Giá vốn sản phẩm ${name} đã thay đổi từ ${formatMoneyVi(oldCost)} thành ${formatMoneyVi(newCost)}`
    return {
      id: `cc-${now}-${i}-${variantId || code || Math.random().toString(36).slice(2, 8)}`,
      kind: 'cost_change',
      variantId,
      code,
      name,
      oldCost,
      newCost,
      message,
      createdAtMs: now,
    }
  })
  saveAppNotifications([...incoming, ...prev])
}

export function clearAppNotificationById(id) {
  const sid = String(id ?? '').trim()
  if (!sid) return
  const next = loadAppNotifications().filter((x) => x.id !== sid)
  saveAppNotifications(next)
}

export function clearAllCostChangeNotifications() {
  saveAppNotifications([])
}

/** Đánh dấu toàn bộ thông báo local (giá vốn) như đã xử lý — đồng bộ với «Đọc tất cả». */
export function markAllLocalNotificationsRead() {
  clearAllCostChangeNotifications()
}
