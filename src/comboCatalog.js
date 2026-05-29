/**
 * Sản phẩm Combo — BOM (thành phần) + trừ tồn khi bán.
 *
 * Hàng thường: `ton_kho` trong DB/catalog là **một số chuẩn duy nhất** (đơn vị cơ bản, thường trùng
 * `ton_kho` của dòng `quy_doi === 1`). Mọi ĐVT anh em được gán **cùng** giá trị sau khi trừ;
 * không trừ riêng trên từng dòng (tránh lệch Thùng/Bịch). Frontend vẫn chia `quy_doi` khi hiển thị.
 */
import { findVariantContext } from './inboundFormUnitHelpers.js'
import { prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import { buildDisplayCatalog, catalogQuyDoiFactorToBase } from './productUnits.js'

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

/**
 * `tong_xuat` khi bán: `so_luong_ban * Number(quy_doi)` — chỉ cột `quy_doi` (CSV / Supabase),
 * không dùng conversionValue/conversion để tránh lệch với tồn chuẩn.
 * @param {object} v — biến thể catalog
 */
export function variantQuyDoiNumber(v) {
  if (!v) return 1
  const qdRaw = Number(v.raw?.quy_doi ?? v.quy_doi ?? v.quyDoi)
  return Number.isFinite(qdRaw) && qdRaw > 0 ? qdRaw : 1
}

/**
 * `ton_kho` hiện tại của **sản phẩm gốc**: dòng có `ma_hang` (`code`) === `ma_goc`.
 * @param {string} maGoc — đã trim
 * @returns {number | null} — null nếu không tìm thấy dòng hoặc tồn không hợp lệ
 */
export function findRootStockTonKhoForMaGoc(products, maGoc) {
  const k = String(maGoc ?? '').trim()
  if (!k) return null
  for (const p of products || []) {
    for (const v of p.groupVariants || [p]) {
      if (String(v.code ?? '').trim() !== k) continue
      const sq = v.stockQty
      if (sq != null && Number.isFinite(Number(sq))) return Number(sq)
    }
  }
  return null
}

/**
 * Biến thể mang «tồn chuẩn»: ưu tiên `quy_doi === 1`, sau đó dòng có `code === ma_goc`,
 * cuối cùng `quy_doi` nhỏ nhất (đơn vị nhỏ nhất).
 * @param {string[]} siblingIds — `collectSiblingVariantIds`
 */
export function findCanonicalStockRootVariant(products, siblingIds) {
  const variants = []
  for (const id of siblingIds || []) {
    const hit = findCatalogVariantInProducts(products, id)
    if (hit?.variant) variants.push(hit.variant)
  }
  if (variants.length === 0) return null
  const q1 = variants.find((v) => Math.abs(variantQuyDoiNumber(v) - 1) < 1e-9)
  if (q1) return q1
  const maGoc = resolveMaGocFromVariant(variants[0])
  const master = variants.find((v) => String(v.code ?? '').trim() === maGoc)
  if (master) return master
  return [...variants].sort((a, b) => variantQuyDoiNumber(a) - variantQuyDoiNumber(b))[0]
}

export function isComboCatalogProduct(p) {
  if (!p) return false
  if (p.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) return true
  if (p.isCombo === true) return true
  const gv = p.groupVariants
  if (Array.isArray(gv) && gv[0]?.catalogProductType === CATALOG_PRODUCT_TYPE_COMBO) return true
  if (Array.isArray(gv) && gv[0]?.isCombo === true) return true
  return false
}

/** Tab «Thành phần combo» — combo đánh dấu hoặc đã có BOM. */
export function shouldShowComboBomTab(p) {
  if (!p) return false
  if (isComboCatalogProduct(p)) return true
  return getComboBom(p).length > 0
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
 * Combo: cộng dồn trừ tồn đơn vị cơ sở theo BOM (theo `variant.id` thành phần).
 * @param {Map<string, number>} deltaBaseByVid
 */
export function mergeComboCartLineIntoDeltaMap(products, line, deltaBaseByVid) {
  const p = findProductContainingVariantId(products, line.variantId)
  const cartQty = Number(line.qty)
  if (!Number.isFinite(cartQty) || cartQty <= 0) return
  if (!p || !isComboCatalogProduct(p)) return
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
}

/** Hàng không combo: `ma_goc` → tổng `tong_xuat` (SL × quy_doi) cần trừ khỏi tồn chuẩn. */
export function buildNonComboDeductionByMaGoc(products, cartLines) {
  /** @type {Map<string, number>} */
  const deductByMaGoc = new Map()
  for (const l of cartLines || []) {
    const p = findProductContainingVariantId(products, l.variantId)
    if (p && isComboCatalogProduct(p)) continue
    const hit = findCatalogVariantInProducts(products, l.variantId)
    if (!hit) continue
    const v = hit.variant
    const ma_goc = resolveMaGocFromVariant(v)
    if (!ma_goc) continue
    const cartQty = Number(l.qty)
    if (!Number.isFinite(cartQty) || cartQty <= 0) continue
    const tong_xuat = cartQty * variantQuyDoiNumber(v)
    deductByMaGoc.set(ma_goc, (deductByMaGoc.get(ma_goc) || 0) + tong_xuat)
  }
  return deductByMaGoc
}

export function buildComboCartSaleDeltaByVariantId(products, cartLines) {
  const deltaBaseByVid = new Map()
  for (const l of cartLines || []) {
    mergeComboCartLineIntoDeltaMap(products, l, deltaBaseByVid)
  }
  return deltaBaseByVid
}

/** Toàn bộ `variant.id` cần đồng bộ `ton_kho` lên Supabase sau bán (nhóm ĐVT + thành phần combo). */
export function collectCartSaleTouchedVariantIds(products, cartLines) {
  const deductByMaGoc = buildNonComboDeductionByMaGoc(products, cartLines)
  const touched = new Set()
  for (const ma of deductByMaGoc.keys()) {
    for (const id of collectSiblingVariantIds(products, ma)) {
      touched.add(String(id))
    }
  }
  const comboDelta = buildComboCartSaleDeltaByVariantId(products, cartLines)
  for (const id of comboDelta.keys()) {
    touched.add(String(id))
  }
  return touched
}

/**
 * @deprecated Dùng `buildNonComboDeductionByMaGoc` + `buildComboCartSaleDeltaByVariantId` hoặc `collectCartSaleTouchedVariantIds`.
 * Giữ tạm: chỉ gộp **delta combo** theo biến thể (hàng thường không còn dùng map này).
 */
export function buildCartSaleStockDeltaByVariantId(products, cartLines) {
  return buildComboCartSaleDeltaByVariantId(products, cartLines)
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

/**
 * Hoàn tồn khi xóa đơn POS — đối xứng `applySoldQtyToCatalog` (App.jsx): cộng lại theo `ma_goc` / combo BOM.
 * @param {{
 *   precomputedDeductByMaGoc?: Map<string, number>
 *   precomputedComboDelta?: Map<string, number>
 * }} [options]
 */
export function applyRestoredQtyToCatalog(products, cartLines, options) {
  if (!products?.length || !cartLines?.length) return products
  const deductByMaGoc =
    options?.precomputedDeductByMaGoc ?? buildNonComboDeductionByMaGoc(products, cartLines)
  const comboDelta =
    options?.precomputedComboDelta ?? buildComboCartSaleDeltaByVariantId(products, cartLines)

  if (deductByMaGoc.size === 0 && comboDelta.size === 0) return products

  /** @type {Map<string, number>} */
  const canonicalTonKhoByVid = new Map()
  for (const [ma_goc, D] of deductByMaGoc) {
    const sids = collectSiblingVariantIds(products, ma_goc)
    if (sids.length === 0) continue
    let cur = findRootStockTonKhoForMaGoc(products, ma_goc)
    if (cur == null || !Number.isFinite(cur)) {
      const root = findCanonicalStockRootVariant(products, sids)
      if (!root) continue
      cur =
        root.stockQty != null && Number.isFinite(Number(root.stockQty)) ? Number(root.stockQty) : 0
    }
    const ton_kho_moi_chuan = cur + D
    for (const sid of sids) {
      canonicalTonKhoByVid.set(String(sid), ton_kho_moi_chuan)
    }
  }

  const flat = []
  for (const p of products) {
    for (const v of p.groupVariants || [p]) {
      const vid = String(v.id)
      let nextStock = v.stockQty
      if (canonicalTonKhoByVid.has(vid)) {
        nextStock = canonicalTonKhoByVid.get(vid)
      } else {
        const restore = comboDelta.get(v.id) ?? comboDelta.get(vid) ?? 0
        if (restore > 0) {
          const cur = nextStock != null && Number.isFinite(Number(nextStock)) ? Number(nextStock) : 0
          nextStock = cur + restore
        }
      }
      flat.push({ ...v, stockQty: nextStock })
    }
  }
  return prepareCatalogForPosSearch(buildDisplayCatalog(flat))
}
