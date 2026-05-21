/** Nháp phiên bán hàng (đa tab) — LocalStorage, chống mất điện / F5 */

export const POS_SESSION_DRAFT_KEY = 'csv-preview-pos-session-draft-v1'
export const POS_SESSION_DRAFT_VERSION = 1

/**
 * Dấu vân tay catalog + tên file để chỉ khôi phục khi CSV khớp phiên đang lưu.
 * @param {Array<{ groupVariants?: unknown[], code?: string, unitLabel?: string }>} products
 * @param {string} fileName
 */
export function buildCatalogFingerprint(products, fileName) {
  if (!products?.length) return ''
  const parts = []
  for (const p of products) {
    const vars = p.groupVariants || [p]
    for (const v of vars) {
      const convRaw = v.conversionValue ?? v.conversion ?? ''
      parts.push(
        `${String(v.code ?? '').trim()}\t${String(v.unitLabel ?? '').trim()}\t${String(convRaw).trim()}\t${Number(v.stockQty) || 0}\t${Number(v.cost) || 0}\t${Number(v.price) || 0}`
      )
    }
  }
  parts.sort()
  const s = parts.join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(33, h) ^ s.charCodeAt(i)) >>> 0
  }
  return `${String(fileName || '')}::${products.length}::${h.toString(16)}`
}

export function loadPosSessionDraft() {
  try {
    const raw = localStorage.getItem(POS_SESSION_DRAFT_KEY)
    if (!raw) return null
    const j = JSON.parse(raw)
    if (!j || j.v !== POS_SESSION_DRAFT_VERSION || typeof j.fingerprint !== 'string') return null
    if (!Array.isArray(j.sellOrders)) return null
    return j
  } catch {
    return null
  }
}

export function savePosSessionDraft(payload) {
  try {
    localStorage.setItem(POS_SESSION_DRAFT_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('posSessionDraft: không lưu được LocalStorage', e)
  }
}

export function clearPosSessionDraft() {
  try {
    localStorage.removeItem(POS_SESSION_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

export function sellOrdersHaveAnyCartLines(sellOrders) {
  if (!Array.isArray(sellOrders)) return false
  return sellOrders.some((o) => Array.isArray(o?.cart) && o.cart.length > 0)
}
