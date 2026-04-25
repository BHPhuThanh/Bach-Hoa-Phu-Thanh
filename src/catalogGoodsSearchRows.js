/**
 * Flatten catalog → dòng giống tab Hàng hóa Admin (filter: filterAndSortGoodsRowsSimple).
 * Thêm _product / _variant cho modal Chọn nhanh (điều chỉnh giá vốn).
 */

import { normalizeBarcodeValue } from './catalogCsv.js'
import {
  buildVariantPosSearchHaystack,
  normalizeCatalogSearchCompactKey,
  normalizeCatalogUnitLabel,
} from './productUnits.js'

export function flattenCatalogToGoodsSearchRows(products) {
  const rows = []
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    for (const v of vars) {
      const id = v.id
      const code = String(v.code || '').trim()
      const name = String(v.name || '').trim() || '—'
      const brand = String(v.brand || '').trim()
      const price = Number(v.price) || 0
      const cost = Number(v.cost) || 0
      let stock = null
      if (v.stockQty != null && Number.isFinite(Number(v.stockQty))) {
        stock = Number(v.stockQty)
      }
      const createdAtMs = Number(v.createdAtMs)
      const okTime = Number.isFinite(createdAtMs) && createdAtMs > 0
      const displayTime = okTime ? new Date(createdAtMs).toLocaleString('vi-VN') : '—'
      const unitLabel = normalizeCatalogUnitLabel(v.unitLabel)
      const barcode = String(normalizeBarcodeValue(v.barcode ?? '')).trim()
      const bcCompact = barcode ? normalizeCatalogSearchCompactKey(barcode) : ''
      const baseHay = buildVariantPosSearchHaystack(
        code,
        v.nameRaw || p.nameRaw,
        v.name || p.name,
        unitLabel,
        v.linkedMasterCode ?? p.linkedMasterCode
      )
      /** Gộp mã vạch (compact) vào haystack — khớp quét máy như luồng POS. */
      const nameSearch = bcCompact ? `${baseHay}${bcCompact}` : baseHay
      rows.push({
        id,
        code,
        name,
        nameSearch,
        unitLabel,
        barcode,
        brand,
        price,
        cost,
        stock,
        createdAtMs: okTime ? createdAtMs : 0,
        displayTime,
        _product: p,
        _variant: v,
      })
    }
  }
  rows.sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
    return String(a.code).localeCompare(String(b.code), 'vi')
  })
  return rows
}
