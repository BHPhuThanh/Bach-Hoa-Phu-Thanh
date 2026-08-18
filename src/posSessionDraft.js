/**
 * Nháp phiên bán hàng — chống mất điện / crash / F5.
 *
 * MỖI TAB CÓ 1 Ô LƯU RIÊNG (không dùng chung 1 khóa cho mọi tab) — trước đây dùng chung 1 khóa,
 * hễ tab nào thanh toán xong là tự ghi đè/xóa luôn ô lưu chung bằng đúng dữ liệu của riêng nó,
 * bất kể tab khác đang có đơn dở dang gì trong đó → tắt mở lại tab kia là mất trắng. Dùng chung
 * 1 khóa còn dễ vỡ dù vá thêm bao nhiêu lớp tín hiệu/thời gian ở lớp trên, vì gốc rễ là 2 tab
 * cùng ghi vào 1 chỗ.
 *
 * Mỗi tab tự nhận 1 mã (`sessionStorage`, sống theo vòng đời tab) và định kỳ "báo còn sống"
 * (heartbeat) vào ô lưu của chính nó. Tab mới mở lên, nếu chưa có ô riêng, sẽ tìm trong các ô
 * của tab khác xem có ô nào ĐÃ NGƯNG báo sống (nghĩa là tab đó thực sự đã đóng) để "nhận lại" —
 * đúng nhu cầu "mất điện/crash rồi mở lại vẫn còn đơn", mà không đụng tới ô của tab đang mở khác.
 */

export const POS_SESSION_DRAFT_PREFIX = 'csv-preview-pos-session-draft-v2::'
export const POS_SESSION_DRAFT_VERSION = 2
const POS_TAB_ID_SESSION_KEY = 'csv-preview-pos-tab-id'
/** Tab không báo sống quá mốc này → coi như đã đóng, cho phép tab khác nhận lại nháp. */
export const POS_DRAFT_HEARTBEAT_STALE_MS = 12000
/** Dọn rác nháp quá cũ (tab đóng rất lâu, không ai nhận) — tránh phình localStorage vô hạn. */
const POS_DRAFT_GC_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

/** Mã tab ổn định trong vòng đời tab này (mất khi đóng tab, giữ nguyên qua F5). */
export function getOrCreatePosTabId() {
  try {
    let id = sessionStorage.getItem(POS_TAB_ID_SESSION_KEY)
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      sessionStorage.setItem(POS_TAB_ID_SESSION_KEY, id)
    }
    return id
  } catch {
    // sessionStorage không khả dụng (vd. chế độ ẩn danh chặn) — vẫn hoạt động được trong phiên
    // này, chỉ là mất khả năng phân biệt qua F5 (chấp nhận được, hiếm gặp).
    return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function draftKeyForTab(tabId) {
  return `${POS_SESSION_DRAFT_PREFIX}${tabId}`
}

/**
 * Dấu vân tay catalog + tên file — dùng để phát hiện danh mục đổi (giá/tồn/đơn vị...), ví dụ để
 * đồng bộ lại giá/tồn hiển thị trên giỏ hàng đang mở khi có cập nhật (App.jsx). Đổi tồn/giá của
 * BẤT KỲ sản phẩm nào cũng làm giá trị này đổi — dùng đúng cho "phát hiện thay đổi để re-sync",
 * KHÔNG dùng để quyết định khôi phục nháp giỏ hàng (xem {@link buildPosDraftFingerprint}).
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

/**
 * Dấu vân tay CẤU TRÚC (mã hàng + ĐVT + hệ số quy đổi) — CHỈ dùng để biết catalog còn khớp để
 * khôi phục nháp hay không. KHÔNG hash tồn kho/giá vốn/giá bán: các giá trị này đổi liên tục lúc
 * cửa hàng đang hoạt động (mỗi đơn bán ở bất kỳ tab nào cũng đổi tồn kho 1 sản phẩm nào đó) —
 * nếu hash theo giá/tồn, chỉ cần lệch 1 sản phẩm bất kỳ là fingerprint đổi, khôi phục bị từ chối
 * oan. `rehydrateSellOrdersFromSnapshot` (App.jsx) vốn đã tự tra lại giá/tồn MỚI NHẤT cho từng
 * dòng lúc khôi phục nên không cần fingerprint theo dõi giá/tồn.
 * @param {Array<{ groupVariants?: unknown[], code?: string, unitLabel?: string }>} products
 * @param {string} fileName
 */
export function buildPosDraftFingerprint(products, fileName) {
  if (!products?.length) return ''
  const parts = []
  for (const p of products) {
    const vars = p.groupVariants || [p]
    for (const v of vars) {
      const convRaw = v.conversionValue ?? v.conversion ?? ''
      parts.push(
        `${String(v.code ?? '').trim()}\t${String(v.unitLabel ?? '').trim()}\t${String(convRaw).trim()}`
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

export function sellOrdersHaveAnyCartLines(sellOrders) {
  if (!Array.isArray(sellOrders)) return false
  return sellOrders.some((o) => Array.isArray(o?.cart) && o.cart.length > 0)
}

export function loadTabDraft(tabId) {
  try {
    const raw = localStorage.getItem(draftKeyForTab(tabId))
    if (!raw) return null
    const j = JSON.parse(raw)
    if (!j || j.v !== POS_SESSION_DRAFT_VERSION || typeof j.fingerprint !== 'string') return null
    if (!Array.isArray(j.sellOrders)) return null
    return j
  } catch {
    return null
  }
}

export function clearTabDraft(tabId) {
  try {
    localStorage.removeItem(draftKeyForTab(tabId))
  } catch {
    /* ignore */
  }
}

function saveTabDraftRaw(tabId, payload) {
  try {
    localStorage.setItem(draftKeyForTab(tabId), JSON.stringify(payload))
  } catch (e) {
    console.warn('posSessionDraft: không lưu được LocalStorage', e)
  }
}

/** Ghi hoặc xóa nháp của tab này ngay (không debounce). */
export function syncTabDraftNow(tabId, { products, fileName, sellOrders, activeSellOrderId }) {
  if (!products?.length || !sellOrdersHaveAnyCartLines(sellOrders)) {
    clearTabDraft(tabId)
    return
  }
  saveTabDraftRaw(tabId, {
    v: POS_SESSION_DRAFT_VERSION,
    fingerprint: buildPosDraftFingerprint(products, fileName),
    fileName: fileName || '',
    sellOrders,
    activeSellOrderId,
    savedAt: new Date().toISOString(),
    heartbeatAt: Date.now(),
  })
}

/** Cập nhật mốc "còn sống" — gọi định kỳ trong lúc tab còn mở, không đổi nội dung đơn hàng. */
export function touchTabDraftHeartbeat(tabId) {
  try {
    const key = draftKeyForTab(tabId)
    const raw = localStorage.getItem(key)
    if (!raw) return
    const j = JSON.parse(raw)
    if (!j || typeof j !== 'object') return
    j.heartbeatAt = Date.now()
    localStorage.setItem(key, JSON.stringify(j))
  } catch {
    /* ignore */
  }
}

/**
 * Tìm nháp của MỘT TAB KHÁC đã ngưng báo sống (thực sự đã đóng) để tab hiện tại (vừa mở, chưa
 * có nháp riêng) nhận lại — chống mất điện/crash. Bỏ qua nháp của tab vẫn còn đang mở (heartbeat
 * còn mới) để không bao giờ đụng vào dữ liệu tab khác đang hoạt động song song.
 * @returns {object | null} nội dung nháp nhận được (đã xóa khỏi ô cũ), hoặc null nếu không có.
 */
export function claimAbandonedTabDraft(myTabId) {
  try {
    const now = Date.now()
    const myKey = draftKeyForTab(myTabId)
    let best = null
    const staleKeys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(POS_SESSION_DRAFT_PREFIX) || key === myKey) continue
      let j = null
      try {
        j = JSON.parse(localStorage.getItem(key))
      } catch {
        staleKeys.push(key)
        continue
      }
      if (!j || typeof j !== 'object' || !Array.isArray(j.sellOrders)) {
        staleKeys.push(key)
        continue
      }
      const heartbeatAt = Number(j.heartbeatAt) || 0
      const age = now - heartbeatAt
      if (age > POS_DRAFT_GC_MAX_AGE_MS || !sellOrdersHaveAnyCartLines(j.sellOrders)) {
        staleKeys.push(key) // rác quá cũ hoặc rỗng — dọn luôn, không dùng để khôi phục.
        continue
      }
      if (age < POS_DRAFT_HEARTBEAT_STALE_MS) continue // tab đó vẫn đang mở — không đụng vào.
      const savedAtMs = Date.parse(String(j.savedAt ?? '')) || 0
      if (!best || savedAtMs > best.savedAtMs) {
        best = { key, data: j, savedAtMs }
      }
    }
    for (const k of staleKeys) clearRawKey(k)
    if (best) {
      clearRawKey(best.key)
      return best.data
    }
    return null
  } catch {
    return null
  }
}

function clearRawKey(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
