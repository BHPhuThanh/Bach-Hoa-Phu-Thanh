/**
 * Sản phẩm Combo — BOM (thành phần) + trừ tồn theo từng mặt hàng lẻ khi bán.
 *
 * Hàng thường (không combo): xuất kho theo ĐVT cơ bản = SL × Number(quy_doi); trừ đồng bộ
 * cùng một lượng đó vào mọi biến thể «anh em» (cùng ma_goc: ma_hh_lien_quan nếu có, không thì ma_hang).
 */
import { findVariantContext } from './inboundFormUnitHelpers.js'
import { catalogQuyDoiFactorToBase } from './productUnits.js'

export const CATALOG_PRODUCT_TYPE_COMBO = 'combo'

export function findProductContainingVariantId(products, variantId) {
  const vid = String(variantId ?? '').trim()
  if (!vid) return null
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    if (vars.some((v) => String(v.id) === vid)) return p
  }
  return null
}

/** `{ product, variant }` theo `variantId` — không import App.jsx. */
export function findCatalogVariantInProducts(products, variantId) {
  const vid = String(variantId ?? '').trim()
  if (!vid) return null
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    for (const v of vars) {
      if (String(v.id) === vid) return { product: p, variant: v }
    }
  }
  return null
}

/**
 * Mã gốc nhóm ĐVT: có «ma_hh_lien_quan» → ma_goc đó; không → `ma_hang` (field `code`).
 * @param {object} v — biến thể catalog
 */
export function resolveMaGocFromVariant(v) {
  if (!v) return ''
  const lq = String(v.linkedMasterCode ?? '').trim()
  if (lq) return lq
  return String(v.code ?? '').trim()
}

/**
 * Mọi biến thể có `code === ma_goc` **hoặc** `linkedMasterCode === ma_goc` (đồng bộ tồn chéo).
 * @param {string} maGoc — đã chuẩn hóa trim
 * @returns {string[]} — danh sách `variant.id` (không trùng)
 */
export function collectSiblingVariantIds(products, maGoc) {
  const k = String(maGoc ?? '').trim()
  if (!k) return []
  const seen = new Set()
  const out = []
  for (const p of products || []) {
    for (const v of p.groupVariants || [p]) {
      const code = String(v.code ?? '').trim()
      const lq = String(v.linkedMasterCode ?? '').trim()
      if (code !== k && lq !== k) continue
      const id = String(v.id ?? '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

export function isComboCatalogProduct(p) {
  if (!p) return false
  if (p.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) return true
  const gv = p.groupVariants
  if (Array.isArray(gv) && gv[0]?.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) return true
  return false
}

export function getComboBom(p) {
  if (!p) return []
  const raw = p.comboBom ?? p.groupVariants?.[0]?.comboBom
  return Array.isArray(raw) ? raw : []
}

export function getComboCostOverride(p) {
  const v = p?.comboCostOverride ?? p?.groupVariants?.[0]?.comboCostOverride
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Giống basePiecesSoldForCartLine trong App — không phụ thuộc App.jsx. */
export function basePiecesSoldForVariantQty(products, variantId, qty) {
  const q = Number(qty)
  if (!Number.isFinite(q) || q <= 0) {
    return { baseVariantId: String(variantId ?? ''), basePieces: 0 }
  }
  const ctx = findVariantContext(products, variantId)
  if (!ctx?.variants?.length) {
    return { baseVariantId: String(variantId ?? ''), basePieces: 0 }
  }
  const sorted = ctx.variants
  const base = sorted[0]
  const v =
    sorted.find((x) => String(x.id) === String(variantId)) || ctx.clicked || sorted[0]
  if (!v || !base) return { baseVariantId: String(variantId ?? ''), basePieces: 0 }
  const cv = catalogQuyDoiFactorToBase(v)
  const cb = catalogQuyDoiFactorToBase(base)
  if (!Number.isFinite(cv) || !Number.isFinite(cb) || cb <= 0) {
    return { baseVariantId: String(base.id), basePieces: q }
  }
  return { baseVariantId: String(base.id), basePieces: q * (cv / cb) }
}

/**
 * Cộng dồn trừ tồn đơn vị cơ sở cho một dòng giỏ (combo → nhiều thành phần; thường → một biến thể).
 * @param {Map<string, number>} deltaBaseByVid
 */
export function mergeCartLineStockIntoDeltaMap(products, line, deltaBaseByVid) {
  const p = findProductContainingVariantId(products, line.variantId)
  const cartQty = Number(line.qty)
  if (!Number.isFinite(cartQty) || cartQty <= 0) return

  if (p && isComboCatalogProduct(p)) {
    const bom = getComboBom(p)
    for (const row of bom) {
      const compVid = String(row.variantId ?? '').trim()
      const perCombo = Number(row.qty)
      if (!compVid || !Number.isFinite(perCombo) || perCombo <= 0) continue
      const { baseVariantId, basePieces } = basePiecesSoldForVariantQty(
        products,
        compVid,
        perCombo * cartQty
      )
      if (!baseVariantId || basePieces <= 0) continue
      deltaBaseByVid.set(baseVariantId, (deltaBaseByVid.get(baseVariantId) || 0) + basePieces)
    }
    return
  }

  const hit = findCatalogVariantInProducts(products, line.variantId)
  if (!hit) return
  const v = hit.variant
  const ma_goc = resolveMaGocFromVariant(v)
  if (!ma_goc) return

  const qdRaw = Number(v.raw?.quy_doi ?? v.quy_doi ?? v.quyDoi)
  const quy_doi = Number.isFinite(qdRaw) && qdRaw > 0 ? qdRaw : 1
  const tong_xuat = cartQty * quy_doi

  const siblingIds = collectSiblingVariantIds(products, ma_goc)
  for (const sid of siblingIds) {
    deltaBaseByVid.set(sid, (deltaBaseByVid.get(sid) || 0) + tong_xuat)
  }
}

/** Gộp delta xuất kho (đơn vị cơ bản) theo `variant.id` — dùng chung POS và snapshot Supabase. */
export function buildCartSaleStockDeltaByVariantId(products, cartLines) {
  const deltaBaseByVid = new Map()
  for (const l of cartLines || []) {
    mergeCartLineStockIntoDeltaMap(products, l, deltaBaseByVid)
  }
  return deltaBaseByVid
}

/** Tổng giá vốn mặc định = Σ (giá vốn thành phần × số lượng trong combo) theo đơn vị đang chọn. */
export function computeDefaultComboCost(products, bom) {
  let sum = 0
  for (const row of bom || []) {
    const q = Number(row.qty)
    if (!Number.isFinite(q) || q <= 0) continue
    const ctx = findVariantContext(products, row.variantId)
    const v = ctx?.clicked
    const cost = Number(v?.cost) || 0
    sum += cost * q
  }
  return Math.round(sum)
}

/** Số combo có thể bán (ước lượng theo tồn đơn vị cơ sở từng thành phần). */
export function salableComboPackCount(products, bom) {
  if (!Array.isArray(bom) || bom.length === 0) return 0
  let cap = Infinity
  for (const row of bom) {
    const per = Number(row.qty)
    if (!Number.isFinite(per) || per <= 0) {
      cap = 0
      break
    }
    const { baseVariantId, basePieces } = basePiecesSoldForVariantQty(products, row.variantId, per)
    if (!baseVariantId || basePieces <= 0) {
      cap = 0
      break
    }
    const ctx = findVariantContext(products, baseVariantId)
    const base = ctx?.variants?.[0]
    const stock = base?.stockQty
    if (stock == null || !Number.isFinite(Number(stock))) {
      cap = 0
      break
    }
    const avail = Math.floor(Number(stock) / basePieces + 1e-9)
    cap = Math.min(cap, avail)
  }
  if (!Number.isFinite(cap) || cap === Infinity) return 0
  return Math.max(0, cap)
}
