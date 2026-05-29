import { normalizeBarcodeValue } from './catalogCsv.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import {
  buildCatalogVariantsFromUnitModal,
  parseMoneyDigitsVi,
  parsePositiveConversion,
  sortUnitModalLinesByConversion,
} from './goodsUnitSetupModalLogic.js'

export function newGoodsCreateBatchRowId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `gcb-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Khóa lỗi mã vạch: rowId hoặc rowId:unitId cho ĐVT phụ. */
export function batchBarcodeFieldKey(rowId, unitId = null) {
  return unitId ? `${rowId}:${unitId}` : String(rowId)
}

export function newGoodsCreateBatchExtraUnit() {
  return {
    unitId: newGoodsCreateBatchRowId(),
    unitLabel: '',
    conversion: '',
    price: '',
    cost: '',
    barcode: '',
    code: '',
  }
}

/** Một dòng nhập độc lập — `donViTinh` = đơn vị quy đổi bổ sung. */
export function newGoodsCreateBatchRow() {
  return {
    rowId: newGoodsCreateBatchRowId(),
    name: '',
    code: '',
    barcode: '',
    brand: '',
    unitLabel: 'Cái',
    price: '',
    wholesale: '',
    cost: '',
    stock: '0',
    donViTinh: [],
    extraUnitsOpen: false,
  }
}

/** Reset trắng form batch (gọi khi mở/đóng/lưu xong). */
export function initialGoodsCreateBatchRows() {
  return [newGoodsCreateBatchRow()]
}

export function patchGoodsCreateBatchRow(rows, index, field, value) {
  if (!Array.isArray(rows) || index < 0 || index >= rows.length) return rows
  return rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
}

export function patchGoodsCreateBatchExtraUnit(rows, rowIndex, unitIndex, field, value) {
  if (!Array.isArray(rows) || rowIndex < 0 || rowIndex >= rows.length) return rows
  return rows.map((row, i) => {
    if (i !== rowIndex) return row
    const units = Array.isArray(row.donViTinh) ? [...row.donViTinh] : []
    if (unitIndex < 0 || unitIndex >= units.length) return row
    units[unitIndex] = { ...units[unitIndex], [field]: value }
    return { ...row, donViTinh: units }
  })
}

export function addGoodsCreateBatchExtraUnit(rows, rowIndex) {
  if (!Array.isArray(rows) || rowIndex < 0 || rowIndex >= rows.length) return rows
  return rows.map((row, i) =>
    i === rowIndex
      ? {
          ...row,
          extraUnitsOpen: true,
          donViTinh: [...(row.donViTinh || []), newGoodsCreateBatchExtraUnit()],
        }
      : row
  )
}

export function removeGoodsCreateBatchExtraUnit(rows, rowIndex, unitIndex) {
  if (!Array.isArray(rows) || rowIndex < 0 || rowIndex >= rows.length) return rows
  return rows.map((row, i) => {
    if (i !== rowIndex) return row
    const units = (row.donViTinh || []).filter((_, j) => j !== unitIndex)
    return { ...row, donViTinh: units, extraUnitsOpen: units.length > 0 ? row.extraUnitsOpen : false }
  })
}

function catalogBarcodeSet(catalogList) {
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  return new Set(
    flat.map((v) => String(normalizeBarcodeValue(v.barcode ?? '')).trim()).filter(Boolean)
  )
}

/** Thu thập mọi mã vạch trong form batch (ô chính + ĐVT phụ). */
function collectBatchBarcodeEntries(batchRows) {
  const entries = []
  for (const r of batchRows || []) {
    const main = String(normalizeBarcodeValue(r.barcode ?? '')).trim()
    if (main) entries.push({ norm: main, rowId: r.rowId, unitId: null })
    for (const u of r.donViTinh || []) {
      const n = String(normalizeBarcodeValue(u.barcode ?? '')).trim()
      if (n) entries.push({ norm: n, rowId: r.rowId, unitId: u.unitId })
    }
  }
  return entries
}

/**
 * Kiểm tra một ô mã vạch (real-time).
 * @returns {{ ok: true, message: '' } | { ok: false, message: string }}
 */
export function inspectGoodsCreateBatchBarcode({
  barcode,
  rowId,
  unitId = null,
  batchRows,
  catalogList,
}) {
  const norm = String(normalizeBarcodeValue(barcode ?? '')).trim()
  if (!norm) return { ok: true, message: '' }

  const existing = catalogBarcodeSet(catalogList)
  if (existing.has(norm)) {
    return { ok: false, message: 'Mã đã tồn tại' }
  }

  const fieldKey = batchBarcodeFieldKey(rowId, unitId)
  let dupCount = 0
  for (const e of collectBatchBarcodeEntries(batchRows)) {
    if (e.norm !== norm) continue
    const k = batchBarcodeFieldKey(e.rowId, e.unitId)
    if (k === fieldKey) dupCount += 1
    else dupCount += 1
  }
  if (dupCount > 1) {
    return { ok: false, message: 'Mã bị trùng trong form' }
  }

  return { ok: true, message: '' }
}

/**
 * Đồng bộ toàn bộ lỗi mã vạch — dùng sau mỗi lần sửa/xóa ô (tránh khóa cứng nút Lưu).
 * @returns {Record<string, string>}
 */
export function syncGoodsCreateBatchBarcodeErrors(batchRows, catalogList) {
  const errors = {}
  const entries = collectBatchBarcodeEntries(batchRows)
  const existing = catalogBarcodeSet(catalogList)
  const seen = new Map()

  for (const e of entries) {
    const key = batchBarcodeFieldKey(e.rowId, e.unitId)
    if (seen.has(e.norm)) {
      errors[key] = 'Mã bị trùng trong form'
      errors[seen.get(e.norm)] = 'Mã bị trùng trong form'
    } else {
      seen.set(e.norm, key)
    }
    if (existing.has(e.norm)) {
      errors[key] = 'Mã đã tồn tại'
    }
  }
  return errors
}

/**
 * @returns {{ ok: true } | { ok: false, message: string, errors: Record<string, string> }}
 */
export function validateGoodsCreateBatchBarcodes(batchRows, catalogList) {
  const errors = syncGoodsCreateBatchBarcodeErrors(batchRows, catalogList)
  if (Object.keys(errors).length === 0) return { ok: true }
  const entries = collectBatchBarcodeEntries(batchRows)

  const firstNorm = entries.find((e) => errors[batchBarcodeFieldKey(e.rowId, e.unitId)])?.norm || ''
  const display = firstNorm.length > 16 ? `${firstNorm.slice(0, 16)}…` : firstNorm
  return {
    ok: false,
    message: display
      ? `Mã vạch ${display} đã tồn tại trong hệ thống hoặc bị nhập trùng.`
      : 'Có mã vạch bị trùng trong form hoặc đã tồn tại.',
    errors,
  }
}

function ensureUniqueVariantCodes(variants, codeSetExisting) {
  const out = []
  for (const v of variants) {
    let code = String(v.code ?? '').trim()
    const codeLc = code.toLowerCase()
    if (
      !code ||
      codeSetExisting.has(codeLc) ||
      out.some((x) => String(x.code).toLowerCase() === codeLc)
    ) {
      code = ''
    } else {
      codeSetExisting.add(codeLc)
    }
    out.push({ ...v, code })
  }
  return out
}

function batchRowToUnitLines(row) {
  const base = {
    key: row.rowId,
    variantId: '',
    unitLabel: normalizeCatalogUnitLabel(row.unitLabel) || 'Cái',
    conversion: '1',
    code: String(row.code ?? '').trim(),
    barcode: String(row.barcode ?? '').trim(),
    cost: String(row.cost ?? ''),
    price: String(row.price ?? ''),
  }
  const extras = (row.donViTinh || [])
    .filter((u) => String(u.unitLabel ?? '').trim())
    .map((u) => ({
      key: u.unitId,
      variantId: '',
      unitLabel: String(u.unitLabel ?? '').trim(),
      conversion: String(u.conversion ?? '').trim() || '1',
      code: String(u.code ?? '').trim(),
      barcode: String(u.barcode ?? '').trim(),
      cost: String(u.cost ?? ''),
      price: String(u.price ?? ''),
    }))
  return sortUnitModalLinesByConversion([base, ...extras])
}

function rowHasExtraUnits(row) {
  return (row.donViTinh || []).some((u) => String(u.unitLabel ?? '').trim())
}

/**
 * @param {Array<object>} batchRows
 * @param {Array<object>} catalogList
 */
export function buildCatalogVariantsFromGoodsCreateBatchRows(batchRows, catalogList) {
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const codeSetExisting = new Set(
    flat.map((v) => String(v.code ?? '').trim().toLowerCase()).filter(Boolean)
  )
  const barcodeSetExisting = new Set(
    flat.map((v) => String(normalizeBarcodeValue(v.barcode ?? ''))).filter(Boolean)
  )

  const out = []

  for (const r of batchRows || []) {
    const nameTrim = String(r.name ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!nameTrim) continue

    const brandTrim = String(r.brand ?? '').trim()

    if (rowHasExtraUnits(r)) {
      const linesSorted = batchRowToUnitLines(r)
      let rootCode = String(linesSorted[0]?.code ?? '').trim()
      if (!rootCode || codeSetExisting.has(rootCode.toLowerCase())) {
        rootCode = ''
      } else {
        codeSetExisting.add(rootCode.toLowerCase())
      }

      const templateVariant = {
        stockQty: Math.max(0, parseMoneyDigitsVi(r.stock)),
        wholesalePrice: parseMoneyDigitsVi(r.wholesale),
        brand: brandTrim,
        supplier: '',
        weightRaw: '',
      }

      const groupVariants = buildCatalogVariantsFromUnitModal({
        templateVariant,
        linesSorted,
        nameTrim,
      })

      for (const v of groupVariants) {
        let barcode = String(normalizeBarcodeValue(v.barcode ?? '')).trim()
        if (
          barcode &&
          (barcodeSetExisting.has(barcode) ||
            out.some((x) => normalizeBarcodeValue(x.barcode) === barcode))
        ) {
          barcode = ''
        }
        if (barcode) barcodeSetExisting.add(barcode)
        v.barcode = barcode
        v.brand = brandTrim
        v.name = nameTrim
        v.nameRaw = nameTrim
        if (v.conversion != null) {
          const conv = parsePositiveConversion(v.conversion) ?? 1
          v.conversion = conv
          v.conversionValue = conv
        }
      }

      const unique = ensureUniqueVariantCodes(groupVariants, codeSetExisting)
      out.push(...unique)
      continue
    }

    let code = String(r.code ?? '').trim()
    const codeLc = code.toLowerCase()
    if (
      !code ||
      codeSetExisting.has(codeLc) ||
      out.some((x) => String(x.code).toLowerCase() === codeLc)
    ) {
      code = ''
    } else {
      codeSetExisting.add(codeLc)
    }

    let barcode = String(normalizeBarcodeValue(r.barcode ?? '')).trim()
    if (
      barcode &&
      (barcodeSetExisting.has(barcode) || out.some((x) => normalizeBarcodeValue(x.barcode) === barcode))
    ) {
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
      brand: brandTrim,
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
  }

  return out
}
