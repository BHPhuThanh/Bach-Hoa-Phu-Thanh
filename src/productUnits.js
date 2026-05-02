/**
 * Gom sản phẩm theo mã gốc (Mã HH Liên Kết hoặc mã bỏ hậu tố -1, -2…).
 */

/**
 * Bỏ dấu tiếng Việt bằng thay thế ký tự (không dùng NFD / \p{M}) — giữ nguyên số và chữ Latin ASCII.
 * @param {unknown} s
 */
export function stripVietnameseAccentsManual(s) {
  let t = String(s ?? '')
  t = t
    .replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/gi, 'a')
    .replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/gi, 'e')
    .replace(/ì|í|ị|ỉ|ĩ/gi, 'i')
    .replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/gi, 'o')
    .replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/gi, 'u')
    .replace(/ỳ|ý|ỵ|ỷ|ỹ/gi, 'y')
    .replace(/đ/gi, 'd')
  return t
}

/**
 * Chuẩn hóa chuỗi tìm kiếm: bỏ dấu thủ công, chữ thường, gom khoảng trắng.
 * @param {unknown} s
 */
export function normalizeCatalogSearchString(s) {
  return stripVietnameseAccentsManual(String(s ?? ''))
    .toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Chuỗi đã bỏ dấu + thường + xóa toàn bộ khoảng trắng — dùng so .includes() kiểu "7up" vs "7 Up". */
export function normalizeCatalogSearchCompactKey(s) {
  return normalizeCatalogSearchString(s ?? '').replace(/\s/g, '')
}

/** Từ đầu tiên của tên (sau chuẩn hóa khoảng trắng) — gõ "7up" + ĐƠN VỊ TÍNH "thùng" → "7upthung". */
export function firstCatalogNameTokenCompact(nameRaw, fallbackName = '') {
  const raw = String(nameRaw ?? '').trim() || String(fallbackName ?? '').trim()
  const s = normalizeCatalogSearchString(raw)
  if (!s) return ''
  const w = s.split(/\s+/).filter(Boolean)[0] || ''
  return normalizeCatalogSearchCompactKey(w)
}

/**
 * Một dòng catalog: Mã hàng (A) + Tên (C) + ĐƠN VỊ TÍNH (L) — thường, bỏ dấu, bỏ khoảng; nối thêm vài đoạn phụ để .includes() linh hoạt.
 * @param {unknown} linkedMasterCode — cột liên kết / mã gốc nhóm (khớp cả chai + thùng khi gõ mã cha).
 */
export function buildVariantPosSearchHaystack(
  codeRaw,
  nameRaw,
  fallbackName,
  unitLabelRaw,
  linkedMasterCode = ''
) {
  const codeC = normalizeCatalogSearchCompactKey(codeRaw)
  const root = normalizeGroupRoot(String(codeRaw ?? '').trim(), String(linkedMasterCode ?? '').trim())
  const rootC = normalizeCatalogSearchCompactKey(root)
  const rawCol = String(nameRaw ?? '').trim() || String(fallbackName ?? '').trim()
  const nameCompact = normalizeCatalogSearchCompactKey(rawCol)
  const uRaw = trimCatalogUnitLabel(unitLabelRaw)
  const unitC = uRaw ? normalizeCatalogSearchCompactKey(uRaw) : ''

  const parts = new Set()
  const triple = `${codeC}${nameCompact}${unitC}`
  if (triple) parts.add(triple)
  if (codeC) parts.add(codeC)
  if (rootC && rootC !== codeC) parts.add(rootC)
  if (nameCompact) parts.add(nameCompact)
  if (unitC) parts.add(unitC)

  if (uRaw) {
    parts.add(normalizeCatalogSearchCompactKey(`${rawCol} ${uRaw}`.trim()))
    const ft = firstCatalogNameTokenCompact(nameRaw, fallbackName)
    if (ft && unitC) parts.add(`${ft}${unitC}`)
    if (ft && codeC) parts.add(`${codeC}${ft}`)
    if (ft && codeC && unitC) parts.add(`${codeC}${ft}${unitC}`)
  }
  return [...parts].join('')
}

/**
 * Gộp haystack từng biến thể (mã + tên + ĐƠN VỊ TÍNH) — filter = product.nameSearch.includes(queryCompact).
 */
export function computeProductNameSearch(p) {
  const variants =
    Array.isArray(p.groupVariants) && p.groupVariants.length > 0 ? p.groupVariants : null
  if (variants) {
    const chunks = variants.map((v) =>
      buildVariantPosSearchHaystack(
        v.code ?? '',
        v.nameRaw || p.nameRaw,
        v.name || p.name,
        v.unitLabel,
        v.linkedMasterCode ?? p.linkedMasterCode
      )
    )
    return { nameSearch: chunks.join('') }
  }
  return {
    nameSearch: buildVariantPosSearchHaystack(
      p.code ?? '',
      p.nameRaw,
      p.name,
      p.unitLabel,
      p.linkedMasterCode
    ),
  }
}

/**
 * Gắn lại nameSearch cho snapshot (đồng bộ sau chỉnh sửa).
 * @param {Array<object>} products
 */
export function refreshCatalogSearchTexts(products) {
  if (!Array.isArray(products)) return []
  return products.map((p) => {
    const merged = { ...p, ...computeProductNameSearch(p) }
    const vars = merged.groupVariants?.length ? merged.groupVariants : []
    if (vars.length === 0) {
      return {
        ...merged,
        posSearchHaystack: buildVariantPosSearchHaystack(
          merged.code ?? '',
          merged.nameRaw,
          merged.name,
          merged.unitLabel,
          merged.linkedMasterCode
        ),
      }
    }
    const gv = vars.map((v) => ({
      ...v,
      posSearchHaystack: buildVariantPosSearchHaystack(
        v.code ?? '',
        v.nameRaw || merged.nameRaw,
        v.name || merged.name,
        v.unitLabel,
        v.linkedMasterCode ?? merged.linkedMasterCode
      ),
    }))
    return { ...merged, groupVariants: gv }
  })
}

/**
 * Cột L trong Excel (chỉ mục 0-based: A=0 … L=11) — ĐƠN VỊ TÍNH khi nhập .xlsx/.xls theo đúng vị trí cột.
 */
export const EXCEL_CATALOG_UNIT_COLUMN_INDEX_L = 11

/** Cột N (0-based = 13) trong mẫu Excel KiotViet — « Quy đổi » (số đơn vị nhỏ nhất trong 1 ĐƠN VỊ TÍNH dòng). */
export const EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N = 13

/** Cột T (0-based = 19) — Giá sỉ / buôn trong mẫu Excel KiotViet (CSV `;` dùng cùng chỉ mục). */
export const EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T = 19

/** Ô ĐƠN VỊ TÍNH trống (sau trim) → mặc định; không thay thế khi đã có chữ từ file (Hộp, Lốc…). */
export const DEFAULT_CATALOG_UNIT_LABEL = 'Cái'

/**
 * Trim nhãn ĐƠN VỊ TÍNH từ ô (không gán mặc định) — dùng khi cần phân biệt trống / có dữ liệu.
 * @param {unknown} raw
 */
export function trimCatalogUnitLabel(raw) {
  return String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Chuẩn hóa nhãn ĐƠN VỊ TÍNH hiển thị / lưu: chỉ gán {@link DEFAULT_CATALOG_UNIT_LABEL} khi sau trim không còn ký tự (hoặc placeholder "—").
 * @param {unknown} raw
 */
export function normalizeCatalogUnitLabel(raw) {
  const s = trimCatalogUnitLabel(raw)
  if (!s || s === '—') return DEFAULT_CATALOG_UNIT_LABEL
  return s
}

/** Chuẩn key so khớp tiêu đề cột ĐƠN VỊ TÍNH (đã qua stripAccents + chữ thường). */
function unitColumnKeyFromNorm(normHeader) {
  return String(normHeader ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
}

/** Tiêu đề "ĐƠN VỊ TÍNH" sau stripAccents thành "đvt" (đ), không phải ASCII "dvt". */
function isDvtHeaderKey(k) {
  const x = String(k ?? '').trim()
  return x === 'dvt' || x === 'đvt'
}

/** Cột A (index 0) là "Mã hàng" — ép codeIdx = 0 để mã khớp ĐƠN VỊ TÍNH cùng dòng. */
export function shouldForceProductCodeColumnA(normHeaders) {
  if (!normHeaders?.length) return false
  const k = unitColumnKeyFromNorm(normHeaders[0])
  return (
    k.includes('ma hang') ||
    k === 'mahang' ||
    k.includes('ma_hang') ||
    k === 'sku' ||
    /^ma$/.test(k) ||
    (k.startsWith('ma ') && !k.includes('vach') && !k.includes('ten'))
  )
}

/**
 * Chọn cột đơn vị tính — ưu tiên cột L (index 11) nếu tiêu đề là ĐƠN VỊ TÍNH (hoặc tương đương); khớp đvt/dvt.
 * @param {string[]} normHeaders — mảng đã qua normalizeHeaderCell (stripAccents, lower).
 */
export function pickUnitColumnIndex(normHeaders) {
  if (!normHeaders?.length) return -1
  const L = EXCEL_CATALOG_UNIT_COLUMN_INDEX_L
  if (normHeaders.length > L) {
    const keyL = unitColumnKeyFromNorm(normHeaders[L])
    if (
      isDvtHeaderKey(keyL) ||
      keyL === 'don vi tinh' ||
      keyL.includes('don vi tinh') ||
      keyL === 'donvitinh' ||
      keyL.includes('donvitinh')
    ) {
      return L
    }
  }
  const keys = normHeaders.map(unitColumnKeyFromNorm)
  let i = keys.findIndex((k) => isDvtHeaderKey(k))
  if (i >= 0) return i
  i = keys.findIndex((k) => k === 'don vi tinh' || k.includes('don vi tinh'))
  if (i >= 0) return i
  i = keys.findIndex((k) => k === 'donvitinh' || k.includes('donvitinh'))
  if (i >= 0) return i
  i = keys.findIndex((k) => k === 'unit' || k === 'uom' || k.includes('unit of measure'))
  if (i >= 0) return i
  for (let j = 0; j < keys.length; j++) {
    if (headerIsUnitColumn(normHeaders[j])) return j
  }
  return -1
}

/** Chuẩn hóa header đã qua normalizeHeaderCell */
export function headerIsLinkedMasterColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('ma') && (h.includes('lien ket') || h.includes('lienket'))) return true
  if (h.includes('hang hoa') && h.includes('lien')) return true
  if (h.includes('ma hh lien')) return true
  return false
}

export function headerIsUnitColumn(normHeader) {
  const h = unitColumnKeyFromNorm(normHeader)
  if (isDvtHeaderKey(h)) return true
  if (h.includes('don vi tinh') || h === 'donvitinh' || h.includes('donvitinh')) return true
  if (h === 'unit' || h === 'uom' || h.includes('unit of measure')) return true
  return false
}

export function headerIsConversionColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('quy doi') || h.includes('quydoi')) return true
  if (h.includes('he so quy doi')) return true
  return false
}

export function parseConversionRatio(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Mã gốc nhóm: ưu tiên cột liên kết; không có thì bỏ hậu tố -số (PVN6903-1 → PVN6903).
 */
export function normalizeGroupRoot(productCode, linkedMasterCode) {
  const link = String(linkedMasterCode ?? '').trim()
  if (link) return link
  const c = String(productCode ?? '').trim()
  if (!c) return c
  const m = c.match(/^(.*)-(\d+)$/)
  if (m && m[1]) return m[1]
  return c
}

/**
 * Hệ số quy đổi về đơn vị cơ bản: `conversionValue` (Hàng hóa) rồi `conversion` (cột Quy đổi / Excel).
 * Khớp thứ tự gom nhóm trong {@link buildDisplayCatalog} — ví dụ 1 thùng = 48 hộp → 48.
 */
export function catalogQuyDoiFactorToBase(v) {
  const raw =
    v?.conversionValue ??
    v?.conversion ??
    v?.quy_doi ??
    v?.quyDoi ??
    v?.raw?.quy_doi
  if (raw == null || (typeof raw === 'string' && !String(raw).trim())) return 1
  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum > 0) return asNum
  const p = parseConversionRatio(String(raw))
  return p != null && p > 0 ? p : 1
}

function variantConversionNumber(v) {
  return catalogQuyDoiFactorToBase(v)
}

function buildConversionHint(variant, baseUnitLabel) {
  const u = normalizeCatalogUnitLabel(variant.unitLabel)
  const base = String(baseUnitLabel || '').trim() || 'đơn vị cơ bản'
  const r = variantConversionNumber(variant)
  if (Math.abs(r - 1) > 1e-9) {
    const n = Math.abs(r - Math.round(r)) < 1e-6 ? Math.round(r) : r
    return `1 ${u} = ${n} ${base}`
  }
  return ''
}

/**
 * @param {Array<{ id: string, code: string, name: string, nameRaw?: string, price: number, cost: number, unitLabel: string, linkedMasterCode: string, conversion: number|null }>} rows
 */
export function buildDisplayCatalog(rows) {
  const byRoot = new Map()
  for (const p of rows) {
    const root = normalizeGroupRoot(p.code, p.linkedMasterCode)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(p)
  }

  const display = []
  for (const [root, members] of byRoot) {
    const sortedRaw = [...members].sort((a, b) => {
      const ca = variantConversionNumber(a)
      const cb = variantConversionNumber(b)
      if (ca !== cb) return ca - cb
      return String(a.code).localeCompare(String(b.code))
    })
    const sorted = sortedRaw.map((v) => ({
      ...v,
      unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
    }))
    const rep =
      sorted.find((m) => String(m.code).trim() === root) ||
      sorted.find((m) => variantConversionNumber(m) <= 1 + 1e-9) ||
      sorted[0]

    const baseUnitLabel = sorted[0]?.unitLabel || rep.unitLabel || ''

    const groupVariants = sorted.map((v) => ({
      ...v,
      conversionHint: buildConversionHint(v, baseUnitLabel),
      posSearchHaystack: buildVariantPosSearchHaystack(
        v.code ?? '',
        v.nameRaw || rep.nameRaw,
        v.name || rep.name,
        v.unitLabel,
        v.linkedMasterCode ?? rep.linkedMasterCode
      ),
    }))

    const { nameSearch } = computeProductNameSearch({
      ...rep,
      groupVariants,
      nameRaw: rep.nameRaw,
      name: rep.name,
    })

    const firstDvt = String(sorted[0]?.dvt ?? rep.dvt ?? '').trim()

    display.push({
      ...rep,
      /** Đơn vị cố định từ cột «dvt» trong file — nhất quán với `groupVariants[].dvt`. */
      dvt: firstDvt || String(rep.unitLabel ?? '').trim(),
      nameSearch,
      groupRoot: root,
      groupVariants,
      multiUnit: sorted.length > 1,
    })
  }

  display.sort((a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code), 'vi'))
  return display
}
