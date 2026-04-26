import * as XLSX from 'xlsx'
import {
  EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N,
  EXCEL_CATALOG_UNIT_COLUMN_INDEX_L,
  EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T,
  buildDisplayCatalog,
  catalogQuyDoiFactorToBase,
  headerIsConversionColumn,
  headerIsLinkedMasterColumn,
  normalizeCatalogUnitLabel,
  normalizeGroupRoot,
  parseConversionRatio,
  pickUnitColumnIndex,
  shouldForceProductCodeColumnA,
  trimCatalogUnitLabel,
} from './productUnits.js'

/* Đồng bộ với App.jsx (đoạn parse CSV): chạy `node scripts/gen-catalog-csv.mjs` sau khi sửa logic nhận cột. */

function parseDelimitedLine(line, delimiter) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === delimiter && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += c
    }
  }
  cells.push(current)
  return cells
}

/**
 * Phân cách CSV: ưu tiên ; (định dạng phổ biến KiotViet / sếp), không có mới dùng ,.
 */
function detectDelimiter(headerLine) {
  if (headerLine.includes(';')) return ';'
  const bySemi = parseDelimitedLine(headerLine, ';').length
  const byComma = parseDelimitedLine(headerLine, ',').length
  if (bySemi > byComma) return ';'
  if (byComma > bySemi) return ','
  return ','
}

function splitLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function stripAccents(s) {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function normalizeHeaderCell(h) {
  return stripAccents(
    String(h ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/\u00A0/g, ' ')
      .trim()
  )
}

const CATALOG_IMPORT_DEV = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV

/** Đủ ô tới cột N (13) — CSV `;` với dòng thiếu ô cuối không làm mất Quy đổi. */
function padCatalogCellRow(cells, minLen) {
  const row = Array.isArray(cells) ? [...cells] : []
  while (row.length < minLen) row.push('')
  return row
}

function normUnitKeyForBulk(raw) {
  return normalizeHeaderCell(String(raw ?? '').replace(/[[\]]/g, ' '))
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function isBulkLikeUnitCellRaw(raw) {
  const k = normUnitKeyForBulk(raw)
  return k.includes('thung') || k.includes('loc') || k.includes('bich')
}

function dvtRawFromCatalogRow(r) {
  const cells = r?.raw
  if (Array.isArray(cells) && cells.length > EXCEL_CATALOG_UNIT_COLUMN_INDEX_L) {
    return String(cells[EXCEL_CATALOG_UNIT_COLUMN_INDEX_L] ?? '').trim()
  }
  return trimCatalogUnitLabel(r?.unitLabel ?? '')
}

function isBulkUnitCatalogRow(r) {
  if (isBulkLikeUnitCellRaw(dvtRawFromCatalogRow(r))) return true
  return isBulkLikeUnitCellRaw(r?.unitLabel ?? '')
}

/**
 * Giá trị ô Quy đổi: ưu tiên cột N (index 13) khi `excelQuyDoiFromColumnN`;
 * CSV dùng `parseDelimitedLine` + {@link padCatalogCellRow} — không qua {@link readSheetColumnNQuyDoi} (chỉ .xlsx).
 */
function readQuyDoiRawForCatalogCells(cells, importOpts, convIdx) {
  const N = EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N
  if (importOpts.excelQuyDoiFromColumnN === true && cells.length > N) {
    const n = cells[N]
    if (n != null && String(n).trim() !== '') return String(n).trim()
  }
  if (convIdx >= 0 && convIdx < cells.length) {
    const v = cells[convIdx]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

let __quyDoiLogCount = 0
const MAX_QUY_DOI_LOG = 24

function maybeLogCatalogQuyDoiColumnN(ctx) {
  if (!ctx.importOpts?.debugCatalogQuyDoiN || !CATALOG_IMPORT_DEV) return
  const { rowIndex, code, cells, convParsed, convIdx, delim } = ctx
  const N = EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N
  const L = EXCEL_CATALOG_UNIT_COLUMN_INDEX_L
  const nRaw = cells.length > N ? cells[N] : ''
  const lRaw = cells.length > L ? cells[L] : ''
  const bulk = isBulkLikeUnitCellRaw(lRaw)
  if (__quyDoiLogCount >= MAX_QUY_DOI_LOG && !bulk) return
  __quyDoiLogCount += 1
  console.log('[catalog Quy đổi cột N index=13]', {
    dataRow1Based: rowIndex + 2,
    code,
    delim,
    colL_index11: lRaw,
    colN_index13: nRaw,
    convIdxFallback: convIdx,
    parsedQuyDoi: convParsed,
  })
}

/**
 * ĐVT lớn (L) mà Quy đổi ≤1: cảnh báo; nếu cùng nhóm có dòng khác với hệ số >1 thì gán max cho ĐVT lớn (KiotViet).
 */
function inferAndWarnBulkQuyDoi(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const groups = new Map()
  for (const r of rows) {
    const key = normalizeGroupRoot(String(r.code ?? ''), String(r.linkedMasterCode ?? ''))
    const k = key || `__solo__${r.id}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  for (const [gk, g] of groups) {
    if (g.length < 2) continue
    const maxC = Math.max(...g.map((x) => catalogQuyDoiFactorToBase(x)))
    if (maxC <= 1) {
      for (const r of g) {
        if (isBulkUnitCatalogRow(r) && catalogQuyDoiFactorToBase(r) <= 1) {
          console.warn(
            '[catalog Quy đổi] ĐVT lớn (Thùng/Lốc/Bịch) nhưng cột N trống hoặc 1 — nhập số (vd. 48) vào cột N. Nhóm:',
            gk,
            'mã:',
            r.code,
          )
        }
      }
      continue
    }
    for (const r of g) {
      if (!isBulkUnitCatalogRow(r)) continue
      const f = catalogQuyDoiFactorToBase(r)
      if (f > 1) continue
      r.conversion = maxC
      r.conversionValue = maxC
      if (CATALOG_IMPORT_DEV) {
        console.info(
          '[catalog Quy đổi] Bổ sung hệ số từ max nhóm cho ĐVT lớn:',
          r.code,
          '→',
          maxC,
          '(nhóm',
          gk,
          ')',
        )
      }
    }
  }
  return rows
}

/** Chuẩn hóa tiêu đề cột để so khớp tên (bỏ [], gom khoảng trắng). */
function normHeaderKey(raw) {
  return normalizeHeaderCell(String(raw ?? '').replace(/[[\]]/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Đúng 'Tên hàng' / 'Ten hang' sau khi bỏ dấu. */
function isExactTenHangHeader(raw) {
  const k = normHeaderKey(raw)
  return k === 'ten hang'
}

/** Cột không dùng làm tên (nhóm, ghi chú, mã, giá, ĐVT…). */
function headerIsExcludedFromName(normFull) {
  const h = String(normFull ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (headerIsPriceColumn(h) || headerIsWholesalePriceColumn(h)) return true
  const blocked = [
    'nhom hang',
    'ghi chu',
    'danh muc',
    'phan loai',
    'nganh hang',
    'loai hang',
    'category',
    'ma hang',
    'ma vach',
    'ma hang hoa',
    'sku',
    'barcode',
    'itemcode',
    'don vi tinh',
    'don vi',
    'dvt',
    'donvitinh',
    'ton kho',
    'so luong',
    'sl ton',
    'hinh anh',
    'image',
    'mo ta ngan',
    'ghi chu noi bo',
    'vat tu',
    'lien ket',
    'quy doi',
    'trong luong',
    'trongluong',
    'khoi luong',
    'khoiluong',
    'dinh muc ton',
    'ton toi thieu',
    'ton toi da',
    'nha cung cap',
    'nhacungcap',
    'nha cung cap hang',
  ]
  for (const b of blocked) {
    if (h === b || h.includes(b)) return true
  }
  return false
}

function countLettersInCell(cell) {
  return (String(cell ?? '').match(/\p{L}/gu) || []).length
}

/** Chọn cột có tổng số ký tự chữ lớn nhất trong mẫu dòng (thường là tên SP). */
function pickNameColumnByLetterScore(headers, dataRows, excludeIdx) {
  const sample = dataRows.slice(0, 120)
  let bestJ = -1
  let bestScore = -1
  for (let j = 0; j < headers.length; j++) {
    if (excludeIdx[j]) continue
    let score = 0
    for (const row of sample) {
      score += countLettersInCell(row[j])
    }
    if (score > bestScore) {
      bestScore = score
      bestJ = j
    }
  }
  return bestJ >= 0 && bestScore > 0 ? bestJ : -1
}

/** Cột giá: header có chứa "Giá bán" / "Gia ban" (sau chuẩn hóa → gia ban). */
function headerIsPriceColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  return h.includes('gia ban')
}

/** Cột giá sỉ / buôn (không dùng làm cột tên). */
function headerIsWholesalePriceColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (headerIsPriceColumn(h)) return false
  if (h.includes('gia si') || h.includes('giasi') || h.includes('gia_si')) return true
  if (h.includes('gia buon') || h.includes('giabuon')) return true
  if (h.includes('wholesale') && h.includes('price')) return true
  return false
}

/** Đơn giá bán: bật sỉ thì ưu tiên cột giá sỉ (>0), không có thì giá lẻ. */
function headerIsCostColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('gia von') || h.includes('giavon') || h.includes('gia_von')) return true
  if (h === 'cost' || h.includes('cost price') || h.includes('unit cost')) return true
  return false
}

/** Cột mã vạch (EAN/UPC…) — tách khỏi Mã hàng/SKU. */
function headerIsBarcodeColumnNorm(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h === 'ma vach' || h.includes('ma vach') || h.includes('mavach') || h.includes('ma_vach'))
    return true
  if (h === 'barcode' || h.includes('barcode')) return true
  if (/\bean\b/.test(h) || /\bupc\b/.test(h)) return true
  return false
}

/**
 * Chuẩn hóa mã vạch chỉ bằng thao tác chuỗi (không parseFloat) để không làm tròn/mất số cuối.
 */
function normalizeBarcodeValue(raw) {
  let s = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
  if (!s) return ''
  s = s.replace(/^="(.+)"$/i, '$1').replace(/^='(.+)'$/i, '$1').replace(/^=(.+)$/, '$1').trim()
  s = s.replace(/[\t\r\n]/g, '')

  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '')

  s = s.replace(/\p{Zs}/gu, '')
  return s
}

/** Gõ giống mã quét: sau chuẩn hóa chỉ còn ký tự mã (khoảng trắng trong CSV/ô nhập đã bỏ). */
function queryLooksLikeBarcodeKeyInput(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return false
  const n = normalizeBarcodeValue(t)
  if (n.length < 1) return false
  return /^[\dA-Za-z._-]+$/.test(n)
}

/** Máy quét dạng bàn phím: khoảng cách liên tiếp rất ngắn, thường kết thúc Enter. */
const SCAN_MAX_INTER_KEY_MS = 75
const SCAN_MIN_CHARS_GLOBAL = 4

function isPrintableBarcodeKey(key) {
  return key.length === 1 && /[\dA-Za-z._-]/.test(key)
}

function scanTimingLooksLikeWedge(times) {
  if (times.length < SCAN_MIN_CHARS_GLOBAL) return false
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > SCAN_MAX_INTER_KEY_MS) return false
  }
  return true
}

/** Ô đang nhập liệu / chọn — không bắt quét toàn cục (tránh lẫn giảm giá, SL…). */
function isEditableFieldElement(el) {
  if (!el || el.nodeType !== 1) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (tag === 'INPUT') {
    const type = String(el.type || '').toLowerCase()
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit' || type === 'reset' || type === 'file') return false
    return true
  }
  return false
}

function playScannerBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.frequency.value = 880
    o.type = 'sine'
    g.gain.setValueAtTime(0.07, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07)
    o.start(ctx.currentTime)
    o.stop(ctx.currentTime + 0.07)
    o.onended = () => ctx.close?.()
  } catch {
    /* ignore */
  }
}

/** Cột tồn kho (KiotViet: Tồn kho; SL tồn…). */
function headerIsStockColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('ton kho') || h.includes('tonkho')) return true
  if (h === 'ton' || /^ton\s/.test(h)) return true
  if (h.includes('so luong ton') || h.includes('sl ton') || h.includes('slton')) return true
  if (h.includes('available') && h.includes('stock')) return true
  if (h === 'stock' || h.includes('on hand') || h.includes('qty on hand')) return true
  if (h.includes('inventory') && !h.includes('price')) return true
  return false
}

/** Cột thương hiệu / hãng (Excel KiotViet thường có "Thương hiệu"). */
/** Cột nhà cung cấp (KiotViet / Excel). */
function headerIsSupplierColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('nha cung cap') || h.includes('nhacungcap') || h.includes('nha_cung_cap')) return true
  if (h.includes('supplier') && !h.includes('price')) return true
  if (h.includes('vendor') && !h.includes('price')) return true
  if (h === 'ncc' || h.startsWith('ncc ')) return true
  return false
}

function headerIsBrandColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('thuong hieu') || h.includes('thuonghieu')) return true
  if (h.includes('nhan hieu') || h.includes('nhanhieu')) return true
  if (h.includes('hang san xuat') || h.includes('hangsx')) return true
  if (h === 'brand' || h.includes('brand')) return true
  return false
}

/** Trọng lượng (KiotViet) — tránh cột “tính giá”. */
function headerIsWeightColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('tinh gia') || h.includes('tinhgia')) return false
  if (h.includes('trong luong') || h.includes('trongluong')) return true
  if (h.includes('khoi luong') || h.includes('khoiluong')) return true
  if (h === 'weight' || h.includes('weight')) return true
  return false
}

/** Định mức tồn tối thiểu. */
function headerIsStockNormMinColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('toi da') || h.includes('toida')) return false
  if (h.includes('ton toi thieu') || h.includes('tontoithieu')) return true
  if (h.includes('dinh muc') && h.includes('toi thieu')) return true
  if (h.includes('sl toi thieu') || h.includes('sltoi thieu')) return true
  return false
}

/** Định mức tồn tối đa. */
function headerIsStockNormMaxColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('toi thieu') || h.includes('toithieu')) return false
  if (h.includes('ton toi da') || h.includes('tontoida')) return true
  if (h.includes('dinh muc') && h.includes('toi da')) return true
  if (h.includes('sl toi da') || h.includes('sltoi da')) return true
  return false
}

/** Một cột dạng "30 - 999.999" (định mức tồn gộp). */
function headerIsStockNormRangeColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (h.includes('toi thieu') || h.includes('toi da')) return false
  if (h.includes('dinh muc') && h.includes('ton')) return true
  return false
}

/**
 * Cột "Mã ĐVT cơ bản" / mã gốc nhóm ĐVT — dùng gom nhiều dòng Excel thành một mặt hàng (không trùng cột Liên kết Kiot).
 */
function headerIsSmartBaseGroupColumn(normHeader) {
  const h = String(normHeader ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, ' ')
    .trim()
  if (headerIsLinkedMasterColumn(h)) return false
  const n = normalizeHeaderCell(h)
  if (n.includes('ma') && n.includes('dvt') && (n.includes('co ban') || n.includes('coban'))) return true
  if (n.includes('ma') && n.includes('dvt') && (n.includes('co so') || n.includes('coso'))) return true
  if (n.includes('dvt') && (n.includes('goc') || n.includes('gốc'))) return true
  if ((n.includes('don vi') || n.includes('donvi')) && (n.includes('goc') || n.includes('gốc'))) return true
  if (n.includes('base') && n.includes('uom')) return true
  return false
}

/**
 * CSV dấu ; (KiotViet): cột 3 = Mã vạch (index 2), cột 4 = Tên hàng (index 3) — tránh bóc sai cột.
 */
function refineBarcodeNameIndicesForSemicolon(headers, delim, barcodeIdx, nameIdx) {
  if (delim !== ';' || headers.length < 4) return { barcodeIdx, nameIdx }
  const n2 = normalizeHeaderCell(headers[2])
  const n3 = normalizeHeaderCell(headers[3])
  const col2Barcode =
    headerIsBarcodeColumnNorm(n2) || (n2.includes('vach') && !n2.includes('ten'))
  const col3Name =
    isExactTenHangHeader(headers[3]) ||
    n3.includes('ten hang') ||
    n3.includes('ten san pham') ||
    n3.includes('ten mat hang') ||
    n3.includes('ten hang hoa')
  if (col2Barcode) barcodeIdx = 2
  if (col3Name) nameIdx = 3
  return { barcodeIdx, nameIdx }
}

/** Nhận diện cột mã / tên / giá theo header kiểu KiotViet hoặc tên tiếng Anh. */
function detectColumns(headers, dataRows = [], delim = '', importOpts = {}) {
  const norm = headers.map(normalizeHeaderCell)
  let codeIdx = -1
  let barcodeIdx = -1
  let nameIdx = -1
  let priceIdx = -1
  let wholesalePriceIdx = -1
  let costIdx = -1
  let stockIdx = -1
  let supplierIdx = -1
  let brandIdx = -1
  let linkIdx = -1
  let baseGroupIdx = -1
  let unitIdx = -1
  let convIdx = -1
  let weightIdx = -1
  let stockNormMinIdx = -1
  let stockNormMaxIdx = -1
  let stockNormRangeIdx = -1

  for (let i = 0; i < norm.length; i++) {
    if (barcodeIdx < 0 && headerIsBarcodeColumnNorm(norm[i])) barcodeIdx = i
  }

  for (let i = 0; i < norm.length; i++) {
    const h = norm[i]
    if (linkIdx < 0 && headerIsLinkedMasterColumn(h)) linkIdx = i
    if (convIdx < 0 && headerIsConversionColumn(h)) convIdx = i
  }
  for (let i = 0; i < norm.length; i++) {
    if (baseGroupIdx < 0 && headerIsSmartBaseGroupColumn(norm[i])) baseGroupIdx = i
  }
  unitIdx = pickUnitColumnIndex(norm)
  if (importOpts.excelUnitFromColumnL === true) {
    unitIdx = EXCEL_CATALOG_UNIT_COLUMN_INDEX_L
  }
  if (importOpts.excelQuyDoiFromColumnN === true) {
    convIdx = EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N
  }
  if (importOpts.excelWholesaleFromColumnT === true) {
    wholesalePriceIdx = EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T
  }

  for (let i = 0; i < norm.length; i++) {
    if (wholesalePriceIdx < 0 && headerIsWholesalePriceColumn(norm[i])) {
      wholesalePriceIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (priceIdx < 0 && headerIsPriceColumn(norm[i])) {
      priceIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (costIdx < 0 && headerIsCostColumn(norm[i])) {
      costIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (stockIdx < 0 && headerIsStockColumn(norm[i])) {
      stockIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (supplierIdx < 0 && headerIsSupplierColumn(norm[i])) {
      supplierIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (brandIdx < 0 && headerIsBrandColumn(norm[i])) {
      brandIdx = i
      break
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (weightIdx < 0 && headerIsWeightColumn(norm[i])) weightIdx = i
  }
  for (let i = 0; i < norm.length; i++) {
    if (stockNormMinIdx < 0 && headerIsStockNormMinColumn(norm[i])) stockNormMinIdx = i
  }
  for (let i = 0; i < norm.length; i++) {
    if (stockNormMaxIdx < 0 && headerIsStockNormMaxColumn(norm[i])) stockNormMaxIdx = i
  }
  if (stockNormMinIdx < 0 && stockNormMaxIdx < 0) {
    for (let i = 0; i < norm.length; i++) {
      if (stockNormRangeIdx < 0 && headerIsStockNormRangeColumn(norm[i])) {
        stockNormRangeIdx = i
        break
      }
    }
  }

  for (let i = 0; i < norm.length; i++) {
    const h = norm[i]
    if (headerIsLinkedMasterColumn(h)) continue
    if (barcodeIdx >= 0 && i === barcodeIdx) continue
    if (codeIdx < 0) {
      const barcodeAsCodeOk = barcodeIdx < 0
      if (
        h.includes('ma_hang') ||
        h.includes('mahang') ||
        (barcodeAsCodeOk && h.includes('ma vach')) ||
        (barcodeAsCodeOk && h.includes('barcode')) ||
        h.includes('sku') ||
        h.includes('itemcode') ||
        /^ma$/.test(h) ||
        (h.startsWith('ma ') && !h.includes('ten') && !h.includes('vach'))
      ) {
        codeIdx = i
      }
    }
    if (priceIdx < 0) {
      if (
        h.includes('gia_ban') ||
        h.includes('giaban') ||
        h.includes('don_gia') ||
        h.includes('dongia') ||
        /^gia$/.test(h) ||
        h.includes('price') ||
        h.includes('thanh tien')
      ) {
        priceIdx = i
      }
    }
  }

  for (let i = 0; i < headers.length; i++) {
    if (isExactTenHangHeader(headers[i])) {
      nameIdx = i
      break
    }
  }

  if (nameIdx < 0 && dataRows.length > 0) {
    const exclude = {}
    for (let j = 0; j < headers.length; j++) {
      exclude[j] =
        j === priceIdx ||
        j === wholesalePriceIdx ||
        j === costIdx ||
        j === stockIdx ||
        (supplierIdx >= 0 && j === supplierIdx) ||
        (brandIdx >= 0 && j === brandIdx) ||
        j === codeIdx ||
        j === barcodeIdx ||
        j === linkIdx ||
        j === unitIdx ||
        j === convIdx ||
        j === weightIdx ||
        j === stockNormMinIdx ||
        j === stockNormMaxIdx ||
        j === stockNormRangeIdx ||
        headerIsExcludedFromName(norm[j])
    }
    nameIdx = pickNameColumnByLetterScore(headers, dataRows, exclude)
  }

  if (nameIdx < 0 && norm.length > 0) {
    const exclude = {}
    for (let j = 0; j < headers.length; j++) {
      exclude[j] =
        j === priceIdx ||
        j === wholesalePriceIdx ||
        j === costIdx ||
        j === stockIdx ||
        (supplierIdx >= 0 && j === supplierIdx) ||
        (brandIdx >= 0 && j === brandIdx) ||
        j === codeIdx ||
        j === barcodeIdx ||
        j === linkIdx ||
        j === unitIdx ||
        j === convIdx ||
        j === weightIdx ||
        j === stockNormMinIdx ||
        j === stockNormMaxIdx ||
        j === stockNormRangeIdx ||
        headerIsExcludedFromName(norm[j])
    }
    nameIdx = headers.findIndex((_, j) => !exclude[j])
    if (nameIdx < 0) nameIdx = 0
  }

  if (codeIdx < 0 && norm.length > 1) codeIdx = 1
  if (codeIdx === nameIdx && norm.length > 2) {
    codeIdx = norm.findIndex(
      (_, i) => i !== nameIdx && i !== priceIdx && i !== wholesalePriceIdx
    )
    if (codeIdx < 0) codeIdx = norm.findIndex((_, i) => i !== nameIdx)
  }

  const refined = refineBarcodeNameIndicesForSemicolon(headers, delim, barcodeIdx, nameIdx)
  barcodeIdx = refined.barcodeIdx
  nameIdx = refined.nameIdx

  if (shouldForceProductCodeColumnA(norm) && nameIdx !== 0) {
    codeIdx = 0
  }

  return {
    codeIdx,
    barcodeIdx,
    nameIdx,
    priceIdx,
    wholesalePriceIdx,
    costIdx,
    stockIdx,
    supplierIdx,
    brandIdx,
    linkIdx,
    baseGroupIdx,
    unitIdx,
    convIdx,
    weightIdx,
    stockNormMinIdx,
    stockNormMaxIdx,
    stockNormRangeIdx,
  }
}

/** Tên hiển thị: bỏ phần trùng mã, ký hiệu trong ngoặc đầu dòng nếu giống SKU. */
function cleanDisplayName(rawName, code) {
  let n = String(rawName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!n) return ''
  const c = String(code ?? '').trim()
  if (c) {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    n = n.replace(new RegExp(`^${esc}\\s*[-–—|:.]?\\s*`, 'i'), '')
    n = n.replace(new RegExp(`^\\[\\s*${esc}\\s*\\]\\s*`, 'i'), '')
    n = n.replace(new RegExp(`^\\(\\s*${esc}\\s*\\)\\s*`, 'i'), '')
  }
  n = n
    .replace(/^[[(][A-Za-z0-9._-]{1,24}[\])]\s*/, '')
    .trim()
  return n || String(rawName ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Chuẩn hóa ô tiền / số từ export Kiot (CSV thường phân tách `;`).
 * Định dạng phổ biến VN/EU: dấu chấm = nghìn, dấu phẩy = thập phân — ví dụ `60.000,0` → `60000`.
 * Dùng khi import CSV và khi ép kiểu gửi lên Supabase (`gia_ban`, `gia_von`, `gia_si`, …).
 * @returns {number}
 */
export function parsePrice(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return 0
  s = s.replace(/\s/g, '').replace(/đ/gi, '')
  const negative = /^-/.test(s)
  s = s.replace(/^-/, '')
  const cleaned = s.replace(/[^\d.,]/g, '')
  if (!cleaned) return 0

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized = cleaned
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    const after = cleaned.slice(lastComma + 1)
    if (/^\d{1,2}$/.test(after)) {
      normalized = cleaned.replace(/,/g, '.')
    } else {
      normalized = cleaned.replace(/,/g, '')
    }
  } else if (lastDot >= 0) {
    const after = cleaned.slice(lastDot + 1)
    if (/^\d{1,2}$/.test(after)) {
      normalized = cleaned
    } else {
      normalized = cleaned.replace(/\./g, '')
    }
  }

  const n = parseFloat(normalized)
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

/**
 * Số tồn từ ô CSV (cùng quy tắc thập phân / nghìn như {@link parsePrice}, ví dụ `1.234,5` kg).
 * Ô trống → `null`. Dùng cho `ton_kho` khi đồng bộ `public.products`.
 */
export function parseStockQty(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = parsePrice(s)
  if (!Number.isFinite(n)) return null
  return n
}

/** Một ô "30 - 999.999" định mức tồn (KiotViet). */
function parseStockNormRangeFromCell(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { min: null, max: null }
  const parts = s.split(/\s*[-–—]\s*/)
  if (parts.length >= 2) {
    const a = parsePrice(parts[0].replace(/\s/g, ''))
    const b = parsePrice(parts.slice(1).join('-').replace(/\s/g, ''))
    return {
      min: Number.isFinite(a) ? a : null,
      max: Number.isFinite(b) ? b : null,
    }
  }
  const n = parsePrice(s.replace(/\s/g, ''))
  return { min: Number.isFinite(n) ? n : null, max: null }
}

/**
 * Chuỗi đang gõ ô SL: chỉ chữ số + thập phân; , → .; gộp .. ; chỉ một dấu . thập phân; .5 → 0.5
 */
function sanitizeCartQtyTyping(raw) {
  let s = String(raw ?? '').replace(/\s/g, '')
  s = s.replace(/[^\d.,]/g, '')
  s = s.replace(/,/g, '.')
  s = s.replace(/\.{2,}/g, '.')
  const di = s.indexOf('.')
  if (di >= 0) {
    const head = s.slice(0, di + 1)
    const tail = s.slice(di + 1).replace(/\./g, '')
    s = head + tail
  }
  if (s.startsWith('.')) s = `0${s}`
  return s
}

/** Hiển thị SL khi không đang sửa (vi-VN: thường dấu phẩy thập phân). */
function formatCartQtyDisplay(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0'
  return x.toLocaleString('vi-VN', { maximumFractionDigits: 8, useGrouping: false })
}

/** Khi focus ô nhập: dùng dấu chấm để gõ tiếp thuận tiện. */
function numberToQtyDraftString(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return ''
  if (x === 0) return '0'
  if (Math.abs(x - Math.round(x)) < 1e-12) return String(Math.round(x))
  const s = String(x)
  if (s.includes('e') || s.includes('E')) {
    return String(Number(x.toFixed(8))).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  }
  return s
}

/** Số lượng dòng giỏ: cho phép thập phân, không âm. */
function parseQtyFromInput(raw) {
  const s = sanitizeCartQtyTyping(String(raw ?? '').trim())
  if (s === '' || s === '.') return 0
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function rowsToProducts(headerCells, dataRows, delim = '', importBaseMs, importOpts = {}) {
  const {
    codeIdx,
    barcodeIdx,
    nameIdx,
    priceIdx,
    wholesalePriceIdx,
    costIdx,
    stockIdx,
    supplierIdx,
    brandIdx,
    linkIdx,
    baseGroupIdx,
    unitIdx,
    convIdx,
    weightIdx,
    stockNormMinIdx,
    stockNormMaxIdx,
    stockNormRangeIdx,
  } = detectColumns(headerCells, dataRows, delim, importOpts)
  const baseMs = typeof importBaseMs === 'number' && Number.isFinite(importBaseMs) ? importBaseMs : Date.now()
  return dataRows.map((cells, rowIndex) => {
    let code = String(cells[codeIdx >= 0 ? codeIdx : 0] ?? '').trim()
    const barcodeRaw = barcodeIdx >= 0 ? cells[barcodeIdx] : ''
    const barcode = String(normalizeBarcodeValue(barcodeRaw))
    if (codeIdx < 0 && barcodeIdx >= 0 && barcode) code = barcode
    const nameRaw = String(cells[nameIdx >= 0 ? nameIdx : 0] ?? '').trim()
    const name = cleanDisplayName(nameRaw, code)
    const priceRaw = priceIdx >= 0 ? cells[priceIdx] : ''
    const price = parsePrice(priceRaw)
    const wholesaleRaw = wholesalePriceIdx >= 0 ? cells[wholesalePriceIdx] : ''
    const wholesalePrice = parsePrice(wholesaleRaw)
    const costRaw = costIdx >= 0 ? cells[costIdx] : ''
    const cost = parsePrice(costRaw)
    const stockRaw = stockIdx >= 0 ? cells[stockIdx] : ''
    const stockQty = stockIdx >= 0 ? parseStockQty(stockRaw) : null
    const supplierRaw = supplierIdx >= 0 ? cells[supplierIdx] : ''
    const supplier = String(supplierRaw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const brandRaw = brandIdx >= 0 ? cells[brandIdx] : ''
    const brand = String(brandRaw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const linkedMasterCode = linkIdx >= 0 ? String(cells[linkIdx] ?? '').trim() : ''
    const baseGroupCode = baseGroupIdx >= 0 ? String(cells[baseGroupIdx] ?? '').trim() : ''
    const L = EXCEL_CATALOG_UNIT_COLUMN_INDEX_L
    const unitCell =
      importOpts.excelUnitFromColumnL === true && cells.length > L
        ? cells[L]
        : unitIdx >= 0
          ? cells[unitIdx]
          : ''
    const unitLabel = normalizeCatalogUnitLabel(unitCell)
    const convRawStr = readQuyDoiRawForCatalogCells(cells, importOpts, convIdx)
    const conversion = parseConversionRatio(convRawStr)
    maybeLogCatalogQuyDoiColumnN({
      importOpts,
      rowIndex,
      code,
      cells,
      convParsed: conversion,
      convIdx,
      delim,
    })
    const weightRaw =
      weightIdx >= 0
        ? String(cells[weightIdx] ?? '')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : ''
    let stockNormMin = null
    let stockNormMax = null
    if (stockNormMinIdx >= 0 || stockNormMaxIdx >= 0) {
      const rawMin = stockNormMinIdx >= 0 ? cells[stockNormMinIdx] : ''
      const rawMax = stockNormMaxIdx >= 0 ? cells[stockNormMaxIdx] : ''
      stockNormMin = parseStockQty(rawMin)
      stockNormMax = parseStockQty(rawMax)
    } else if (stockNormRangeIdx >= 0) {
      const r0 = parseStockNormRangeFromCell(cells[stockNormRangeIdx])
      stockNormMin = r0.min
      stockNormMax = r0.max
    }
    const id = `${rowIndex}-${code || 'row'}`
    return {
      id,
      code,
      barcode,
      name,
      nameRaw,
      price,
      wholesalePrice,
      cost,
      stockQty,
      supplier,
      brand,
      linkedMasterCode,
      baseGroupCode,
      unitLabel,
      conversion,
      ...(conversion != null ? { conversionValue: conversion } : {}),
      weightRaw,
      stockNormMin,
      stockNormMax,
      createdAtMs: baseMs + rowIndex,
      raw: cells,
    }
  })
}

function convSortKeyRow(row) {
  const raw = row?.conversionValue ?? row?.conversion
  const c = raw != null && raw !== '' ? Number(raw) : NaN
  if (Number.isFinite(c) && c > 0) return c
  return 1
}

/**
 * Gom các dòng phẳng cùng tên hàng hoặc cùng "Mã ĐVT cơ bản" thành một nhóm (một gốc — nhiều ĐVT).
 * Giữ nguyên nhóm đã có cột Liên kết Kiot (linkedMasterCode).
 */
export function mergeFlatCatalogRowsBySmartUomGroups(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return flat
  const getBucket = (r) => {
    const link = String(r.linkedMasterCode || '').trim()
    if (link) return { mode: 'kiot', key: normalizeHeaderCell(link) }
    const bg = String(r.baseGroupCode || '').trim()
    if (bg) return { mode: 'smart', key: `bg:${normalizeHeaderCell(bg)}` }
    const nk = normalizeHeaderCell(String(r.name || '').trim())
    if (nk) return { mode: 'smart', key: `nm:${nk}` }
    return { mode: 'smart', key: `id:${r.id}` }
  }
  const groups = new Map()
  for (const r of flat) {
    const b = getBucket(r)
    const gk = `${b.mode}|${b.key}`
    if (!groups.has(gk)) groups.set(gk, [])
    groups.get(gk).push(r)
  }
  const out = []
  for (const [, g] of groups) {
    if (g.length === 1) {
      const { baseGroupCode: _bg, ...rest } = g[0]
      out.push(rest)
      continue
    }
    const mode = getBucket(g[0]).mode
    if (mode === 'kiot') {
      for (const r of g) {
        const { baseGroupCode: _bg, ...rest } = r
        out.push(rest)
      }
      continue
    }
    const sorted = [...g].sort((a, b) => {
      const d = convSortKeyRow(a) - convSortKeyRow(b)
      if (d !== 0) return d
      return String(a.code).localeCompare(String(b.code), 'vi')
    })
    const root = sorted[0]
    const masterLink =
      String(root.code || '').trim() ||
      `grp-${String(root.id || 'x')
        .replace(/\s/g, '')
        .slice(0, 24)}`
    for (const x of sorted) {
      const { baseGroupCode: _bg, ...rest } = x
      out.push({ ...rest, linkedMasterCode: masterLink })
    }
  }
  return out
}

export function parseCsvTextToDisplayCatalog(text, fileName = '') {
  __quyDoiLogCount = 0
  const lines = splitLines(text).filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { error: 'File trống hoặc không có nội dung.', products: [], rowCount: 0, fileName }
  }
  const delim = detectDelimiter(lines[0])
  const headerCells0 = parseDelimitedLine(lines[0], delim)
  const minCols = Math.max(
    headerCells0.length,
    EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N + 1,
    EXCEL_CATALOG_UNIT_COLUMN_INDEX_L + 1,
    EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T + 1,
  )
  const headerCells = padCatalogCellRow(headerCells0, minCols)
  const dataLines = lines.slice(1)
  if (dataLines.length === 0) {
    return { error: 'CSV chỉ có dòng tiêu đề, chưa có sản phẩm.', products: [], rowCount: 0, fileName }
  }
  const kiotSemicolon = delim === ';'
  const dataRows = dataLines.map((line) => padCatalogCellRow(parseDelimitedLine(line, delim), minCols))
  const importBaseMs = Date.now()
  const flat = rowsToProducts(headerCells, dataRows, delim, importBaseMs, {
    excelUnitFromColumnL: kiotSemicolon,
    excelQuyDoiFromColumnN: kiotSemicolon,
    excelWholesaleFromColumnT: kiotSemicolon,
    debugCatalogQuyDoiN: kiotSemicolon && CATALOG_IMPORT_DEV,
  })
  const merged = mergeFlatCatalogRowsBySmartUomGroups(flat)
  inferAndWarnBulkQuyDoi(merged)
  const products = buildDisplayCatalog(merged)
  return { products, rowCount: dataRows.length, error: null, fileName }
}

function padExcelCatalogRow(r, nCols) {
  const row = Array.isArray(r) ? [...r] : []
  while (row.length < nCols) row.push('')
  return row.map((c) => {
    if (c == null || c === '') return ''
    if (typeof c === 'number' && Number.isFinite(c)) {
      if (Number.isInteger(c) && String(Math.abs(Math.trunc(c))).length > 12) return String(Math.trunc(c))
      return String(c)
    }
    return String(c).trim()
  })
}

/** Đọc đúng ô cột L (0-based) từ worksheet — tránh mất chuỗi dùng chung / dòng thưa khi chỉ dùng sheet_to_json. */
function readSheetColumnLUnit(ws, sheetRow0Based) {
  if (!ws || sheetRow0Based < 0) return ''
  const addr = XLSX.utils.encode_cell({ r: sheetRow0Based, c: EXCEL_CATALOG_UNIT_COLUMN_INDEX_L })
  const cell = ws[addr]
  if (!cell || cell.t === 'z') return ''
  try {
    const s = XLSX.utils.format_cell(cell)
    return String(s ?? '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    if (cell.w != null)
      return String(cell.w)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (cell.v != null && cell.t !== 'e')
      return String(cell.v)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return ''
  }
}

/**
 * Đọc ô cột N (Quy đổi) từ worksheet .xlsx/.xls.
 * CSV dấu `;` không dùng hàm này: dùng `parseDelimitedLine` + `padCatalogCellRow` và `readQuyDoiRawForCatalogCells` (index 13).
 */
/** Đọc ô cột T (Giá sỉ) từ worksheet — cùng kiểu format ô với cột L. */
function readSheetColumnTWholesale(ws, sheetRow0Based) {
  if (!ws || sheetRow0Based < 0) return ''
  const addr = XLSX.utils.encode_cell({ r: sheetRow0Based, c: EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T })
  const cell = ws[addr]
  if (!cell || cell.t === 'z') return ''
  try {
    const s = XLSX.utils.format_cell(cell)
    return String(s ?? '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    if (cell.w != null)
      return String(cell.w)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (cell.v != null && cell.t !== 'e')
      return String(cell.v)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return ''
  }
}

function readSheetColumnNQuyDoi(ws, sheetRow0Based) {
  if (!ws || sheetRow0Based < 0) return ''
  const addr = XLSX.utils.encode_cell({ r: sheetRow0Based, c: EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N })
  const cell = ws[addr]
  if (!cell || cell.t === 'z') return ''
  try {
    const s = XLSX.utils.format_cell(cell)
    return String(s ?? '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    if (cell.w != null)
      return String(cell.w)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    if (cell.v != null && cell.t !== 'e')
      return String(cell.v)
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return ''
  }
}

/**
 * Đọc Excel từ ArrayBuffer (cột L ĐVT + cột N Quy đổi) — dùng trên main thread hoặc Web Worker.
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} [fileName]
 */
export function parseExcelCatalogArrayBuffer(arrayBuffer, fileName = '') {
  const importBaseMs = Date.now()
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sn0 = wb.SheetNames[0]
  if (!sn0) return { error: 'File Excel không có sheet.', products: [], rowCount: 0, fileName }
  const ws = wb.Sheets[sn0]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  if (!rows.length) return { error: 'Sheet trống.', products: [], rowCount: 0, fileName }
  const nColsRaw = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 0)
  const nCols = Math.max(
    nColsRaw,
    EXCEL_CATALOG_UNIT_COLUMN_INDEX_L + 1,
    EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N + 1,
    EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T + 1
  )
  const headerCells = padExcelCatalogRow(rows[0], nCols)
  const dataRows = rows
    .slice(1)
    .map((r, idx) => {
      const pad = padExcelCatalogRow(r, nCols)
      const sheetRow0 = idx + 1
      pad[EXCEL_CATALOG_UNIT_COLUMN_INDEX_L] = readSheetColumnLUnit(ws, sheetRow0)
      pad[EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N] = readSheetColumnNQuyDoi(ws, sheetRow0)
      pad[EXCEL_CATALOG_WHOLESALE_PRICE_COLUMN_INDEX_T] = readSheetColumnTWholesale(ws, sheetRow0)
      return pad
    })
    .filter((cells) => cells.some((c) => String(c).trim() !== ''))
  if (dataRows.length === 0) {
    return {
      error: 'Sheet chỉ có tiêu đề, chưa có dòng dữ liệu.',
      products: [],
      rowCount: 0,
      fileName,
    }
  }
  __quyDoiLogCount = 0
  const flat = rowsToProducts(headerCells, dataRows, '', importBaseMs, {
    excelUnitFromColumnL: true,
    excelQuyDoiFromColumnN: true,
    excelWholesaleFromColumnT: true,
    debugCatalogQuyDoiN: CATALOG_IMPORT_DEV,
  })
  const merged = mergeFlatCatalogRowsBySmartUomGroups(flat)
  inferAndWarnBulkQuyDoi(merged)
  const products = buildDisplayCatalog(merged)
  return { products, rowCount: dataRows.length, error: null, fileName }
}

/** Nhập CSV hoặc Excel (.xlsx / .xls) trên main thread — cùng logic cột ĐVT với màn Bán hàng. */
export async function parseCatalogBlobOnMainThread(file) {
  const fileName = file?.name || ''
  const ext = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase()

  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer()
    return parseExcelCatalogArrayBuffer(buf, fileName)
  }

  const text = String(await file.text()).replace(/^\uFEFF/, '')
  return parseCsvTextToDisplayCatalog(text, fileName)
}

export { normalizeHeaderCell, normalizeBarcodeValue }
