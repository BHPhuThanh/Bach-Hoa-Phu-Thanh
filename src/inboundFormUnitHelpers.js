/**
 * Quy đổi ĐVT phiếu nhập — tách khỏi AdminHub để tab Doanh thu / hub không phụ thuộc module này khi tải.
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
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    const hit = vars.find((x) => x.id === variantId)
    if (hit) {
      return { product: p, variants: sortVariantsSmallestUnitFirst(vars), clicked: hit }
    }
  }
  return null
}

/**
 * Variant đơn vị cơ bản (conversion nhỏ nhất trong nhóm) — mặc định khi thêm dòng phiếu nhập.
 * @param {object} product — dòng danh mục (có groupVariants)
 * @param {object} clickedVariant — variant user chọn / gợi ý
 */
export function pickInboundBaseVariant(product, clickedVariant) {
  const gv = product?.groupVariants
  if (Array.isArray(gv) && gv.length > 0) {
    return sortVariantsSmallestUnitFirst(gv)[0] || clickedVariant
  }
  return clickedVariant
}

/** Chỉ các ĐVT thực sự có trong danh mục (KiotViet) cho mặt hàng của dòng — không gợi ý Gói/Hộp giả. */
export function buildInboundDvtSelectOptions(catalogList, line) {
  const cur = normalizeCatalogUnitLabel(line.unitLabel)
  const ctx = findVariantContext(catalogList, line.variantId)
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
 * Đổi ĐVT dòng phiếu nhập (chỉ ảnh hưởng phiếu nhập, không dùng cho Doanh thu).
 */
export function applyInboundLineUnitChange(catalogList, line, newLabelRaw) {
  const want = normalizeCatalogUnitLabel(newLabelRaw)
  const cur = normalizeCatalogUnitLabel(line.unitLabel)
  if (want === cur) return { ok: true, changed: false }

  const ctx = findVariantContext(catalogList, line.variantId)
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
