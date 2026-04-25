/**
 * Tổng hợp số lượng đã bán theo mã hàng (code) từ lịch sử đơn IndexedDB.
 * @param {Array<{ items?: { code?: string, qty?: number }[] }>} orders
 * @returns {Record<string, number>}
 */
export function aggregateCodeQtyFromOrders(orders) {
  const o = {}
  for (const ord of orders || []) {
    for (const it of ord.items || []) {
      const c = String(it.code ?? '').trim()
      if (!c) continue
      const q = Number(it.qty) || 0
      o[c] = (o[c] || 0) + q
    }
  }
  return o
}

/**
 * Điểm bán chạy của một mặt hàng catalog (cộng dồn mọi biến thể ĐVT).
 */
export function scoreCatalogProduct(p, codeQty) {
  const variants = p.groupVariants || [p]
  let s = 0
  for (const v of variants) {
    const c = String(v.code ?? '').trim()
    s += codeQty[c] || 0
  }
  return s
}

/**
 * Sắp xếp: bán chạy trước, sau đó tên.
 */
export function sortProductsBySales(products, codeQty) {
  return [...products].sort((a, b) => {
    const sa = scoreCatalogProduct(a, codeQty)
    const sb = scoreCatalogProduct(b, codeQty)
    if (sb !== sa) return sb - sa
    return String(a.name || '').localeCompare(String(b.name || ''), 'vi')
  })
}

/**
 * Id catalog (dòng đại diện nhóm) được coi là "bán chạy": top theo điểm, có dữ liệu bán.
 */
export function getHotCatalogIds(products, codeQty) {
  const scored = products.map((p) => ({ id: p.id, score: scoreCatalogProduct(p, codeQty) }))
  const positives = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  const hot = new Set()
  if (positives.length === 0) return hot
  const k = Math.min(15, Math.max(4, Math.ceil(positives.length * 0.1)))
  for (let i = 0; i < k && i < positives.length; i++) {
    hot.add(positives[i].id)
  }
  return hot
}
