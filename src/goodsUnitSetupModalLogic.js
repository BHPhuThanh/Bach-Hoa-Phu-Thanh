import { normalizeCatalogUnitLabel } from './productUnits.js'

function fmtMoneyVi(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function parseMoneyDigitsVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

export function parsePositiveConversion(raw) {
  const n = parseFloat(String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function newUnitModalRowKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `um-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** @param {Array<{ conversion?: number|null, id?: string }>} variants */
export function sortVariantsSmallestUnitFirst(variants) {
  return [...(variants || [])].sort((a, b) => {
    const ca =
      a.conversion != null && Number.isFinite(Number(a.conversion)) && Number(a.conversion) > 0
        ? Number(a.conversion)
        : 1
    const cb =
      b.conversion != null && Number.isFinite(Number(b.conversion)) && Number(b.conversion) > 0
        ? Number(b.conversion)
        : 1
    if (ca !== cb) return ca - cb
    return String(a.id || '').localeCompare(String(b.id || ''), 'vi')
  })
}

/**
 * @param {Array<object>} variants — biến thể một nhóm (ctx.variants)
 */
export function createUnitModalLinesFromVariants(variants) {
  const sorted = sortVariantsSmallestUnitFirst(variants)
  return sorted.map((v) => ({
    key: String(v.id || newUnitModalRowKey()),
    variantId: String(v.id || ''),
    unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
    conversion:
      v.conversion != null && Number.isFinite(Number(v.conversion)) && Number(v.conversion) > 0
        ? String(Number(v.conversion))
        : '1',
    code: String(v.code ?? '').trim(),
    barcode: String(v.barcode ?? '').trim(),
    cost: fmtMoneyVi(Number(v.cost) || 0),
    price: fmtMoneyVi(Number(v.price) || 0),
    costManual: false,
    priceManual: false,
  }))
}

export function sortUnitModalLinesByConversion(lines) {
  return [...(lines || [])].sort((a, b) => {
    const ca = parsePositiveConversion(a.conversion) ?? 1
    const cb = parsePositiveConversion(b.conversion) ?? 1
    if (ca !== cb) return ca - cb
    return String(a.key).localeCompare(String(b.key), 'vi')
  })
}

/**
 * Khi đổi giá vốn / giá bán ở dòng cơ bản (conversion nhỏ nhất): nhân theo tỷ lệ quy đổi cho các dòng chưa chỉnh tay.
 * @param {Array<{ key: string, conversion: string, cost: string, price: string, costManual?: boolean, priceManual?: boolean }>} linesSorted
 */
export function propagateBaseUnitMoney(linesSorted, baseCost, basePrice) {
  const baseConv = parsePositiveConversion(linesSorted[0]?.conversion) ?? 1
  return linesSorted.map((row, idx) => {
    if (idx === 0) {
      return {
        ...row,
        cost: fmtMoneyVi(baseCost),
        price: fmtMoneyVi(basePrice),
        costManual: false,
        priceManual: false,
      }
    }
    const cj = parsePositiveConversion(row.conversion) ?? 1
    const ratio = baseConv > 0 ? cj / baseConv : 1
    const nextCost =
      row.costManual === true ? row.cost : fmtMoneyVi(Math.round(baseCost * ratio))
    const nextPrice =
      row.priceManual === true ? row.price : fmtMoneyVi(Math.round(basePrice * ratio))
    return { ...row, cost: nextCost, price: nextPrice }
  })
}

function newCatalogVariantId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * @param {object} opts
 * @param {object} opts.templateVariant — biến thể mẫu (đơn vị nhỏ nhất) để copy các trường chung
 * @param {Array<object>} opts.linesSorted — đã sort theo conversion
 * @param {string} opts.nameTrim
 * @param {Map<string, object>} [opts.prevByVariantId]
 */
export function buildCatalogVariantsFromUnitModal({
  templateVariant,
  linesSorted,
  nameTrim,
  prevByVariantId,
}) {
  const rootFallback = String(templateVariant?.code ?? '').trim()
  const finalCodes = assignFinalProductCodes(linesSorted, rootFallback)

  const out = []
  for (let i = 0; i < linesSorted.length; i++) {
    const row = linesSorted[i]
    const conv = parsePositiveConversion(row.conversion) ?? 1
    const code = finalCodes[i]

    const vid = String(row.variantId || '').trim()
    const id = vid || newCatalogVariantId()
    const cost = parseMoneyDigitsVi(row.cost)
    const price = parseMoneyDigitsVi(row.price)
    const prev = vid && prevByVariantId?.get(vid) ? prevByVariantId.get(vid) : null
    const rootCode = String(finalCodes[0] ?? '').trim()

    if (prev) {
      out.push({
        ...prev,
        id,
        code,
        barcode: String(row.barcode ?? '').trim(),
        name: nameTrim,
        nameRaw: nameTrim,
        unitLabel: normalizeCatalogUnitLabel(row.unitLabel),
        conversion: conv,
        conversionValue: conv,
        cost,
        price,
        linkedMasterCode: String(prev.linkedMasterCode ?? '').trim(),
        persistMaHang: String(prev.code ?? '').trim(),
      })
      continue
    }

    out.push({
      id,
      code,
      barcode: String(row.barcode ?? '').trim(),
      name: nameTrim,
      nameRaw: nameTrim,
      unitLabel: normalizeCatalogUnitLabel(row.unitLabel),
      conversion: conv,
      conversionValue: conv,
      cost,
      price,
      wholesalePrice: Number(templateVariant?.wholesalePrice) || 0,
      stockQty: i === 0 ? templateVariant?.stockQty : 0,
      supplier: String(templateVariant?.supplier ?? '').trim(),
      brand: String(templateVariant?.brand ?? '').trim(),
      linkedMasterCode: i === 0 ? '' : rootCode,
      baseGroupCode: '',
      stockNormMin: null,
      stockNormMax: null,
      weightRaw: String(templateVariant?.weightRaw ?? '').trim(),
      createdAtMs: Date.now(),
      raw: [],
    })
  }
  return out
}

export function assignFinalProductCodes(linesSorted, rootFallback) {
  const root =
    String(linesSorted[0]?.code ?? '').trim() ||
    String(rootFallback ?? '').trim() ||
    'SP'
  return linesSorted.map((row, i) => {
    let c = String(row.code ?? '').trim()
    // Quy tắc mới: không tự thêm hậu tố -1/-2 cho ĐVT phụ.
    // - Dòng gốc (i===0) luôn có mã (root nếu trống).
    // - Dòng phụ: giữ mã người dùng nhập; để trống thì tạo mới sẽ auto-assign HH tăng dần.
    if (!c) c = i === 0 ? root : ''
    return c
  })
}

export function validateUnitModalLines(linesSorted, rootFallback) {
  if (!linesSorted.length) return 'Cần ít nhất một đơn vị tính.'
  const labels = new Set()
  for (const row of linesSorted) {
    const u = String(row.unitLabel ?? '').trim()
    if (!u) return 'Vui lòng nhập tên đơn vị cho mỗi dòng.'
    const k = normalizeCatalogUnitLabel(u).toLowerCase()
    if (labels.has(k)) return 'Trùng tên đơn vị tính.'
    labels.add(k)
    if (parsePositiveConversion(row.conversion) == null) return 'Giá trị quy đổi phải là số dương.'
  }
  const codes = assignFinalProductCodes(linesSorted, rootFallback)
  const nonEmpty = codes.map((c) => String(c ?? '').trim()).filter(Boolean)
  const set = new Set(nonEmpty.map((c) => c.toLowerCase()))
  if (set.size !== nonEmpty.length) return 'Mã hàng sau quy đổi không được trùng nhau.'
  return ''
}
