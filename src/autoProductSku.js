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
  let code = suggestNextProductCodeFromCatalog(products)
  let guard = 0
  while (codeSet.has(code.toLowerCase()) && guard < 100000) {
    const n = parseHhNumericSku(code)
    code = formatHhSkuFromSequence((n != null ? n : 0) + 1)
    guard += 1
  }
  return code
}
