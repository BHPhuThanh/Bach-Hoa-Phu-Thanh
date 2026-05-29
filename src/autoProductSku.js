import { normalizeBarcodeValue } from './catalogCsv.js'

/** Mã SKU dạng HH + số (4 chữ số tối thiểu, ví dụ HH0001). */
export function parseHhNumericSku(code) {
  const m = String(code ?? '').trim().match(/^HH(\d+)$/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

export function formatHhSkuFromSequence(n) {
  const x = Math.max(1, Math.floor(Number(n)) || 1)
  const s = String(x)
  return `HH${s.length <= 4 ? s.padStart(4, '0') : s}`
}

/**
 * Gợi ý mã tiếp theo HH0001… — mã khớp toàn chuỗi ^HH\\d+$.
 */
export function suggestNextProductCodeFromCatalog(products) {
  let max = 0
  for (const p of products || []) {
    for (const v of p.groupVariants || [p]) {
      const seq = parseHhNumericSku(v.code)
      if (seq != null) max = Math.max(max, seq)
    }
  }
  return formatHhSkuFromSequence(max + 1)
}

/** Ô SKU trống: mã HH kế tiếp, tăng cho tới khi không trùng code trong danh mục. */
export function allocateAutoHhSkuIfEmpty(products, userCodeTrimmed) {
  const trimmed = String(userCodeTrimmed ?? '').trim()
  if (trimmed) return trimmed
  const flat = (Array.isArray(products) ? products : []).flatMap((p) => p.groupVariants || [p])
  const codeSet = new Set(
    flat.map((v) => String(v.code ?? '').trim().toLowerCase()).filter(Boolean)
  )
  return allocateNextHhSkuInCodeSet(codeSet, products)
}

/**
 * Cấp mã HH tiếp theo chưa có trong `codeSet` (lowercase), tăng tuần tự HH0460 → HH0461…
 * Sau khi cấp, thêm mã vào `codeSet`.
 * @param {Set<string>} codeSet — mã đã dùng (chữ thường)
 * @param {Array<object>} [catalogProducts] — catalog để tính max HH ban đầu
 */
export function allocateNextHhSkuInCodeSet(codeSet, catalogProducts = []) {
  let code = suggestNextProductCodeFromCatalog(catalogProducts)
  let guard = 0
  while (codeSet.has(code.toLowerCase()) && guard < 100000) {
    const n = parseHhNumericSku(code)
    code = formatHhSkuFromSequence((n != null ? n : 0) + 1)
    guard += 1
  }
  codeSet.add(code.toLowerCase())
  return code
}

/**
 * Gán mã HH duy nhất cho từng dòng mới (trong batch + so với catalog hiện có).
 * @param {Array<object>} existingProducts — display catalog
 * @param {Array<object>} newFlatRows — biến thể phẳng sắp tạo
 */
export function ensureUniqueMaHangAndBarcodeForNewRows(existingProducts, newFlatRows) {
  if (!Array.isArray(newFlatRows) || newFlatRows.length === 0) return []
  const synthetic = Array.isArray(existingProducts) ? [...existingProducts] : []
  const codeSet = new Set(
    synthetic
      .flatMap((p) => p.groupVariants || [p])
      .map((v) => String(v.code ?? '').trim().toLowerCase())
      .filter(Boolean)
  )
  const barcodeSet = new Set(
    synthetic
      .flatMap((p) => p.groupVariants || [p])
      .map((v) => String(normalizeBarcodeValue(v.barcode ?? '')).trim())
      .filter(Boolean)
  )
  const out = []
  for (const row of newFlatRows) {
    let code = String(row.code ?? '').trim()
    if (!code || codeSet.has(code.toLowerCase())) {
      code = allocateNextHhSkuInCodeSet(codeSet, synthetic)
    } else {
      let guard = 0
      while (codeSet.has(code.toLowerCase()) && guard < 100000) {
        const n = parseHhNumericSku(code)
        code = formatHhSkuFromSequence((n != null ? n : 0) + 1)
        guard += 1
      }
      codeSet.add(code.toLowerCase())
    }

    let barcode = String(normalizeBarcodeValue(row.barcode ?? '')).trim()
    if (barcode && barcodeSet.has(barcode)) barcode = ''
    if (barcode) barcodeSet.add(barcode)

    const normalized = { ...row, code, barcode }
    out.push(normalized)
    synthetic.push({ groupVariants: [normalized] })
  }
  return out
}
