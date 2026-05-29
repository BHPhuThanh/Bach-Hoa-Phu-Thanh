import { normalizeBarcodeValue } from './catalogCsv.js'
import { allocateAutoHhSkuIfEmpty } from './autoProductSku.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

export function newGoodsCreateBatchRowId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `gcb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Một dòng nhập độc lập trong form «Tạo nhiều sản phẩm». */
export function newGoodsCreateBatchRow() {
  return {
    rowId: newGoodsCreateBatchRowId(),
    name: '',
    code: '',
    barcode: '',
    unitLabel: 'Cái',
    price: '',
    wholesale: '',
    cost: '',
    stock: '0',
    brand: '',
  }
}

/**
 * Cập nhật một field trên đúng index (immutable).
 * @param {Array<object>} rows
 * @param {number} index
 * @param {string} field
 * @param {unknown} value
 */
export function patchGoodsCreateBatchRow(rows, index, field, value) {
  if (!Array.isArray(rows) || index < 0 || index >= rows.length) return rows
  return rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
}

function parseMoneyDigitsVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Mỗi phần tử batch → một biến thể catalog riêng (tên/mã/giá không dùng chung).
 * @param {Array<object>} batchRows
 * @param {Array<object>} catalogList — display catalog hiện có
 */
export function buildCatalogVariantsFromGoodsCreateBatchRows(batchRows, catalogList) {
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const codeSetExisting = new Set(
    flat.map((v) => String(v.code ?? '').trim().toLowerCase()).filter(Boolean)
  )
  const barcodeSetExisting = new Set(
    flat.map((v) => String(normalizeBarcodeValue(v.barcode ?? ''))).filter(Boolean)
  )

  const syntheticCatalog = Array.isArray(catalogList) ? [...catalogList] : []
  const out = []

  for (const r of batchRows || []) {
    const nameTrim = String(r.name ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!nameTrim) continue

    let code = String(r.code ?? '').trim()
    if (!code) {
      code = allocateAutoHhSkuIfEmpty(syntheticCatalog, '')
    }
    const codeLc = code.toLowerCase()
    let guard = 0
    while ((codeSetExisting.has(codeLc) || out.some((x) => String(x.code).toLowerCase() === codeLc)) && guard < 100000) {
      code = allocateAutoHhSkuIfEmpty(syntheticCatalog, '')
      guard += 1
    }
    codeSetExisting.add(code.toLowerCase())

    let barcode = String(normalizeBarcodeValue(r.barcode ?? '')).trim()
    if (barcode && (barcodeSetExisting.has(barcode) || out.some((x) => normalizeBarcodeValue(x.barcode) === barcode))) {
      barcode = ''
    }
    if (barcode) barcodeSetExisting.add(barcode)

    const variant = {
      id: newGoodsCreateBatchRowId(),
      code,
      barcode,
      name: nameTrim,
      nameRaw: nameTrim,
      price: parseMoneyDigitsVi(r.price),
      wholesalePrice: parseMoneyDigitsVi(r.wholesale),
      cost: parseMoneyDigitsVi(r.cost),
      stockQty: Math.max(0, parseMoneyDigitsVi(r.stock)),
      supplier: '',
      brand: String(r.brand ?? '').trim(),
      linkedMasterCode: '',
      baseGroupCode: '',
      unitLabel: normalizeCatalogUnitLabel(r.unitLabel) || 'Cái',
      conversion: 1,
      conversionValue: 1,
      weightRaw: '',
      stockNormMin: null,
      stockNormMax: null,
      createdAtMs: Date.now(),
      raw: [],
    }

    out.push(variant)
    syntheticCatalog.push({ groupVariants: [variant] })
  }

  return out
}
