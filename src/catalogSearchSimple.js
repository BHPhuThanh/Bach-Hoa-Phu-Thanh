/**
 * Tìm kiếm POS / Hàng hóa: `clean` + AND từ khóa trong tên; thêm khớp substring Mã hàng (cột A / code); ưu tiên khớp SKU khi sắp xếp.
 * Gợi ý POS: quét theo bán chạy (bộ nhớ) + giới hạn số dòng. Nhánh mã vạch/QR số dài (EAN…) giữ khớp 100% cột mã vạch.
 */

import { normalizeBarcodeValue } from './catalogCsv.js'
import { refreshCatalogSearchTexts, stripVietnameseAccentsManual } from './productUnits.js'
import { scoreCatalogProduct, sortProductsBySales } from './sellFrequency.js'

/** Số sản phẩm tối đa thu thập khi quét theo bán chạy (buffer trước khi sort lại). */
export const POS_SUGGEST_SCAN_CAP = 120

/** Số dòng gợi ý tối đa trong dropdown POS. */
export const POS_SUGGEST_ROW_CAP = 15

/** Giống tên hàm user gọi: chỉ bỏ dấu TV, giữ khoảng trắng. */
function stripVietnameseAccents(s) {
  return stripVietnameseAccentsManual(s)
}

/** Chuẩn hóa cực mạnh: Trà C2, 455ml → tra c2 455ml */
function clean(str) {
  return stripVietnameseAccents(str).toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
}

/** Log thống nhất để xác nhận logic V9 trên toàn app (grep: SYSTEM-WIDE-SEARCH-V9). */
export function logSystemWideSearchV9(surface, payload) {
  console.log('[SYSTEM-WIDE-SEARCH-V9]', surface, payload)
}

/** Khớp chuỗi nhập với Mã hàng (cột A / code) — từng biến thể hoặc mã nhóm. */
function catalogEntitySkuClean(entity, fallbackCode = '') {
  return clean(String(entity?.code ?? entity?.id ?? fallbackCode ?? ''))
}

function productMatchesSkuSearchInput(product, searchInput) {
  if (!searchInput) return false
  const vars = product.groupVariants
  if (Array.isArray(vars) && vars.length > 0) {
    for (const v of vars) {
      const skuToSearch = catalogEntitySkuClean(v, product.code ?? product.id ?? '')
      if (skuToSearch.includes(searchInput)) return true
    }
    return false
  }
  return catalogEntitySkuClean(product).includes(searchInput)
}

/**
 * @returns {{ searchInput: string, keywords: string[] }}
 */
export function getCatalogSearchQueryParts(raw) {
  const searchInput = clean(String(raw ?? '').trim())
  const keywords = searchInput.split(' ').filter((k) => k)
  return { searchInput, keywords }
}

/**
 * Khớp tên biến thể (AND từ khóa) hoặc khớp Mã hàng/SKU (chuỗi đã `clean` chứa trong mã).
 * @param {string} [searchInput] — từ `getCatalogSearchQueryParts`; mặc định nối từ khóa (tương thích gọi cũ).
 */
export function variantDisplayMatchesPosKeywords(v, p, keywords, searchInput) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false
  const si = typeof searchInput === 'string' && searchInput.length > 0 ? searchInput : keywords.join(' ')
  const productName = clean(String(v?.nameRaw || v?.name || p?.nameRaw || p?.name || ''))
  const isNameMatch = keywords.every((word) => productName.includes(word))
  const skuToSearch = catalogEntitySkuClean(v, p?.code ?? p?.id ?? '')
  const isSkuMatch = Boolean(si) && skuToSearch.includes(si)
  return isNameMatch || isSkuMatch
}

function stripLegacyCatalogKeys(p) {
  const {
    searchText,
    catalogNameNorm,
    catalogNameRawNorm,
    nameFixed,
    codesFixed,
    nameSearch,
    catalogVariantHaystackNorm,
    catalogSoloVariantHaystackNorm,
    groupVariants,
    ...rest
  } = p
  const next = { ...rest }
  if (Array.isArray(groupVariants)) {
    next.groupVariants = groupVariants.map((v) => {
      const { catalogVariantHaystackNorm: _h, ...vv } = v
      return vv
    })
  }
  return next
}

/** Chuẩn bị catalog: xóa cache cũ + gắn nameSearch một lần. */
export function prepareCatalogForPosSearch(products) {
  if (!Array.isArray(products) || products.length === 0) return []
  const stripped = products.map(stripLegacyCatalogKeys)
  return refreshCatalogSearchTexts(stripped)
}

export function forceRebuildSearchCache(products) {
  return prepareCatalogForPosSearch(products)
}

/** Chuỗi tra cứu dạng một khối (bỏ mọi khoảng sau `clean`) — tương thích mã gọi cũ. */
export function normalizeSearchKeyword(raw) {
  const { searchInput } = getCatalogSearchQueryParts(raw)
  return searchInput.replace(/\s+/g, '')
}

/** Giống ô POS: sau chuẩn hóa mã chỉ còn ký tự mã (dùng cho nhánh quét mã vạch). */
export function posQueryLooksLikeBarcodeKeyInput(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return false
  const n = String(normalizeBarcodeValue(t))
  if (n.length < 1) return false
  return /^[\dA-Za-z._-]+$/.test(n)
}

/**
 * Chuỗi số dài kiểu EAN/UPC — chỉ được tra cột mã vạch, không dùng tên / mã hàng.
 * (EAN-8 trở lên; sau chuẩn hóa chỉ còn chữ số.)
 */
export function strictLongNumericBarcodeQuery(raw) {
  const n = String(normalizeBarcodeValue(raw))
  if (n.length < 8) return false
  return /^\d+$/.test(n)
}

/**
 * Bộ nhớ quét: mảng đã sắp bán chạy, mỗi phần tử có `hay` = nameSearch (chuẩn hóa một lần khi nạp catalog).
 * @param {Array<object>} products
 * @param {Record<string, number>} codeQty
 * @returns {Array<{ hay: string, product: object }>}
 */
export function buildPosTextSearchScanList(products, codeQty = {}) {
  if (!Array.isArray(products) || products.length === 0) return []
  const sorted = sortProductsBySales(products, codeQty)
  return sorted.map((product) => ({
    hay: String(product.nameSearch ?? ''),
    product,
  }))
}

/**
 * Quét theo thứ tự bán chạy, dừng sớm — O(k) với k = POS_SUGGEST_SCAN_CAP tối đa.
 */
export function scanPosTextMatches(scanList, rawQuery, maxProducts = POS_SUGGEST_SCAN_CAP) {
  const { searchInput, keywords } = getCatalogSearchQueryParts(rawQuery)
  if (!searchInput || keywords.length === 0 || !Array.isArray(scanList) || maxProducts < 1) return []
  const out = []
  for (let scanIdx = 0; scanIdx < scanList.length; scanIdx++) {
    const row = scanList[scanIdx]
    const p = row.product
    const productName = clean(String(p.nameRaw || p.name || ''))
    const isNameMatch = keywords.every((word) => productName.includes(word))
    const isSkuMatch = productMatchesSkuSearchInput(p, searchInput)
    const isMatch = isNameMatch || isSkuMatch
    if (isMatch) {
      out.push({ product: p, isSkuMatch, scanIdx })
      if (out.length >= maxProducts) break
    }
  }
  out.sort((a, b) => {
    if (a.isSkuMatch !== b.isSkuMatch) return (b.isSkuMatch ? 1 : 0) - (a.isSkuMatch ? 1 : 0)
    return a.scanIdx - b.scanIdx
  })
  const products = out.map((x) => x.product)
  const skuHits = out.filter((x) => x.isSkuMatch).length
  logSystemWideSearchV9('pos-scanPosTextMatches', {
    searchInput,
    hits: products.length,
    skuHits,
    nameOnlyHits: products.length - skuHits,
  })
  return products
}

/**
 * Danh sách sản phẩm cho gợi ý: mã vạch O(1) / quét tên theo bộ nhớ bán chạy (không filter cả 10k mỗi phím).
 * @param {{ products: object[], posScanList: { hay: string, product: object }[], rawQuery: string, productsByBarcodeKey?: Map<string, object[]> | null }} opts
 */
export function resolvePosSuggestCatalog({
  products,
  posScanList,
  rawQuery,
  productsByBarcodeKey = null,
}) {
  const q = String(rawQuery ?? '').trim()
  if (!q) return posScanList.map((r) => r.product)

  const trimmed = q
  const { searchInput, keywords } = getCatalogSearchQueryParts(trimmed)

  /** Chỉ dãy số dài (EAN/UPC/QR số) — không dùng posQueryLooksLikeBarcode (gõ chữ không dấu sẽ bị gộp khoảng → nhầm mã). */
  if (strictLongNumericBarcodeQuery(trimmed)) {
    const needleStr = String(normalizeBarcodeValue(trimmed))
    const byBarcode = productsByBarcodeKey?.get?.(needleStr)
    if (Array.isArray(byBarcode) && byBarcode.length > 0) {
      logSystemWideSearchV9('pos-resolvePosSuggestCatalog', {
        mode: 'barcode-long-numeric',
        hits: byBarcode.length,
        needle: needleStr,
        source: 'map',
      })
      return [...byBarcode]
    }
    const out = []
    for (const p of products) {
      const vars = p.groupVariants || [p]
      const hit = vars.some((v) => {
        const bc = String(normalizeBarcodeValue(v.barcode ?? ''))
        return bc.length > 0 && bc === needleStr
      })
      if (hit) out.push(p)
    }
    if (out.length > 0) {
      logSystemWideSearchV9('pos-resolvePosSuggestCatalog', {
        mode: 'barcode-long-numeric',
        hits: out.length,
        needle: needleStr,
        source: 'scan',
      })
      return out
    }
    /** Không gợi ý theo tên/mã chứa chuỗi con — tránh “8934…” khớp nhầm SKU/tên khác. */
    logSystemWideSearchV9('pos-resolvePosSuggestCatalog', {
      mode: 'barcode-long-numeric',
      hits: 0,
      needle: needleStr,
      source: 'none',
    })
    return []
  }

  if (!searchInput || keywords.length === 0) {
    logSystemWideSearchV9('pos-resolvePosSuggestCatalog', { mode: 'no-keywords', hits: 0, trimmed })
    return []
  }
  return scanPosTextMatches(posScanList, trimmed, POS_SUGGEST_SCAN_CAP)
}

/**
 * Điểm khớp: khớp Mã hàng (substring sau `clean`) luôn trên khớp tên thuần;
 * trong cùng nhóm, ưu tiên khớp đầu tên như trước.
 */
export function rankProductNameSearchMatch(product, rawQuery) {
  const { searchInput, keywords } = getCatalogSearchQueryParts(rawQuery)
  if (!searchInput || keywords.length === 0) return 0
  const productName = clean(String(product.nameRaw || product.name || ''))
  const isNameMatch = keywords.every((w) => productName.includes(w))
  const isSkuMatch = productMatchesSkuSearchInput(product, searchInput)
  if (!isNameMatch && !isSkuMatch) return 0
  let sub = 0
  if (isNameMatch) {
    if (productName.startsWith(keywords[0])) sub = 3
    else {
      const idx = productName.indexOf(keywords[0])
      sub = idx >= 0 && idx <= 2 ? 2 : 1
    }
  }
  if (isSkuMatch) return 100 + sub
  return sub
}

/**
 * Lọc catalog POS: tên sản phẩm (nameRaw / name) chứa đủ các từ khóa sau `clean` (AND).
 */
export function filterCatalogByQuery(products, raw) {
  const { searchInput, keywords } = getCatalogSearchQueryParts(raw)
  if (!Array.isArray(products)) {
    logSystemWideSearchV9('pos-filterCatalogByQuery', { hits: 0, reason: 'invalid-products' })
    return []
  }
  if (!searchInput || !keywords.length) {
    logSystemWideSearchV9('pos-filterCatalogByQuery', { hits: 0, reason: 'empty-query' })
    return []
  }
  let rowsWithSkuMatch = 0
  let rowsNameOnly = 0
  const res = products.filter((product) => {
    const productName = clean(String(product.nameRaw || product.name || ''))
    const isNameMatch = keywords.every((word) => productName.includes(word))
    const isSkuMatch = productMatchesSkuSearchInput(product, searchInput)
    if (!isNameMatch && !isSkuMatch) return false
    if (isSkuMatch) rowsWithSkuMatch += 1
    else rowsNameOnly += 1
    return true
  })
  logSystemWideSearchV9('pos-filterCatalogByQuery', {
    searchInput,
    hits: res.length,
    rowsWithSkuMatch,
    rowsNameOnly,
  })
  return res
}

function nameCompactMatchRank(product, rawQuery) {
  return rankProductNameSearchMatch(product, rawQuery)
}

/** Thứ tự hiển thị: điểm khớp tên (clean + AND) → bán chạy → locale. */
export function sortCatalogProductsByQuery(products, raw, codeQty = {}) {
  if (!Array.isArray(products) || products.length === 0) return [...products]
  const { searchInput, keywords } = getCatalogSearchQueryParts(raw)
  const hasKw = searchInput && keywords.length > 0
  return [...products].sort((a, b) => {
    if (hasKw) {
      const qa = nameCompactMatchRank(a, raw)
      const qb = nameCompactMatchRank(b, raw)
      if (qb !== qa) return qb - qa
    }
    const sa = scoreCatalogProduct(a, codeQty)
    const sb = scoreCatalogProduct(b, codeQty)
    if (sb !== sa) return sb - sa
    return String(a.name || '').localeCompare(String(b.name || ''), 'vi')
  })
}

/**
 * Tab Hàng hóa Admin / gợi ý combo — `clean` + AND từ trong tên; SKU cột A substring; EAN dài === cột B.
 * @param {{ surface?: string }} [opts] — nhãn log `[SYSTEM-WIDE-SEARCH-V9]` (mặc định `admin-goods-rows`).
 */
export function filterAndSortGoodsRowsSimple(rows, rawQuery, opts = null) {
  const surface = opts?.surface ?? 'admin-goods-rows'
  if (!Array.isArray(rows) || rows.length === 0) return rows || []
  const trimmed = String(rawQuery ?? '').trim()
  if (!trimmed) return rows || []

  if (strictLongNumericBarcodeQuery(trimmed)) {
    const needle = String(normalizeBarcodeValue(trimmed))
    if (!needle) {
      logSystemWideSearchV9(surface, { mode: 'barcode-long', hits: 0, reason: 'empty-needle' })
      return []
    }
    const hits = rows.filter((r) => String(normalizeBarcodeValue(r.barcode ?? '')) === needle)
    if (hits.length === 0) {
      logSystemWideSearchV9(surface, { mode: 'barcode-long', hits: 0, needle })
      return []
    }
    if (hits.length > 1) {
      console.warn(
        `[Hàng hóa] Trùng mã vạch "${needle}" trên ${hits.length} dòng — hiển thị theo dòng mới nhất trong file (createdAtMs / mã hàng).`
      )
    }
    const sorted = [...hits]
      .map((r) => ({ ...r }))
      .sort((a, b) => {
        const ta = Number(a.createdAtMs) || 0
        const tb = Number(b.createdAtMs) || 0
        if (tb !== ta) return tb - ta
        return String(b.code || '').localeCompare(String(a.code || ''), 'vi')
      })
    logSystemWideSearchV9(surface, { mode: 'barcode-long', hits: sorted.length, needle })
    return sorted
  }

  const raw = trimmed
  const searchInput = clean(raw)
  const keywords = searchInput.split(' ').filter((k) => k)
  if (keywords.length === 0) {
    logSystemWideSearchV9(surface, { mode: 'name-sku', hits: 0, reason: 'no-keywords-after-clean' })
    return rows || []
  }

  const withMeta = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const nameToSearch = clean(r.name)
    const skuToSearch = clean(String(r.code ?? r.id ?? ''))
    const isNameMatch = keywords.every((word) => nameToSearch.includes(word))
    const isSkuMatch = Boolean(searchInput) && skuToSearch.includes(searchInput)
    const isMatch = isNameMatch || isSkuMatch
    if (isMatch) withMeta.push({ row: r, i, isSkuMatch })
  }
  withMeta.sort((a, b) => {
    if (a.isSkuMatch !== b.isSkuMatch) return (b.isSkuMatch ? 1 : 0) - (a.isSkuMatch ? 1 : 0)
    return a.i - b.i
  })
  const out = withMeta.map((x) => ({ ...x.row }))
  logSystemWideSearchV9(surface, {
    mode: 'name-sku',
    searchInput,
    hits: out.length,
    skuFirstRows: withMeta.filter((x) => x.isSkuMatch).length,
  })
  return out
}

/**
 * Sau khi lọc tìm kiếm (hoặc không có query): sắp xếp danh sách hàng trong bộ nhớ — phản hồi tức thì.
 * @param {'newest'|'name_az'} sortMode
 */
export function applyGoodsListSort(rows, sortMode) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || []
  if (sortMode === 'name_az') {
    return [...rows].sort((a, b) =>
      String(a.ten_hang ?? a.name ?? '').localeCompare(String(b.ten_hang ?? b.name ?? ''), 'vi')
    )
  }
  return [...rows].sort((a, b) => {
    const ta = Number(a.createdAtMs) || 0
    const tb = Number(b.createdAtMs) || 0
    if (tb !== ta) return tb - ta
    return String(a.code || '').localeCompare(String(b.code || ''), 'vi')
  })
}

/**
 * Giống filterAndSortGoodsRowsSimple; nếu không khớp (ví dụ lệch chuẩn gõ tên), lọc lỏng theo tên/mã/mã vạch hiển thị.
 */
export function filterAndSortGoodsRowsSimpleWithFallback(rows, rawQuery) {
  const trimmed = String(rawQuery ?? '').trim()
  if (!trimmed || !Array.isArray(rows) || rows.length === 0) return rows || []
  if (strictLongNumericBarcodeQuery(trimmed)) {
    return filterAndSortGoodsRowsSimple(rows, rawQuery)
  }
  const primary = filterAndSortGoodsRowsSimple(rows, rawQuery)
  if (primary.length > 0) return primary
  const { keywords: wordsFb } = getCatalogSearchQueryParts(trimmed)
  if (wordsFb.length === 0) return rows || []
  const loose = rows.filter((r) => {
    const name = clean(r.name)
    if (wordsFb.every((w) => name.includes(w))) return true
    const codeN = clean(String(r.code ?? ''))
    if (wordsFb.every((w) => codeN.includes(w))) return true
    const bc = clean(String(normalizeBarcodeValue(r.barcode ?? '')))
    if (bc && wordsFb.every((w) => bc.includes(w))) return true
    return false
  })
  logSystemWideSearchV9('admin-goods-rows-fallback-loose', {
    mode: 'fallback-loose',
    hits: loose.length,
    keywords: wordsFb,
  })
  return loose.sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'vi'))
}

/**
 * Gợi ý chọn { product, variant } (phiếu nhập, v.v.): barcode dài === cột B; còn lại AND tên + SKU như POS.
 * @param {object[]} catalogList
 * @param {string} rawQuery
 * @param {{ maxHits?: number, surface?: string }} [opts]
 * @returns {Array<{ product: object, variant: object }>}
 */
export function suggestCatalogVariantPairsV9(catalogList, rawQuery, opts = {}) {
  const maxHits = opts.maxHits ?? 20
  const surface = opts.surface ?? 'admin-inbound-product-suggest'
  const list = Array.isArray(catalogList) ? catalogList : []
  const trimmed = String(rawQuery ?? '').trim()
  if (!trimmed || list.length === 0) {
    logSystemWideSearchV9(surface, { hits: 0, mode: trimmed ? 'empty-catalog' : 'empty-query' })
    return []
  }

  if (strictLongNumericBarcodeQuery(trimmed)) {
    const needle = String(normalizeBarcodeValue(trimmed))
    const hits = []
    outer: for (const p of list) {
      for (const v of p.groupVariants || [p]) {
        const bc = String(normalizeBarcodeValue(v.barcode ?? ''))
        if (bc && bc === needle) {
          hits.push({ product: p, variant: v })
          if (hits.length >= maxHits) break outer
        }
      }
    }
    logSystemWideSearchV9(surface, { mode: 'barcode-exact', hits: hits.length, needle })
    return hits
  }

  const { searchInput, keywords } = getCatalogSearchQueryParts(trimmed)
  if (!searchInput || !keywords.length) {
    logSystemWideSearchV9(surface, { mode: 'name-sku', hits: 0, reason: 'no-keywords-after-clean' })
    return []
  }

  const withMeta = []
  let order = 0
  for (const p of list) {
    for (const v of p.groupVariants || [p]) {
      if (!variantDisplayMatchesPosKeywords(v, p, keywords, searchInput)) continue
      const dispName = clean(String(v?.nameRaw || v?.name || p?.nameRaw || p?.name || ''))
      const isNameMatch = keywords.every((w) => dispName.includes(w))
      const isSkuMatch =
        Boolean(searchInput) && catalogEntitySkuClean(v, p?.code ?? p?.id ?? '').includes(searchInput)
      withMeta.push({ product: p, variant: v, isSkuMatch, isNameMatch, order: order++ })
    }
  }
  withMeta.sort((a, b) => {
    if (a.isSkuMatch !== b.isSkuMatch) return (b.isSkuMatch ? 1 : 0) - (a.isSkuMatch ? 1 : 0)
    return a.order - b.order
  })
  const out = withMeta.slice(0, maxHits).map(({ product, variant }) => ({ product, variant }))
  logSystemWideSearchV9(surface, {
    mode: 'name-sku',
    searchInput,
    hits: out.length,
    candidatesBeforeCap: withMeta.length,
  })
  return out
}
