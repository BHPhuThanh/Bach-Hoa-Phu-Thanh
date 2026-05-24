/**
 * Quy đổi ĐƠN VỊ TÍNH phiếu nhập — tách khỏi AdminHub để tab Doanh thu / hub không phụ thuộc module này khi tải.
 */
import { normalizeCatalogUnitLabel } from './productUnits.js'

function sortVariantsSmallestUnitFirst(variants) {
  return [...(variants || [])].sort((a, b) => {
    const ca =
      a.conversion != null && Number.isFinite(a.conversion) && a.conversion > 0 ? a.conversion : 1
    const cb =
      b.conversion != null && Number.isFinite(b.conversion) && b.conversion > 0 ? b.conversion : 1
    if (ca !== cb) return ca - cb
    return String(a.code).localeCompare(String(b.code), 'vi')
  })
}

export function findVariantContext(products, variantId) {
  const vid = String(variantId ?? '').trim()
  if (!vid) return null
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    const hit = vars.find((x) => String(x.id) === vid)
    if (hit) {
      return { product: p, variants: sortVariantsSmallestUnitFirst(vars), clicked: hit }
    }
  }
  return null
}

/** Khớp dòng phiếu / snapshot chọn nhanh với danh mục phiếu nhập (id có thể lệch sau đồng bộ). */
export function findVariantContextForInboundLine(catalogList, line) {
  const vid = String(line?.variantId ?? '').trim()
  if (vid) {
    const byId = findVariantContext(catalogList, vid)
    if (byId) return byId
  }
  const code = String(line?.code ?? line?.ma_hang ?? '').trim().toLowerCase()
  if (!code) return null
  const unit = normalizeCatalogUnitLabel(line?.unitLabel)
  for (const p of catalogList || []) {
    const vars = Array.isArray(p.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
    const matches = vars.filter((v) => String(v?.code ?? '').trim().toLowerCase() === code)
    if (!matches.length) continue
    const clicked =
      unit != null && unit !== ''
        ? matches.find((v) => normalizeCatalogUnitLabel(v.unitLabel) === unit) || matches[0]
        : matches[0]
    return { product: p, variants: sortVariantsSmallestUnitFirst(vars), clicked }
  }
  return null
}

/** Map product/variant từ modal Chọn nhanh sang biến thể trong `catalogListForInbound`. */
export function resolveInboundCatalogProductVariant(catalogList, product, variant) {
  const vid = String(variant?.id ?? '').trim()
  const code = String(variant?.code ?? product?.code ?? '').trim().toLowerCase()
  const unit = normalizeCatalogUnitLabel(variant?.unitLabel)
  if (vid) {
    const ctx = findVariantContext(catalogList, vid)
    if (ctx) {
      const hit =
        unit != null && unit !== ''
          ? ctx.variants.find((v) => normalizeCatalogUnitLabel(v.unitLabel) === unit) || ctx.clicked
          : ctx.clicked
      return { product: ctx.product, variant: hit }
    }
  }
  if (code) {
    for (const p of catalogList || []) {
      const vars = Array.isArray(p.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
      const matches = vars.filter((v) => String(v?.code ?? '').trim().toLowerCase() === code)
      if (!matches.length) continue
      const hit =
        unit != null && unit !== ''
          ? matches.find((v) => normalizeCatalogUnitLabel(v.unitLabel) === unit) || matches[0]
          : matches[0]
      return { product: p, variant: hit }
    }
  }
  return { product, variant: variant || product }
}

/** Chỉ các ĐƠN VỊ TÍNH thực sự có trong danh mục (KiotViet) cho mặt hàng của dòng — không gợi ý Gói/Hộp giả. */
export function buildInboundDvtSelectOptions(catalogList, line) {
  const cur = normalizeCatalogUnitLabel(line.unitLabel)
  const ctx = findVariantContextForInboundLine(catalogList, line)
  if (!ctx?.variants?.length) {
    return cur ? [cur] : []
  }
  const seen = new Set()
  const out = []
  for (const v of ctx.variants) {
    const u = normalizeCatalogUnitLabel(v.unitLabel)
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  if (cur && !seen.has(cur)) {
    out.push(cur)
  }
  return out
}

/**
 * Đổi ĐƠN VỊ TÍNH dòng phiếu nhập (chỉ ảnh hưởng phiếu nhập, không dùng cho Doanh thu).
 */
export function applyInboundLineUnitChange(catalogList, line, newLabelRaw) {
  const want = normalizeCatalogUnitLabel(newLabelRaw)
  const cur = normalizeCatalogUnitLabel(line.unitLabel)
  if (want === cur) return { ok: true, changed: false }

  const ctx = findVariantContextForInboundLine(catalogList, line)
  if (!ctx) {
    return {
      ok: true,
      changed: true,
      line: { ...line, unitLabel: want },
    }
  }
  const vNew = ctx.variants.find((v) => normalizeCatalogUnitLabel(v.unitLabel) === want)
  if (!vNew) {
    return { ok: false, changed: false }
  }
  const vCur = ctx.clicked
  const convCur =
    vCur.conversion != null && Number.isFinite(Number(vCur.conversion)) && Number(vCur.conversion) > 0
      ? Number(vCur.conversion)
      : 1
  const convNew =
    vNew.conversion != null && Number.isFinite(Number(vNew.conversion)) && Number(vNew.conversion) > 0
      ? Number(vNew.conversion)
      : 1
  const qty = Math.max(0, Number(line.qty) || 0)
  const basePieces = qty * convCur
  const rawQty = convNew > 0 ? basePieces / convNew : qty
  const newQty = Number.isFinite(rawQty) ? rawQty : qty
  const unitPrice = Math.round(
    Number(vNew.cost) > 0 ? Number(vNew.cost) : Number(vNew.price) || 0
  )
  return {
    ok: true,
    changed: true,
    line: {
      ...line,
      variantId: String(vNew.id),
      code: String(vNew.code || line.code || '').trim(),
      unitLabel: normalizeCatalogUnitLabel(vNew.unitLabel),
      qty: newQty,
      unitPrice,
    },
  }
}
