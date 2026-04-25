/** Hash (legacy): ah_open_product — dùng khi chưa có route /hang-hoa */
const AH_OPEN_PRODUCT = 'ah_open_product'

/** SPA slug: `/hang-hoa/:id` hoặc `/hang-hoa?id=` — mở tab Hàng hóa + mở rộng dòng (mã hàng hoặc variant id). */
export const HANG_HOA_SLUG = 'hang-hoa'

/** `true` nếu pathname có phân đoạn `hang-hoa` — tuyệt đối không nhầm với Doanh thu hay `/`. */
export function pathnameHasHangHoaDeepLink(pathname) {
  const segs = String(pathname || '')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
  return segs.includes(HANG_HOA_SLUG)
}

/**
 * Trang shell `/doanh-thu` (báo cáo độc lập). Luôn `false` nếu URL chứa `hang-hoa`.
 * Không coi `/` (POS) là Doanh thu.
 */
export function isDoanhThuPath() {
  if (typeof window === 'undefined') return false
  const pathname = window.location.pathname
  if (pathnameHasHangHoaDeepLink(pathname)) return false
  const segs = String(pathname || '')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
  return segs.includes('doanh-thu')
}

/** Query keys: mở Admin Hub (tab trình duyệt mới) thẳng vào chi tiết chứng từ. */
export const AHDL_POS = 'ah_pos_order'
export const AHDL_INBOUND = 'ah_inbound_order'
export const AHDL_POS_RETURN = 'ah_pos_return'

/** Query thân thiện (kèm ah_*): ?tab=donhang&id=… | nhaphang | trahang */
const HUB_TAB_Q = 'tab'
const HUB_ID_Q = 'id'

const ORDER_PATH_SLUGS = /** @type {const} */ (['don-hang', 'nhap-hang', 'tra-hang'])

/** SPA: mở hub ở danh sách đơn / màn đổi trả (không kèm id chứng từ). */
const HUB_OPEN_SLUGS = /** @type {const} */ (['danh-sach-don-hang', 'doi-tra-hang'])

function pathnameLastSeg(pathname) {
  const p = String(pathname || '').replace(/\/$/, '')
  return p.split('/').pop()?.toLowerCase() || ''
}

function pathnameOrderSlug(pathname) {
  const seg = pathnameLastSeg(pathname)
  return ORDER_PATH_SLUGS.includes(seg) ? seg : null
}

function pathnameHubOpenSlug(pathname) {
  const seg = pathnameLastSeg(pathname)
  return HUB_OPEN_SLUGS.includes(seg) ? seg : null
}

function pathnameAdminOrdersPath(pathname) {
  const p = String(pathname || '').replace(/\/$/, '')
  return /\/admin\/orders$/.test(p)
}

/** @returns {string | null} id đơn POS */
function pathnameAdminReturnOrderId(pathname) {
  const p = String(pathname || '').replace(/\/$/, '')
  const m = p.match(/\/admin\/return-order\/([^/]+)$/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

function pathnameStripToHubAppRoot(pathname) {
  return Boolean(
    pathnameOrderSlug(pathname) ||
      pathnameHubOpenSlug(pathname) ||
      pathnameAdminOrdersPath(pathname) ||
      pathnameAdminReturnOrderId(pathname)
  )
}

function hubAppBasePathname() {
  const b = import.meta.env.BASE_URL || '/'
  const n = b.endsWith('/') ? b : `${b}/`
  return n === '//' ? '/' : n
}

/**
 * URL mở tab mới: /don-hang?id=… | /nhap-hang?id=… | /tra-hang?id=… (cộng BASE_URL).
 * @param {{ type: 'pos', posOrderId?: string } | { type: 'inbound', inboundOrderId?: string } | { type: 'pos_return', returnLedgerId?: string } | null | undefined} link
 */
export function buildOrderDocPageHref(link) {
  if (typeof window === 'undefined' || !link) return ''
  const id =
    link.type === 'pos'
      ? String(link.posOrderId || '').trim()
      : link.type === 'inbound'
        ? String(link.inboundOrderId || '').trim()
        : String(link.returnLedgerId || '').trim()
  if (!id) return ''
  const slug =
    link.type === 'pos' ? 'don-hang' : link.type === 'inbound' ? 'nhap-hang' : link.type === 'pos_return' ? 'tra-hang' : ''
  if (!slug) return ''
  try {
    const origin = window.location.origin
    const base = hubAppBasePathname()
    return `${origin}${base}${slug}?id=${encodeURIComponent(id)}`
  } catch {
    return ''
  }
}

export function parseAdminHubDeepLinkFromWindow() {
  if (typeof window === 'undefined') return null
  const u = new URL(window.location.href)
  const adminRetId = pathnameAdminReturnOrderId(u.pathname)
  if (adminRetId) {
    return { posOrderId: adminRetId, inboundOrderId: null, posReturnLedgerId: null }
  }
  if (pathnameAdminOrdersPath(u.pathname)) {
    return { posOrderId: null, inboundOrderId: null, posReturnLedgerId: null, hubOpen: 'orders' }
  }

  const hubOpenSlug = pathnameHubOpenSlug(u.pathname)
  if (hubOpenSlug === 'danh-sach-don-hang') {
    return { posOrderId: null, inboundOrderId: null, posReturnLedgerId: null, hubOpen: 'orders' }
  }
  if (hubOpenSlug === 'doi-tra-hang') {
    return { posOrderId: null, inboundOrderId: null, posReturnLedgerId: null, hubOpen: 'returns' }
  }

  const slug = pathnameOrderSlug(u.pathname)
  if (slug === 'don-hang') {
    const id = u.searchParams.get('id')?.trim()
    if (id) return { posOrderId: id, inboundOrderId: null, posReturnLedgerId: null }
  }
  if (slug === 'nhap-hang') {
    const id = u.searchParams.get('id')?.trim()
    if (id) return { posOrderId: null, inboundOrderId: id, posReturnLedgerId: null }
  }
  if (slug === 'tra-hang') {
    const id = u.searchParams.get('id')?.trim()
    if (id) return { posOrderId: null, inboundOrderId: null, posReturnLedgerId: id }
  }

  const sp = new URLSearchParams(window.location.search)
  const pos = sp.get(AHDL_POS)?.trim() || null
  const inbound = sp.get(AHDL_INBOUND)?.trim() || null
  const posRet = sp.get(AHDL_POS_RETURN)?.trim() || null
  if (pos || inbound || posRet) {
    return { posOrderId: pos, inboundOrderId: inbound, posReturnLedgerId: posRet }
  }
  const tab = sp.get(HUB_TAB_Q)?.trim().toLowerCase() || null
  const id = sp.get(HUB_ID_Q)?.trim() || null
  if (!tab || !id) return null
  if (tab === 'donhang') return { posOrderId: id, inboundOrderId: null, posReturnLedgerId: null }
  if (tab === 'nhaphang') return { posOrderId: null, inboundOrderId: id, posReturnLedgerId: null }
  if (tab === 'trahang') return { posOrderId: null, inboundOrderId: null, posReturnLedgerId: id }
  return null
}

export function stripAdminHubDeepLinkParamsFromWindow() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  let changed = false
  if (pathnameStripToHubAppRoot(u.pathname)) {
    u.pathname = hubAppBasePathname()
    u.search = ''
    changed = true
  }
  for (const k of [AHDL_POS, AHDL_INBOUND, AHDL_POS_RETURN, HUB_TAB_Q, HUB_ID_Q]) {
    if (u.searchParams.has(k)) {
      u.searchParams.delete(k)
      changed = true
    }
  }
  if (!changed) return
  const qs = u.searchParams.toString()
  window.history.replaceState({}, '', `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`)
}

/**
 * @param {{ type: 'pos', posOrderId?: string } | { type: 'inbound', inboundOrderId?: string } | { type: 'pos_return', returnLedgerId?: string } | null | undefined} link
 */
export function buildAdminHubOrderDetailHref(link) {
  return buildOrderDocPageHref(link) || '#'
}

/**
 * Đọc `/hang-hoa/:productId` hoặc `/hang-hoa?id=…` — id có thể là mã hàng (SP001) hoặc id biến thể.
 * @param {string} [pathname] — mặc định `window.location.pathname`
 * @param {string} [search] — mặc định `window.location.search`
 * @returns {{ rawId: string } | null}
 */
export function parseHangHoaGoodsOpenFromLocation(pathname, search) {
  if (pathname === undefined) {
    if (typeof window === 'undefined') return null
    return parseHangHoaGoodsOpenFromParts(window.location.pathname, window.location.search)
  }
  return parseHangHoaGoodsOpenFromParts(pathname, search)
}

/** @param {string} pathname @param {string} [search] */
function parseHangHoaGoodsOpenFromParts(pathname, search) {
  const segs = String(pathname || '')
    .split('/')
    .filter(Boolean)
  let hi = -1
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].toLowerCase() === HANG_HOA_SLUG) hi = i
  }
  if (hi >= 0 && segs[hi + 1]) {
    const rawId = decodeURIComponent(segs[hi + 1]).trim()
    if (rawId) return { rawId }
  }
  if (pathnameLastSeg(pathname) === HANG_HOA_SLUG) {
    const q = new URLSearchParams(String(search || '').replace(/^\?/, ''))
    const rawId = q.get('id')?.trim()
    if (rawId) return { rawId }
  }
  return null
}

/** Xóa slug hang-hoa khỏi thanh địa chỉ sau khi đã đọc (giữ app tại BASE_URL). */
export function stripHangHoaGoodsDeepLinkFromWindow() {
  if (typeof window === 'undefined') return
  if (!parseHangHoaGoodsOpenFromLocation()) return
  const u = new URL(window.location.href)
  u.pathname = hubAppBasePathname()
  u.search = ''
  window.history.replaceState({}, '', `${u.pathname}${u.search}`)
}

/**
 * URL tuyệt đối mở tab mới: `/hang-hoa/<mã hàng hoặc variantId>` (path segment, hỗ trợ deep link SPA).
 * @param {string} variantId
 * @param {string} [productCode] — ưu tiên đưa vào URL nếu an toàn (chữ số, gạch…)
 */
export function buildOpenHangHoaGoodsAbsUrl(variantId, productCode) {
  const vid = String(variantId ?? '').trim()
  if (typeof window === 'undefined' || !vid) return ''
  const code = String(productCode ?? '').trim()
  const segment =
    code && /^[A-Za-z0-9._-]+$/.test(code) ? encodeURIComponent(code) : encodeURIComponent(vid)
  try {
    const origin = window.location.origin
    const base = hubAppBasePathname()
    return `${origin}${base}${HANG_HOA_SLUG}/${segment}`
  } catch {
    return ''
  }
}

/** @deprecated Dùng buildOpenHangHoaGoodsAbsUrl — alias để không đổi mọi import */
export function buildOpenAdminHubProductAbsUrl(variantId, productCode) {
  return buildOpenHangHoaGoodsAbsUrl(variantId, productCode)
}

/** @returns {string | null} */
export function parseAhOpenProductVariantIdFromLocation() {
  if (typeof window === 'undefined') return null
  const h = String(window.location.hash || '').replace(/^#/, '')
  if (!h.startsWith(`${AH_OPEN_PRODUCT}=`)) return null
  try {
    return decodeURIComponent(h.slice(AH_OPEN_PRODUCT.length + 1)).trim() || null
  } catch {
    return null
  }
}

export function stripAhOpenProductHashFromLocation() {
  if (typeof window === 'undefined') return
  if (!parseAhOpenProductVariantIdFromLocation()) return
  const u = new URL(window.location.href)
  u.hash = ''
  window.history.replaceState({}, '', `${u.pathname}${u.search}`)
}
