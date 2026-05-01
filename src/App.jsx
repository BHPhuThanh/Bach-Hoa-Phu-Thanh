import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import {
  BHPHUTHANH_SEMICOLON_CSV_DVT_INDEX,
  BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX,
} from './kiotProductSchema.js'
import {
  POS_SESSION_DRAFT_VERSION,
  buildCatalogFingerprint,
  clearPosSessionDraft,
  loadPosSessionDraft,
  savePosSessionDraft,
  sellOrdersHaveAnyCartLines,
} from './posSessionDraft.js'
import {
  E_INVOICE_TEMPLATE_CODE,
  loadEInvoiceSettings,
  saveEInvoiceSettings,
} from './eInvoiceSettings.js'
import {
  getAdminOrdersAbsUrl,
  getAdminReturnOrderAbsUrl,
  getDoanhThuAbsUrl,
  readStoredSellerId,
  writeStoredSellerId,
} from './sellerRoleStorage.js'
import { usePrintReceiptIframe } from './usePrintReceiptIframe.js'
import AdminHub from './AdminHub.jsx'
import {
  parseAdminHubDeepLinkFromWindow,
  parseAhOpenProductVariantIdFromLocation,
  parseHangHoaGoodsOpenFromLocation,
  pathnameHasHangHoaDeepLink,
  stripAdminHubDeepLinkParamsFromWindow,
  stripAhOpenProductHashFromLocation,
} from './adminHubDeepLink.js'
import { pathnameOpensHubStandaloneDashboard } from './adminHubPathSync.js'

const HANG_HOA_PENDING_SS_KEY = 'csv-preview-pending-hang-hoa-open-v1'
import { getAllOrders, saveOrder } from './ordersDb.js'
import {
  aggregateCodeQtyFromOrders,
  scoreCatalogProduct,
  sortProductsBySales,
} from './sellFrequency.js'
import { buildK80ReceiptHtml, formatInvoiceNo } from './receiptHtml.js'
import { parseCatalogBlobFile } from './catalogParseClient.js'
import {
  buildPosTextSearchScanList,
  filterCatalogByQuery,
  forceRebuildSearchCache,
  getCatalogSearchQueryParts,
  POS_SUGGEST_ROW_CAP,
  prepareCatalogForPosSearch,
  rankProductNameSearchMatch,
  resolvePosSuggestCatalog,
  sortCatalogProductsByQuery,
  strictLongNumericBarcodeQuery,
  variantDisplayMatchesPosKeywords,
} from './catalogSearchSimple.js'
import {
  EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N,
  EXCEL_CATALOG_UNIT_COLUMN_INDEX_L,
  buildDisplayCatalog,
  catalogQuyDoiFactorToBase,
  headerIsConversionColumn,
  headerIsLinkedMasterColumn,
  headerIsUnitColumn,
  normalizeCatalogSearchCompactKey,
  normalizeCatalogUnitLabel,
  normalizeGroupRoot,
  parseConversionRatio,
  pickUnitColumnIndex,
  shouldForceProductCodeColumnA,
  trimCatalogUnitLabel,
} from './productUnits.js'
import {
  CATALOG_SNAPSHOT_STORAGE_KEY,
  CATALOG_SYNC_BUMP_KEY,
  applyProductDataToCatalog,
  fetchProducts,
  persistCatalogSnapshotAndProducts,
  readCatalogSnapshotSync,
  revalidateCatalogFromStore,
} from './catalogRepository.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import { runStoreDataBootstrap } from './storeBootstrap.js'
import {
  getComboBom,
  isComboCatalogProduct,
  mergeCartLineStockIntoDeltaMap,
  salableComboPackCount,
} from './comboCatalog.js'

/**
 * Tách một dòng CSV/delimited, hỗ trợ dấu ngoặc kép và ký tự phân cách tùy chọn (, hoặc ;).
 */
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

/** Cột không dùng làm tên (nhóm, ghi chú, mã, giá, ĐƠN VỊ TÍNH…). */
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

/** Đơn giá bán: bật sỉ thì lấy cột T (giá sỉ), trống = 0 — không fallback giá lẻ. */
function effectiveSellUnitPrice(variant, wholesaleMode) {
  const retail = Number(variant?.price) || 0
  if (!wholesaleMode) return retail
  const w = Number(variant?.wholesalePrice)
  if (Number.isFinite(w)) return Math.max(0, w)
  return 0
}

/**
 * Đơn giá vốn (cột E) — luôn dùng cho tiền vốn / LN, kể cả khi bán sỉ (đơn giá bán vẫn là T qua effectiveSellUnitPrice).
 */
function effectivePosCostUnit(variant, _wholesaleMode) {
  return Number(variant?.cost) || 0
}

/**
 * Danh sách ĐƠN VỊ TÍNH/biến thể cho POS: ưu tiên groupVariants; nếu có mảng `units` / `conversions`
 * (cùng state sản phẩm) thì dùng khi chưa gom đủ nhóm — khớp mục Hàng hóa.
 */
function getProductVariantRowsForPos(product) {
  if (!product) return []
  const gv = Array.isArray(product.groupVariants) ? product.groupVariants : []
  if (gv.length >= 2) return gv

  const mapAltRows = (arr, prefix) => {
    if (!Array.isArray(arr) || arr.length < 2) return null
    return arr.map((u, i) => {
      const rawC =
        u.conversionValue ??
        u.conversion ??
        u.toBase ??
        u.ratio ??
        u.factor ??
        u.heSoQuyDoi ??
        u.quyDoi
      const conv = parseConversionRatio(rawC != null ? String(rawC) : '') ?? 1
      return {
        ...product,
        ...u,
        id: u.id != null ? u.id : `${prefix}-${String(product.id ?? 'p')}-${i}`,
        code: String(u.code ?? product.code ?? '').trim(),
        unitLabel: normalizeCatalogUnitLabel(u.unitLabel ?? u.label ?? u.unit ?? u.toUnit ?? ''),
        conversion: conv,
        conversionValue: u.conversionValue ?? u.conversion ?? conv,
      }
    })
  }

  const fromUnits = mapAltRows(product.units, 'u')
  if (fromUnits) return fromUnits
  const fromConv = mapAltRows(product.conversions, 'c')
  if (fromConv) return fromConv
  if (gv.length === 1) return gv
  return [product]
}

/**
 * Hệ số quy đổi về đơn vị cơ bản (tồn / POS): ưu tiên `conversionValue` rồi `conversion` (cột Quy đổi);
 * chỉ dùng alias (heSoQuyDoi…) khi hai trường trên trống hoặc không parse được.
 */
function effectiveConversionForVariant(v) {
  if (!v) return 1
  const primary = v.conversionValue ?? v.conversion
  const hasPrimary = primary != null && !(typeof primary === 'string' && !String(primary).trim())
  if (hasPrimary) {
    const n =
      typeof primary === 'number' && Number.isFinite(primary) && primary > 0
        ? primary
        : parseConversionRatio(String(primary))
    if (n != null && n > 0) return n
  }
  const raw = v.heSoQuyDoi ?? v.quyDoi ?? v.toBase ?? v.ratio ?? v.factor
  if (raw == null || (typeof raw === 'string' && !String(raw).trim())) return 1
  const n2 = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : parseConversionRatio(String(raw))
  if (Number.isFinite(n2) && n2 > 0) return n2
  return 1
}

/** Biến thể có hệ số quy đổi tối thiểu trong nhóm — tồn kho cơ sở POS. */
function baseVariantForProduct(p) {
  const vars = getProductVariantRowsForPos(p)
  if (!vars.length) return null
  let best = vars[0]
  let bestC = catalogQuyDoiFactorToBase(best)
  for (let i = 1; i < vars.length; i++) {
    const vi = vars[i]
    const c = catalogQuyDoiFactorToBase(vi)
    if (c < bestC) {
      bestC = c
      best = vi
    }
  }
  return best
}

/**
 * Số lượng bán theo ĐƠN VỊ TÍNH hiện tại → số đơn vị cơ bản cần trừ khỏi tồn của biến thể cơ sở.
 * @returns {{ baseVariantId: string, basePieces: number }}
 */
function basePiecesSoldForCartLine(products, line) {
  const qty = Number(line.qty)
  if (!Number.isFinite(qty) || qty <= 0) {
    return { baseVariantId: String(line.variantId ?? ''), basePieces: 0 }
  }
  const vid = line.variantId
  if (vid == null || String(vid).length === 0) {
    return { baseVariantId: '', basePieces: 0 }
  }
  for (const p of products) {
    for (const v of getProductVariantRowsForPos(p)) {
      if (String(v.id) !== String(vid)) continue
      const base = baseVariantForProduct(p)
      const cv = catalogQuyDoiFactorToBase(v)
      const cb = catalogQuyDoiFactorToBase(base)
      return { baseVariantId: String(base.id), basePieces: qty * (cv / cb) }
    }
  }
  return { baseVariantId: String(vid), basePieces: qty }
}

/** SL có thể bán theo ĐƠN VỊ TÍNH (từ tồn đơn vị cơ sở), hoặc tồn riêng biến thể nếu không có tồn cơ sở. */
function salableQtyInVariantUnitsForPos(products, product, variant) {
  if (product && isComboCatalogProduct(product)) {
    return salableComboPackCount(products, getComboBom(product))
  }
  const vars = getProductVariantRowsForPos(product)
  const base = baseVariantForProduct(product)
  const baseQ = base?.stockQty
  if (baseQ != null && Number.isFinite(Number(baseQ)) && vars.length > 1) {
    const cv = catalogQuyDoiFactorToBase(variant)
    const cb = catalogQuyDoiFactorToBase(base)
    const ratio = cv / cb
    if (ratio > 0) return Math.floor(Number(baseQ) / ratio + 1e-9)
  }
  const vs = variant?.stockQty
  if (vs != null && Number.isFinite(Number(vs))) return Number(vs)
  if (baseQ != null && Number.isFinite(Number(baseQ))) return Math.floor(Number(baseQ) + 1e-9)
  return null
}

/** Tồn kho hiển thị trên thẻ (đa ĐƠN VỊ TÍNH: lấy tồn đơn vị cơ sở; combo = số gói bán được theo BOM). */
function catalogStockLabel(products, p) {
  if (p && isComboCatalogProduct(p)) {
    return salableComboPackCount(products, getComboBom(p))
  }
  const vars = getProductVariantRowsForPos(p)
  if (vars.length > 1) {
    const base = baseVariantForProduct(p)
    const q = base?.stockQty
    if (q != null && Number.isFinite(Number(q))) return Number(q)
    return null
  }
  const rep = p?.stockQty
  if (rep != null && Number.isFinite(Number(rep))) return Number(rep)
  let sum = 0
  let n = 0
  for (const v of vars) {
    const q = v.stockQty
    if (q != null && Number.isFinite(Number(q))) {
      sum += Number(q)
      n += 1
    }
  }
  if (n > 0) return sum
  return null
}

/** Cột giá vốn (KiotViet: Giá vốn; tiếng Anh: cost). */
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
  let brandIdx = -1
  let linkIdx = -1
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
  unitIdx = pickUnitColumnIndex(norm)
  if (importOpts.excelUnitFromColumnL === true) {
    const L = EXCEL_CATALOG_UNIT_COLUMN_INDEX_L
    if (
      norm.length > L &&
      headerIsUnitColumn(norm[L]) &&
      !headerIsConversionColumn(norm[L])
    ) {
      unitIdx = L
    }
  }
  if (importOpts.excelQuyDoiFromColumnN === true) {
    const N = EXCEL_CATALOG_QUY_DOI_COLUMN_INDEX_N
    if (norm.length > N && headerIsConversionColumn(norm[N])) {
      convIdx = N
    }
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
    brandIdx,
    linkIdx,
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

/** Chuẩn hóa chuỗi giá: 10.000 / 10,000 (nghìn), 1.234,56 / 1,234.56 (thập phân). */
function parsePrice(raw) {
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

/** Số tồn kho từ ô CSV (hỗ trợ thập phân, ví dụ cân ký). */
function parseStockQty(raw) {
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

/** SL hiển thị / tính tiền: ưu tiên chuỗi đang gõ trong ô (draft), chưa blur vẫn cập nhật Thành tiền & tổng. */
function effectiveCartLineQty(line, cartQtyDraftByLine) {
  const draft = cartQtyDraftByLine[line.lineId]
  if (draft === undefined) return Math.max(0, Number(line.qty) || 0)
  return parseQtyFromInput(String(draft))
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
    brandIdx,
    linkIdx,
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
    const brandRaw = brandIdx >= 0 ? cells[brandIdx] : ''
    const brand = String(brandRaw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const linkedMasterCode = linkIdx >= 0 ? String(cells[linkIdx] ?? '').trim() : ''
    const bhSemiFixed =
      delim === ';' && cells.length > BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX
    const unitCellRaw = bhSemiFixed
      ? cells[BHPHUTHANH_SEMICOLON_CSV_DVT_INDEX]
      : unitIdx >= 0
        ? cells[unitIdx]
        : ''
    const convRaw = bhSemiFixed
      ? cells[BHPHUTHANH_SEMICOLON_CSV_QUY_DOI_INDEX]
      : convIdx >= 0
        ? cells[convIdx]
        : ''
    const unitLabel = normalizeCatalogUnitLabel(unitCellRaw)
    const dvt = trimCatalogUnitLabel(unitCellRaw)
    const conversion = parseConversionRatio(convRaw)
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
      brand,
      linkedMasterCode,
      unitLabel,
      dvt,
      conversion,
      weightRaw,
      stockNormMin,
      stockNormMax,
      createdAtMs: baseMs + rowIndex,
      raw: cells,
    }
  })
}

function newCartLineId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ln-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** Tham chiếu ổn định — không tạo `[]` mới mỗi render khi chưa có giỏ. */
const EMPTY_CART_LINES = []

function buildVariantOptionsFromProduct(p) {
  return getProductVariantRowsForPos(p).map((v) => ({
    id: v.id,
    code: v.code,
    name: String(v.name ?? '').trim(),
    unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
    price: Number(v.price) || 0,
    wholesalePrice: Number(v.wholesalePrice) || 0,
    cost: Number(v.cost) || 0,
    conversion: effectiveConversionForVariant(v),
    conversionValue: v.conversionValue,
    conversionHint: v.conversionHint || '',
  }))
}

/** Tìm đúng biến thể trong catalog theo variantId (id duy nhất từ CSV). */
function findCatalogVariantById(products, variantId) {
  const vid = String(variantId ?? '').trim()
  if (!vid || !Array.isArray(products)) return null
  for (const p of products) {
    const vars = getProductVariantRowsForPos(p)
    const v = vars.find((x) => String(x.id) === vid)
    if (v) return { product: p, variant: v }
  }
  return null
}

/** Sau nhập lại catalog: ưu tiên khớp variantId + catalogId; tên luôn lấy từ biến thể gốc trong catalog. */
function remapCartLineFromCatalog(line, products, wholesaleMode) {
  if (!line || !Array.isArray(products) || products.length === 0) return line

  const vid = String(line.variantId ?? '').trim()
  if (vid) {
    const hit = findCatalogVariantById(products, vid)
    if (hit) {
      const { product: p, variant: v } = hit
      const variantOptions = buildVariantOptionsFromProduct(p)
      const vo = variantOptions.find((o) => String(o.id) === vid) || variantOptions[0]
      const nextLine = {
        ...line,
        catalogId: p.id,
        variantId: v.id,
        groupRoot: p.groupRoot ?? p.code,
        code: vo.code,
        name: String(v.name ?? '').trim() || '—',
        price: effectiveSellUnitPrice(vo, wholesaleMode),
        cost: effectivePosCostUnit(vo, wholesaleMode),
        unitLabel: vo.unitLabel,
        conversionHint: vo.conversionHint || '',
        variantOptions,
      }
      if (isBatchIdValidForLine(products, nextLine)) return nextLine
      const d0 = pickDefaultBatchIdForLine(products, nextLine)
      const { selectedBatchId: _sb, ...rest } = nextLine
      return d0 ? { ...rest, selectedBatchId: d0 } : rest
    }
  }

  const code = String(line.code ?? '').trim()
  const name = String(line.name ?? '').trim()
  const groupRoot = String(line.groupRoot ?? '').trim()

  for (const p of products) {
    const vars = getProductVariantRowsForPos(p)
    const pRoot =
      String(p.groupRoot ?? '').trim() || normalizeGroupRoot(p.code, p.linkedMasterCode)
    if (groupRoot && pRoot !== groupRoot) continue
    for (const v of vars) {
      if (String(v.code ?? '').trim() !== code) continue
      if (vid && String(v.id) !== vid) continue
      const variantOptions = buildVariantOptionsFromProduct(p)
      const vo =
        variantOptions.find((o) => String(o.id) === String(line.variantId)) ||
        variantOptions.find((o) => String(o.code ?? '').trim() === code) ||
        variantOptions[0]
      const nextLine = {
        ...line,
        catalogId: p.id,
        variantId: vo.id,
        code: vo.code,
        name: String(v.name ?? '').trim() || '—',
        price: effectiveSellUnitPrice(vo, wholesaleMode),
        cost: effectivePosCostUnit(vo, wholesaleMode),
        unitLabel: vo.unitLabel,
        conversionHint: vo.conversionHint || '',
        variantOptions,
      }
      if (isBatchIdValidForLine(products, nextLine)) return nextLine
      const d0 = pickDefaultBatchIdForLine(products, nextLine)
      const { selectedBatchId: _sb, ...rest } = nextLine
      return d0 ? { ...rest, selectedBatchId: d0 } : rest
    }
  }

  for (const p of products) {
    if (String(p.name ?? '').trim() !== name) continue
    const vars = getProductVariantRowsForPos(p)
    const v = code ? vars.find((x) => String(x.code ?? '').trim() === code) : vars[0]
    if (!v) continue
    const variantOptions = buildVariantOptionsFromProduct(p)
    const vo = variantOptions.find((o) => String(o.id) === String(v.id)) || variantOptions[0]
    const nextLine = {
      ...line,
      catalogId: p.id,
      variantId: vo.id,
      code: vo.code,
      name: String(v.name ?? '').trim() || '—',
      price: effectiveSellUnitPrice(vo, wholesaleMode),
      cost: effectivePosCostUnit(vo, wholesaleMode),
      unitLabel: vo.unitLabel,
      conversionHint: vo.conversionHint || '',
      variantOptions,
    }
    if (isBatchIdValidForLine(products, nextLine)) return nextLine
    const d0 = pickDefaultBatchIdForLine(products, nextLine)
    const { selectedBatchId: _sb, ...rest } = nextLine
    return d0 ? { ...rest, selectedBatchId: d0 } : rest
  }

  return line
}

function findProductByCatalogId(products, catalogId) {
  const id = String(catalogId ?? '').trim()
  if (!id || !products?.length) return null
  return products.find((p) => String(p.id) === id) ?? null
}

/** Khớp nhóm hàng cho dòng giỏ (catalogId đôi khi lệch snapshot — fallback theo variantId / groupRoot). */
function findProductForCartLine(products, line) {
  if (!products?.length || !line) return null
  const byId = findProductByCatalogId(products, line.catalogId)
  if (byId) return byId
  const lineCode = String(line.code ?? '').trim()
  if (lineCode) {
    for (const p of products) {
      const vars = getProductVariantRowsForPos(p)
      if (vars.some((v) => String(v.code ?? '').trim() === lineCode)) return p
    }
  }
  const vid = String(line.variantId ?? '').trim()
  if (vid) {
    for (const p of products) {
      const vars = getProductVariantRowsForPos(p)
      if (vars.some((v) => String(v.id) === vid)) return p
    }
  }
  const gr = String(line.groupRoot ?? '').trim()
  if (gr) {
    for (const p of products) {
      const pRoot =
        String(p.groupRoot ?? '').trim() || normalizeGroupRoot(String(p.code ?? ''), String(p.linkedMasterCode ?? ''))
      if (pRoot === gr) return p
    }
  }
  return null
}

function productHasMultiUnitForPos(p) {
  if (!p) return false
  if (p.multiUnit === true) return true
  const vars = getProductVariantRowsForPos(p)
  return vars.length > 1
}

/** Dòng giỏ có nhiều ĐƠN VỊ TÍNH (ưu tiên variantOptions trên dòng — vẫn đúng khi snapshot catalog lệch). */
function cartLineShowsMultiUnitToggle(products, line) {
  if ((line?.variantOptions?.length ?? 0) > 1) return true
  return productHasMultiUnitForPos(findProductForCartLine(products, line))
}

function formatConvQtyForHint(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x <= 0) return ''
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x))
  let s = x.toFixed(6).replace(/(\.\d*?)0+$/, '$1')
  if (s.endsWith('.')) s = s.slice(0, -1)
  return s
}

/**
 * Hàng ĐƠN VỊ TÍNH: đồng bộ với POS — `groupVariants` (≥2) trước; không thì `product.units`; còn lại getProductVariantRowsForPos.
 */
function getProductUnitOrVariantRows(product) {
  if (!product) return []
  const gv = Array.isArray(product.groupVariants) ? product.groupVariants : []
  if (gv.length >= 2) return gv

  const units = product.units
  if (Array.isArray(units) && units.length > 0) {
    return units.map((u, i) => ({
      ...product,
      ...u,
      id: u.id != null ? u.id : `unit-${String(product.id ?? 'p')}-${i}`,
      code: String(u.code ?? product.code ?? '').trim(),
      name: String(u.name ?? u.productName ?? product.name ?? '').trim(),
      unitLabel: normalizeCatalogUnitLabel(u.unitLabel ?? u.label ?? u.unit ?? u.toUnit ?? ''),
      conversionValue: u.conversionValue ?? u.conversion,
      conversion: u.conversion ?? u.conversionValue,
    }))
  }
  return getProductVariantRowsForPos(product)
}

/** Đơn vị gốc: Quy đổi = 1; nếu không có thì hệ số nhỏ nhất trong nhóm (theo conversionValue / conversion). */
function findBaseUnitRowFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const exact = rows.find((r) => Math.abs(catalogQuyDoiFactorToBase(r) - 1) < 1e-9)
  if (exact) return exact
  return [...rows].sort((a, b) => catalogQuyDoiFactorToBase(a) - catalogQuyDoiFactorToBase(b))[0]
}

function resolveCartLineVariantRow(product, line) {
  if (!product || !line) return null
  const rows = getProductUnitOrVariantRows(product)
  const vid = String(line.variantId ?? '')
  let v = rows.find((r) => String(r.id) === vid)
  if (!v && Array.isArray(line.variantOptions)) {
    const o = line.variantOptions.find((x) => String(x.id) === vid)
    if (o) {
      v = rows.find(
        (r) =>
          String(r.code ?? '').trim() === String(o.code ?? '').trim() &&
          normalizeCatalogUnitLabel(r.unitLabel) === normalizeCatalogUnitLabel(o.unitLabel)
      )
    }
  }
  if (!v) {
    const c = String(line.code ?? '').trim()
    if (c) v = rows.find((r) => String(r.code ?? '').trim() === c) ?? null
  }
  return v
}

/** Dòng catalog hoặc option trên giỏ — đủ conversionValue / conversion để hiển thị Quy đổi. */
function resolveCartLineVariantRowOrFallback(product, line) {
  const fromCat = resolveCartLineVariantRow(product, line)
  if (fromCat) return fromCat
  const vo = line?.variantOptions?.find((o) => String(o.id) === String(line?.variantId))
  if (!vo) return null
  return {
    ...vo,
    conversionValue: vo.conversionValue ?? vo.conversion,
    conversion: vo.conversion ?? vo.conversionValue,
  }
}

/**
 * Biến thể catalog có cùng giá trị cột CSV `ma_hh_lien_quan` (field JSON `linkedMasterCode`).
 */
function collectVariantsSharingMaHhLienQuan(products, linkKey) {
  const k = String(linkKey ?? '').trim()
  if (!k) return []
  const seen = new Set()
  const out = []
  for (const p of products || []) {
    const vars = getProductVariantRowsForPos(p)
    for (const v of vars) {
      if (String(v?.linkedMasterCode ?? '').trim() !== k) continue
      const id = String(v?.id ?? '')
      if (id) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      out.push(v)
    }
  }
  return out
}

/** ≥ 2 SKU cùng `ma_hh_lien_quan` → hiện «Xem chi tiết …» mở modal nhóm quy đổi. */
function cartLineHasMaHhLienConversionGroup(products, line) {
  const p = findProductForCartLine(products, line)
  const v = resolveCartLineVariantRowOrFallback(p, line)
  const lk = String(v?.linkedMasterCode ?? '').trim()
  if (!lk) return false
  return collectVariantsSharingMaHhLienQuan(products, lk).length >= 2
}

function cartLineQuyDoiFactor(products, line) {
  if (!line) return 1
  const p = findProductForCartLine(products, line)
  const v = resolveCartLineVariantRowOrFallback(p, line)
  const n = effectiveConversionForVariant(v || line)
  return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 1
}

/**
 * Inline Tab Bán: dưới tên (mã + tên đơn vị nhỏ nhất); số = SL * conversionValue (cột N / Hàng hóa) của đơn vị đang bán.
 * Khong tra ve khi conversionValue ~ 1 (khong can quy doi).
 */
function buildCartConversionExpansionModel(products, line, cartQtyDraftByLine) {
  if (!cartLineShowsMultiUnitToggle(products, line)) return null
  const p = findProductForCartLine(products, line)
  if (!p || !line) return null
  const rows = getProductUnitOrVariantRows(p)
  if (rows.length < 2) return null
  const baseProd = baseVariantForProduct(p)
  const baseById = baseProd ? rows.find((r) => String(r.id) === String(baseProd.id)) : null
  const base = baseById ?? findBaseUnitRowFromRows(rows)
  const cur = resolveCartLineVariantRowOrFallback(p, line)
  if (!base || !cur) return null
  const convFactor = catalogQuyDoiFactorToBase(cur)
  if (!Number.isFinite(convFactor) || convFactor <= 0) return null
  if (Math.abs(convFactor - 1) < 1e-9) return null
  const qtyRaw = effectiveCartLineQty(line, cartQtyDraftByLine)
  const qty = Number(qtyRaw)
  const qtySafe = Number.isFinite(qty) && qty >= 0 ? qty : 0
  const n = qtySafe * convFactor
  const numStr =
    qtySafe === 0 && Math.abs(n) < 1e-9
      ? '0'
      : formatConvQtyForHint(n) || (Math.abs(n) < 1e-9 ? '0' : '')
  if (!numStr) return null
  const baseCode = String(base.code ?? '').trim() || '—'
  const baseName =
    String(base.name ?? base.nameRaw ?? p.name ?? p.nameRaw ?? '')
      .replace(/\s+/g, ' ')
      .trim() || String(p.name ?? '').trim() || '—'
  return { baseCode, baseName, qtyDisplay: numStr }
}

/** Hiển thị cell modal nhóm `ma_hh_lien_quan` — field CSV `dvt` / `quy_doi` / `gia_ban`. */
function posMaHhModalDvtCell(v) {
  const t = String(v?.dvt ?? '').trim()
  return t ? normalizeCatalogUnitLabel(t) : normalizeCatalogUnitLabel(v?.unitLabel)
}

function posMaHhModalQuyCell(v) {
  const n = catalogQuyDoiFactorToBase(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n))
  return formatConvQtyForHint(n) || String(n)
}

function posMaHhModalGiaBanCell(v) {
  const n = Number(v?.price)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('vi-VN')} đ`
}

/** Sản phẩm / biến thể có bật quản lý HSD (POS). */
function variantTracksExpiryForPos(v) {
  if (!v) return false
  if (v.manageBatchExpiry === true) return true
  if (String(v.lotExpiryYmd ?? '').trim()) return true
  return false
}

function parseBatchExpirySortKey(ymd) {
  const s = String(ymd ?? '').trim()
  if (!s) return Number.POSITIVE_INFINITY
  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) {
    const y = Number(digits.slice(0, 4))
    const mo = Number(digits.slice(4, 6)) - 1
    const d = Number(digits.slice(6, 8))
    const t = Date.UTC(y, mo, d)
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/**
 * Lô bán hàng: ưu tiên mảng stockBatches; không có thì gỡ từ lotExpiryYmd + tồn (một lô ảo).
 * Sắp xếp HSD gần nhất trước (ngày nhỏ → lớn).
 */
function normalizePosBatchesSorted(variant) {
  const raw = variant?.stockBatches
  if (Array.isArray(raw) && raw.length > 0) {
    const rows = raw.map((b, i) => ({
      batchId: String(b.batchId ?? b.id ?? `lot-${i}`).trim() || `lot-${i}`,
      expiryYmd: String(b.expiryYmd ?? b.expiry ?? b.hsdYmd ?? '').trim(),
      qty: Math.max(0, Number(b.qty ?? b.stockQty ?? b.quantity) || 0),
    }))
    return rows.sort((a, b) => parseBatchExpirySortKey(a.expiryYmd) - parseBatchExpirySortKey(b.expiryYmd))
  }
  const ymd = String(variant?.lotExpiryYmd ?? '').trim()
  if (!ymd) return []
  const qty = Math.max(0, Number(variant?.stockQty) || 0)
  return [{ batchId: '__default_lot', expiryYmd: ymd, qty }]
}

/** Biến thể đang giữ danh sách lô cho POS (ưu tồn cơ bản nếu có HSD). */
function getPosBatchOwnerVariant(p, lineVariantId) {
  const vars = p?.groupVariants || [p]
  const cur = vars.find((x) => String(x.id) === String(lineVariantId)) || vars[0]
  const base = baseVariantForProduct(p)
  if (!cur || !base) return null
  const baseTr = variantTracksExpiryForPos(base)
  const curTr = variantTracksExpiryForPos(cur)
  const baseHas = baseTr && normalizePosBatchesSorted(base).length > 0
  const curHas = curTr && normalizePosBatchesSorted(cur).length > 0
  if (baseTr && baseHas) return base
  if (curTr && curHas) return cur
  if (baseTr) return base
  if (curTr) return cur
  return null
}

function resolveLineBatchContext(products, line) {
  const p = findProductForCartLine(products, line)
  if (!p) return null
  const owner = getPosBatchOwnerVariant(p, line.variantId)
  if (!owner) return null
  const batches = normalizePosBatchesSorted(owner)
  if (!batches.length) return null
  const base = baseVariantForProduct(p)
  const useBasePieces = String(owner.id) === String(base?.id)
  return { product: p, owner, batches, useBasePieces }
}

function cartLineNeedsBatchSelection(products, line) {
  return resolveLineBatchContext(products, line) != null
}

function pickDefaultBatchIdForLine(products, line) {
  const ctx = resolveLineBatchContext(products, line)
  if (!ctx || ctx.batches.length !== 1) return null
  return ctx.batches[0].batchId
}

function batchDeductQtyForLine(products, line) {
  const ctx = resolveLineBatchContext(products, line)
  if (!ctx) return 0
  const qty = Math.max(0, Number(line.qty) || 0)
  if (!Number.isFinite(qty) || qty <= 0) return 0
  if (ctx.useBasePieces) return basePiecesSoldForCartLine(products, line).basePieces
  return qty
}

function isBatchIdValidForLine(products, line) {
  const b = String(line?.selectedBatchId ?? '').trim()
  if (!b) return false
  const ctx = resolveLineBatchContext(products, line)
  return !!ctx?.batches.some((x) => x.batchId === b)
}

function formatExpiryYmdVi(ymd) {
  const s = String(ymd ?? '').trim()
  const d = s.replace(/\D/g, '')
  if (d.length === 8) {
    return `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`
  }
  return s || '—'
}

/** Thứ tự hiển thị lô (1…n) theo danh sách đã sắp HSD — dùng trong bảng chọn lô và ghi chú giỏ. */
function batchDisplayOrdinal(sortedBatches, batchId) {
  const i = sortedBatches.findIndex((b) => b.batchId === batchId)
  return i >= 0 ? i + 1 : null
}

function newSellOrderId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Bảng hướng dẫn phím tắt (modal « Phím tắt »). */
const POS_SHORTCUTS_HELP_ROWS = [
  { id: 'f1', key: 'F1', desc: 'Thanh toán — in hóa đơn và làm mới đơn hàng' },
  { id: 'f2', key: 'F2', desc: 'Nhảy vào ô Tiền khách đưa (cột tóm tắt tiền phía dưới)' },
  { id: 'f3', key: 'F3', desc: 'Ô tìm sản phẩm / quét mã vạch (thanh trên)' },
  { id: 'f10', key: 'F10', desc: 'Tìm khách hàng (ô tìm / tạo khách — cột phải thanh toán)' },
  { id: 'f4', key: 'F4', desc: 'Mở đơn hàng mới (thêm tab hóa đơn)' },
  { id: 'f6', key: 'F6', desc: 'Focus ô Giảm giá (cột thanh toán)' },
  {
    id: 'f11',
    key: 'F11',
    desc:
      'Admin: mở báo cáo Doanh thu trên tab trình duyệt mới (tab bán hàng giữ nguyên). Nhân viên: bật / tắt menu gợi ý quét mã vạch.',
  },
  {
    id: 'altf11',
    key: 'Alt+F11',
    desc: 'Chỉ Admin khi đang Bán hàng: bật / tắt menu quét mã (F11 dành cho Doanh thu).',
  },
  {
    id: 'home',
    key: 'Home',
    desc: 'Focus ô SL của dòng đang được chọn (viền xanh); bôi đen số để gõ mới',
  },
  {
    id: 'cart-arrows',
    key: '↑ / ↓ (ô SL giỏ)',
    desc: 'Di chuyển giữa các dòng; ô số lượng dòng mới được focus và bôi đen',
  },
  {
    id: 'cart-pg',
    key: 'PgUp / PgDn (ô SL)',
    desc: 'Tăng / giảm 1 đơn vị số lượng tại dòng đang chọn (không đổi dòng)',
  },
  {
    id: 'hdr-arrows',
    key: '↑ / ↓ (gợi ý ô tìm)',
    desc: 'Khi danh sách gợi ý mở: chọn dòng trên / dưới',
  },
  {
    id: 'esc',
    key: 'Esc',
    desc:
      'Đóng bảng Phím tắt / menu quét / chọn ĐƠN VỊ TÍNH; thoát ô nhập (blur), bỏ khung chọn dòng giỏ, xóa ô tìm và focus ô tìm để quét mã tiếp',
  },
]

const POS_CUSTOMERS_STORAGE_KEY = 'csv-preview-pos-customers-v1'

function loadStoredCustomers() {
  try {
    const raw = localStorage.getItem(POS_CUSTOMERS_STORAGE_KEY)
    const j = raw ? JSON.parse(raw) : []
    if (!Array.isArray(j)) return []
    return j
      .filter((c) => c && typeof c.name === 'string')
      .map((c) => ({
        name: String(c.name || '').trim(),
        phone: String(c.phone || '').trim(),
      }))
      .filter((c) => c.name)
  } catch {
    return []
  }
}

function saveStoredCustomers(list) {
  try {
    localStorage.setItem(POS_CUSTOMERS_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function formatPosSidebarClock(d) {
  const pad = (n) => String(n).padStart(2, '0')
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  return `${t} - ${date}`
}

const POS_SELLER_ACCOUNTS = [
  { id: 'admin', label: 'Admin — Chủ cửa hàng' },
  { id: 'staff', label: 'Nhân viên bán hàng' },
]

function createEmptySellOrder() {
  return {
    id: newSellOrderId(),
    cart: [],
    orderDiscountStr: '',
    cashGivenStr: '',
    customerName: '',
    customerPhone: '',
    customerQuery: '',
    orderNote: '',
  }
}

/**
 * Khôi phục sellOrders từ JSON đã lưu; khớp variant theo id hoặc (mã + ĐƠN VỊ TÍNH).
 * Giá / variantOptions lấy lại từ catalog hiện tại theo chế độ sỉ.
 */
function rehydrateSellOrdersFromSnapshot(products, rawOrders, wholesaleMode) {
  if (!products?.length || !Array.isArray(rawOrders) || rawOrders.length === 0) return null

  function findProductVariantForLine(line) {
    const vid = line?.variantId
    if (vid != null && String(vid).length > 0) {
      for (const p of products) {
        const vars = getProductVariantRowsForPos(p)
        const v = vars.find((x) => String(x.id) === String(vid))
        if (v) return { product: p, variant: v }
      }
    }
    const code = String(line?.code ?? '').trim()
    const ul = String(line?.unitLabel ?? '').trim()
    for (const p of products) {
      const vars = p.groupVariants || [p]
      const v = vars.find(
        (x) =>
          String(x.code ?? '').trim() === code &&
          String(x.unitLabel ?? '').trim() === ul
      )
      if (v) return { product: p, variant: v }
    }
    return null
  }

  const hydrated = rawOrders.map((o) => {
    const id =
      typeof o.id === 'string' && o.id.trim().length > 0 ? o.id.trim() : newSellOrderId()
    const cart = []
    for (const line of o.cart || []) {
      const hit = findProductVariantForLine(line)
      if (!hit) continue
      const { product, variant } = hit
      const variantOptions = buildVariantOptionsFromProduct(product)
      const unitPrice = effectiveSellUnitPrice(variant, wholesaleMode)
      const qtyRaw = Number(line.qty)
      const qty = Number.isFinite(qtyRaw) && qtyRaw >= 0 ? qtyRaw : 0
      const lid =
        typeof line.lineId === 'string' && line.lineId.length >= 8
          ? line.lineId
          : newCartLineId()
      const selBatch = String(line?.selectedBatchId ?? '').trim()
      const lineStub = { catalogId: product.id, variantId: variant.id, qty, selectedBatchId: selBatch }
      const batchOk = selBatch && isBatchIdValidForLine(products, lineStub)
      const defaultBatch = pickDefaultBatchIdForLine(products, { catalogId: product.id, variantId: variant.id, qty })
      cart.push({
        lineId: lid,
        catalogId: product.id,
        variantId: variant.id,
        groupRoot: product.groupRoot ?? product.code,
        code: variant.code,
        name: product.name,
        price: unitPrice,
        cost: effectivePosCostUnit(variant, wholesaleMode),
        unitLabel: variant.unitLabel,
        conversionHint: variant.conversionHint || '',
        qty,
        variantOptions,
        ...(batchOk ? { selectedBatchId: selBatch } : defaultBatch ? { selectedBatchId: defaultBatch } : {}),
      })
    }
    return {
      id,
      cart,
      orderDiscountStr: String(o.orderDiscountStr ?? ''),
      cashGivenStr: String(o.cashGivenStr ?? ''),
      customerName: String(o.customerName ?? ''),
      customerPhone: String(o.customerPhone ?? ''),
      customerQuery: String(o.customerQuery ?? ''),
      orderNote: String(o.orderNote ?? ''),
    }
  })

  if (!hydrated.some((o) => o.cart.length > 0)) return null
  return { orders: hydrated }
}

/** Trừ tồn kho catalog theo số lượng bán (đa ĐƠN VỊ TÍNH: trừ theo đơn vị cơ sở); trừ thêm từng lô nếu có stockBatches. */
function applySoldQtyToCatalog(products, cartLines) {
  if (!products?.length || !cartLines?.length) return products
  const deltaBaseByVid = new Map()
  for (const l of cartLines) {
    mergeCartLineStockIntoDeltaMap(products, l, deltaBaseByVid)
  }

  /** @type {Map<string, Map<string, number>>} */
  const batchDecByVariantId = new Map()
  for (const l of cartLines) {
    const bid = String(l.selectedBatchId ?? '').trim()
    if (!bid) continue
    const ctx = resolveLineBatchContext(products, l)
    if (!ctx) continue
    const batchesArr = ctx.owner.stockBatches
    if (!Array.isArray(batchesArr) || batchesArr.length === 0) continue
    const q = batchDeductQtyForLine(products, l)
    if (q <= 0) continue
    const vid = String(ctx.owner.id)
    if (!batchDecByVariantId.has(vid)) batchDecByVariantId.set(vid, new Map())
    const m = batchDecByVariantId.get(vid)
    m.set(bid, (m.get(bid) || 0) + q)
  }

  if (deltaBaseByVid.size === 0 && batchDecByVariantId.size === 0) return products
  const flat = []
  for (const p of products) {
    for (const v of p.groupVariants || [p]) {
      const sold = deltaBaseByVid.get(v.id) || 0
      let nextStock = v.stockQty
      if (sold > 0) {
        const cur = nextStock != null && Number.isFinite(Number(nextStock)) ? Number(nextStock) : 0
        nextStock = cur - sold
      }
      let nextBatches = v.stockBatches
      const decMap = batchDecByVariantId.get(String(v.id))
      if (decMap && Array.isArray(v.stockBatches) && v.stockBatches.length > 0) {
        nextBatches = v.stockBatches.map((b) => {
          const id = String(b.batchId ?? b.id ?? '').trim()
          const dq = decMap.get(id) || 0
          const curQ = Math.max(0, Number(b.qty ?? b.stockQty) || 0)
          return { ...b, qty: Math.max(0, curQ - dq) }
        })
      }
      flat.push({ ...v, stockQty: nextStock, stockBatches: nextBatches })
    }
  }
  return prepareCatalogForPosSearch(buildDisplayCatalog(flat))
}

/** Số nguyên VN: phần nghìn bằng dấu chấm (50.000). */
function formatVnDots(n) {
  const x = Math.floor(Number(n))
  if (!Number.isFinite(x)) return '0'
  const sign = x < 0 ? '-' : ''
  const abs = Math.abs(x)
  return sign + String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Hiển thị SL / tồn (có thể thập phân). */
function formatQtyOrStockVi(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '0'
  if (Math.abs(x - Math.round(x)) < 1e-9) return formatVnDots(Math.round(x))
  return x.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 6 })
}

function parseVnIntMoney(str) {
  const d = String(str ?? '').replace(/\D/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

/** Ô tiền: chỉ chữ số → hiển thị có dấu chấm phần nghìn. */
function formatCashInputFromRaw(raw) {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return ''
  const n = parseInt(d, 10)
  if (!Number.isFinite(n)) return ''
  return formatVnDots(n)
}

/** Giảm giá: số tiền (có dấu chấm) hoặc % (vd. 10%). */
function formatDiscountInputChange(raw) {
  const r = String(raw ?? '')
  const pctIdx = r.indexOf('%')
  if (pctIdx >= 0) {
    const before = r.slice(0, pctIdx).replace(/[^\d.,\s]/g, '')
    return `${before.trim()}%`
  }
  return formatCashInputFromRaw(r)
}

function parseDiscountApplied(orderDiscountStr, total) {
  const s = String(orderDiscountStr ?? '').trim()
  if (!s) return 0
  const t = Math.max(0, Number(total) || 0)
  if (/%/.test(s)) {
    const before = s.split('%')[0].trim().replace(/\s/g, '').replace(',', '.')
    const num = parseFloat(before)
    if (!Number.isFinite(num) || num < 0) return 0
    const applied = Math.round((t * num) / 100)
    return Math.min(Math.max(0, applied), t)
  }
  const amount = parseVnIntMoney(s)
  return Math.min(Math.max(0, amount), t)
}

const QUICK_CASH_AMOUNTS = [100_000, 200_000, 400_000, 500_000]

/** Khớp mã / mã vạch chính xác với một dòng catalog (kể cả ĐƠN VỊ TÍNH). */
function findCatalogRowByCodeOrScan(products, raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  const n = normalizeHeaderCell(trimmed)
  for (const p of products) {
    const variants = p.groupVariants || [p]
    for (const v of variants) {
      const c = String(v.code ?? '').trim()
      if (!c) continue
      if (normalizeHeaderCell(c) === n || c === trimmed) {
        return { product: p, variantId: v.id }
      }
    }
  }
  return null
}

/** Cột Mã vạch trong CSV có dữ liệu — ô trống không tham gia quét / khớp mã vạch. */
function variantHasCsvBarcode(v) {
  return String(normalizeBarcodeValue(v.barcode ?? '')).length > 0
}

/** Hệ số quy đổi dùng khi chọn ĐƠN VỊ TÍNH: null coi như đơn vị cơ bản (1). */
function effectiveConversionForBarcodePick(v) {
  return effectiveConversionForVariant(v)
}

/** Ưu tiên Gói/Bịch… trước Thùng/Lốc khi cùng một mã vạch. */
function unitLabelBulkSortKey(unitLabel) {
  const u = stripAccents(String(unitLabel ?? '').toLowerCase()).replace(/\s+/g, ' ').trim()
  if (u.includes('thung')) return 2
  if (u.includes('loc')) return 2
  return 0
}

function compareVariantsForSharedBarcodePick(va, vb) {
  const ca = effectiveConversionForBarcodePick(va)
  const cb = effectiveConversionForBarcodePick(vb)
  if (ca !== cb) return ca - cb
  const ba = unitLabelBulkSortKey(va.unitLabel)
  const bb = unitLabelBulkSortKey(vb.unitLabel)
  if (ba !== bb) return ba - bb
  return String(va.code).localeCompare(String(vb.code))
}

function sortBarcodeHitsForPick(hits) {
  hits.sort((a, b) => {
    const ta = Number(a.variant.createdAtMs) || 0
    const tb = Number(b.variant.createdAtMs) || 0
    if (tb !== ta) return tb - ta
    const d = String(b.variant.code || '').localeCompare(String(a.variant.code || ''), 'vi')
    if (d !== 0) return d
    return compareVariantsForSharedBarcodePick(a.variant, b.variant)
  })
}

/**
 * Bộ nhớ đệm mã vạch theo catalog đã nạp (parse CSV một lần; quét chỉ tra Map).
 * @returns {{ bestByKey: Map<string, { product: object, variantId: string }>, productsByKey: Map<string, object[]> }}
 */
function buildCatalogBarcodeCaches(products) {
  const bestByKey = new Map()
  const productsByKey = new Map()
  if (!products?.length) return { bestByKey, productsByKey }

  const hitsByKey = new Map()
  for (const p of products) {
    const variants = p.groupVariants || [p]
    for (const v of variants) {
      if (!variantHasCsvBarcode(v)) continue
      const k = String(normalizeBarcodeValue(v.barcode ?? ''))
      if (!k) continue
      let arr = hitsByKey.get(k)
      if (!arr) {
        arr = []
        hitsByKey.set(k, arr)
      }
      arr.push({ product: p, variant: v })
    }
  }

  for (const [k, hits] of hitsByKey) {
    if (hits.length > 1) {
      const brief = hits
        .map((h) => `${String(h.variant.code || '—')}: ${String(h.variant.name || h.product.name || '')}`)
        .join(' · ')
      console.warn(
        `[Bán hàng] Trùng mã vạch "${k}" (${hits.length} dòng). Ưu tiên dòng sau cùng trong file (SKU/mã hàng mới hơn). Chi tiết: ${brief}`
      )
    }
    const dedupe = new Map()
    for (const h of hits) {
      dedupe.set(h.product.id, h.product)
    }
    productsByKey.set(k, [...dedupe.values()])

    const ranked = [...hits]
    sortBarcodeHitsForPick(ranked)
    bestByKey.set(k, { product: ranked[0].product, variantId: ranked[0].variant.id })
  }
  return { bestByKey, productsByKey }
}

/** Tra mã vạch O(1) từ bộ đệm buildCatalogBarcodeCaches. */
function findProductByBarcodeCached(caches, raw) {
  const keyStr = String(normalizeBarcodeValue(raw))
  if (!keyStr) return null
  return caches.bestByKey.get(keyStr) ?? null
}

/**
 * Chỉ tên trên object biến thể được truyền vào — không đọc `product.name` hay bất kỳ tên ngoài nào.
 */
function displayNameForCartVariant(_product, variant) {
  return String(variant?.name ?? '').trim() || '—'
}

/**
 * Số dòng trên sheet CSV (1 = tiêu đề, 2 = dòng dữ liệu đầu) — id phẳng dạng `rowIndex-code`.
 * @returns {number | null}
 */
function csvSheetRow1BasedFromVariant(variant) {
  const idStr = String(variant?.id ?? '')
  const dash = idStr.indexOf('-')
  if (dash <= 0) return null
  const rowIdx = parseInt(idStr.slice(0, dash), 10)
  if (!Number.isFinite(rowIdx) || rowIdx < 0) return null
  return rowIdx + 2
}

function buildBarcodeScanLogContext(hit, raw) {
  if (!hit?.product) return null
  const needle = String(normalizeBarcodeValue(raw))
  const vars = hit.product.groupVariants || [hit.product]
  let v = vars.find((x) => String(x.id) === String(hit.variantId))
  if (!v) v = vars[0]
  if (needle && v && String(normalizeBarcodeValue(v.barcode ?? '')) !== needle) {
    v = vars.find((x) => String(normalizeBarcodeValue(x.barcode ?? '')) === needle) || v
  }
  return v ? { product: hit.product, variant: v } : null
}

function nameMatchRankForQuery(p, rawQuery) {
  return rankProductNameSearchMatch(p, rawQuery)
}

function compareForNamedSearch(a, b, rawQuery, codeQty) {
  const qa = nameMatchRankForQuery(a, rawQuery)
  const qb = nameMatchRankForQuery(b, rawQuery)
  if (qb !== qa) return qb - qa
  const sa = scoreCatalogProduct(a, codeQty)
  const sb = scoreCatalogProduct(b, codeQty)
  if (sb !== sa) return sb - sa
  return String(a.name || '').localeCompare(String(b.name || ''), 'vi')
}

function sortProductsBySearchQuery(products, raw, codeQty) {
  const q = String(raw ?? '').trim()
  if (!q) return sortProductsBySales(products, codeQty)
  if (!strictLongNumericBarcodeQuery(q)) return sortCatalogProductsByQuery(products, raw, codeQty)
  const needle = String(normalizeBarcodeValue(q))
  const hasExactBarcodeInList = products.some((p) =>
    (p.groupVariants || [p]).some(
      (v) =>
        variantHasCsvBarcode(v) && String(normalizeBarcodeValue(v.barcode ?? '')) === needle
    )
  )
  if (hasExactBarcodeInList) return sortProductsBySales(products, codeQty)
  /** Chuỗi dạng mã vạch mà không khớp cột Mã vạch — không sắp xếp theo tên/mã hàng. */
  return []
}

function bestBarcodeMatchRank(p, needleNorm) {
  const needleStr = String(needleNorm ?? '')
  if (needleStr.length === 0) return 0
  for (const v of p.groupVariants || [p]) {
    if (!variantHasCsvBarcode(v)) continue
    const bcStr = String(normalizeBarcodeValue(v.barcode ?? ''))
    if (bcStr === needleStr) return 2
  }
  return 0
}

/**
 * Chuỗi kiểu mã vạch: ưu tiên khớp cột Mã vạch (===), không có mới gợi ý theo tên/mã.
 * @param {Map<string, object[]>|null} productsByBarcodeKey — từ buildCatalogBarcodeCaches; bỏ qua thì duyệt full catalog.
 */
function filterProductsByQuickQuery(products, raw, productsByBarcodeKey = null) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return []

  if (strictLongNumericBarcodeQuery(trimmed)) {
    const needleStr = String(normalizeBarcodeValue(trimmed))
    let byBarcode = null
    if (productsByBarcodeKey) {
      byBarcode = productsByBarcodeKey.get(needleStr)
    }
    if (!byBarcode) {
      byBarcode = []
      for (const p of products) {
        const vars = p.groupVariants || [p]
        const hit = vars.some((v) => {
          if (!variantHasCsvBarcode(v)) return false
          return String(normalizeBarcodeValue(v.barcode ?? '')) === needleStr
        })
        if (hit) byBarcode.push(p)
      }
    }
    if (byBarcode.length > 0) return byBarcode
    return []
  }

  return filterCatalogByQuery(products, raw)
}

function variantMatchesBarcodeQuery(variant, q) {
  const needle = String(normalizeBarcodeValue(q))
  if (!needle) return true
  if (!variantHasCsvBarcode(variant)) return false
  return String(normalizeBarcodeValue(variant.barcode ?? '')) === needle
}

/** Dòng gợi ý POS: `variantOptions` chỉ khi gộp nhiều ĐƠN VỊ TÍNH; chọn ĐƠN VỊ TÍNH qua state map theo product.id. */
function resolveHeaderSuggestVariant(row, pickMap) {
  const opts = row.variantOptions
  const fallback = row.variant
  if (!opts || opts.length <= 1) return fallback
  const pid = String(row.product?.id ?? '')
  const vid = pickMap?.[pid]
  return opts.find((o) => String(o.id) === String(vid)) || fallback
}

/** Mỗi dòng gợi ý = một mặt hàng (dropdown ĐƠN VỊ TÍNH nếu đa đơn vị), đã sắp bán chạy. */
function buildHeaderSuggestRows(
  products,
  posScanList,
  codeQty,
  queryRaw,
  productsByBarcodeKey = null
) {
  const q = String(queryRaw ?? '').trim()
  const catalogList = resolvePosSuggestCatalog({
    products,
    posScanList,
    rawQuery: queryRaw,
    productsByBarcodeKey,
  })
  const { keywords, searchInput: posSearchInputClean } = getCatalogSearchQueryParts(q)
  const catalogHasExactBarcodeHit =
    q.trim() &&
    strictLongNumericBarcodeQuery(q) &&
    catalogList.some((p) =>
      getProductVariantRowsForPos(p).some((v) => variantMatchesBarcodeQuery(v, q))
    )
  const sorted = q
    ? catalogHasExactBarcodeHit
      ? [...catalogList].sort((a, b) => {
          const needle = String(normalizeBarcodeValue(q))
          const na = bestBarcodeMatchRank(a, needle)
          const nb = bestBarcodeMatchRank(b, needle)
          if (nb !== na) return nb - na
          if (na === 2 && nb === 2) {
            const sa = scoreCatalogProduct(a, codeQty)
            const sb = scoreCatalogProduct(b, codeQty)
            if (sb !== sa) return sb - sa
          }
          return compareForNamedSearch(a, b, q, codeQty)
        })
      : sortCatalogProductsByQuery(catalogList, q, codeQty)
    : catalogList
  const rows = []
  const rowCap = POS_SUGGEST_ROW_CAP
  for (const p of sorted) {
    if (rows.length >= rowCap) break
    const vars = getProductVariantRowsForPos(p)
    const barcodeQ = catalogHasExactBarcodeHit
    let matching = !q.trim()
      ? vars
      : barcodeQ
        ? vars.filter((v) => variantMatchesBarcodeQuery(v, q))
        : vars.filter((v) =>
            variantDisplayMatchesPosKeywords(v, p, keywords, posSearchInputClean)
          )
    if (matching.length === 0) continue

    const variantCount = vars.length || 1
    const isMultiUnit = variantCount > 1 || p.multiUnit === true
    /** Đa ĐƠN VỊ TÍNH: luôn tách từng dòng gợi ý (không gộp dropdown) để chọn nhanh. */
    const collapseMulti = !barcodeQ && !isMultiUnit && matching.length > 1

    if (collapseMulti) {
      const options = !q.trim() ? vars : matching
      const base = baseVariantForProduct(p)
      const def = options.find((o) => String(o.id) === String(base?.id)) || options[0]
      rows.push({ product: p, variant: def, variantOptions: options })
    } else {
      for (const v of matching) {
        if (rows.length >= rowCap) break
        rows.push({ product: p, variant: v, variantOptions: null })
      }
    }
  }
  return rows
}

/** Icon ô thao tác nhanh (SVG, contrast cao trên nền tối). */
function PosQuickDockIcon({ name, svgClassName }) {
  const common = {
    className: svgClassName ? `pos-quick-action-svg ${svgClassName}` : 'pos-quick-action-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
  }
  switch (name) {
    case 'service':
      return (
        <svg {...common}>
          <path
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'percent':
      return (
        <svg {...common}>
          <path
            d="M19 5L5 19M9.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm10 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'promo':
      return (
        <svg {...common}>
          <path
            d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'gift':
      return (
        <svg {...common}>
          <path
            d="M20 12v10H4V12M2 7h20v5H2V7zm12 0V5a2 2 0 1 0-4 0v2M12 22V7"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path
            d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'clipboard-list':
      return (
        <svg {...common}>
          <path
            d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9h6m-6 4h6m-6-8h6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'return':
      return (
        <svg {...common}>
          <path
            d="M3 7v6h6M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    default:
      return null
  }
}

/**
 * Khởi tạo đồng bộ từ URL: `/hang-hoa/...` → vào dashboard + pending mở Hàng hóa (không nháy tab Doanh thu).
 */
function getAppDeepLinkBootState() {
  if (typeof window === 'undefined') {
    return { initialActiveView: 'sell', initialHangHoaOpen: null }
  }
  let hang = parseHangHoaGoodsOpenFromLocation(window.location.pathname, window.location.search)
  if (!hang?.rawId) {
    try {
      const raw = sessionStorage.getItem(HANG_HOA_PENDING_SS_KEY)
      if (raw) {
        const j = JSON.parse(raw)
        if (j?.rawId) hang = { rawId: String(j.rawId).trim() }
      }
    } catch {
      /* ignore */
    }
  }
  if (hang?.rawId) {
    try {
      sessionStorage.setItem(HANG_HOA_PENDING_SS_KEY, JSON.stringify({ rawId: hang.rawId }))
    } catch {
      /* ignore */
    }
    return { initialActiveView: 'dashboard', initialHangHoaOpen: hang }
  }
  if (pathnameHasHangHoaDeepLink(window.location.pathname)) {
    return { initialActiveView: 'dashboard', initialHangHoaOpen: null }
  }
  if (pathnameOpensHubStandaloneDashboard(window.location.pathname)) {
    return { initialActiveView: 'dashboard', initialHangHoaOpen: null }
  }
  return { initialActiveView: 'sell', initialHangHoaOpen: null }
}

const APP_DEEP_LINK_BOOT = getAppDeepLinkBootState()

export default function App({ standaloneInboundCreate = false } = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const catalogBootRef = useRef(null)
  if (catalogBootRef.current === null) {
    catalogBootRef.current =
      readCatalogSnapshotSync() ?? { products: [], fileName: '', csvRowCount: 0 }
  }
  const catalogBoot = catalogBootRef.current
  const [fileName, setFileName] = useState(catalogBoot.fileName)
  const [csvRowCount, setCsvRowCount] = useState(catalogBoot.csvRowCount)
  const [products, setProducts] = useState(() =>
    prepareCatalogForPosSearch(catalogBoot.products)
  )
  const [error, setError] = useState('')
  const [sellOrders, setSellOrders] = useState(() => [createEmptySellOrder()])
  const [activeSellOrderId, setActiveSellOrderId] = useState(() => sellOrders[0].id)
  const [headerSearch, setHeaderSearch] = useState('')
  const [headerSearchInvalid, setHeaderSearchInvalid] = useState(false)
  const [headerSearchFeedback, setHeaderSearchFeedback] = useState('')
  const [lastBarcodeReceived, setLastBarcodeReceived] = useState('')
  const [posScanToast, setPosScanToast] = useState(null)
  const [headerSuggestOpen, setHeaderSuggestOpen] = useState(false)
  const [headerHighlightIndex, setHeaderHighlightIndex] = useState(0)
  /** Khi gợi ý gộp nhiều ĐƠN VỊ TÍNH: product.id → variantId đang chọn trong dropdown. */
  const [headerSuggestUnitPickByProductId, setHeaderSuggestUnitPickByProductId] = useState({})
  const [scannerMenuOpen, setScannerMenuOpen] = useState(false)
  const [activeView, setActiveView] = useState(() =>
    standaloneInboundCreate ? 'dashboard' : APP_DEEP_LINK_BOOT.initialActiveView
  )
  const [adminHubDeepLink, setAdminHubDeepLink] = useState(null)
  /** `/hang-hoa/...` hoặc hash legacy — mở tab Hàng hóa + dòng SP (một lần). */
  const [pendingHangHoaGoodsOpen, setPendingHangHoaGoodsOpen] = useState(() =>
    standaloneInboundCreate ? null : APP_DEEP_LINK_BOOT.initialHangHoaOpen
  )
  const [salesRefresh, setSalesRefresh] = useState(0)
  const [unitPickerProduct, setUnitPickerProduct] = useState(null)
  const [codeSalesMap, setCodeSalesMap] = useState({})
  /** Tab panel dưới cùng: thao tác nhanh | danh sách sản phẩm */
  const [posDockTab, setPosDockTab] = useState('products')
  const [posDockExpanded, setPosDockExpanded] = useState(true)
  const [returnPickModalOpen, setReturnPickModalOpen] = useState(false)
  const [returnPickModalLoading, setReturnPickModalLoading] = useState(false)
  const [returnPickModalOrders, setReturnPickModalOrders] = useState([])
  /** Dòng giỏ đang mở hộp thoại chọn lô / HSD */
  const [batchPickLineId, setBatchPickLineId] = useState(null)
  const [batchDraftId, setBatchDraftId] = useState(null)
  const [batchSearch, setBatchSearch] = useState('')
  /** Modal nhóm quy đổi theo «ma_hh_lien_quan» (CSV) — `groupProducts` = biến thể thu được từ danh mục. */
  const [posMaHhLienConvModal, setPosMaHhLienConvModal] = useState(null)
  /**
   * Giỏ hàng — ẩn/hiện dòng quy đổi theo từng dòng (lineId → boolean).
   * Thành phần A (link xanh) luôn hiện khi có đa ĐƠN VỊ TÍNH; bấm chỉ đảo `showConversion` cho dòng đó.
   * Thành phần B (chữ nhỏ) chỉ render khi `showConversion === true` cho lineId tương ứng.
   */
  const [showConversionByLineId, setShowConversionByLineId] = useState({})
  /** Dòng giỏ đang mở bảng ĐƠN VỊ TÍNH quy đổi nhanh */
  const discountInputRef = useRef(null)
  const cashGivenInputRef = useRef(null)
  const cartQtyInputRefs = useRef(new Map())
  const cartRef = useRef([])
  /** Cuộn dòng giỏ vào vùng nhìn (ô SL / hàng). */
  const scrollCartLineIntoView = useCallback((lineId) => {
    const run = () => {
      const input = cartQtyInputRefs.current.get(lineId)
      const row = input?.closest('tr')
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    requestAnimationFrame(run)
  }, [])
  const [selectedCartLineId, setSelectedCartLineId] = useState(null)
  /** Chuỗi đang gõ ô SL theo lineId (khi undefined → hiển thị formatCartQtyDisplay). */
  const [cartQtyDraftByLine, setCartQtyDraftByLine] = useState(() => ({}))
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const [eInvoiceSettings, setEInvoiceSettings] = useState(() => loadEInvoiceSettings())
  const [eInvoiceModalOpen, setEInvoiceModalOpen] = useState(false)
  const [eInvoiceModalDraft, setEInvoiceModalDraft] = useState(() => loadEInvoiceSettings())
  const [nowTick, setNowTick] = useState(() => new Date())
  /** Lần đầu: đang tải CSV mặc định từ `public` (ẩn màn “Chọn file” cho tới khi xong / lỗi). */
  const [initialCatalogLoadPending, setInitialCatalogLoadPending] = useState(
    !catalogBoot.products?.length
  )
  const [sellWholesaleMode, setSellWholesaleMode] = useState(false)
  const [activeSellerId, setActiveSellerId] = useState(
    () => readStoredSellerId() ?? 'admin'
  )
  const [sellerMenuOpen, setSellerMenuOpen] = useState(false)
  const [storedCustomers, setStoredCustomers] = useState(() => loadStoredCustomers())
  const [customerAddOpen, setCustomerAddOpen] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const headerSearchRef = useRef(null)
  const customerSearchRef = useRef(null)
  const sellerMenuRef = useRef(null)
  const headerSuggestWrapRef = useRef(null)
  const scannerMenuRef = useRef(null)
  const posScanToastClearRef = useRef(null)
  /** Tránh ghi đè LocalStorage trong lúc khôi phục nháp */
  const posDraftHydratingRef = useRef(false)
  /** Sau khi đọc xong IndexedDB (lần đầu) mới cho phép auto-save — tránh xóa DB khi state tạm []. */
  const [catalogStoreHydrated, setCatalogStoreHydrated] = useState(false)
  const catalogStoreHydratedRef = useRef(false)
  const initialCatalogLoadPendingRef = useRef(initialCatalogLoadPending)
  const catalogFileNameRef = useRef(fileName)
  catalogFileNameRef.current = fileName
  useEffect(() => {
    catalogStoreHydratedRef.current = catalogStoreHydrated
  }, [catalogStoreHydrated])
  useEffect(() => {
    initialCatalogLoadPendingRef.current = initialCatalogLoadPending
  }, [initialCatalogLoadPending])
  const [storeBootstrapBusy, setStoreBootstrapBusy] = useState(false)
  const [storeBootstrapHint, setStoreBootstrapHint] = useState('')
  const storeBootstrapAbortRef = useRef(null)
  /** Mỗi fingerprint catalog chỉ thử restore một lần */
  const lastCatalogFingerprintRef = useRef('')
  const { receiptIframeRef, printReceiptHtml } = usePrintReceiptIframe()
  const handleThanhToanRef = useRef(() => {})
  const productsRef = useRef([])
  const catalogImportInputRef = useRef(null)
  const globalScanBufferRef = useRef({ buf: '', times: [] })
  const addToCartForGlobalScanRef = useRef(() => {})
  const scanHeaderRef = useRef({
    setHeaderSearch: () => {},
    logBarcodeReceived: () => {},
    afterSuccessfulAdd: () => {},
    markBarcodeNotFound: () => {},
  })
  productsRef.current = products

  const fileNameRef = useRef(fileName)
  fileNameRef.current = fileName

  const catalogBarcodeCaches = useMemo(() => buildCatalogBarcodeCaches(products), [products])
  const catalogBarcodeCachesRef = useRef(catalogBarcodeCaches)
  catalogBarcodeCachesRef.current = catalogBarcodeCaches

  const catalogDataFingerprint = useMemo(
    () => (products.length ? buildCatalogFingerprint(products, fileName) : ''),
    [products, fileName]
  )

  const clearAdminHubDeepLink = useCallback(() => {
    setAdminHubDeepLink(null)
  }, [])

  const clearPendingHangHoaGoodsOpen = useCallback(() => {
    setPendingHangHoaGoodsOpen(null)
    try {
      sessionStorage.removeItem(HANG_HOA_PENDING_SS_KEY)
    } catch {
      /* ignore */
    }
    navigate('/', { replace: true })
    stripAhOpenProductHashFromLocation()
  }, [navigate])

  /** Hash `#doanh-thu` (legacy) → `/doanh-thu`. Ưu tiên deep link: không chạy khi pathname có `hang-hoa`. */
  useLayoutEffect(() => {
    if (pathnameHasHangHoaDeepLink(location.pathname)) return
    const hashRaw = (window.location.hash || '').replace(/^#/, '')
    if (!hashRaw) return
    const tail = hashRaw.split('/').filter(Boolean).pop() || ''
    if (tail !== 'doanh-thu' && !hashRaw.endsWith('doanh-thu')) return
    navigate('/doanh-thu', { replace: true })
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [location.pathname, location.search, navigate])

  useLayoutEffect(() => {
    let hang = parseHangHoaGoodsOpenFromLocation(location.pathname, location.search)
    if (!hang?.rawId) {
      try {
        const raw = sessionStorage.getItem(HANG_HOA_PENDING_SS_KEY)
        if (raw) {
          const j = JSON.parse(raw)
          if (j?.rawId) hang = { rawId: String(j.rawId).trim() }
        }
      } catch {
        /* ignore */
      }
    }
    if (hang?.rawId) {
      setActiveView('dashboard')
      setPendingHangHoaGoodsOpen(hang)
      try {
        sessionStorage.setItem(HANG_HOA_PENDING_SS_KEY, JSON.stringify({ rawId: hang.rawId }))
      } catch {
        /* ignore */
      }
      return
    }
    const legacyVid = parseAhOpenProductVariantIdFromLocation()
    if (legacyVid) {
      setActiveView('dashboard')
      setPendingHangHoaGoodsOpen({ rawId: legacyVid })
      try {
        sessionStorage.setItem(HANG_HOA_PENDING_SS_KEY, JSON.stringify({ rawId: legacyVid }))
      } catch {
        /* ignore */
      }
      return
    }
    if (pathnameHasHangHoaDeepLink(location.pathname)) {
      setActiveView('dashboard')
      return
    }
    const d = parseAdminHubDeepLinkFromWindow()
    if (d) {
      setActiveView('dashboard')
      setAdminHubDeepLink(d)
      stripAdminHubDeepLinkParamsFromWindow()
      return
    }
    if (pathnameOpensHubStandaloneDashboard(location.pathname)) {
      setActiveView('dashboard')
    }
  }, [location.pathname, location.search])

  /** Sau ghi Supabase: đọc lại DB (revalidate) để UI/POS khớp server — tránh cache client. */
  const applyServerCatalogAfterPersist = useCallback(async () => {
    if (!isSupabaseConfigured()) return
    const fresh = await revalidateCatalogFromStore()
    if (!fresh?.products?.length) return
    startTransition(() => {
      setProducts(prepareCatalogForPosSearch(fresh.products))
      setFileName(fresh.fileName)
      setCsvRowCount(fresh.csvRowCount)
      setSalesRefresh((x) => x + 1)
    })
  }, [])

  const handleRemoveCatalogVariants = useCallback((variantIds) => {
    if (!variantIds?.length) return
      setProducts((prev) => {
      const next = applyProductDataToCatalog(prev, { type: 'remove_variants', variantIds })
      queueMicrotask(() => {
        if (!catalogStoreHydratedRef.current || initialCatalogLoadPendingRef.current) return
        void (async () => {
          if (next.length === 0) {
            catalogFileNameRef.current = ''
            const persistEmpty = await persistCatalogSnapshotAndProducts([], '')
            setFileName('')
            setCsvRowCount(0)
            if (persistEmpty.ok) await applyServerCatalogAfterPersist()
            return
          }
          const r = await persistCatalogSnapshotAndProducts(next, catalogFileNameRef.current)
          if (r.ok) await applyServerCatalogAfterPersist()
        })()
      })
      return next
    })
  }, [applyServerCatalogAfterPersist])

  const handleReplaceCatalogGroup = useCallback((anchorVariantId, replacements) => {
    if (anchorVariantId == null || !Array.isArray(replacements) || replacements.length === 0) return
    setProducts((prev) => {
      const next = applyProductDataToCatalog(prev, {
        type: 'replace_group',
        anchorVariantId,
        replacements,
      })
      queueMicrotask(() => {
        if (!catalogStoreHydratedRef.current || initialCatalogLoadPendingRef.current) return
        void (async () => {
          const r = await persistCatalogSnapshotAndProducts(next, catalogFileNameRef.current)
          if (r.ok) await applyServerCatalogAfterPersist()
        })()
      })
      return next
    })
  }, [applyServerCatalogAfterPersist])

  const handleAppendCatalogVariants = useCallback((variants) => {
    if (!Array.isArray(variants) || variants.length === 0) return
    setProducts((prev) => {
      const next = applyProductDataToCatalog(prev, { type: 'append_flat_variants', variants })
      queueMicrotask(() => {
        if (!catalogStoreHydratedRef.current || initialCatalogLoadPendingRef.current) return
        void (async () => {
          const r = await persistCatalogSnapshotAndProducts(next, catalogFileNameRef.current, {
            upsertOnlyVariants: variants,
          })
          if (r.ok) await applyServerCatalogAfterPersist()
        })()
      })
      return next
    })
  }, [applyServerCatalogAfterPersist])

  const handleUpdateCatalogVariant = useCallback((variantId, patch) => {
    if (variantId == null || !patch || typeof patch !== 'object') return
    setProducts((prev) => {
      const next = applyProductDataToCatalog(prev, { type: 'patch_variant', variantId, patch })
      queueMicrotask(() => {
        if (!catalogStoreHydratedRef.current || initialCatalogLoadPendingRef.current) return
        void (async () => {
          const r = await persistCatalogSnapshotAndProducts(next, catalogFileNameRef.current)
          if (r.ok) await applyServerCatalogAfterPersist()
        })()
      })
      return next
    })
  }, [applyServerCatalogAfterPersist])

  /** Khởi động: khi có Supabase — chỉ tải từ Supabase (bảng `products` rồi `catalog_snapshots`). Không tự fetch `public/bhphuthanh.csv`. Đồng bộ CSV một lần: `npm run push-catalog` hoặc nút «KHỞI TẠO DỮ LIỆU CỬA HÀNG». */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snap = await fetchProducts()
        if (cancelled) return
        if (snap?.products?.length) {
          setInitialCatalogLoadPending(false)
          setProducts((prev) => {
            /* Có Supabase: luôn áp dữ liệu từ server khi boot (tránh state khởi tạo cũ / IDB che hàng mới sau F5). */
            if (!isSupabaseConfigured() && prev.length > 0) return prev
            queueMicrotask(() => {
              setFileName(snap.fileName)
              setCsvRowCount(snap.csvRowCount)
              setSalesRefresh((x) => x + 1)
            })
            return prepareCatalogForPosSearch(snap.products)
          })
        } else if (isSupabaseConfigured()) {
          setInitialCatalogLoadPending(false)
          setError((prev) =>
            prev ||
            'Danh mục trên Supabase đang trống. Đẩy dữ liệu từ file CSV trong repo một lần (máy dev): `npm run push-catalog` với SUPABASE_URL + khóa ghi được — hoặc bấm «KHỞI TẠO DỮ LIỆU CỬA HÀNG» để đẩy public/bhphuthanh.csv lên Supabase.'
          )
        } else {
          setInitialCatalogLoadPending(false)
          setError((prev) =>
            prev ||
            'Chưa cấu hình Supabase (VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY). Ứng dụng không còn tự tải file CSV mặc định; hãy cấu hình env và tải lại — hoặc dùng «Nhập CSV» để nạp thủ công (offline).'
          )
        }
      } finally {
        if (!cancelled) setCatalogStoreHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Tab khác (cùng origin): bump localStorage → đọc lại catalog (Supabase hoặc IndexedDB). */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.storageArea !== localStorage) return
      if (e.key !== CATALOG_SNAPSHOT_STORAGE_KEY && e.key !== CATALOG_SYNC_BUMP_KEY) return
      void (async () => {
        const snap = await fetchProducts()
        if (snap?.products?.length) {
          setProducts(prepareCatalogForPosSearch(snap.products))
          setFileName(snap.fileName)
          setCsvRowCount(snap.csvRowCount)
        } else {
          setProducts([])
          setFileName('')
          setCsvRowCount(0)
        }
        setSalesRefresh((x) => x + 1)
      })()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const focusHeaderSearchSelect = useCallback(() => {
    queueMicrotask(() => {
      const el = headerSearchRef.current
      el?.focus()
      el?.select()
    })
  }, [])

  const showPosScanToastMessage = useCallback((text) => {
    const t = String(text ?? '').trim()
    if (!t) return
    if (posScanToastClearRef.current != null) {
      window.clearTimeout(posScanToastClearRef.current)
      posScanToastClearRef.current = null
    }
    setPosScanToast(t)
    posScanToastClearRef.current = window.setTimeout(() => {
      setPosScanToast(null)
      posScanToastClearRef.current = null
    }, 3800)
  }, [])

  const toggleSellWholesaleMode = useCallback(() => {
    setSellWholesaleMode((v) => {
      const next = !v
      showPosScanToastMessage(
        next ? 'Đã chuyển sang chế độ BÁN SỈ' : 'Đã trở lại chế độ BÁN LẺ'
      )
      return next
    })
  }, [showPosScanToastMessage])

  useEffect(
    () => () => {
      if (posScanToastClearRef.current != null) {
        window.clearTimeout(posScanToastClearRef.current)
        posScanToastClearRef.current = null
      }
    },
    []
  )

  const logBarcodeReceived = useCallback(
    (raw, ctx) => {
      const disp = String(normalizeBarcodeValue(raw) || String(raw ?? '').trim())
      setLastBarcodeReceived(disp || String(raw ?? '').trim() || '—')
      const v = ctx?.variant
      const p = ctx?.product
      if (v && p) {
        const nameFound = displayNameForCartVariant(p, v)
        const price = effectiveSellUnitPrice(v, sellWholesaleMode)
        const priceDisp =
          typeof price === 'number' && Number.isFinite(price)
            ? price.toLocaleString('vi-VN')
            : String(price)
        const rowNo = csvSheetRow1BasedFromVariant(v)
        const rowLabel = rowNo != null ? String(rowNo) : '?'
        const mãVạch = String(normalizeBarcodeValue(v.barcode ?? '') || disp)
        console.log(
          `[QUÉT MÃ] Khớp 100% dòng số ${rowLabel}: ${mãVạch} - ${nameFound} - ${priceDisp}`
        )
        showPosScanToastMessage(`Đã tìm thấy: ${nameFound} - ${priceDisp}`)
      }
    },
    [sellWholesaleMode, showPosScanToastMessage]
  )

  /** Sau khi thêm hàng: giữ nguyên ô tìm, bôi đen toàn bộ để lần quét/gõ sau thay thế. */
  const afterSuccessfulHeaderAdd = useCallback(() => {
    setHeaderSearchInvalid(false)
    setHeaderSearchFeedback('')
    setHeaderSuggestOpen(false)
    focusHeaderSearchSelect()
  }, [focusHeaderSearchSelect])

  const markBarcodeNotFound = useCallback((raw) => {
    const disp = String(normalizeBarcodeValue(raw) || String(raw ?? '').trim())
    setLastBarcodeReceived(disp || String(raw ?? '').trim() || '—')
    setHeaderSearchInvalid(true)
    setHeaderSearchFeedback(disp ? `Mã ${disp} không tồn tại` : 'Mã không tồn tại')
    setHeaderSuggestOpen(false)
    focusHeaderSearchSelect()
  }, [focusHeaderSearchSelect])

  const clearPosSearchForScan = useCallback(() => {
    setHeaderSearch('')
    setHeaderSearchInvalid(false)
    setHeaderSearchFeedback('')
    setLastBarcodeReceived('')
    setHeaderSuggestOpen(false)
  }, [])

  scanHeaderRef.current = {
    setHeaderSearch,
    logBarcodeReceived,
    afterSuccessfulHeaderAdd,
    markBarcodeNotFound,
  }

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    setInitialCatalogLoadPending(false)
    setError('')
    setProducts([])
    setCsvRowCount(0)
    setFileName('')
    setHeaderSearch('')
    setHeaderSearchInvalid(false)
    setHeaderSearchFeedback('')
    setLastBarcodeReceived('')
    setHeaderSuggestOpen(false)
    const fresh = createEmptySellOrder()
    setSellOrders([fresh])
    setActiveSellOrderId(fresh.id)
    e.target.value = ''

    if (!file) return

    try {
      await persistCatalogSnapshotAndProducts([], '')
    } catch {
      /* ignore */
    }

    try {
      const res = await parseCatalogBlobFile(file)
      if (res.error) {
        setError(res.error)
        return
      }
      const prepared = prepareCatalogForPosSearch(res.products)
      const importedName = res.fileName
      startTransition(() => {
        setFileName(importedName)
        setCsvRowCount(res.rowCount)
        setProducts(prepared)
        setSellOrders((orders) =>
          orders.map((o) => ({
            ...o,
            cart: (o.cart || []).map((line) => remapCartLineFromCatalog(line, prepared, sellWholesaleMode)),
          }))
        )
      })
      queueMicrotask(() => {
        if (!catalogStoreHydratedRef.current) return
        void persistCatalogSnapshotAndProducts(prepared, importedName)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được file.')
    }
  }, [sellWholesaleMode])

  const activeOrder = useMemo(
    () => sellOrders.find((o) => o.id === activeSellOrderId) ?? sellOrders[0],
    [sellOrders, activeSellOrderId]
  )
  const cart = activeOrder?.cart ?? EMPTY_CART_LINES

  useEffect(() => {
    console.log(
      '[cart]',
      cart.map((l) => ({
        name: l.name,
        code: l.code,
        variantId: l.variantId,
        catalogId: l.catalogId,
        qty: l.qty,
      }))
    )
  }, [cart])

  cartRef.current = cart
  const orderDiscountStr = activeOrder?.orderDiscountStr ?? ''
  const cashGivenStr = activeOrder?.cashGivenStr ?? ''
  const customerQuery = activeOrder?.customerQuery ?? ''

  const activeSeller = useMemo(
    () => POS_SELLER_ACCOUNTS.find((a) => a.id === activeSellerId) ?? POS_SELLER_ACCOUNTS[0],
    [activeSellerId]
  )

  const customerMatches = useMemo(() => {
    const raw = customerQuery.trim()
    if (!raw) return []
    const q = stripAccents(raw.toLowerCase())
    return storedCustomers
      .filter((c) => {
        const hay = stripAccents(`${c.name} ${c.phone}`.toLowerCase())
        return hay.includes(q)
      })
      .slice(0, 8)
  }, [customerQuery, storedCustomers])

  const updateActiveOrder = useCallback((fn) => {
    setSellOrders((orders) => {
      const idx = orders.findIndex((o) => o.id === activeSellOrderId)
      if (idx < 0) return orders
      const next = fn(orders[idx])
      const copy = [...orders]
      copy[idx] = next
      return copy
    })
  }, [activeSellOrderId])

  const setCart = useCallback(
    (updater) => {
      updateActiveOrder((o) => ({
        ...o,
        cart: typeof updater === 'function' ? updater(o.cart) : updater,
      }))
    },
    [updateActiveOrder]
  )

  useEffect(() => {
    if (!batchPickLineId) {
      setBatchDraftId(null)
      setBatchSearch('')
      return
    }
    const line = cart.find((l) => l.lineId === batchPickLineId)
    if (!line) {
      setBatchPickLineId(null)
      setBatchDraftId(null)
      setBatchSearch('')
      return
    }
    const ctx = resolveLineBatchContext(products, line)
    const batches = ctx?.batches ?? []
    const ok =
      line.selectedBatchId && batches.some((b) => b.batchId === line.selectedBatchId)
    setBatchDraftId(ok ? line.selectedBatchId : batches[0]?.batchId ?? null)
    setBatchSearch('')
  }, [batchPickLineId, cart, products])

  useLayoutEffect(() => {
    if (products.length === 0) {
      lastCatalogFingerprintRef.current = ''
      return
    }
    const fp = buildCatalogFingerprint(products, fileName)
    if (lastCatalogFingerprintRef.current === fp) return
    lastCatalogFingerprintRef.current = fp

    const parsed = loadPosSessionDraft()
    if (!parsed || parsed.fingerprint !== fp) {
      posDraftHydratingRef.current = false
      return
    }

    const re = rehydrateSellOrdersFromSnapshot(
      products,
      parsed.sellOrders,
      parsed.sellWholesaleMode === true
    )
    if (!re) {
      posDraftHydratingRef.current = false
      return
    }

    posDraftHydratingRef.current = true
    setSellOrders(re.orders)
    const savedAid = parsed.activeSellOrderId
    const nextAid =
      typeof savedAid === 'string' && re.orders.some((o) => o.id === savedAid)
        ? savedAid
        : re.orders[0].id
    setActiveSellOrderId(nextAid)
    setSellWholesaleMode(parsed.sellWholesaleMode === true)
    queueMicrotask(() => {
      posDraftHydratingRef.current = false
    })
  }, [products, fileName])

  useEffect(() => {
    if (!products.length) return
    if (posDraftHydratingRef.current) return

    const fp = buildCatalogFingerprint(products, fileName)
    const t = window.setTimeout(() => {
      if (posDraftHydratingRef.current) return
      if (!sellOrdersHaveAnyCartLines(sellOrders)) {
        clearPosSessionDraft()
        return
      }
      savePosSessionDraft({
        v: POS_SESSION_DRAFT_VERSION,
        fingerprint: fp,
        fileName,
        sellOrders,
        activeSellOrderId,
        sellWholesaleMode,
        savedAt: new Date().toISOString(),
      })
    }, 420)
    return () => window.clearTimeout(t)
  }, [sellOrders, activeSellOrderId, sellWholesaleMode, products, fileName])

  /** Khi catalog (Hàng hóa / Excel) đổi — cập nhật ĐƠN VỊ TÍNH / biến thể / giá trên dòng giỏ ngay (sau bước khôi phục nháp). */
  useEffect(() => {
    if (activeView !== 'sell') return
    if (!catalogDataFingerprint) return
    queueMicrotask(() => {
      if (posDraftHydratingRef.current) return
      const prods = productsRef.current
      setSellOrders((orders) =>
        orders.map((o) => ({
          ...o,
          cart: (o.cart || []).map((line) => remapCartLineFromCatalog(line, prods, sellWholesaleMode)),
        }))
      )
    })
  }, [catalogDataFingerprint, sellWholesaleMode, activeView])

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    writeStoredSellerId(activeSellerId)
  }, [activeSellerId])

  useEffect(() => {
    if (!sellerMenuOpen) return
    const onDoc = (e) => {
      if (sellerMenuRef.current?.contains(e.target)) return
      setSellerMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [sellerMenuOpen])

  useEffect(() => {
    if (activeView !== 'sell') setShortcutsHelpOpen(false)
  }, [activeView])

  useEffect(() => {
    if (!shortcutsHelpOpen) return
    const onEsc = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setShortcutsHelpOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [shortcutsHelpOpen])

  useEffect(() => {
    if (activeView !== 'dashboard' || activeSellerId !== 'admin') return
    const onKey = (e) => {
      if (e.key !== 'F11' || e.altKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      setActiveView('sell')
      navigate('/', { replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeView, activeSellerId, navigate])

  useEffect(() => {
    setCart((prev) => {
      let changed = false
      const next = prev.map((line) => {
        const v = line.variantOptions.find((o) => String(o.id) === String(line.variantId))
        if (!v) return line
        const price = effectiveSellUnitPrice(v, sellWholesaleMode)
        const cost = effectivePosCostUnit(v, sellWholesaleMode)
        if (price === line.price && cost === line.cost) return line
        changed = true
        return { ...line, price, cost }
      })
      return changed ? next : prev
    })
  }, [sellWholesaleMode, setCart])

  const addSellTab = useCallback(() => {
    const o = createEmptySellOrder()
    setSellOrders((prev) => [...prev, o])
    setActiveSellOrderId(o.id)
  }, [])

  const closeSellTab = useCallback(
    (id) => {
      let nextActiveId = null
      setSellOrders((prev) => {
        if (prev.length <= 1) return prev
        const o = prev.find((x) => x.id === id)
        if (o && o.cart.length > 0 && !window.confirm('Đơn này còn hàng. Đóng và bỏ giỏ?')) {
          return prev
        }
        const idx = prev.findIndex((x) => x.id === id)
        const next = prev.filter((x) => x.id !== id)
        if (activeSellOrderId === id) {
          const na = next[Math.max(0, idx - 1)] ?? next[0]
          if (na) nextActiveId = na.id
        }
        return next
      })
      if (nextActiveId != null) setActiveSellOrderId(nextActiveId)
    },
    [activeSellOrderId]
  )

  const bestSellerProducts = useMemo(
    () => (products.length > 0 ? sortProductsBySales(products, codeSalesMap) : []),
    [products, codeSalesMap]
  )

  /** Bộ nhớ quét gợi ý: đã sắp bán chạy + nameSearch gắn sẵn (chuẩn hóa một lần khi đổi catalog). */
  const posTextSearchScanList = useMemo(
    () => (products.length > 0 ? buildPosTextSearchScanList(products, codeSalesMap) : []),
    [products, codeSalesMap]
  )

  const headerSuggestRows = useMemo(
    () =>
      products.length > 0
        ? buildHeaderSuggestRows(
            products,
            posTextSearchScanList,
            codeSalesMap,
            headerSearch,
            catalogBarcodeCaches.productsByKey
          )
        : [],
    [products, posTextSearchScanList, codeSalesMap, headerSearch, catalogBarcodeCaches]
  )

  useEffect(() => {
    if (!headerSuggestOpen || headerSuggestRows.length === 0) return
    headerSuggestRows.forEach((row, x) => {
      const v = resolveHeaderSuggestVariant(row, headerSuggestUnitPickByProductId)
      console.log(
        `Item Row ${x}: Name = ${String(v.name ?? '')} , Barcode = ${String(normalizeBarcodeValue(v.barcode ?? ''))}`
      )
    })
  }, [headerSuggestOpen, headerSuggestRows, headerSuggestUnitPickByProductId])

  useEffect(() => {
    setProducts((prev) => forceRebuildSearchCache(prev))
  }, [])

  useEffect(() => {
    setHeaderHighlightIndex((h) => {
      if (headerSuggestRows.length === 0) return 0
      return Math.min(h, headerSuggestRows.length - 1)
    })
  }, [headerSuggestRows.length])

  useEffect(() => {
    if (!headerSuggestOpen) return
    const onDoc = (e) => {
      if (headerSuggestWrapRef.current?.contains(e.target)) return
      setHeaderSuggestOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [headerSuggestOpen])

  useLayoutEffect(() => {
    if (!headerSuggestOpen || headerSuggestRows.length === 0) return
    document
      .getElementById(`pos-header-sug-${headerHighlightIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [headerHighlightIndex, headerSuggestOpen, headerSuggestRows.length])

  useEffect(() => {
    let cancelled = false
    getAllOrders()
      .then((orders) => {
        if (!cancelled) setCodeSalesMap(aggregateCodeQtyFromOrders(orders))
      })
      .catch(() => {
        if (!cancelled) setCodeSalesMap({})
      })
    return () => {
      cancelled = true
    }
  }, [salesRefresh, activeView])

  useEffect(() => {
    if (activeView !== 'sell') {
      setUnitPickerProduct(null)
      setHeaderSuggestOpen(false)
      setShowConversionByLineId({})
    }
  }, [activeView])

  const prevPosDockTabRef = useRef(posDockTab)
  useEffect(() => {
    const prev = prevPosDockTabRef.current
    prevPosDockTabRef.current = posDockTab
    if (prev === 'actions' && posDockTab === 'products' && posDockExpanded) {
      const t = window.setTimeout(() => headerSearchRef.current?.focus(), 120)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [posDockTab, posDockExpanded])

  const addToCartWithVariant = useCallback(
    (p, variantRowId) => {
      const variantOptions = buildVariantOptionsFromProduct(p)
      const cur =
        variantOptions.find((o) => String(o.id) === String(variantRowId)) || variantOptions[0]
      const unitPrice = effectiveSellUnitPrice(cur, sellWholesaleMode)
      const lineName = displayNameForCartVariant(p, cur)
      setCart((prev) => {
        const i = prev.findIndex((l) => String(l.variantId) === String(cur.id))
        if (i >= 0) {
          const line = prev[i]
          const updated = {
            ...line,
            qty: line.qty + 1,
            code: cur.code,
            name: lineName,
            price: unitPrice,
            cost: effectivePosCostUnit(cur, sellWholesaleMode),
            unitLabel: cur.unitLabel,
            conversionHint: cur.conversionHint || '',
            variantOptions,
          }
          return [updated, ...prev.filter((_, j) => j !== i)]
        }
        const stub = { catalogId: p.id, variantId: cur.id, qty: 1 }
        const defaultBatch = pickDefaultBatchIdForLine(productsRef.current, stub)
        return [
          {
            lineId: newCartLineId(),
            catalogId: p.id,
            variantId: cur.id,
            groupRoot: p.groupRoot ?? p.code,
            code: cur.code,
            name: lineName,
            price: unitPrice,
            cost: effectivePosCostUnit(cur, sellWholesaleMode),
            unitLabel: cur.unitLabel,
            conversionHint: cur.conversionHint || '',
            qty: 1,
            variantOptions,
            ...(defaultBatch ? { selectedBatchId: defaultBatch } : {}),
          },
          ...prev,
        ]
      })
    },
    [setCart, sellWholesaleMode]
  )

  addToCartForGlobalScanRef.current = addToCartWithVariant

  /**
   * Quét toàn cục (capture): máy quét gõ cực nhanh + Enter; không cần focus ô tìm.
   * Tắt khi modal/ngăn kéo mở hoặc đang focus ô nhập (Giảm giá, SL, ô tìm…).
   */
  useEffect(() => {
    if (activeView !== 'sell' || products.length === 0) return

    const flushBuffer = () => {
      globalScanBufferRef.current = { buf: '', times: [] }
    }

    const shouldPauseGlobalScan = () => {
      if (unitPickerProduct || scannerMenuOpen || batchPickLineId || posMaHhLienConvModal) return true
      const ae = document.activeElement
      if (ae && ae === headerSearchRef.current) return true
      if (ae && isEditableFieldElement(ae)) return true
      if (ae?.closest?.('[aria-modal="true"]')) return true
      return false
    }

    const onKeyDownCapture = (e) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (shouldPauseGlobalScan()) {
        flushBuffer()
        return
      }

      const st = globalScanBufferRef.current

      if (e.key === 'Enter') {
        const { buf, times } = st
        flushBuffer()
        if (buf.length < SCAN_MIN_CHARS_GLOBAL) return
        if (!scanTimingLooksLikeWedge(times)) return
        if (!queryLooksLikeBarcodeKeyInput(buf)) return
        e.preventDefault()
        e.stopPropagation()
        const { setHeaderSearch, logBarcodeReceived, afterSuccessfulHeaderAdd, markBarcodeNotFound } =
          scanHeaderRef.current
        const hit = findProductByBarcodeCached(catalogBarcodeCachesRef.current, buf)
        if (!hit) {
          markBarcodeNotFound(buf)
          return
        }
        const scanCtx = buildBarcodeScanLogContext(hit, buf)
        const headerLabel = scanCtx
          ? displayNameForCartVariant(hit.product, scanCtx.variant)
          : buf
        setHeaderSearch(headerLabel)
        if (scanCtx) logBarcodeReceived(buf, scanCtx)
        else logBarcodeReceived(buf)
        playScannerBeep()
        addToCartForGlobalScanRef.current(hit.product, hit.variantId)
        afterSuccessfulHeaderAdd()
        return
      }

      if (isPrintableBarcodeKey(e.key)) {
        const now = performance.now()
        if (st.times.length > 0 && now - st.times[st.times.length - 1] > SCAN_MAX_INTER_KEY_MS) {
          st.buf = ''
          st.times = []
        }
        st.buf += e.key
        st.times.push(now)
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const noReset = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'ContextMenu', 'Dead'])
      if (!noReset.has(e.key)) flushBuffer()
    }

    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true)
      flushBuffer()
    }
  }, [activeView, products.length, unitPickerProduct, scannerMenuOpen, batchPickLineId, posMaHhLienConvModal])

  const tryAddProductFromHeader = useCallback(() => {
    const raw = headerSearch.trim()
    if (!raw) {
      setHeaderSearchInvalid(false)
      setHeaderSearchFeedback('')
      return
    }
    const strictNumBar = strictLongNumericBarcodeQuery(raw)
    const barcodeLike = queryLooksLikeBarcodeKeyInput(raw)
    const barHit = findProductByBarcodeCached(catalogBarcodeCaches, raw)
    if (barHit) {
      const scanCtx = buildBarcodeScanLogContext(barHit, raw)
      if (scanCtx) {
        setHeaderSearch(displayNameForCartVariant(barHit.product, scanCtx.variant))
        logBarcodeReceived(raw, scanCtx)
      } else {
        logBarcodeReceived(raw)
      }
      playScannerBeep()
      addToCartWithVariant(barHit.product, barHit.variantId)
      afterSuccessfulHeaderAdd()
      return
    }
    if (strictNumBar) {
      markBarcodeNotFound(raw)
      return
    }
    if (!barcodeLike) {
      const codeHit = findCatalogRowByCodeOrScan(products, raw)
      if (codeHit) {
        const { product: p, variantId } = codeHit
        addToCartWithVariant(p, variantId)
        afterSuccessfulHeaderAdd()
        return
      }
    }
    const nameMatches = filterProductsByQuickQuery(
      products,
      raw,
      catalogBarcodeCaches.productsByKey
    )
    const sorted = sortProductsBySearchQuery(nameMatches, raw, codeSalesMap)
    if (sorted.length === 0) {
      if (barcodeLike) {
        markBarcodeNotFound(raw)
        return
      }
      setHeaderSearchInvalid(false)
      setHeaderSearchFeedback('')
      window.alert('Không tìm thấy sản phẩm khớp.')
      return
    }
    const p = sorted[0]
    if (p.multiUnit) {
      setUnitPickerProduct(p)
      setHeaderSuggestOpen(false)
      setHeaderSearchInvalid(false)
      setHeaderSearchFeedback('')
      return
    }
    addToCartWithVariant(p, p.id)
    afterSuccessfulHeaderAdd()
  }, [
    headerSearch,
    products,
    codeSalesMap,
    addToCartWithVariant,
    afterSuccessfulHeaderAdd,
    logBarcodeReceived,
    markBarcodeNotFound,
    catalogBarcodeCaches,
    strictLongNumericBarcodeQuery,
    setHeaderSearch,
  ])

  const pickHeaderSuggestRow = useCallback(
    (row) => {
      if (!row) return
      const v = resolveHeaderSuggestVariant(row, headerSuggestUnitPickByProductId)
      setHeaderSearch(displayNameForCartVariant(row.product, v))
      addToCartWithVariant(row.product, v.id)
      setHeaderHighlightIndex(0)
      afterSuccessfulHeaderAdd()
    },
    [addToCartWithVariant, afterSuccessfulHeaderAdd, headerSuggestUnitPickByProductId, setHeaderSearch]
  )

  const onHeaderSearchKeyDown = useCallback(
    (e) => {
      if (e.key === 'ArrowDown') {
        if (!headerSuggestOpen || headerSuggestRows.length === 0) return
        e.preventDefault()
        setHeaderHighlightIndex((h) => Math.min(h + 1, headerSuggestRows.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        if (!headerSuggestOpen || headerSuggestRows.length === 0) return
        e.preventDefault()
        setHeaderHighlightIndex((h) => Math.max(h - 1, 0))
        return
      }
      if (e.key !== 'Enter') return
      e.preventDefault()
      const raw = headerSearch.trim()
      const barcodeLike = raw.length > 0 && queryLooksLikeBarcodeKeyInput(raw)
      const strictNumBar = strictLongNumericBarcodeQuery(raw)
      const bar = raw ? findProductByBarcodeCached(catalogBarcodeCaches, raw) : null
      if (bar) {
        const scanCtx = buildBarcodeScanLogContext(bar, raw)
        if (scanCtx) {
          setHeaderSearch(displayNameForCartVariant(bar.product, scanCtx.variant))
          logBarcodeReceived(raw, scanCtx)
        } else {
          logBarcodeReceived(raw)
        }
        playScannerBeep()
        addToCartWithVariant(bar.product, bar.variantId)
        afterSuccessfulHeaderAdd()
        return
      }
      if (strictNumBar) {
        markBarcodeNotFound(raw)
        return
      }
      if (!barcodeLike) {
        const exact = raw ? findCatalogRowByCodeOrScan(products, raw) : null
        if (exact) {
          addToCartWithVariant(exact.product, exact.variantId)
          afterSuccessfulHeaderAdd()
          return
        }
      }
      if (
        headerSuggestOpen &&
        headerSuggestRows.length > 0 &&
        headerHighlightIndex >= 0 &&
        headerHighlightIndex < headerSuggestRows.length
      ) {
        pickHeaderSuggestRow(headerSuggestRows[headerHighlightIndex])
        return
      }
      tryAddProductFromHeader()
    },
    [
      headerSuggestOpen,
      headerSuggestRows,
      headerHighlightIndex,
      headerSearch,
      products,
      addToCartWithVariant,
      pickHeaderSuggestRow,
      tryAddProductFromHeader,
      afterSuccessfulHeaderAdd,
      logBarcodeReceived,
      markBarcodeNotFound,
      catalogBarcodeCaches,
      setHeaderSearch,
    ]
  )

  const setLineVariant = useCallback((lineId, variantId) => {
    setCartQtyDraftByLine({})
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.lineId === lineId)
      if (idx < 0) return prev
      const line = prev[idx]
      const v = line.variantOptions.find((o) => String(o.id) === String(variantId))
      if (!v) return prev

      const other = prev.find((l, i) => i !== idx && String(l.variantId) === String(variantId))
      if (other) {
        const mergedQty = line.qty + other.qty
        const merged = { ...other, qty: mergedQty }
        return [
          merged,
          ...prev.filter((l) => l.lineId !== line.lineId && l.lineId !== other.lineId),
        ]
      }

      return prev.map((l) => {
        if (l.lineId !== lineId) return l
        const pHit = findProductByCatalogId(productsRef.current, l.catalogId)
        const lineName = pHit ? displayNameForCartVariant(pHit, v) : String(v.name ?? l.name ?? '')
        const next = {
          ...l,
          variantId: v.id,
          code: v.code,
          name: lineName,
          price: effectiveSellUnitPrice(v, sellWholesaleMode),
          cost: effectivePosCostUnit(v, sellWholesaleMode),
          unitLabel: v.unitLabel,
          conversionHint: v.conversionHint || '',
        }
        const d0 = pickDefaultBatchIdForLine(productsRef.current, next)
        const { selectedBatchId: _r, ...rest } = next
        return d0 ? { ...rest, selectedBatchId: d0 } : rest
      })
    })
  }, [setCart, sellWholesaleMode])

  const setLineQty = useCallback((lineId, qty) => {
    const s = typeof qty === 'number' ? String(qty) : String(qty ?? '')
    const n = parseQtyFromInput(sanitizeCartQtyTyping(s.trim()))
    setCartQtyDraftByLine((m) => {
      const next = { ...m }
      delete next[lineId]
      return next
    })
    setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: n } : l)))
  }, [setCart])

  const removeLine = useCallback((lineId) => {
    setCartQtyDraftByLine((m) => {
      const next = { ...m }
      delete next[lineId]
      return next
    })
    setCart((prev) => prev.filter((l) => l.lineId !== lineId))
  }, [setCart])

  const bumpLineQty = useCallback((lineId, delta) => {
    setCartQtyDraftByLine((m) => {
      const next = { ...m }
      delete next[lineId]
      return next
    })
    setCart((prev) => {
      const line = prev.find((l) => l.lineId === lineId)
      if (!line) return prev
      const n = Math.max(0, Number(line.qty) + delta)
      return prev.map((l) => (l.lineId === lineId ? { ...l, qty: n } : l))
    })
  }, [setCart])

  useEffect(() => {
    if (cart.length === 0) {
      setCartQtyDraftByLine({})
      setSelectedCartLineId(null)
      return
    }
    setSelectedCartLineId((prev) => {
      if (prev != null && cart.some((l) => l.lineId === prev)) return prev
      if (prev === null) return null
      return cart[0]?.lineId ?? null
    })
  }, [cart])

  const onCartQtyInputKeyDown = useCallback(
    (e, lineId, idx) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowDown' ? 1 : -1
        const nextIdx = idx + dir
        if (nextIdx < 0 || nextIdx >= cartRef.current.length) {
          e.currentTarget.select()
          scrollCartLineIntoView(lineId)
          return
        }
        const nid = cartRef.current[nextIdx].lineId
        setSelectedCartLineId(nid)
        queueMicrotask(() => {
          const el = cartQtyInputRefs.current.get(nid)
          el?.focus()
          el?.select()
          scrollCartLineIntoView(nid)
        })
        return
      }
      if (e.key === 'PageUp') {
        e.preventDefault()
        bumpLineQty(lineId, 1)
        window.setTimeout(() => {
          const el = cartQtyInputRefs.current.get(lineId)
          el?.focus()
          el?.select()
          scrollCartLineIntoView(lineId)
        }, 0)
        return
      }
      if (e.key === 'PageDown') {
        e.preventDefault()
        bumpLineQty(lineId, -1)
        window.setTimeout(() => {
          const c = cartRef.current
          if (c.length === 0) return
          const i = Math.min(idx, c.length - 1)
          const nid = c[i].lineId
          setSelectedCartLineId(nid)
          const el = cartQtyInputRefs.current.get(nid)
          el?.focus()
          el?.select()
          scrollCartLineIntoView(nid)
        }, 0)
      }
    },
    [bumpLineQty, scrollCartLineIntoView]
  )

  const total = useMemo(
    () =>
      cart.reduce(
        (s, l) => s + (Number(l.price) || 0) * effectiveCartLineQty(l, cartQtyDraftByLine),
        0
      ),
    [cart, cartQtyDraftByLine]
  )

  const discountApplied = useMemo(
    () => parseDiscountApplied(orderDiscountStr, total),
    [orderDiscountStr, total]
  )

  const payTotal = useMemo(() => Math.max(0, total - discountApplied), [total, discountApplied])

  const cashGivenNum = useMemo(() => parseVnIntMoney(cashGivenStr), [cashGivenStr])

  const changeDue = useMemo(() => {
    if (cashGivenNum <= 0) return null
    return cashGivenNum - payTotal
  }, [cashGivenNum, payTotal])

  const handleThanhToan = useCallback(async () => {
    if (cart.length === 0) {
      alert('Chưa có sản phẩm để in')
      return
    }
    const hasInvalidQty = cart.some((l) => {
      const q = effectiveCartLineQty(l, cartQtyDraftByLine)
      return !Number.isFinite(q) || q <= 0
    })
    if (hasInvalidQty) {
      alert('Có số lượng không được phép là 0. Vui lòng kiểm tra lại đơn hàng!')
      return
    }
    const batchBlocked = cart.some(
      (l) => cartLineNeedsBatchSelection(products, l) && !isBatchIdValidForLine(products, l)
    )
    if (batchBlocked) {
      const hit = cart.find(
        (l) => cartLineNeedsBatchSelection(products, l) && !isBatchIdValidForLine(products, l)
      )
      if (hit?.lineId) {
        setBatchPickLineId(hit.lineId)
        scrollCartLineIntoView(hit.lineId)
      }
      window.alert('Vui lòng chọn lô — hạn sử dụng trước khi thanh toán.')
      return
    }
    const fixedAt = new Date()
    const invoiceNo = formatInvoiceNo(fixedAt)
    const items = cart.map((l) => {
      const vid = l.variantId != null ? String(l.variantId).trim() : ''
      let price = Number(l.price) || 0
      let cost = Number(l.cost) || 0
      if (vid) {
        const hit = findCatalogVariantById(products, vid)
        if (hit) {
          const vo =
            buildVariantOptionsFromProduct(hit.product).find((o) => String(o.id) === vid) || null
          if (vo) {
            price = effectiveSellUnitPrice(vo, sellWholesaleMode)
            cost = effectivePosCostUnit(vo, sellWholesaleMode)
          }
        }
      }
      const qty = effectiveCartLineQty(l, cartQtyDraftByLine)
      const quyDoi = cartLineQuyDoiFactor(products, l)
      const lineRevenue = price * qty
      const lineCost = cost * qty
      const lineProfit = lineRevenue - lineCost
      const orderLineId = String(l.lineId || '').trim() || undefined
      const variantId = vid
      return {
        name: l.name,
        unitLabel: normalizeCatalogUnitLabel(l.unitLabel),
        code: l.code,
        price,
        cost,
        qty,
        quyDoi,
        returnedQty: 0,
        ...(orderLineId ? { orderLineId } : {}),
        ...(variantId ? { variantId } : {}),
        lineRevenue,
        lineCost,
        lineProfit,
      }
    })
    const totalCost = items.reduce((s, it) => s + it.lineCost, 0)
    const disc = parseDiscountApplied(orderDiscountStr, total)
    const finalTotal = Math.max(0, total - disc)
    const totalProfit = finalTotal - totalCost
    if (sellWholesaleMode) {
      const revenue = items.reduce((s, it) => s + (Number(it.lineRevenue) || 0), 0)
      const tienVon = totalCost
      const profit = revenue - tienVon
      console.log('[V10-PROFIT-CHECK] Chế độ: SỈ | Doanh thu:', revenue, '| Tiền vốn:', tienVon, '| Lợi nhuận:', profit)
    }
    const custName = String(activeOrder?.customerName ?? '').trim()
    const custPhone = String(activeOrder?.customerPhone ?? '').trim()
    const noteStr = String(activeOrder?.orderNote ?? '').trim()
    const order = {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      invoiceNo,
      createdAt: fixedAt.toISOString(),
      items,
      subtotal: total,
      discount: disc,
      total: finalTotal,
      totalCost,
      totalProfit,
      ...(custName ? { customerName: custName } : {}),
      ...(custPhone ? { customerPhone: custPhone } : {}),
      ...(noteStr ? { note: noteStr } : {}),
      sellWholesaleMode: !!sellWholesaleMode,
    }
    try {
      await saveOrder(order)
      setSalesRefresh((k) => k + 1)
      const cartForStock = cart.map((l) => ({
        ...l,
        qty: effectiveCartLineQty(l, cartQtyDraftByLine),
      }))
      setProducts((prev) => {
        const next = applySoldQtyToCatalog(prev, cartForStock)
        queueMicrotask(() => {
          if (!catalogStoreHydratedRef.current || initialCatalogLoadPendingRef.current) return
          void (async () => {
            const r = await persistCatalogSnapshotAndProducts(next, catalogFileNameRef.current)
            if (r.ok) await applyServerCatalogAfterPersist()
          })()
        })
        return next
      })
    } catch (e) {
      console.error(e)
      alert(
        'Không lưu được đơn hàng (Supabase hoặc IndexedDB). Vẫn in hóa đơn; kiểm tra mạng, biến môi trường hoặc quyền lưu trữ.'
      )
    }
    const cartPrint = cart.map((l) => ({
      id: l.lineId,
      code: l.code,
      name: l.name,
      unitLabel: normalizeCatalogUnitLabel(l.unitLabel),
      price: l.price,
      qty: effectiveCartLineQty(l, cartQtyDraftByLine),
    }))
    const html = buildK80ReceiptHtml(cartPrint, finalTotal, {
      fixedAt,
      invoiceNo,
      discount: disc,
      ...(custName ? { customerName: custName } : {}),
      ...(custPhone ? { customerPhone: custPhone } : {}),
      ...(eInvoiceSettings.qrLookup
        ? { eInvoice: { showQrLookup: true } }
        : {}),
    })
    if (eInvoiceSettings.autoPrint) {
      printReceiptHtml(html)
    }
    setSellOrders((orders) =>
      orders.map((o) =>
        o.id === activeSellOrderId
          ? {
              ...o,
              cart: [],
              orderDiscountStr: '',
              cashGivenStr: '',
              customerName: '',
              customerPhone: '',
              customerQuery: '',
              orderNote: '',
            }
          : o
      )
    )
    setSellWholesaleMode(false)
  }, [
    cart,
    cartQtyDraftByLine,
    orderDiscountStr,
    printReceiptHtml,
    total,
    activeSellOrderId,
    activeOrder,
    eInvoiceSettings,
    setProducts,
    products,
    scrollCartLineIntoView,
    setBatchPickLineId,
    sellWholesaleMode,
    applyServerCatalogAfterPersist,
  ])

  handleThanhToanRef.current = handleThanhToan

  useEffect(() => {
    setUnitPickerProduct(null)
    setBatchPickLineId(null)
    setBatchDraftId(null)
    setBatchSearch('')
    setShowConversionByLineId({})
  }, [activeSellOrderId])

  useEffect(() => {
    if (!scannerMenuOpen) return
    const onDoc = (e) => {
      if (scannerMenuRef.current?.contains(e.target)) return
      setScannerMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [scannerMenuOpen])

  const focusDiscountField = useCallback(() => {
    discountInputRef.current?.focus()
    discountInputRef.current?.select()
  }, [])

  const closeReturnPickModal = useCallback(() => {
    setReturnPickModalOpen(false)
    setReturnPickModalOrders([])
    setReturnPickModalLoading(false)
  }, [])

  const openReturnPickModal = useCallback(() => {
    setReturnPickModalOpen(true)
    setReturnPickModalLoading(true)
    getAllOrders()
      .then((list) => {
        const arr = Array.isArray(list) ? list : []
        setReturnPickModalOrders(arr.slice(0, 6))
      })
      .catch(() => setReturnPickModalOrders([]))
      .finally(() => setReturnPickModalLoading(false))
  }, [])

  const onConfirmReturnPickOrder = useCallback(
    (orderId) => {
      const id = String(orderId ?? '').trim()
      if (!id) return
      window.open(getAdminReturnOrderAbsUrl(id), '_blank', 'noopener,noreferrer')
      closeReturnPickModal()
    },
    [closeReturnPickModal]
  )

  const openDoanhThuInNewTab = useCallback(() => {
    window.open(getDoanhThuAbsUrl(), '_blank', 'noopener,noreferrer')
  }, [])

  const quickXemDanhSachDon = useCallback(() => {
    window.open(getAdminOrdersAbsUrl(), '_blank', 'noopener,noreferrer')
  }, [])

  const submitNewCustomer = useCallback(() => {
    const name = newCustomerName.trim()
    const phone = newCustomerPhone.trim()
    if (!name) {
      window.alert('Vui lòng nhập họ tên khách.')
      return
    }
    const entry = { name, phone: phone || '' }
    setStoredCustomers((prev) => {
      const without = phone
        ? prev.filter((c) => String(c.phone || '').trim() !== phone)
        : prev.filter((c) => c.name !== name)
      const next = [entry, ...without].slice(0, 200)
      saveStoredCustomers(next)
      return next
    })
    updateActiveOrder((o) => ({
      ...o,
      customerName: name,
      customerPhone: phone,
      customerQuery: phone ? `${name} · ${phone}` : name,
    }))
    setCustomerAddOpen(false)
    setNewCustomerName('')
    setNewCustomerPhone('')
  }, [newCustomerName, newCustomerPhone, updateActiveOrder])

  useEffect(() => {
    if (activeView !== 'sell' || products.length === 0) return
    const onEscCapture = (e) => {
      if (e.key !== 'Escape') return
      if (returnPickModalOpen) {
        e.preventDefault()
        e.stopPropagation()
        closeReturnPickModal()
        return
      }
      if (eInvoiceModalOpen) {
        e.preventDefault()
        e.stopPropagation()
        setEInvoiceModalOpen(false)
        return
      }
      if (customerAddOpen) {
        e.preventDefault()
        e.stopPropagation()
        setCustomerAddOpen(false)
        setNewCustomerName('')
        setNewCustomerPhone('')
        queueMicrotask(() => customerSearchRef.current?.focus())
        return
      }
      if (shortcutsHelpOpen) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutsHelpOpen(false)
        setSelectedCartLineId(null)
        clearPosSearchForScan()
        queueMicrotask(() => focusHeaderSearchSelect())
        return
      }
      if (batchPickLineId) {
        e.preventDefault()
        e.stopPropagation()
        setBatchPickLineId(null)
        setBatchDraftId(null)
        setBatchSearch('')
        return
      }
      if (posMaHhLienConvModal) {
        e.preventDefault()
        e.stopPropagation()
        setPosMaHhLienConvModal(null)
        return
      }
      if (unitPickerProduct) {
        e.preventDefault()
        e.stopPropagation()
        setUnitPickerProduct(null)
        setSelectedCartLineId(null)
        clearPosSearchForScan()
        queueMicrotask(() => focusHeaderSearchSelect())
        return
      }
      if (scannerMenuOpen) {
        e.preventDefault()
        e.stopPropagation()
        setScannerMenuOpen(false)
        setSelectedCartLineId(null)
        clearPosSearchForScan()
        queueMicrotask(() => focusHeaderSearchSelect())
        return
      }
      const ae = document.activeElement
      if (ae === headerSearchRef.current) {
        if (headerSuggestOpen) {
          e.preventDefault()
          e.stopPropagation()
          setHeaderSuggestOpen(false)
          setHeaderSearchFeedback('')
          setHeaderSearchInvalid(false)
          return
        }
        e.preventDefault()
        e.stopPropagation()
        setSelectedCartLineId(null)
        clearPosSearchForScan()
        headerSearchRef.current?.focus()
        return
      }
      if (isEditableFieldElement(ae)) {
        e.preventDefault()
        e.stopPropagation()
        if (typeof ae.blur === 'function') ae.blur()
        setSelectedCartLineId(null)
        clearPosSearchForScan()
        queueMicrotask(() => focusHeaderSearchSelect())
      }
    }
    window.addEventListener('keydown', onEscCapture, true)
    return () => window.removeEventListener('keydown', onEscCapture, true)
  }, [
    activeView,
    products.length,
    shortcutsHelpOpen,
    eInvoiceModalOpen,
    customerAddOpen,
    unitPickerProduct,
    scannerMenuOpen,
    headerSuggestOpen,
    returnPickModalOpen,
    closeReturnPickModal,
    clearPosSearchForScan,
    focusHeaderSearchSelect,
    batchPickLineId,
    posMaHhLienConvModal,
  ])

  useEffect(() => {
    const onKey = (e) => {
      if (activeView !== 'sell' || products.length === 0) return
      if (shortcutsHelpOpen) return
      if (eInvoiceModalOpen) return
      if (customerAddOpen) return
      if (returnPickModalOpen) return
      if (batchPickLineId) return
      if (posMaHhLienConvModal) return
      if (e.key === 'F1') {
        e.preventDefault()
        handleThanhToanRef.current()
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        cashGivenInputRef.current?.focus()
        cashGivenInputRef.current?.select()
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        headerSearchRef.current?.focus()
        headerSearchRef.current?.select()
        return
      }
      if (e.key === 'F10') {
        e.preventDefault()
        customerSearchRef.current?.focus()
        customerSearchRef.current?.select()
        return
      }
      if (e.key === 'F4') {
        e.preventDefault()
        addSellTab()
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        if (cart.length === 0) return
        const id =
          selectedCartLineId != null && cart.some((l) => l.lineId === selectedCartLineId)
            ? selectedCartLineId
            : cart[0].lineId
        setSelectedCartLineId(id)
        queueMicrotask(() => {
          const el = cartQtyInputRefs.current.get(id)
          el?.focus()
          el?.select()
          scrollCartLineIntoView(id)
        })
        return
      }
      if (e.key === 'F11' && e.altKey && activeSellerId === 'admin') {
        e.preventDefault()
        setScannerMenuOpen((open) => !open)
        return
      }
      if (e.key === 'F11' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (activeSellerId === 'admin') {
          e.preventDefault()
          openDoanhThuInNewTab()
          return
        }
        e.preventDefault()
        setScannerMenuOpen((open) => !open)
        return
      }
      const ae = document.activeElement
      if (isEditableFieldElement(ae)) return
      if (e.key === 'F6') {
        e.preventDefault()
        focusDiscountField()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeView,
    products.length,
    shortcutsHelpOpen,
    eInvoiceModalOpen,
    customerAddOpen,
    cart.length,
    focusDiscountField,
    addSellTab,
    selectedCartLineId,
    scrollCartLineIntoView,
    activeSellerId,
    openDoanhThuInNewTab,
    returnPickModalOpen,
    batchPickLineId,
    posMaHhLienConvModal,
  ])

  const isPosMode = activeView === 'sell' && products.length > 0
  const canAccessDashboard = activeSellerId === 'admin'

  const openEInvoiceModal = useCallback(() => {
    setEInvoiceModalDraft({ ...eInvoiceSettings })
    setEInvoiceModalOpen(true)
  }, [eInvoiceSettings])

  const commitEInvoiceModal = useCallback(() => {
    saveEInvoiceSettings(eInvoiceModalDraft)
    setEInvoiceSettings({ ...eInvoiceModalDraft })
    setEInvoiceModalOpen(false)
  }, [eInvoiceModalDraft])

  const handleStoreBootstrapClick = useCallback(async () => {
    if (!isSupabaseConfigured() || storeBootstrapBusy) return
    setStoreBootstrapBusy(true)
    setStoreBootstrapHint('Đang khởi tạo…')
    try {
      const ac = new AbortController()
      storeBootstrapAbortRef.current = ac
      await runStoreDataBootstrap({
        signal: ac.signal,
        onPhase: (phase, detail) => {
          setStoreBootstrapHint(detail ? `${phase}: ${detail}` : phase)
        },
      })
      const snap = await fetchProducts()
      if (snap?.products?.length) {
        setProducts(prepareCatalogForPosSearch(snap.products))
        setFileName(snap.fileName)
        setCsvRowCount(snap.csvRowCount)
        setSalesRefresh((x) => x + 1)
      }
      setStoreBootstrapHint('Hoàn tất. Dữ liệu đã lên Supabase (products + catalog_snapshots + sales sẵn sàng).')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStoreBootstrapHint(msg)
      alert(msg)
    } finally {
      setStoreBootstrapBusy(false)
      storeBootstrapAbortRef.current = null
    }
  }, [storeBootstrapBusy])

  const renderHeaderIconRail = (variant) => {
    const railClass =
      variant === 'kv'
        ? 'app-header-icon-rail app-header-icon-rail--kv'
        : 'app-header-icon-rail app-header-icon-rail--blue'
    const showPrinter = variant === 'blue'

    const homeBtn = (
      <button
        key="home"
        type="button"
        className="app-header-icon-btn"
        disabled={!canAccessDashboard}
        aria-label="Doanh thu — mở tab mới"
        title={
          canAccessDashboard
            ? 'Doanh thu — mở tab mới (F11)'
            : 'Doanh thu — chỉ Admin / Chủ cửa hàng'
        }
        onClick={() => canAccessDashboard && openDoanhThuInNewTab()}
      >
        <svg
          className="app-header-icon-svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>
    )

    const shortcutsBtn = (
      <button
        key="shortcuts"
        type="button"
        className="app-header-icon-btn"
        aria-label="Phím tắt"
        title="Bảng phím tắt"
        onClick={() => setShortcutsHelpOpen(true)}
      >
        <svg
          className="app-header-icon-svg"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h4" />
        </svg>
      </button>
    )

    const bellBtn = (
      <button
        key="notifications"
        type="button"
        className="app-header-icon-btn"
        aria-label="Thông báo"
        title="Thông báo"
        onClick={() => {
          /* Giữ chỗ tính năng thông báo — giao diện đồng bộ thanh icon */
        }}
      >
        <svg
          className="app-header-icon-svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>
    )

    const cartBtn = (
      <button
        key="cart"
        type="button"
        className={`app-header-icon-btn${activeView === 'sell' ? ' app-header-icon-btn--on' : ''}`}
        aria-label="Bán hàng"
        title="Bán hàng"
        onClick={() => {
          setActiveView('sell')
          navigate('/', { replace: true })
        }}
      >
        <svg
          className="app-header-icon-svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="9" cy="20" r="1" />
          <circle cx="18" cy="20" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      </button>
    )

    const printerBlock = showPrinter ? (
      <div key="printer" className="pos-header-printer-wrap">
        <button
          type="button"
          className="app-header-icon-btn app-header-icon-btn--printer"
          aria-label="Hóa đơn điện tử"
          title="Hóa đơn điện tử"
          onClick={openEInvoiceModal}
        >
          <svg
            className="app-header-icon-svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <path d="M6 14h12v8H6z" />
          </svg>
        </button>
        <span className="pos-header-printer-badge" aria-hidden>
          Mới
        </span>
      </div>
    ) : null

    const sellerMeta = (
      <div className="app-header-seller-block pos-sidebar-seller" key="seller">
        <button
          type="button"
          className="pos-sidebar-seller-trigger"
          aria-expanded={sellerMenuOpen}
          aria-haspopup="listbox"
          onClick={() => setSellerMenuOpen((v) => !v)}
        >
          {activeSeller.label}
          <span className="pos-sidebar-seller-chev" aria-hidden>
            ▾
          </span>
        </button>
        {sellerMenuOpen && (
          <ul className="pos-sidebar-seller-menu" role="listbox">
            {POS_SELLER_ACCOUNTS.map((acc) => (
              <li key={acc.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={acc.id === activeSellerId}
                  className={
                    acc.id === activeSellerId
                      ? 'pos-sidebar-seller-item pos-sidebar-seller-item--active'
                      : 'pos-sidebar-seller-item'
                  }
                  onClick={() => {
                    setActiveSellerId(acc.id)
                    setSellerMenuOpen(false)
                  }}
                >
                  {acc.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )

    const clockBlock = (
      <div className="pos-sidebar-clock pos-sidebar-clock--blue-rail" aria-live="polite" key="clock">
        {formatPosSidebarClock(nowTick)}
      </div>
    )

    if (variant === 'blue') {
      return (
        <div className={railClass} ref={sellerMenuRef}>
          <div className="pos-header-blue-icons">
            {printerBlock}
            {homeBtn}
            {shortcutsBtn}
            {bellBtn}
            {cartBtn}
          </div>
          <div className="pos-header-blue-meta">
            {sellerMeta}
            {clockBlock}
          </div>
        </div>
      )
    }

    return (
      <div className={railClass} ref={sellerMenuRef}>
        {homeBtn}
        {shortcutsBtn}
        {bellBtn}
        {cartBtn}
        <div className="app-header-meta-cluster">
          {sellerMeta}
          <span className="pos-sidebar-meta-sep" aria-hidden>
            ·
          </span>
          {clockBlock}
        </div>
      </div>
    )
  }

  return (
    <div className={`app app--dark${isPosMode ? ' app--pos' : ''}`}>
      {posScanToast ? (
        <div className="pos-scan-toast" role="status" aria-live="polite">
          {posScanToast}
        </div>
      ) : null}
      {isSupabaseConfigured() ? (
        <div className="store-bootstrap-fab-wrap">
          <button
            type="button"
            className="store-bootstrap-fab"
            disabled={storeBootstrapBusy}
            onClick={handleStoreBootstrapClick}
          >
            {storeBootstrapBusy ? 'Đang xử lý…' : 'KHỞI TẠO DỮ LIỆU CỬA HÀNG'}
          </button>
          {storeBootstrapHint ? (
            <div className="store-bootstrap-fab-hint" role="status">
              {storeBootstrapHint}
            </div>
          ) : null}
        </div>
      ) : null}
      <iframe
        ref={receiptIframeRef}
        src="about:blank"
        title="Hóa đơn bán hàng"
        className="print-receipt-iframe"
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={catalogImportInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="file-input"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
        tabIndex={-1}
        aria-hidden
        onChange={onFile}
      />
      <header className={isPosMode ? 'pos-header' : 'kv-header'}>
        {isPosMode ? (
          <div className="pos-header-top">
            <div className="pos-header-tools">
              <label className="file-label pos-file-label">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={onFile}
                  className="file-input"
                />
                <span className="file-button pos-file-btn">Nhập CSV</span>
              </label>
              {fileName && (
                <span className="pos-file-meta">
                  {fileName} · {csvRowCount.toLocaleString('vi-VN')} dòng ·{' '}
                  {products.length.toLocaleString('vi-VN')} mặt hàng
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="kv-header-inner kv-header-inner--compact">
            <div className="kv-header-left">
              {activeView === 'sell' && (
                <>
                  <h1 className="kv-title">Bán hàng</h1>
                  <label className="file-label kv-file">
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={onFile}
                      className="file-input"
                    />
                    <span className="file-button kv-file-btn">Nhập CSV</span>
                  </label>
                  {fileName && (
                    <span className="kv-file-meta">
                      {fileName} · {csvRowCount.toLocaleString('vi-VN')} dòng CSV ·{' '}
                      {products.length.toLocaleString('vi-VN')} mặt hàng
                    </span>
                  )}
                </>
              )}
              {activeView === 'dashboard' && (
                <h1 className="kv-title">
                  {standaloneInboundCreate ? 'Tạo đơn nhập hàng' : 'Quản lý doanh thu'}
                </h1>
              )}
            </div>
            {renderHeaderIconRail('kv')}
          </div>
        )}
        {isPosMode && (
          <div className="pos-header-workbar">
            <div className="pos-header-workbar-inner">
              <div className="pos-header-workbar-left">
              <div className="pos-header-search-wrap" ref={headerSuggestWrapRef}>
                <div className="pos-header-search-row">
                  <span className="pos-header-search-icon" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <input
                    ref={headerSearchRef}
                    id="pos-header-search"
                    className={`pos-header-search-input${
                      headerSearchInvalid ? ' pos-header-search-input--invalid' : ''
                    }`}
                    placeholder="Thêm sản phẩm vào đơn (F3)"
                    value={headerSearch}
                    role="combobox"
                    aria-expanded={headerSuggestOpen}
                    aria-invalid={headerSearchInvalid}
                    aria-controls="pos-header-suggest-list"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      headerSuggestOpen && headerSuggestRows.length > 0
                        ? `pos-header-sug-${headerHighlightIndex}`
                        : undefined
                    }
                    onInput={(e) => {
                      setHeaderSearch(e.currentTarget.value)
                      setHeaderHighlightIndex(0)
                      setHeaderSuggestUnitPickByProductId({})
                      setHeaderSearchInvalid(false)
                      setHeaderSearchFeedback('')
                      setHeaderSuggestOpen(true)
                    }}
                    onFocus={() => setHeaderSuggestOpen(true)}
                    onKeyDown={onHeaderSearchKeyDown}
                    autoComplete="off"
                    aria-label="Thêm sản phẩm vào đơn"
                    title={
                      headerSearchInvalid
                        ? 'Mã này không có trong dữ liệu CSV'
                        : undefined
                    }
                  />
                  {headerSearch.trim() !== '' && (
                    <button
                      type="button"
                      className="pos-header-search-clear"
                      aria-label="Xóa ô tìm"
                      onClick={() => {
                        clearPosSearchForScan()
                        setHeaderHighlightIndex(0)
                        headerSearchRef.current?.focus()
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {headerSearchFeedback ? (
                  <p className="pos-header-search-feedback" role="alert">
                    {headerSearchFeedback}
                  </p>
                ) : null}
                {headerSuggestOpen && (
                  <div
                    className="pos-header-suggest"
                    id="pos-header-suggest-list"
                    role="listbox"
                    aria-label="Gợi ý sản phẩm"
                  >
                    {headerSuggestRows.length === 0 ? (
                      headerSearch.trim() !== '' ? (
                        <p className="pos-header-suggest-empty">Không có sản phẩm khớp.</p>
                      ) : null
                    ) : (
                      headerSuggestRows.map((row, i) => {
                        const v = resolveHeaderSuggestVariant(row, headerSuggestUnitPickByProductId)
                        const sku = String(v.code || '').trim() || '—'
                        const dvt = normalizeCatalogUnitLabel(v.unitLabel)
                        const salable = salableQtyInVariantUnitsForPos(products, row.product, v)
                        const stock =
                          salable != null && Number.isFinite(Number(salable))
                            ? formatQtyOrStockVi(salable)
                            : '—'
                        const priceStr = `${effectiveSellUnitPrice(v, sellWholesaleMode).toLocaleString('vi-VN')} đ`
                        const baseName = String(v.name ?? '').trim() || 'Không tên'
                        const title = `${baseName} — ${dvt} — ${sku}`
                        const showUomSelect =
                          Array.isArray(row.variantOptions) && row.variantOptions.length > 1
                        return (
                          <button
                            key={`pos-sug-${String(v.id)}-${i}`}
                            type="button"
                            role="option"
                            aria-selected={i === headerHighlightIndex}
                            id={`pos-header-sug-${i}`}
                            className={`pos-header-suggest-row${
                              i === headerHighlightIndex ? ' pos-header-suggest-row--active' : ''
                            }${showUomSelect ? ' pos-header-suggest-row--multi-uom' : ''}`}
                            title={title}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setHeaderHighlightIndex(i)}
                            onClick={() => pickHeaderSuggestRow(row)}
                          >
                            <span className="pos-header-suggest-cell pos-header-suggest-cell--left">
                              <span className="pos-header-suggest-title-row">
                                <span className="pos-header-suggest-title">{baseName}</span>
                                {showUomSelect ? (
                                  <select
                                    className="pos-header-suggest-uom"
                                    value={v.id}
                                    aria-label="Chọn đơn vị tính"
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      e.stopPropagation()
                                      setHeaderSuggestUnitPickByProductId((prev) => ({
                                        ...prev,
                                        [String(row.product.id)]: e.target.value,
                                      }))
                                    }}
                                  >
                                    {row.variantOptions.map((opt) => (
                                      <option key={opt.id} value={opt.id}>
                                        {normalizeCatalogUnitLabel(opt.unitLabel)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="pos-header-suggest-dvt">{dvt}</span>
                                )}
                              </span>
                              <span className="pos-header-suggest-sku">{sku}</span>
                            </span>
                            <span className="pos-header-suggest-cell pos-header-suggest-cell--right">
                              <span className="pos-header-suggest-price-line">{priceStr}</span>
                              <span className="pos-header-suggest-salable">
                                Có thể bán: {stock} {dvt}
                              </span>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
              <div className="pos-header-barcode-scanner-group" role="group" aria-label="Mã vạch và menu quét">
              <span
                className="pos-header-barcode-debug"
                title="Mã vạch phần mềm vừa nhận (đối chiếu với máy quét). Xem thêm Console (F12)."
              >
                Nhận: <code>{lastBarcodeReceived || '—'}</code>
              </span>
              <div className="pos-header-scanner" ref={scannerMenuRef}>
                <button
                  type="button"
                  className="pos-header-scanner-main"
                  aria-expanded={scannerMenuOpen}
                  aria-haspopup="true"
                  aria-controls="pos-scanner-menu"
                  id="pos-scanner-trigger"
                  onClick={() => setScannerMenuOpen((v) => !v)}
                >
                  <svg
                    className="pos-header-scanner-svg"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    aria-hidden
                  >
                    <path
                      fill="currentColor"
                      d="M2 6h2v2H2V6zm4 0h2v2H6V6zm4 0h2v2h-2V6zm4 0h2v2h-2V6zm4 0h2v2h-2V6zm0 4h2v2h-2v-2zm-16 4h2v2H2v-2zm4 0h2v2H6v-2zm8 0h2v2h-2v-2zm4 0h2v2h-2v-2zM2 18h2v2H2v-2zm4 0h2v2H6v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z"
                    />
                  </svg>
                  <span className="pos-header-scanner-f10">
                    ({canAccessDashboard ? 'Alt+F11' : 'F11'})
                  </span>
                  <span className="pos-header-scanner-chev" aria-hidden>
                    ▾
                  </span>
                </button>
                {scannerMenuOpen && (
                  <div
                    className="pos-header-scanner-pop"
                    id="pos-scanner-menu"
                    role="menu"
                    aria-labelledby="pos-scanner-trigger"
                  >
                    <p className="pos-header-scanner-pop-hint">
                      Quét Mã vạch bất kỳ đâu trên màn hình (máy quét gõ nhanh + Enter) — tự thêm đơn
                      và tít. Vào ô tìm nếu muốn gõ tên hoặc xem gợi ý. Tạm dừng khi mở hộp thoại
                      hoặc đang nhập Giảm giá / SL / tiền khách đưa. Phím tắt menu này:{' '}
                      {canAccessDashboard ? (
                        <>
                          <strong>Alt+F11</strong> (Admin: <strong>F11</strong> mở Doanh thu trên tab mới)
                        </>
                      ) : (
                        <strong>F11</strong>
                      )}
                      . Thanh toán: <strong>F1</strong>.
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      className="pos-header-scanner-pop-btn"
                      onClick={() => {
                        headerSearchRef.current?.focus()
                        setScannerMenuOpen(false)
                      }}
                    >
                      Đưa con trỏ vào ô tìm kiếm
                    </button>
                  </div>
                )}
              </div>
              </div>
              <div className="pos-header-order-tabs-strip">
                <div className="pos-header-order-tabs" role="tablist" aria-label="Đơn hàng">
                {sellOrders.map((o, i) => (
                  <div
                    key={o.id}
                    className={`pos-order-tab${o.id === activeSellOrderId ? ' pos-order-tab--active' : ''}`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={o.id === activeSellOrderId}
                      className="pos-order-tab-label"
                      onClick={() => setActiveSellOrderId(o.id)}
                    >
                      Đơn {i + 1}
                    </button>
                    {sellOrders.length > 1 && (
                      <button
                        type="button"
                        className="pos-order-tab-close"
                        aria-label={`Đóng đơn ${i + 1}`}
                        onClick={() => closeSellTab(o.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="pos-order-tab-add"
                  aria-label="Thêm đơn hàng mới (F4)"
                  title="Thêm đơn (F4)"
                  onClick={addSellTab}
                >
                  +
                </button>
                </div>
              </div>
              </div>
              <div className="pos-header-workbar-right">
                {renderHeaderIconRail('blue')}
              </div>
            </div>
          </div>
        )}
      </header>

      {error && <div className={isPosMode ? 'error error--pos' : 'error'}>{error}</div>}

      {shortcutsHelpOpen && (
        <div
          className="pos-shortcuts-backdrop"
          role="presentation"
          onClick={() => setShortcutsHelpOpen(false)}
        >
          <div
            className="pos-shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-shortcuts-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-shortcuts-modal-head">
              <h2 id="pos-shortcuts-title" className="pos-shortcuts-modal-title">
                Phím tắt POS
              </h2>
              <button
                type="button"
                className="pos-shortcuts-modal-close"
                aria-label="Đóng (Esc)"
                onClick={() => setShortcutsHelpOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="pos-shortcuts-modal-lead">
              Các phím <kbd className="pos-shortcuts-kbd">F1</kbd>–<kbd className="pos-shortcuts-kbd">F4</kbd>,{' '}
              <kbd className="pos-shortcuts-kbd">F10</kbd>, <kbd className="pos-shortcuts-kbd">F11</kbd>,{' '}
              <kbd className="pos-shortcuts-kbd">Alt+F11</kbd> và <kbd className="pos-shortcuts-kbd">Home</kbd>{' '}
              hoạt động đầy đủ khi đang ở màn <strong>Bán hàng</strong> và đã nạp CSV.{' '}
              <kbd className="pos-shortcuts-kbd">F6</kbd>, <kbd className="pos-shortcuts-kbd">F8</kbd>,{' '}
              <kbd className="pos-shortcuts-kbd">F9</kbd> chỉ khi không đang gõ trong ô nhập.{' '}
              <strong>Admin:</strong> <kbd className="pos-shortcuts-kbd">F11</kbd> (và icon nhà) mở báo cáo Doanh thu
              trên <strong>tab trình duyệt mới</strong>, tab bán hàng không đổi.
            </p>
            <div className="pos-shortcuts-table-wrap">
              <table className="pos-shortcuts-table">
                <thead>
                  <tr>
                    <th scope="col">Phím</th>
                    <th scope="col">Chức năng</th>
                  </tr>
                </thead>
                <tbody>
                  {POS_SHORTCUTS_HELP_ROWS.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <kbd className="pos-shortcuts-kbd">{row.key}</kbd>
                      </td>
                      <td>{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pos-shortcuts-modal-foot">
              F6, F8, F9 chỉ kích hoạt khi <em>không</em> đang gõ trong ô nhập. Trong ô SL giỏ:{' '}
              <kbd className="pos-shortcuts-kbd">↑</kbd>/<kbd className="pos-shortcuts-kbd">↓</kbd> đổi
              dòng; <kbd className="pos-shortcuts-kbd">PgUp</kbd>/<kbd className="pos-shortcuts-kbd">
                PgDn
              </kbd>{' '}
              ±1 số lượng (tổng tiền cập nhật ngay). Máy quét: gõ nhanh + Enter (tạm dừng khi hộp thoại
              hoặc đang nhập SL / giảm giá / tiền khách đưa).
            </p>
          </div>
        </div>
      )}

      {eInvoiceModalOpen && (
        <div
          className="einv-backdrop"
          role="presentation"
          onClick={() => setEInvoiceModalOpen(false)}
        >
          <div
            className="einv-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="einv-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="einv-modal-title" className="einv-modal-title">
              Hóa đơn điện tử
            </h2>
            <div className="einv-modal-rule" aria-hidden />
            <div className="einv-modal-rows">
              <div className="einv-modal-row">
                <span className="einv-modal-label">Tự động phát hành</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={eInvoiceModalDraft.autoPrint}
                  className={`einv-switch${eInvoiceModalDraft.autoPrint ? ' einv-switch--on' : ''}`}
                  onClick={() =>
                    setEInvoiceModalDraft((d) => ({ ...d, autoPrint: !d.autoPrint }))
                  }
                >
                  <span className="einv-switch-knob" aria-hidden />
                </button>
              </div>
              <div className="einv-modal-row">
                <span className="einv-modal-label">
                  In HDDT có mã tra cứu
                  <span
                    className="einv-modal-info"
                    title="Khi bật, cuối phiếu in có mã QR (liên kết tra cứu) và dòng Mã tra cứu. URL QR: biến môi trường VITE_EINVOICE_QR_URL hoặc mặc định tra cứu GDT."
                    aria-label="Thông tin"
                  >
                    ⓘ
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={eInvoiceModalDraft.qrLookup}
                  className={`einv-switch${eInvoiceModalDraft.qrLookup ? ' einv-switch--on' : ''}`}
                  onClick={() =>
                    setEInvoiceModalDraft((d) => ({ ...d, qrLookup: !d.qrLookup }))
                  }
                >
                  <span className="einv-switch-knob" aria-hidden />
                </button>
              </div>
            </div>
            <div className="einv-modal-template">
              <span className="einv-modal-template-label">Mẫu phát hành:</span>
              <span className="einv-modal-template-pill">{E_INVOICE_TEMPLATE_CODE}</span>
            </div>
            <div className="einv-modal-actions">
              <button
                type="button"
                className="einv-modal-btn einv-modal-btn--ghost"
                onClick={() => setEInvoiceModalOpen(false)}
              >
                Bỏ qua
              </button>
              <button type="button" className="einv-modal-btn einv-modal-btn--primary" onClick={commitEInvoiceModal}>
                Xong
              </button>
            </div>
          </div>
        </div>
      )}

      {activeView === 'dashboard' && (
        <AdminHub
          printReceiptHtml={printReceiptHtml}
          refreshKey={salesRefresh}
          products={products}
          catalogFileName={fileName}
          onTriggerCatalogImport={() => catalogImportInputRef.current?.click()}
          onRemoveCatalogVariants={handleRemoveCatalogVariants}
          onUpdateCatalogVariant={handleUpdateCatalogVariant}
          onReplaceCatalogGroup={handleReplaceCatalogGroup}
          onAppendCatalogVariants={handleAppendCatalogVariants}
          hubDeepLink={adminHubDeepLink}
          onHubDeepLinkConsumed={clearAdminHubDeepLink}
          hangHoaGoodsOpenRequest={pendingHangHoaGoodsOpen}
          onHangHoaGoodsOpenConsumed={clearPendingHangHoaGoodsOpen}
          standaloneInboundCreate={standaloneInboundCreate}
        />
      )}

      {activeView === 'sell' && products.length > 0 && (
        <main className="pos-main pos-main--dock">
          <div className="pos-main-body">
          <div className="pos-left">
            <div className="pos-table-wrap">
              <table className="pos-table pos-table--cart">
                <colgroup>
                  <col className="pos-cart-col pos-cart-col--act" style={{ width: '4%' }} />
                  <col className="pos-cart-col pos-cart-col--stt" style={{ width: '4%' }} />
                  <col className="pos-cart-col pos-cart-col--code" style={{ width: '9%' }} />
                  <col className="pos-cart-col pos-cart-col--name" style={{ width: '34%' }} />
                  <col className="pos-cart-col pos-cart-col--dvt" style={{ width: '10%' }} />
                  <col className="pos-cart-col pos-cart-col--qty" style={{ width: '14%' }} />
                  <col className="pos-cart-col pos-cart-col--price" style={{ width: '12%' }} />
                  <col className="pos-cart-col pos-cart-col--sum" style={{ width: '13%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="pos-col--act" aria-label="Thao tác" />
                    <th className="pos-col--stt">STT</th>
                    <th className="pos-col--code">Mã hàng</th>
                    <th className="pos-col--name">Tên sản phẩm</th>
                    <th className="pos-col--dvt">ĐƠN VỊ TÍNH</th>
                    <th className="pos-col--qty">Số lượng</th>
                    <th className="pos-col--price">Giá bán</th>
                    <th className="pos-col--sum">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l, idx) => {
                    const isSelected = l.lineId === selectedCartLineId
                    const showBatch = cartLineNeedsBatchSelection(products, l)
                    const batchCtx = showBatch ? resolveLineBatchContext(products, l) : null
                    const selBatchMeta =
                      batchCtx && l.selectedBatchId
                        ? batchCtx.batches.find((b) => b.batchId === l.selectedBatchId)
                        : null
                    const showConvToggle = cartLineShowsMultiUnitToggle(products, l)
                    const pCart = findProductForCartLine(products, l)
                    const vCart = resolveCartLineVariantRowOrFallback(pCart, l)
                    const maHhLinkKey = String(vCart?.linkedMasterCode ?? '').trim()
                    const groupProducts = maHhLinkKey
                      ? collectVariantsSharingMaHhLienQuan(products, maHhLinkKey)
                      : []
                    const showMaHhConvDetail = maHhLinkKey !== '' && groupProducts.length >= 2
                    const showLegacyConvUi = showConvToggle && !showMaHhConvDetail
                    const needConvHints = showMaHhConvDetail || showConvToggle
                    const convExpansion = needConvHints
                      ? buildCartConversionExpansionModel(products, l, cartQtyDraftByLine)
                      : null
                    const showConversion = !!showConversionByLineId[l.lineId]
                    const convDetailOpen = showLegacyConvUi && showConversion && !!convExpansion
                    const showQtyConvSub = !!(
                      convExpansion &&
                      (showMaHhConvDetail || (showLegacyConvUi && showConversion))
                    )
                    return (
                    <tr
                      key={l.lineId}
                      className={`pos-cart-row${isSelected ? ' pos-cart-row--selected' : ''}${
                        convDetailOpen ? ' pos-cart-row--conv-detail-open' : ''
                      }`}
                    >
                      <td className="pos-col--act">
                        <div className="pos-col-act-stack">
                          <button
                            type="button"
                            className="pos-row-del"
                            onClick={() => removeLine(l.lineId)}
                            aria-label="Xóa dòng"
                          >
                            <svg
                              className="pos-row-del-svg"
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                          {showBatch ? (
                            <button
                              type="button"
                              className="pos-cart-sub-link"
                              onClick={() => {
                                setSelectedCartLineId(l.lineId)
                                setBatchPickLineId(l.lineId)
                              }}
                            >
                              Chọn lô
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="pos-col--stt">{idx + 1}</td>
                      <td className="pos-col--code">
                        <span className="pos-cart-code-text" title="Mã hàng">
                          {String(l.code ?? '').trim() || '—'}
                        </span>
                      </td>
                      <td className="pos-col--name">
                        <div className="pos-name-text">{l.name}</div>
                        {(showMaHhConvDetail || showLegacyConvUi) ? (
                          <div className="pos-cart-conv-block">
                            <button
                              type="button"
                              id={`pos-cart-conv-btn-${l.lineId}`}
                              className="pos-cart-conv-toggle pos-cart-conv-toggle--btn"
                              aria-expanded={showLegacyConvUi ? showConversion : undefined}
                              aria-controls={
                                showLegacyConvUi && convExpansion
                                  ? `pos-cart-conv-panel-${l.lineId}`
                                  : undefined
                              }
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (showMaHhConvDetail) {
                                  console.log('Nhóm liên quan:', groupProducts)
                                  setPosMaHhLienConvModal({
                                    linkKey: maHhLinkKey,
                                    groupProducts,
                                    lineHint: String(l.code ?? '').trim() || l.name,
                                  })
                                  return
                                }
                                setShowConversionByLineId((m) => ({
                                  ...m,
                                  [l.lineId]: !m[l.lineId],
                                }))
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  if (showMaHhConvDetail) {
                                    console.log('Nhóm liên quan:', groupProducts)
                                    setPosMaHhLienConvModal({
                                      linkKey: maHhLinkKey,
                                      groupProducts,
                                      lineHint: String(l.code ?? '').trim() || l.name,
                                    })
                                    return
                                  }
                                  setShowConversionByLineId((m) => ({
                                    ...m,
                                    [l.lineId]: !m[l.lineId],
                                  }))
                                }
                              }}
                            >
                              Xem chi tiết sản phẩm quy đổi
                            </button>
                            {showLegacyConvUi && showConversion && convExpansion ? (
                              <div
                                id={`pos-cart-conv-panel-${l.lineId}`}
                                className="pos-cart-conv-inline-exp"
                                role="region"
                                aria-labelledby={`pos-cart-conv-btn-${l.lineId}`}
                                aria-live="polite"
                              >
                                <div className="pos-cart-conv-exp-line pos-cart-conv-exp-line--under-name">
                                  <span className="pos-cart-conv-exp-arrow" aria-hidden>
                                    {'└─>'}
                                  </span>
                                  <span className="pos-cart-conv-exp-code">{convExpansion.baseCode}</span>
                                  <span className="pos-cart-conv-exp-title">{convExpansion.baseName}</span>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {showBatch && selBatchMeta && batchCtx ? (
                          <div
                            className="pos-cart-batch-note"
                            title={selBatchMeta.batchId ? `Mã lô nội bộ: ${selBatchMeta.batchId}` : 'Lô đang chọn'}
                          >
                            Lô{' '}
                            <strong>
                              {batchDisplayOrdinal(batchCtx.batches, selBatchMeta.batchId) ?? '—'}
                            </strong>
                            {selBatchMeta.expiryYmd
                              ? ` · HSD ${formatExpiryYmdVi(selBatchMeta.expiryYmd)}`
                              : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="pos-col--dvt">
                        <div className="pos-dvt-dropdown-wrap">
                          <span className="pos-dvt-current-label" title="Đơn vị đang bán">
                            {normalizeCatalogUnitLabel(l.unitLabel)}
                          </span>
                          <select
                            className="pos-dvt-select pos-dvt-select--cart"
                            value={l.variantId}
                            onChange={(e) => setLineVariant(l.lineId, e.target.value)}
                            aria-label="Đơn vị tính"
                          >
                            {l.variantOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {normalizeCatalogUnitLabel(o.unitLabel)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="pos-col--qty">
                        <div className="pos-qty-cell-stack">
                          <div className="pos-qty-btns">
                            <button
                              type="button"
                              className="pos-qty-btn"
                              aria-label="Giảm số lượng"
                              onClick={() => bumpLineQty(l.lineId, -1)}
                            >
                              −
                            </button>
                            <input
                              ref={(el) => {
                                if (el) cartQtyInputRefs.current.set(l.lineId, el)
                                else cartQtyInputRefs.current.delete(l.lineId)
                              }}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className="pos-qty-input"
                              value={
                                cartQtyDraftByLine[l.lineId] !== undefined
                                  ? cartQtyDraftByLine[l.lineId]
                                  : formatCartQtyDisplay(l.qty)
                              }
                              onChange={(e) => {
                                const cleaned = sanitizeCartQtyTyping(e.target.value)
                                setCartQtyDraftByLine((m) => ({ ...m, [l.lineId]: cleaned }))
                              }}
                              onFocus={() => {
                                setSelectedCartLineId(l.lineId)
                                setCartQtyDraftByLine((m) => ({
                                  ...m,
                                  [l.lineId]: numberToQtyDraftString(l.qty),
                                }))
                              }}
                              onBlur={(e) => {
                                const str = sanitizeCartQtyTyping(e.target.value)
                                setLineQty(l.lineId, str)
                              }}
                              onKeyDown={(e) => onCartQtyInputKeyDown(e, l.lineId, idx)}
                              aria-label="Số lượng"
                            />
                            <button
                              type="button"
                              className="pos-qty-btn"
                              aria-label="Tăng số lượng"
                              onClick={() => bumpLineQty(l.lineId, 1)}
                            >
                              +
                            </button>
                          </div>
                          {showQtyConvSub ? (
                            <div
                              className="pos-cart-conv-qty-sub"
                              title="Số lượng quy đổi theo đơn vị nhỏ nhất (quy_doi / cột N)"
                            >
                              {convExpansion.qtyDisplay}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="pos-col--price">
                        {l.price.toLocaleString('vi-VN')}
                        <span className="pos-currency">đ</span>
                      </td>
                      <td className="pos-col--sum">
                        <strong>
                          {(
                            (Number(l.price) || 0) * effectiveCartLineQty(l, cartQtyDraftByLine)
                          ).toLocaleString('vi-VN')}{' '}
                          đ
                        </strong>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              {cart.length === 0 && (
                <p className="pos-table-empty">
                  Chưa có món — mở tab <strong>Bán chạy</strong> phía dưới hoặc dùng ô tìm <strong>F3</strong>.
                </p>
              )}
            </div>
          </div>
          </div>

          <div className="pos-right-rail">
          <aside className="pos-sidebar pos-sidebar--minimal">
            <div className="pos-sidebar-top">
              <div className="pos-sidebar-customer-toolbar">
                <div className="pos-sidebar-customer-field">
                  <span className="pos-sidebar-customer-icon" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <input
                    ref={customerSearchRef}
                    type="text"
                    className="pos-sidebar-customer-input"
                    placeholder="F10 - Tìm hoặc tạo khách hàng (F10)"
                    autoComplete="off"
                    value={customerQuery}
                    onChange={(e) =>
                      updateActiveOrder((o) => ({
                        ...o,
                        customerQuery: e.target.value,
                      }))
                    }
                    aria-label="Tìm hoặc tạo khách hàng"
                  />
                  {customerMatches.length > 0 && customerQuery.trim() !== '' && (
                    <ul className="pos-sidebar-customer-suggest" role="listbox">
                      {customerMatches.map((c, idx) => (
                        <li key={`${c.name}-${c.phone}-${idx}`}>
                          <button
                            type="button"
                            className="pos-sidebar-customer-suggest-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              updateActiveOrder((o) => ({
                                ...o,
                                customerName: c.name,
                                customerPhone: c.phone,
                                customerQuery: c.phone ? `${c.name} · ${c.phone}` : c.name,
                              }))
                            }}
                          >
                            <span className="pos-sidebar-customer-suggest-name">{c.name}</span>
                            {c.phone ? (
                              <span className="pos-sidebar-customer-suggest-phone">{c.phone}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  className="pos-sidebar-customer-plus"
                  aria-label="Thêm khách hàng mới"
                  title="Thêm khách (Họ tên, SĐT)"
                  onClick={() => {
                    const q = customerQuery.trim()
                    setNewCustomerName(q.includes('·') ? q.split('·')[0].trim() : q)
                    setNewCustomerPhone('')
                    setCustomerAddOpen(true)
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M12 5v14M5 12h14"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sellWholesaleMode}
                  className={`pos-sidebar-wholesale-pill${sellWholesaleMode ? ' pos-sidebar-wholesale-pill--on' : ''}`}
                  onClick={toggleSellWholesaleMode}
                >
                  Bán giá sỉ
                </button>
              </div>
            </div>
            <div className="pos-sidebar-scroll pos-sidebar-scroll--compact-pay">
              <label className="pos-side-block pos-side-input-wrap">
                <span className="pos-side-label">
                  Giảm giá <span className="pos-side-hint">(số tiền hoặc %, vd. 10%)</span>
                </span>
                <input
                  ref={discountInputRef}
                  type="text"
                  inputMode="decimal"
                  className="pos-side-input pos-side-input--discount"
                  placeholder="0 hoặc 10%"
                  value={orderDiscountStr}
                  onChange={(e) =>
                    updateActiveOrder((o) => ({
                      ...o,
                      orderDiscountStr: formatDiscountInputChange(e.target.value),
                    }))
                  }
                />
                {discountApplied > 0 && (
                  <span className="pos-side-discount-applied">
                    = −{formatVnDots(discountApplied)} đ
                  </span>
                )}
              </label>
              <label className="pos-side-block pos-side-input-wrap">
                <span className="pos-side-label">Ghi chú đơn</span>
                <input
                  type="text"
                  className="pos-side-input"
                  placeholder="Tùy chọn — lưu kèm đơn và báo cáo doanh thu"
                  autoComplete="off"
                  value={activeOrder?.orderNote ?? ''}
                  onChange={(e) =>
                    updateActiveOrder((o) => ({
                      ...o,
                      orderNote: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="pos-sidebar-pay-grow">
                <div className="pos-side-block pos-side-due">
                  <span className="pos-side-label pos-side-label--due">Tổng tiền cần khách trả</span>
                  <span className="pos-side-value pos-side-due-num">{formatVnDots(payTotal)} đ</span>
                </div>
                <label className="pos-side-block pos-side-input-wrap pos-side-cash-wrap">
                  <span className="pos-side-label">Tiền khách đưa</span>
                  <input
                    ref={cashGivenInputRef}
                    type="text"
                    inputMode="numeric"
                    className="pos-side-input pos-side-input--cash"
                    placeholder="0"
                    autoComplete="off"
                    value={cashGivenStr}
                    onChange={(e) =>
                      updateActiveOrder((o) => ({
                        ...o,
                        cashGivenStr: formatCashInputFromRaw(e.target.value),
                      }))
                    }
                    aria-label="Tiền khách đưa"
                  />
                  <div className="pos-quick-cash" role="group" aria-label="Gợi ý tiền mặt">
                    {QUICK_CASH_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        className="pos-quick-cash-btn"
                        onClick={() =>
                          updateActiveOrder((o) => ({
                            ...o,
                            cashGivenStr: formatVnDots(amt),
                          }))
                        }
                      >
                        {formatVnDots(amt)}
                      </button>
                    ))}
                  </div>
                </label>
                <div className="pos-side-block pos-side-block--change">
                  <span className="pos-side-label">Tiền thừa trả khách</span>
                  <span
                    className={`pos-side-value pos-side-change-num ${
                      changeDue == null ? '' : changeDue >= 0 ? 'pos-change--ok' : 'pos-change--bad'
                    }`}
                  >
                    {changeDue == null ? '—' : `${formatVnDots(changeDue)} đ`}
                  </span>
                </div>
              </div>
            </div>
            <div className="pos-sidebar-footer-actions">
              <button
                type="button"
                className="pos-btn-checkout"
                onClick={handleThanhToan}
                disabled={cart.length === 0}
              >
                THANH TOÁN (F1)
              </button>
            </div>
          </aside>
          </div>
          <div className="pos-main-checkout-footer">
            <div className="pos-main-checkout-footer-left">
              <div className="pos-left-dock-wrap">
                <div
                  className={`pos-bottom-dock pos-bottom-dock--wide pos-bottom-dock--checkout-footer${
                    posDockExpanded ? '' : ' pos-bottom-dock--collapsed'
                  }`}
                  role="region"
                  aria-label="Thao tác nhanh và sản phẩm bán chạy"
                >
                  <div className="pos-bottom-dock-top">
                    <div className="pos-bottom-dock-tabs" role="tablist" aria-label="Panel dưới">
                      <button
                        type="button"
                        role="tab"
                        id="pos-tab-actions"
                        aria-selected={posDockTab === 'actions'}
                        aria-controls="pos-panel-actions"
                        className={`pos-bottom-tab${posDockTab === 'actions' ? ' pos-bottom-tab--active' : ''}`}
                        onClick={() => {
                          setPosDockTab('actions')
                          setPosDockExpanded(true)
                        }}
                      >
                        <span className="pos-bottom-tab-text">Thao tác nhanh</span>
                        {posDockTab === 'actions' && posDockExpanded && (
                          <span className="pos-bottom-tab-check" aria-hidden>
                            ✓
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        id="pos-tab-products"
                        aria-selected={posDockTab === 'products'}
                        aria-controls="pos-panel-products"
                        className={`pos-bottom-tab${posDockTab === 'products' ? ' pos-bottom-tab--active' : ''}`}
                        onClick={() => {
                          setPosDockTab('products')
                          setPosDockExpanded(true)
                        }}
                      >
                        <span className="pos-bottom-tab-text">Bán chạy</span>
                        {posDockTab === 'products' && posDockExpanded && (
                          <span className="pos-bottom-tab-check" aria-hidden>
                            ✓
                          </span>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="pos-bottom-dock-chevron"
                      aria-expanded={posDockExpanded}
                      aria-label={posDockExpanded ? 'Thu gọn panel' : 'Mở rộng panel'}
                      onClick={() => setPosDockExpanded((v) => !v)}
                    >
                      <span aria-hidden>{posDockExpanded ? '▾' : '▴'}</span>
                    </button>
                  </div>

                  {posDockExpanded && (
                    <div
                      className="pos-bottom-dock-body"
                      id={posDockTab === 'actions' ? 'pos-panel-actions' : 'pos-panel-products'}
                      role="tabpanel"
                      aria-labelledby={posDockTab === 'actions' ? 'pos-tab-actions' : 'pos-tab-products'}
                    >
                      {posDockTab === 'actions' && (
                        <div className="pos-quick-actions-stack pos-quick-actions-stack--footer-only">
                          <div className="pos-quick-featured-row pos-quick-featured-row--footer-fill">
                            <button
                              type="button"
                              className="pos-quick-action-btn pos-quick-action-btn--featured pos-quick-action-btn--featured-inline"
                              onClick={quickXemDanhSachDon}
                            >
                              <span className="pos-quick-action-featured-inner">
                                <PosQuickDockIcon
                                  name="clipboard-list"
                                  svgClassName="pos-quick-action-svg--featured"
                                />
                                <span className="pos-quick-action-label">Danh sách đơn hàng</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="pos-quick-action-btn pos-quick-action-btn--featured pos-quick-action-btn--featured-inline"
                              onClick={openReturnPickModal}
                            >
                              <span className="pos-quick-action-featured-inner">
                                <PosQuickDockIcon name="return" svgClassName="pos-quick-action-svg--featured" />
                                <span className="pos-quick-action-label">Đổi trả hàng</span>
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                      {posDockTab === 'products' && (
                        <>
                          <p className="pos-bottom-dock-hint">
                            Sản phẩm bán chạy theo lịch sử đơn — chạm để thêm <strong>1</strong> vào giỏ. Tìm
                            thêm tại ô chính <strong>F3</strong> phía trên.
                          </p>
                          <div className="pos-bestseller-scroll">
                            <div className="pos-bestseller-grid">
                              {bestSellerProducts.map((p) => {
                                const priceNum = Math.round(
                                  effectiveSellUnitPrice(p, sellWholesaleMode)
                                )
                                const stockVal = catalogStockLabel(products, p)
                                return (
                                  <button
                                    type="button"
                                    key={p.id}
                                    className="pos-bestseller-tile"
                                    title={p.code ? `${p.name} · ${p.code}` : (p.name || '')}
                                    onClick={() => {
                                      if (p.multiUnit) setUnitPickerProduct(p)
                                      else addToCartWithVariant(p, p.id)
                                    }}
                                  >
                                    <span className="pos-bestseller-stock" aria-label="Tồn kho">
                                      {stockVal != null
                                        ? `Tồn ${formatQtyOrStockVi(stockVal)}`
                                        : 'Tồn —'}
                                    </span>
                                    {p.multiUnit ? (
                                      <span className="pos-bestseller-dvt">ĐƠN VỊ TÍNH</span>
                                    ) : null}
                                    <span className="pos-bestseller-name">
                                      {p.name || 'Không tên'}
                                    </span>
                                    <span className="pos-bestseller-price">
                                      {formatVnDots(priceNum)} đ
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                            {bestSellerProducts.length === 0 && (
                              <p className="pos-bottom-dock-empty">Chưa có sản phẩm trong danh mục.</p>
                            )}
                          </div>
                          <div className="pos-bottom-dock-foot">
                            <span className="pos-bottom-dock-count">
                              {bestSellerProducts.length.toLocaleString('vi-VN')} mặt hàng · sắp xếp theo bán
                              chạy
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {returnPickModalOpen && activeView === 'sell' && (
        <div
          className="pos-return-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeReturnPickModal()
          }}
        >
          <div
            className="pos-return-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-return-pick-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pos-return-pick-title" className="pos-return-modal-title">
              Chọn đơn để đổi trả hàng
            </h2>
            <p className="pos-return-modal-lead">Hiển thị tối đa 6 đơn bán gần nhất (theo thời gian thanh toán).</p>
            {returnPickModalLoading ? (
              <p className="pos-return-modal-muted">Đang tải danh sách…</p>
            ) : returnPickModalOrders.length === 0 ? (
              <p className="pos-return-modal-muted">Chưa có đơn đã thanh toán trên thiết bị này.</p>
            ) : (
              <div className="pos-return-modal-table-wrap">
                <table className="pos-return-modal-table">
                  <thead>
                    <tr>
                      <th>Mã đơn</th>
                      <th>Thời gian</th>
                      <th className="pos-return-modal-th-num">Tổng tiền</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {returnPickModalOrders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.invoiceNo || '—'}</td>
                        <td>
                          {(() => {
                            try {
                              return new Date(o.createdAt).toLocaleString('vi-VN')
                            } catch {
                              return '—'
                            }
                          })()}
                        </td>
                        <td className="pos-return-modal-td-num">
                          {Number(o.total ?? 0).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="pos-return-modal-td-act">
                          <button
                            type="button"
                            className="pos-return-modal-pick-btn"
                            onClick={() => onConfirmReturnPickOrder(o.id)}
                          >
                            Chọn đơn
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pos-return-modal-footer">
              <button type="button" className="pos-return-modal-close-btn" onClick={closeReturnPickModal}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {customerAddOpen && activeView === 'sell' && (
        <div
          className="pos-cust-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCustomerAddOpen(false)
              setNewCustomerName('')
              setNewCustomerPhone('')
            }
          }}
        >
          <div
            className="pos-cust-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-cust-add-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pos-cust-add-title" className="pos-cust-modal-title">
              Thêm khách hàng
            </h2>
            <label className="pos-cust-modal-field">
              <span className="pos-cust-modal-label">Họ tên</span>
              <input
                type="text"
                className="pos-cust-modal-input"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                autoComplete="name"
                autoFocus
              />
            </label>
            <label className="pos-cust-modal-field">
              <span className="pos-cust-modal-label">Số điện thoại</span>
              <input
                type="tel"
                className="pos-cust-modal-input"
                value={newCustomerPhone}
                onChange={(e) => setNewCustomerPhone(e.target.value)}
                autoComplete="tel"
              />
            </label>
            <div className="pos-cust-modal-actions">
              <button
                type="button"
                className="pos-cust-modal-btn pos-cust-modal-btn--ghost"
                onClick={() => {
                  setCustomerAddOpen(false)
                  setNewCustomerName('')
                  setNewCustomerPhone('')
                }}
              >
                Hủy
              </button>
              <button type="button" className="pos-cust-modal-btn" onClick={submitNewCustomer}>
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {batchPickLineId && activeView === 'sell' && (() => {
        const line = cart.find((x) => x.lineId === batchPickLineId)
        if (!line) return null
        const ctx = resolveLineBatchContext(products, line)
        const allBatches = ctx?.batches ?? []
        const q = stripAccents(batchSearch.toLowerCase().trim())
        const batches = !q
          ? allBatches
          : allBatches.filter((b) => {
              const ord = String(batchDisplayOrdinal(allBatches, b.batchId) ?? '')
              const hay = stripAccents(`${b.batchId} ${b.expiryYmd} ${ord}`.toLowerCase())
              return hay.includes(q)
            })
        return (
          <div
            className="pos-batch-backdrop"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setBatchPickLineId(null)
                setBatchDraftId(null)
                setBatchSearch('')
              }
            }}
          >
            <div
              className="pos-batch-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pos-batch-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pos-batch-modal-head">
                <h2 id="pos-batch-modal-title" className="pos-batch-modal-title">
                  Chọn lô — hạn sử dụng
                </h2>
                <button
                  type="button"
                  className="pos-batch-modal-close"
                  aria-label="Đóng"
                  onClick={() => {
                    setBatchPickLineId(null)
                    setBatchDraftId(null)
                    setBatchSearch('')
                  }}
                >
                  ×
                </button>
              </div>
              <div className="pos-batch-modal-search">
                <span className="pos-batch-search-ic" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <input
                  type="search"
                  className="pos-batch-search-input"
                  placeholder="Tìm kiếm lô"
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="pos-batch-table-wrap">
                <table className="pos-batch-table">
                  <thead>
                    <tr>
                      <th className="pos-batch-col-stt">STT</th>
                      <th className="pos-batch-col-pick">Chọn</th>
                      <th>HSD</th>
                      <th className="pos-batch-col-num">Tồn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="pos-batch-empty">
                          {allBatches.length === 0 ? 'Chưa có lô hàng.' : 'Không khớp tìm kiếm.'}
                        </td>
                      </tr>
                    ) : (
                      batches.map((b) => {
                        const active = batchDraftId === b.batchId
                        const ord = batchDisplayOrdinal(allBatches, b.batchId) ?? 0
                        return (
                          <tr
                            key={b.batchId}
                            className={active ? 'pos-batch-row--active' : ''}
                            onClick={() => setBatchDraftId(b.batchId)}
                          >
                            <td className="pos-batch-col-stt" title={b.batchId ? `Mã lô: ${b.batchId}` : undefined}>
                              {ord || '—'}
                            </td>
                            <td className="pos-batch-col-pick">
                              <input
                                type="radio"
                                className="pos-batch-radio"
                                checked={active}
                                onChange={() => setBatchDraftId(b.batchId)}
                                aria-label={`Chọn lô thứ ${ord}`}
                              />
                            </td>
                            <td>{b.expiryYmd ? formatExpiryYmdVi(b.expiryYmd) : '—'}</td>
                            <td className="pos-batch-col-num">{formatQtyOrStockVi(b.qty)}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="pos-batch-modal-actions">
                <button
                  type="button"
                  className="pos-batch-btn pos-batch-btn--ghost"
                  onClick={() => {
                    setBatchPickLineId(null)
                    setBatchDraftId(null)
                    setBatchSearch('')
                  }}
                >
                  Thoát
                </button>
                <button
                  type="button"
                  className="pos-batch-btn pos-batch-btn--primary"
                  disabled={!batchDraftId || batches.length === 0}
                  onClick={() => {
                    if (!batchDraftId || !batchPickLineId) return
                    setCart((prev) =>
                      prev.map((x) =>
                        x.lineId === batchPickLineId ? { ...x, selectedBatchId: batchDraftId } : x
                      )
                    )
                    setBatchPickLineId(null)
                    setBatchDraftId(null)
                    setBatchSearch('')
                  }}
                >
                  Áp dụng
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {posMaHhLienConvModal && activeView === 'sell' && (
        <div
          className="dvt-pick-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-ma-hh-lq-title"
          onClick={(e) => e.target === e.currentTarget && setPosMaHhLienConvModal(null)}
        >
          <div className="dvt-pick-modal pos-ma-hh-lq-modal">
            <div className="dvt-pick-head">
              <h2 id="pos-ma-hh-lq-title">Chi tiết nhóm quy đổi</h2>
              <button
                type="button"
                className="dvt-pick-close"
                aria-label="Đóng"
                onClick={() => setPosMaHhLienConvModal(null)}
              >
                ×
              </button>
            </div>
            <p className="pos-ma-hh-lq-sub">
              <span className="pos-ma-hh-lq-k">ma_hh_lien_quan:</span>{' '}
              <strong>{posMaHhLienConvModal.linkKey}</strong>
              {posMaHhLienConvModal.lineHint ? (
                <>
                  {' '}
                  · Giỏ: <span className="pos-ma-hh-lq-hint">{posMaHhLienConvModal.lineHint}</span>
                </>
              ) : null}
            </p>
            <div className="pos-ma-hh-lq-scroll">
              <table className="pos-ma-hh-lq-table">
                <thead>
                  <tr>
                    <th>Mã hàng</th>
                    <th>dvt</th>
                    <th>quy_doi</th>
                    <th>gia_ban</th>
                  </tr>
                </thead>
                <tbody>
                  {posMaHhLienConvModal.groupProducts.map((v, vi) => (
                    <tr key={String(v.id ?? `${v.code}-${vi}`)}>
                      <td>{String(v.code ?? '').trim() || '—'}</td>
                      <td>{posMaHhModalDvtCell(v)}</td>
                      <td>{posMaHhModalQuyCell(v)}</td>
                      <td>{posMaHhModalGiaBanCell(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="dvt-pick-cancel"
              onClick={() => setPosMaHhLienConvModal(null)}
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {unitPickerProduct && activeView === 'sell' && (
        <div
          className="dvt-pick-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dvt-pick-title"
          onClick={(e) => e.target === e.currentTarget && setUnitPickerProduct(null)}
        >
          <div className="dvt-pick-modal">
            <div className="dvt-pick-head">
              <h2 id="dvt-pick-title">Chọn đơn vị bán</h2>
              <button
                type="button"
                className="dvt-pick-close"
                aria-label="Đóng"
                onClick={() => setUnitPickerProduct(null)}
              >
                ×
              </button>
            </div>
            <p className="dvt-pick-product">{unitPickerProduct.name || 'Sản phẩm'}</p>
            <ul className="dvt-pick-list">
              {(unitPickerProduct.groupVariants || [unitPickerProduct]).map((v) => {
                const u = (v.unitLabel || '').trim()
                const label = `— ${normalizeCatalogUnitLabel(u)}`
                const sal = salableQtyInVariantUnitsForPos(products, unitPickerProduct, v)
                const salStr =
                  sal != null && Number.isFinite(sal) ? `Có thể bán: ${formatQtyOrStockVi(sal)}` : null
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="dvt-pick-option"
                      onClick={() => {
                        addToCartWithVariant(unitPickerProduct, v.id)
                        setUnitPickerProduct(null)
                        afterSuccessfulHeaderAdd()
                      }}
                    >
                      <span className="dvt-pick-option-main">Bán {label}</span>
                      <span className="dvt-pick-option-sub">
                        {v.code} ·{' '}
                        {effectiveSellUnitPrice(v, sellWholesaleMode).toLocaleString('vi-VN')} đ
                        {salStr ? ` · ${salStr}` : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              className="dvt-pick-cancel"
              onClick={() => setUnitPickerProduct(null)}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {activeView === 'sell' && products.length === 0 && initialCatalogLoadPending && !error && (
        <div className="welcome welcome--loading">
          <p>Đang tải dữ liệu hàng từ máy chủ…</p>
        </div>
      )}
      {activeView === 'sell' && products.length === 0 && !initialCatalogLoadPending && (
        <div className="welcome">
          <p>Chọn file CSV (UTF-8) xuất từ KiotViet hoặc có cột <strong>mã</strong>,{' '}
            <strong>tên</strong>, <strong>giá</strong> tương ứng.</p>
          <p className="welcome-sub">
            Hỗ trợ file phân cách bằng <strong>dấu chấm phẩy (;)</strong> hoặc dấu phẩy (tự nhận
            theo dòng tiêu đề). Cột <strong>Giá vốn</strong>, <strong>Mã HH Liên Kết</strong>,{' '}
            <strong>Đơn vị tính</strong>, <strong>Quy đổi</strong> (nếu có) để gom nhóm và báo cáo.
          </p>
        </div>
      )}
    </div>
  )
}
