import {
  Fragment,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import debounce from 'lodash/debounce'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildK80ReceiptHtml, RECEIPT_STORE_NAME } from './receiptHtml.js'
import AdminHubRevenuePanel from './AdminHubRevenuePanel.jsx'
import AdminHubTabErrorBoundary from './AdminHubTabErrorBoundary.jsx'
import { AdminHubMobileChrome } from './AdminHubMobileChrome.jsx'
import { AdminHubComboBomPanel } from './AdminHubComboBomPanel.jsx'
import { AdminHubComboModal } from './AdminHubComboModal.jsx'
import AdminHubGoodsCreateModal from './AdminHubGoodsCreateModal.jsx'
import BarcodeScanModal from './BarcodeScanModal.jsx'
import { blurActiveElement } from './scanFeedback.js'
import { AdminHubGoodsExpandedBelow } from './AdminHubGoodsExpandedBelow.jsx'
import { AdminHubGoodsVirtualList } from './AdminHubGoodsVirtualList.jsx'
import { AutoSizer } from 'react-virtualized-auto-sizer'
import {
  applyInboundLineUnitChange,
  buildInboundDvtSelectOptions,
  findVariantContext,
  resolveInboundCatalogProductVariant,
} from './inboundFormUnitHelpers.js'
import { getDoanhThuAbsUrl, getInboundCreateAbsUrl, readStoredSellerId } from './sellerRoleStorage.js'
import { loadEInvoiceSettings } from './eInvoiceSettings.js'
import { clearAllOrders, deleteOrderById, getAllOrders, saveOrder } from './ordersDb.js'
import { exportOrdersToExcel } from './exportOrdersExcel.js'
import { exportGoodsRowsToKiotCsv } from './exportProductsExcel.js'
import { mergeFlatCatalogRowsBySmartUomGroups, normalizeBarcodeValue } from './catalogCsv.js'
import { suggestNextProductCodeFromCatalog, allocateAutoHhSkuIfEmpty } from './autoProductSku.js'
import { formatMoneyThousandsTyping } from './moneyInputFormat.js'
import { parseCatalogBlobFile } from './catalogParseClient.js'
import {
  filterAndSortGoodsRowsSimple,
  applyGoodsListSort,
  posQueryLooksLikeBarcodeKeyInput,
  prepareCatalogForPosSearch,
  suggestCatalogVariantPairsV9,
} from './catalogSearchSimple.js'
import {
  applyRestoredQtyToCatalog,
  buildComboCartSaleDeltaByVariantId,
  buildNonComboDeductionByMaGoc,
  collectCartSaleTouchedVariantIds,
  getComboBom,
  isComboCatalogProduct,
  shouldShowComboBomTab,
} from './comboCatalog.js'
import { flattenCatalogToGoodsSearchRows } from './catalogGoodsSearchRows.js'
import CostAdjustQuickPickModal from './CostAdjustQuickPickModal.jsx'
import AdminHubInboundDraftLineRow from './AdminHubInboundDraftLineRow.jsx'
import InboundThuongHieuAutocomplete, {
  collectUniqueThuongHieuFromCatalog,
} from './InboundThuongHieuAutocomplete.jsx'
import { GOODS_DATE_PRESET_OPTIONS, resolveGoodsCreatedAtRangeMs } from './adminHubGoodsDateRange.js'
import EntityPersonModal from './EntityPersonModal.jsx'
import SupplierManager from './SupplierManager.jsx'
import { SimpleVirtualList } from './SimpleVirtualList.jsx'
import { useViewportMaxWidth } from './useViewportMaxWidth.js'
import {
  fetchCustomersFromSupabase,
  fetchEmployeesFromSupabase,
  fetchSuppliersFromSupabase,
  formatPostgrestErrorForUser,
  insertCustomerSupabase,
  insertEmployeeSupabase,
  insertSupplierSupabase,
  updateCustomerSupabase,
  updateEmployeeSupabase,
  mergeCustomerListsDedupe,
  mergeSupplierListsDedupe,
} from './entityContactsRepository.js'
import {
  buildVariantPosSearchHaystack,
  normalizeCatalogSearchCompactKey,
  normalizeCatalogSearchString,
  normalizeCatalogUnitLabel,
  refreshCatalogSearchTexts,
} from './productUnits.js'
import {
  computePosOrderStatusFromItems,
  normalizePosOrder,
  posOrderCanPartialReturn,
  posOrderLineReturnableQty,
  posOrderSaleQtyDeltaMap,
  posOrderStatusLabel,
  buildOrderDeleteRestoreCartLines,
  buildPosReturnRestoreCartLines,
  resolvePosItemVariantId,
  posReturnLedgerAmountsFromStoredOrderLine,
} from './posOrderAdmin.js'
import {
  RANGE_CUSTOM,
  RANGE_LABELS,
  RANGE_LAST_7,
  RANGE_THIS_MONTH,
  RANGE_TODAY,
  RANGE_YESTERDAY,
  filterInboundOrdersForReport,
  filterOrdersForReport,
  filterPosReturnLedgerEntriesForReport,
  mapReturnLedgerToRevenueDisplayRows,
  mergeRevenueTableRows,
  orderLineCostTotal,
  orderLineProfit,
  orderLineRevenue,
  orderReportCostFromCatalog,
  orderTotalCost,
  orderTotalProfit,
} from './reportUtils.js'
import { clearPosReturnDayLedger } from './posReturnDayLedger.js'
import {
  deletePosReturnLedgerByOrderId,
  fetchPosReturnLedgerEntries,
  insertPosReturnLedgerEntry,
  ledgerProfitSubFromParts,
  migrateLocalPosReturnLedgerToSupabaseOnce,
  POS_RETURN_LEDGER_BUMP_EVENT,
} from './posReturnLedgerRepository.js'
import { appendInboundCostChangeNotifications } from './appNotificationsStorage.js'
import { ORDERS_SYNC_BUMP_EVENT } from './ordersSyncEvents.js'
import { buildAdminHubOrderDetailHref, buildOpenHangHoaGoodsAbsUrl } from './adminHubDeepLink.js'
import { hubMainTabFromPathname, pathForMainNavTab } from './adminHubPathSync.js'
import AdminHubStockCheckPanel from './AdminHubStockCheckPanel.jsx'
import AdminHubCostAdjustPanel from './AdminHubCostAdjustPanel.jsx'
import {
  STOCK_CHECK_STORAGE_KEY,
  appendAutoCompletedStockCheck,
  loadStockCheckVouchers,
  saveStockCheckVouchers,
  stockQtyMeaningfullyChanged,
} from './stockCheckStorage.js'
import { formatInboundTonLabelVi } from './displayStockQty.js'
import {
  COST_ADJUST_SYNC_BUMP_KEY,
  appendCompletedCostAdjustFromGoods,
  loadCostAdjustVouchersFromStore,
  saveCostAdjustVouchersToStore,
} from './costAdjustStorage.js'
import { buildVariantStockLedgerRows } from './stockLedgerForVariant.js'
import {
  fetchInventoryLogsByProductId,
  INVENTORY_LOG_UPDATED_EVENT,
  mapInventoryLogDbRowToDisplay,
  buildPosReturnInventoryLogRows,
  insertInventoryLogRows,
  staffNameForInventoryLog,
} from './inventoryLogRepository.js'
import './dashboard.css'
import './dashboard-dark.css'
import './adminHub.css'
import './barcodeScan.css'
import './costAdjustCreatePage.css'
import {
  CATALOG_SNAPSHOT_STORAGE_KEY,
  CATALOG_SYNC_BUMP_KEY,
  fetchProducts,
  fetchProductsCostAndStockByMaHang,
  readCatalogSnapshotSync,
  flattenDisplayCatalogToVariants,
  persistCatalogSnapshotAndProducts,
  updateProductDisplayVariantsSequential,
  insertProductDisplayVariantsSequential,
  revalidateCatalogFromStore,
  describeCatalogPersistError,
  deleteProductsForRemovedVariants,
  updateProductThuongHieuByMaHang,
} from './catalogRepository.js'
import {
  bumpInboundSync,
  fetchInboundInvoices,
  INBOUND_SYNC_BUMP_EVENT,
} from './supabaseInboundHistory.js'
import {
  collectInboundMaHangCodes,
  computeInboundFulfillmentPlan,
} from './inboundWeightedCost.js'
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'
import { persistCatalogStockRestoreFromCartLines } from './catalogStockRestore.js'
import { buildDisplayCatalog, normalizeGroupRoot } from './productUnits.js'
import {
  buildCatalogVariantsFromUnitModal,
  createUnitModalLinesFromVariants,
  newUnitModalRowKey,
  parseMoneyDigitsVi,
  parsePositiveConversion,
  propagateBaseUnitMoney,
  sortUnitModalLinesByConversion,
  sortVariantsSmallestUnitFirst,
  validateUnitModalLines,
} from './goodsUnitSetupModalLogic.js'

/** Đủ id để ghép URL deep-link Admin Hub (ah_pos_order / ah_inbound_order / ah_pos_return). */
function stockLedgerDocLinkHasTarget(link) {
  if (!link || typeof link !== 'object') return false
  if (link.type === 'pos' && String(link.posOrderId || '').trim()) return true
  if (link.type === 'inbound' && String(link.inboundOrderId || '').trim()) return true
  if (link.type === 'pos_return' && String(link.returnLedgerId || '').trim()) return true
  return false
}

/** URL tuyệt đối mở tab mới tới chi tiết chứng từ; rỗng nếu không hợp lệ (không dùng #). */
function getStockLedgerDetailAbsoluteUrl(link) {
  if (typeof window === 'undefined' || !stockLedgerDocLinkHasTarget(link)) return ''
  const raw = buildAdminHubOrderDetailHref(link)
  if (!raw || raw === '#') return ''
  try {
    return new URL(raw, window.location.href).toString()
  } catch {
    return ''
  }
}

/** Mã vạch/QR đã chuẩn hóa có trùng bất kỳ biến thể nào trong catalog (snapshot IndexedDB / props). */
function catalogHasNormalizedBarcode(catalogProducts, needleNorm) {
  const n = String(needleNorm ?? '').trim()
  if (!n) return false
  const flat = (Array.isArray(catalogProducts) ? catalogProducts : []).flatMap(
    (p) => p.groupVariants || [p]
  )
  return flat.some((v) => String(normalizeBarcodeValue(v.barcode ?? '')) === n)
}

const POS_CUSTOMERS_KEY = 'csv-preview-pos-customers-v1'

/** Ưu tiên `createdAtMs` biến thể; fallback `raw.created_at` / `created_at` (Supabase) — khớp lọc «Ngày tạo». */
function effectiveCreatedAtMsFromVariant(v) {
  const n = Number(v?.createdAtMs)
  if (Number.isFinite(n) && n > 0) return n
  const raw = v?.raw
  let iso
  if (raw && typeof raw === 'object') {
    iso = raw.created_at ?? raw.createdAt
  }
  if (iso == null || iso === '') {
    iso = v?.created_at ?? v?.createdAt
  }
  if (iso != null && String(iso).trim() !== '') {
    const ms = Date.parse(String(iso))
    if (Number.isFinite(ms) && ms > 0) return ms
  }
  return 0
}

function flattenCatalogToGoodsRows(products) {
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
      const ton_kho = stock
      const createdAtMs = effectiveCreatedAtMsFromVariant(v)
      const okTime = createdAtMs > 0
      const displayTime = okTime ? new Date(createdAtMs).toLocaleString('vi-VN') : '—'
      const unitLabel = normalizeCatalogUnitLabel(v.unitLabel)
      const dvt = unitLabel
      const barcode = String(normalizeBarcodeValue(v.barcode ?? '')).trim()
      rows.push({
        id,
        code,
        name,
        ten_hang: name,
        nameSearch: buildVariantPosSearchHaystack(
          code,
          v.nameRaw || p.nameRaw,
          v.name || p.name,
          unitLabel,
          v.linkedMasterCode ?? p.linkedMasterCode
        ),
        unitLabel,
        dvt,
        barcode,
        brand,
        price,
        cost,
        stock,
        ton_kho,
        quy_doi:
          v.raw?.quy_doi ??
          v.quy_doi ??
          v.conversionValue ??
          v.conversion ??
          v.heSoQuyDoi ??
          v.quyDoi ??
          '',
        createdAtMs: okTime ? createdAtMs : 0,
        displayTime,
      })
    }
  }
  rows.sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs
    return String(a.code).localeCompare(String(b.code), 'vi')
  })
  return rows
}

/** `/hang-hoa/:id` hoặc `?id=` — khớp variant id, mã hàng, hoặc mã vạch sau khi catalog đã tải. */
function resolveGoodsVariantIdFromGoodsDeepLink(catalogList, raw) {
  const s = String(raw ?? '').trim()
  if (!s || !catalogList?.length) return null
  if (findVariantContext(catalogList, s)) return s
  for (const p of catalogList) {
    for (const v of p.groupVariants || [p]) {
      if (String(v.code ?? '').trim() === s) return String(v.id)
      const bc = normalizeBarcodeValue(v.barcode ?? '')
      if (bc && String(bc).trim() === s) return String(v.id)
    }
  }
  return null
}

function parseAdminStockNullable(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (s === '' || s === '-') return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Giá trong ô chỉnh sửa: phân tách hàng nghìn bằng dấu phẩy (vd. 132,000). */
function formatMoneyDraftVi(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Khách hàng trên thẻ đơn POS (mobile). */
function formatPosOrderCustomerDisplay(order) {
  const name = String(order?.customerName ?? '').trim()
  const phone = String(order?.customerPhone ?? '').trim()
  if (name && phone) return `${name} · ${phone}`
  return name || phone || '—'
}

function renderInboundLineCodeLink(ln) {
  const code = ln.code || '—'
  const ma_hang = String(ln.ma_hang ?? ln.code ?? '').trim()
  const url = ln.variantId ? buildOpenHangHoaGoodsAbsUrl(ln.variantId, ma_hang) : ''
  if (!url) return code
  return (
    <a
      className="ah-inbound-line-code-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Mở chi tiết sản phẩm (tab mới)"
    >
      {code}
    </a>
  )
}

function renderInboundLineNameButton(ln, onOpenQuickEdit, catalogList) {
  const name = ln.name || '—'
  const vid = resolveVariantIdForInboundLine(ln, catalogList)
  if (!vid || typeof onOpenQuickEdit !== 'function') return name
  return (
    <button
      type="button"
      className="ah-inbound-product-name-btn ah-inbound-product-name-btn--clickable"
      onClick={(e) => {
        e.stopPropagation()
        onOpenQuickEdit(vid)
      }}
      title="Sửa nhanh sản phẩm"
    >
      {name}
    </button>
  )
}

/** Tìm variant id từ dòng nhập — ưu tiên variantId, fallback mã hàng. */
function resolveVariantIdForInboundLine(ln, catalogList) {
  const vid = String(ln?.variantId ?? '').trim()
  if (vid && catalogList?.length) {
    const ctx = findVariantContext(catalogList, vid)
    if (ctx?.clicked?.id) return String(ctx.clicked.id)
    if (ctx) return vid
  }
  const needle = String(ln?.code ?? ln?.ma_hang ?? '').trim().toLowerCase()
  if (!needle || !Array.isArray(catalogList)) return vid
  for (const p of catalogList) {
    const vars = Array.isArray(p?.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
    const v = vars.find((x) => String(x?.code ?? '').trim().toLowerCase() === needle)
    if (v?.id != null && String(v.id).trim()) return String(v.id)
  }
  return vid
}

function parseMoneyDraftVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

/** Phần trăm chiết khấu đơn (0–100), cho phép dấu thập phân. */
function parsePercentDraftVi(raw) {
  const s = String(raw ?? '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
  if (!s) return 0
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function buildGoodsDetailDraft(v) {
  if (!v) return null
  return {
    name: String(v.name ?? ''),
    code: String(v.code ?? ''),
    barcode: String(v.barcode ?? ''),
    stockQty:
      v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? String(v.stockQty) : '',
    stockNormMin:
      v.stockNormMin != null && Number.isFinite(Number(v.stockNormMin))
        ? String(v.stockNormMin)
        : '',
    cost: formatMoneyDraftVi(Number(v.cost) || 0),
    price: formatMoneyDraftVi(Number(v.price) || 0),
    wholesalePrice: formatMoneyDraftVi(Number(v.wholesalePrice) || 0),
    brand: String(v.brand ?? ''),
    weightRaw: String(v.weightRaw ?? ''),
  }
}

const TAB_OVERVIEW = 'overview'
const TAB_GOODS = 'goods'
const TAB_STOCK_CHECK = 'stock_check'
const TAB_COST_ADJUST = 'cost_adjust'
const TAB_INBOUND = 'inbound'
/** Tab tạm: form tạo phiếu nhập (full width, đóng sau Lưu tạm / Hoàn thành). */
const TAB_INBOUND_DRAFT = 'inbound_draft'
const TAB_ORDERS = 'orders'
const TAB_CUSTOMERS = 'customers'
const TAB_STAFF = 'staff'
const TAB_SUPPLIER = 'supplier'

const NAV_ITEMS = [
  { id: TAB_OVERVIEW, label: 'Doanh thu' },
  { id: TAB_GOODS, label: 'Hàng hóa' },
  { id: TAB_STOCK_CHECK, label: 'Kiểm hàng' },
  { id: TAB_COST_ADJUST, label: 'Điều chỉnh giá vốn' },
  { id: TAB_INBOUND, label: 'Nhập hàng' },
  { id: TAB_ORDERS, label: 'Đơn hàng' },
  { id: TAB_CUSTOMERS, label: 'Khách hàng' },
  { id: TAB_STAFF, label: 'Nhân viên' },
  { id: TAB_SUPPLIER, label: 'Nhà cung cấp' },
]

/** Tab chi tiết SP động: `solo_product:<encodeURIComponent(variantId)>` — có thể mở nhiều tab cạnh nhau. */
const SOLO_PRODUCT_TAB_PREFIX = 'solo_product:'

/** Đa nhiệm 5–7 tab SP; giới hạn nhẹ để tránh treo UI. */
const MAX_OPEN_PRODUCT_DETAIL_TABS = 8

function toSoloProductTabId(variantId) {
  return `${SOLO_PRODUCT_TAB_PREFIX}${encodeURIComponent(String(variantId))}`
}

function parseSoloProductTabId(tab) {
  const s = String(tab ?? '')
  if (!s.startsWith(SOLO_PRODUCT_TAB_PREFIX)) return null
  try {
    return decodeURIComponent(s.slice(SOLO_PRODUCT_TAB_PREFIX.length))
  } catch {
    return null
  }
}

function isSoloProductTabId(tab) {
  return String(tab ?? '').startsWith(SOLO_PRODUCT_TAB_PREFIX)
}

/** Tab con chi tiết SP (dòng Hàng hóa mở rộng + tab solo): 'tonkho' = Mô tả, 'lichsu' = Lịch sử kho. */
const GOODS_DETAIL_VIEW_TONKHO = 'tonkho'
const GOODS_DETAIL_VIEW_LICHSU = 'lichsu'
const GOODS_DETAIL_VIEW_COMBO = 'combo_tp'

const DESKTOP_LAYOUT_MQ = '(min-width: 769px)'

function scrollElementIntoViewCenter(el) {
  if (!el || typeof el.scrollIntoView !== 'function') return
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

const GOODS_SCROLL_BEFORE_MODAL_MS = 320

function scrollGoodsRowIntoView(variantId, listApi, onDone) {
  const id = String(variantId ?? '').trim()
  if (!id || typeof document === 'undefined') {
    onDone?.()
    return
  }
  if (typeof window !== 'undefined' && !window.matchMedia(DESKTOP_LAYOUT_MQ).matches) {
    onDone?.()
    return
  }
  listApi?.scrollVariantIntoViewCenter?.(id)
  const el = document.querySelector(`[data-goods-row-id="${CSS.escape(id)}"]`)
  scrollElementIntoViewCenter(el)
  if (onDone) {
    window.setTimeout(onDone, GOODS_SCROLL_BEFORE_MODAL_MS)
  }
}

function scrollInboundLineIntoView(lineId) {
  const id = String(lineId ?? '').trim()
  if (!id || typeof document === 'undefined') return
  if (typeof window !== 'undefined' && !window.matchMedia(DESKTOP_LAYOUT_MQ).matches) return
  const el = document.querySelector(`[data-inbound-line-id="${CSS.escape(id)}"]`)
  scrollElementIntoViewCenter(el)
}

/** Tab chi tiết phiếu nhập: `inbound_detail:<encodeURIComponent(orderId)>`. */
const INBOUND_DETAIL_TAB_PREFIX = 'inbound_detail:'
const MAX_OPEN_INBOUND_DETAIL_TABS = 10

function toInboundDetailTabId(orderId) {
  return `${INBOUND_DETAIL_TAB_PREFIX}${encodeURIComponent(String(orderId))}`
}

function parseInboundDetailTabId(tab) {
  const s = String(tab ?? '')
  if (!s.startsWith(INBOUND_DETAIL_TAB_PREFIX)) return null
  try {
    return decodeURIComponent(s.slice(INBOUND_DETAIL_TAB_PREFIX.length))
  } catch {
    return null
  }
}

function isInboundDetailTabId(tab) {
  return String(tab ?? '').startsWith(INBOUND_DETAIL_TAB_PREFIX)
}

/** Tab chi tiết đơn bán POS: `pos_order_detail:<encodeURIComponent(orderId)>`. */
const POS_ORDER_DETAIL_TAB_PREFIX = 'pos_order_detail:'
const MAX_OPEN_POS_ORDER_DETAIL_TABS = 10

function toPosOrderDetailTabId(orderId) {
  return `${POS_ORDER_DETAIL_TAB_PREFIX}${encodeURIComponent(String(orderId))}`
}

function parsePosOrderDetailTabId(tab) {
  const s = String(tab ?? '')
  if (!s.startsWith(POS_ORDER_DETAIL_TAB_PREFIX)) return null
  try {
    return decodeURIComponent(s.slice(POS_ORDER_DETAIL_TAB_PREFIX.length))
  } catch {
    return null
  }
}

function isPosOrderDetailTabId(tab) {
  return String(tab ?? '').startsWith(POS_ORDER_DETAIL_TAB_PREFIX)
}

/** Tab chi tiết giao dịch hoàn trả (ledger): `pos_return_detail:<encodeURIComponent(ledgerEntryId)>`. */
const POS_RETURN_DETAIL_TAB_PREFIX = 'pos_return_detail:'
const MAX_OPEN_POS_RETURN_DETAIL_TABS = 8

function toPosReturnDetailTabId(ledgerEntryId) {
  return `${POS_RETURN_DETAIL_TAB_PREFIX}${encodeURIComponent(String(ledgerEntryId))}`
}

function parsePosReturnDetailTabId(tab) {
  const s = String(tab ?? '')
  if (!s.startsWith(POS_RETURN_DETAIL_TAB_PREFIX)) return null
  try {
    return decodeURIComponent(s.slice(POS_RETURN_DETAIL_TAB_PREFIX.length))
  } catch {
    return null
  }
}

function isPosReturnDetailTabId(tab) {
  return String(tab ?? '').startsWith(POS_RETURN_DETAIL_TAB_PREFIX)
}

/** Tổng tiền hàng + thanh toán từ dòng và chiết khấu đơn (giống logic phiếu nhập). */
function computeInboundOrderTotalsFromDiscountedLines(lines, orderDiscountMode, orderDiscountValue) {
  const goodsSubtotal = (lines || []).reduce(
    (s, l) => s + inboundLineTotal(normalizeInboundLine(l)),
    0
  )
  if (orderDiscountMode === 'percent') {
    const p = Math.min(100, Math.max(0, Number(orderDiscountValue) || 0))
    const orderDiscountAmount = Math.round((goodsSubtotal * p) / 100)
    return {
      goodsSubtotal,
      totalValue: Math.max(0, goodsSubtotal - orderDiscountAmount),
    }
  }
  const orderDiscountAmount = Math.min(goodsSubtotal, Math.max(0, Number(orderDiscountValue) || 0))
  return {
    goodsSubtotal,
    totalValue: Math.max(0, goodsSubtotal - orderDiscountAmount),
  }
}

const RANGE_PRESETS = [RANGE_TODAY, RANGE_YESTERDAY, RANGE_LAST_7, RANGE_THIS_MONTH, RANGE_CUSTOM]

/** Tab Đơn hàng — nhãn tùy chọn lịch (Doanh thu dùng RANGE_LABELS[RANGE_CUSTOM]). */
const ORDERS_TAB_CUSTOM_RANGE_LABEL = 'Khoảng ngày tự chọn'

function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function safeMoney(n) {
  const x = Number(n)
  return Number.isFinite(x) ? x : 0
}

/** Snapshot danh sách phiếu nhập để rollback khi đồng bộ Supabase thất bại. */
function snapshotInboundOrdersList(rows) {
  return (rows || []).map((o) => ({
    ...o,
    lines: (o.lines || []).map((l) => ({ ...l })),
  }))
}

/** Số lượng trả từ ô nhập (hỗ trợ số thập phân), không vượt max. */
function parseReturnQtyDraft(raw, maxVal) {
  const max = Math.max(0, Number(maxVal) || 0)
  if (max <= 0) return 0
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/,/g, '.')
  if (!s) return 0
  const n = Number.parseFloat(s)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(max, n)
}

function loadCustomersFromStorage() {
  try {
    const raw = localStorage.getItem(POS_CUSTOMERS_KEY)
    const j = raw ? JSON.parse(raw) : []
    if (!Array.isArray(j)) return []
    return j
      .filter((c) => c && typeof c.name === 'string')
      .map((c) => ({
        name: String(c.name || '').trim(),
        phone: String(c.phone || '').trim(),
        address: String(c.address || '').trim(),
        cccd: String(c.cccd || '').trim(),
        mail: String(c.mail || '').trim(),
      }))
      .filter((c) => c.name)
  } catch {
    return []
  }
}

function orderToCartLines(order) {
  return (order.items || []).map((it, i) => ({
    id: `re-${order.id}-${i}`,
    name: it.name,
    code: it.code || '',
    unitLabel: normalizeCatalogUnitLabel(it.unitLabel),
    price: Number(it.price),
    qty: Number(it.qty),
  }))
}

function recomputePosDraftAgg(d) {
  if (!d) return d
  const items = d.items || []
  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0)
  const disc = Math.min(subtotal, Math.max(0, Number(d.discount) || 0))
  const total = Math.max(0, subtotal - disc)
  const totalCost = items.reduce((s, it) => s + (Number(it.cost) || 0) * (Number(it.qty) || 0), 0)
  const totalProfit = total - totalCost
  const nextItems = items.map((it) => {
    const price = Number(it.price) || 0
    const cost = Number(it.cost) || 0
    const qty = Number(it.qty) || 0
    const lineRevenue = price * qty
    const lineCost = cost * qty
    return { ...it, lineRevenue, lineCost, lineProfit: lineRevenue - lineCost }
  })
  return { ...d, items: nextItems, subtotal, discount: disc, total, totalCost, totalProfit }
}

function sellHomeHref() {
  const base = import.meta.env.BASE_URL || '/'
  try {
    return new URL(base, window.location.origin).href
  } catch {
    return `${window.location.origin}${base}`
  }
}

const INBOUND_STORAGE_KEY = 'csv-preview-admin-inbound-orders-v1'
const SUPPLIERS_STORAGE_KEY = 'csv-preview-admin-suppliers-v1'

function createInboundId() {
  return `ib-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function inboundStatusLabel(status) {
  if (status === 'completed') return 'Hoàn thành'
  if (status === 'saved_temp') return 'Lưu tạm'
  if (status === 'receiving') return 'Đang nhập'
  if (status === 'cancelled') return 'Hủy đơn'
  if (status === 'returned_partial') return 'Đã hoàn trả một phần'
  if (status === 'returned_full') return 'Đã hoàn trả'
  return 'Phiếu tạm'
}

function normalizeInboundLine(x) {
  const qty = Math.max(0, Number(x.qty) || 0)
  let returnedQty = Math.max(0, Number(x.returnedQty) || 0)
  if (returnedQty > qty) returnedQty = qty
  return {
    lineId: String(x.lineId || createInboundId()),
    variantId: String(x.variantId || ''),
    code: String(x.code ?? '').trim(),
    name: String(x.name ?? '').trim(),
    unitLabel: String(x.unitLabel ?? '').trim(),
    thuong_hieu: String(x.thuong_hieu ?? x.brand ?? '').trim(),
    qty,
    returnedQty,
    unitPrice: Math.max(0, Number(x.unitPrice) || 0),
    lineDiscount: Math.max(0, Number(x.lineDiscount) || 0),
  }
}

/** SL còn trong kho từ dòng phiếu (đã trừ phần đã hoàn trả). */
function inboundLineReturnableQty(line) {
  const l = normalizeInboundLine(line)
  return Math.max(0, l.qty - l.returnedQty)
}

function inboundOrderCanPartialReturn(r) {
  const row = normalizeInboundRow(r)
  if (row.status === 'cancelled') return false
  if (!['completed', 'returned_partial', 'returned_full'].includes(row.status)) return false
  return row.lines.some((l) => inboundLineReturnableQty(l) > 0 && l.variantId)
}

/** Trạng thái hiển thị sau khi lưu dòng (giữ Hoàn trả một phần / toàn bộ nếu còn returnedQty). */
function computeInboundStatusAfterLines(lines) {
  const ns = (lines || []).map(normalizeInboundLine)
  if (!ns.some((l) => l.qty > 0)) return 'saved_temp'
  const allReturned = ns.every((l) => l.qty <= 0 || l.returnedQty >= l.qty)
  const anyReturned = ns.some((l) => l.returnedQty > 0)
  if (allReturned) return 'returned_full'
  if (anyReturned) return 'returned_partial'
  return 'completed'
}

function netVariantQtyMapFromInboundLines(lines) {
  const m = new Map()
  for (const raw of lines || []) {
    const l = normalizeInboundLine(raw)
    if (!l.variantId) continue
    const eff = inboundLineReturnableQty(l)
    if (eff <= 0) continue
    m.set(l.variantId, (m.get(l.variantId) || 0) + eff)
  }
  return m
}

function inboundLineTotal(line) {
  const gross = Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(line.unitPrice) || 0)
  return Math.max(0, gross - Math.max(0, Number(line.lineDiscount) || 0))
}

/** Thương hiệu — CSV `thuong_hieu` (cột D) được map vào `brand` trên biến thể. */
function brandThuongHieuFromProductVariant(product, variant) {
  const v = variant || product
  return String(v?.brand ?? product?.brand ?? '').trim()
}

/** Dòng cũ có thể thiếu `thuong_hieu` — hiển thị fallback theo danh mục. */
function inboundLineThuongHieuResolved(line, catalogList) {
  const n = normalizeInboundLine(line)
  if (n.thuong_hieu) return n.thuong_hieu
  const vid = String(n.variantId || '').trim()
  if (!vid || !catalogList?.length) return ''
  const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
  const v = flat.find((x) => String(x.id) === vid)
  return String(v?.brand ?? '').trim()
}

/** Một dòng phiếu nhập mới (SL mặc định 1 — đồng bộ với `addInboundFormLine`). Giữ đúng ĐVT / variant đã chọn (Thùng, Lốc…), không ép về đơn vị cơ bản. */
function createInboundFormLineFromProductVariant(product, variant) {
  const v = variant || product
  const unit = normalizeCatalogUnitLabel(v.unitLabel)
  const rawCost = Number(v.cost)
  const rawPrice = Number(v.price)
  const effective = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0
  const priceRounded = Math.max(0, Math.round(effective))
  const thuong_hieu = brandThuongHieuFromProductVariant(product, variant)
  const maHang = String(v.code || '').trim()
  const convRaw = Number(v?.conversionValue ?? v?.conversion ?? v?.quy_doi)
  const quy_doi = Number.isFinite(convRaw) && convRaw > 0 ? convRaw : 1
  return {
    lineId: `il-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    variantId: String(v.id ?? ''),
    code: maHang,
    ma_hang: maHang,
    name: String(product.name || v.name || '').trim(),
    unitLabel: unit,
    dvt: unit,
    thuong_hieu,
    qty: 1,
    so_luong: 1,
    returnedQty: 0,
    unitPrice: priceRounded,
    gia_nhap: priceRounded,
    lineDiscount: 0,
    quy_doi,
  }
}

/** Gộp biến thể vừa tạo (modal) chờ đồng bộ props — chỉ trong luồng phiếu nhập. */
function mergeInboundPendingFlatVariantsById(prev, incoming) {
  const map = new Map()
  for (const r of prev || []) {
    if (!r || r.id == null) continue
    map.set(String(r.id), r)
  }
  for (const r of incoming || []) {
    if (!r || r.id == null) continue
    map.set(String(r.id), r)
  }
  return [...map.values()]
}

function flattenCatalogVariantIdsForInboundMerge(catalog) {
  const out = []
  for (const p of catalog || []) {
    const vars = Array.isArray(p.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
    for (const v of vars) {
      if (v?.id == null || !String(v.id).trim()) continue
      out.push(String(v.id))
    }
  }
  return new Set(out)
}

/** Sau revalidate, id biến thể đổi (`sb-index-ma`) nhưng mã hàng trùng — lọc pending theo mã để không trùng dòng. */
function flattenCatalogMaHangCodesLcForInboundMerge(catalog) {
  const out = new Set()
  for (const p of catalog || []) {
    const vars = Array.isArray(p.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
    for (const v of vars) {
      const k = String(v?.code ?? '').trim().toLowerCase()
      if (k) out.add(k)
    }
  }
  return out
}

/** Chuẩn hóa tồn / giá / quy đổi trước khi buildDisplayCatalog — tránh NaN khi tính vốn nhập. */
function applyInboundStagingCatalogNumericDefaults(flatRow) {
  if (!flatRow || typeof flatRow !== 'object') return flatRow
  const out = { ...flatRow }
  let ton = out.stockQty
  if (ton === undefined || ton === null) ton = out.ton_kho
  const tonN = Number(ton)
  out.stockQty = Number.isFinite(tonN) ? Math.max(0, tonN) : 0

  let gv = out.cost
  if (gv === undefined || gv === null) gv = out.gia_von
  const gvN = Number(gv)
  out.cost = Number.isFinite(gvN) ? Math.max(0, gvN) : 0

  let qd = out.conversionValue ?? out.conversion ?? out.quy_doi
  const qdN = Number(qd)
  const quy = Number.isFinite(qdN) && qdN > 0 ? qdN : 1
  out.conversionValue = quy
  out.conversion = quy
  out.quy_doi = quy

  const rawBase = out.raw && typeof out.raw === 'object' ? out.raw : {}
  out.raw = {
    ...rawBase,
    ton_kho: out.stockQty,
    gia_von: out.cost,
    quy_doi: quy,
  }
  return out
}

function appendInboundDraftLinesFromFlatRows(setInboundFormLines, flatRows) {
  if (!flatRows?.length) return
  let display = []
  try {
    display = prepareCatalogForPosSearch(buildDisplayCatalog(flatRows))
  } catch (e) {
    console.warn('[AdminHub appendInboundDraftLinesFromFlatRows]', e)
    return
  }
  setInboundFormLines((prev) => {
    const next = [...prev]
    for (const prod of display) {
      const vars =
        Array.isArray(prod.groupVariants) && prod.groupVariants.length > 0
          ? prod.groupVariants
          : [prod]
      for (const v of vars) {
        next.push(createInboundFormLineFromProductVariant(prod, v))
      }
    }
    return next
  })
}

function defaultInboundOrders() {
  const now = Date.now()
  return [
    {
      id: 'ib-seed-1',
      code: 'NH001',
      createdAtMs: now - 86400000 * 2,
      supplier: 'CT TNHH Thực phẩm ABC',
      totalValue: 12500000,
      goodsSubtotal: 12500000,
      status: 'completed',
      lines: [],
      note: '',
    },
    {
      id: 'ib-seed-2',
      code: 'NH002',
      createdAtMs: now - 86400000,
      supplier: 'NCC Hải sản Miền Trung',
      totalValue: 3840000,
      goodsSubtotal: 3840000,
      status: 'saved_temp',
      lines: [],
      note: 'Chờ kiểm đếm',
    },
    {
      id: 'ib-seed-3',
      code: 'NH003',
      createdAtMs: now - 3600000,
      supplier: 'NCC Tạp hóa Sông Hồng',
      totalValue: 892500,
      goodsSubtotal: 900000,
      status: 'draft',
      lines: [],
      note: '',
    },
  ]
}

function normalizeInboundRow(x) {
  const st = x.status
  const status = [
    'completed',
    'receiving',
    'draft',
    'saved_temp',
    'cancelled',
    'returned_partial',
    'returned_full',
  ].includes(st)
    ? st
    : 'draft'
  const lines = Array.isArray(x.lines) ? x.lines.map(normalizeInboundLine) : []
  return {
    id: String(x.id || ''),
    code: String(x.code ?? '').trim(),
    createdAtMs: Number(x.createdAtMs) || Date.now(),
    supplier: String(x.supplier ?? '').trim(),
    totalValue: Math.max(0, Number(x.totalValue) || 0),
    goodsSubtotal: Math.max(0, Number(x.goodsSubtotal) || Number(x.totalValue) || 0),
    status,
    lines,
    note: String(x.note ?? ''),
    orderDiscountMode: x.orderDiscountMode === 'percent' ? 'percent' : 'amount',
    orderDiscountValue: Math.max(0, Number(x.orderDiscountValue) || 0),
  }
}

function loadInboundOrdersFromStorage() {
  try {
    const raw = localStorage.getItem(INBOUND_STORAGE_KEY)
    if (!raw) return defaultInboundOrders()
    const j = JSON.parse(raw)
    if (!Array.isArray(j)) return defaultInboundOrders()
    if (j.length === 0) return []
    const rows = j.map(normalizeInboundRow).filter((r) => r.id && r.code)
    return rows.length > 0 ? rows : defaultInboundOrders()
  } catch {
    return defaultInboundOrders()
  }
}

function exportInboundRowsToCsvFile(rows) {
  if (!rows.length) return
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`
  const header = ['Mã đơn nhập', 'Ngày nhập', 'Nhà cung cấp', 'Giá trị đơn', 'Trạng thái nhập']
  const body = rows.map((r) =>
    [
      esc(r.code),
      esc(new Date(r.createdAtMs).toLocaleString('vi-VN')),
      esc(r.supplier || '—'),
      esc(String(r.totalValue)),
      esc(inboundStatusLabel(r.status)),
    ].join(';')
  )
  const csv = ['\ufeff' + header.join(';'), ...body].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `don-nhap-hang-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function loadSuppliersFromStorage() {
  try {
    const raw = localStorage.getItem(SUPPLIERS_STORAGE_KEY)
    if (!raw) return []
    const j = JSON.parse(raw)
    if (!Array.isArray(j)) return []
    return j
      .filter((s) => s && typeof s.name === 'string' && String(s.name).trim())
      .map((s) => ({
        id: String(s.id || createInboundId()),
        name: String(s.name || '').trim(),
        phone: String(s.phone || '').trim(),
        address: String(s.address || '').trim(),
        cccd: String(s.cccd || '').trim(),
        mail: String(s.mail || '').trim(),
      }))
  } catch {
    return []
  }
}

function computeNextInboundCode(orders) {
  let max = 0
  for (const o of orders || []) {
    const m = String(o.code || '').trim().match(/^NH(\d+)$/i)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `NH${String(max + 1).padStart(3, '0')}`
}

/** Giống POS: quét bàn phím cực nhanh + Enter → điền ô mã vạch (modal tạo hàng). */
const AH_SCAN_MAX_INTER_KEY_MS = 75
const AH_SCAN_MIN_CHARS = 4

function ahIsPrintableBarcodeKey(key) {
  return key.length === 1 && /[\dA-Za-z._-]/.test(key)
}

function ahScanTimingLooksLikeWedge(times) {
  if (times.length < AH_SCAN_MIN_CHARS) return false
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > AH_SCAN_MAX_INTER_KEY_MS) return false
  }
  return true
}

function ahIsEditableFieldElement(el) {
  if (!el || el.nodeType !== 1) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (tag === 'INPUT') {
    const type = String(el.type || '').toLowerCase()
    if (
      type === 'hidden' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'file'
    ) {
      return false
    }
    return true
  }
  return false
}

function useDebounced(value, ms = 300) {
  const [out, setOut] = useState(value)
  const dRef = useRef(null)
  if (dRef.current == null) {
    dRef.current = debounce((v) => setOut(v), ms)
  }
  useEffect(() => {
    dRef.current(value)
  }, [value])
  useEffect(() => () => dRef.current?.cancel(), [])
  return out
}

const STAFF_ROWS_DEFAULT = [
  { name: 'Admin — Chủ cửa hàng', phone: '—', address: '—', cccd: '—', mail: '—' },
  { name: 'Nhân viên bán hàng', phone: '—', address: '—', cccd: '—', mail: '—' },
]

/** Một reference cố định — tránh `?? []` tạo mảng mới mỗi render làm `catalogList` đổi identity → vòng lặp useEffect. */
const EMPTY_CATALOG_LIST = []

export default function AdminHub({
  printReceiptHtml = () => {},
  refreshKey,
  products: productsProp,
  catalogFileName = '',
  onTriggerCatalogImport,
  onRemoveCatalogVariants,
  onUpdateCatalogVariant,
  onBulkPatchCatalogVariants,
  onReplaceCatalogGroup,
  onAppendCatalogVariants,
  /** Trang /doanh-thu độc lập: { readOnlyRevenue: true } khi không phải Admin — vẫn hiện layout đầy đủ */
  doanhThuMode,
  hubDeepLink = null,
  onHubDeepLinkConsumed,
  /** `/hang-hoa/:id` hoặc hash legacy — mở tab Hàng hóa + expand dòng */
  hangHoaGoodsOpenRequest = null,
  onHangHoaGoodsOpenConsumed,
  /** Route `/nhap-hang/tao-moi` — form nhập mở sẵn; Đóng = `window.close()`. */
  standaloneInboundCreate = false,
  /** App: sau upsert + `select`, nhận biến thể đã map để thay id dòng phiếu nhập (UUID client → sb-…). */
  registerInboundCatalogUpsertReconcile,
  /** App + Supabase: đã sửa danh mục cục bộ — chờ nút «Đồng bộ Supabase». */
  catalogSupabaseDirty = false,
  catalogSupabaseFlushBusy = false,
  onFlushCatalogToSupabase,
  /** App: hàng đợi global — job Supabase không unmount khi đóng form nhập. */
  runInboundCompletionJob = null,
  /** App: đồng bộ nền products + inbound_history (Promise.all) — Modal chỉ gọi hàm này. */
  onConfirmInboundComplete = null,
  /** App: từ thông báo tồn thấp — mở phiếu nhập + thêm dòng sẵn. */
  inboundLowStockPrefillRequest = null,
  onInboundLowStockPrefillConsumed,
  /** App: sau tạo/sửa SP — `fetchProducts` / revalidate và cập nhật `products` cha. */
  onRevalidateCatalog,
}) {
  /** Ledger hoàn trả POS — nguồn chính Supabase (`pos_return_ledger`), không cache báo cáo localStorage. */
  const [returnDayLedger, setReturnDayLedger] = useState([])
  const [returnLedgerRemoteLoading, setReturnLedgerRemoteLoading] = useState(false)

  const revenueReadOnly = Boolean(doanhThuMode?.readOnlyRevenue)
  const isHubMobileLayout = useViewportMaxWidth(768)
  const navigate = useNavigate()
  const location = useLocation()
  const syncHubUrlToMainTab = useCallback(
    (tabId) => {
      const p = pathForMainNavTab(tabId)
      if (p) navigate(p, { replace: true })
    },
    [navigate]
  )
  const onAdminHubNavItemActivate = useCallback(
    (tabId) => {
      setActiveTab(tabId)
      setSelected(null)
      syncHubUrlToMainTab(tabId)
    },
    [syncHubUrlToMainTab]
  )
  const parentCatalogSupplied = productsProp !== undefined && productsProp !== null
  const parentProducts = parentCatalogSupplied ? productsProp : EMPTY_CATALOG_LIST
  const [activeTab, setActiveTab] = useState(() => {
    if (standaloneInboundCreate) return TAB_INBOUND_DRAFT
    if (hangHoaGoodsOpenRequest?.rawId) return TAB_GOODS
    return TAB_OVERVIEW
  })
  /** Để callback modal tạo hàng chỉ chỉnh lưới nhập / staging khi đang ở tab nháp nhập hàng */
  const activeTabForInboundSyncRef = useRef(activeTab)
  activeTabForInboundSyncRef.current = activeTab
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await getAllOrders()
      setOrders(list)
    } catch (e) {
      console.error(e)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [])

  const refetchOrdersQuiet = useCallback(async () => {
    try {
      const list = await getAllOrders()
      setOrders(list)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void refetchOrdersQuiet()
  }, [refreshKey, refetchOrdersQuiet])

  useEffect(() => {
    const onOrdersBump = () => {
      void refetchOrdersQuiet()
    }
    window.addEventListener(ORDERS_SYNC_BUMP_EVENT, onOrdersBump)
    return () => window.removeEventListener(ORDERS_SYNC_BUMP_EVENT, onOrdersBump)
  }, [refetchOrdersQuiet])

  useEffect(() => {
    if (activeTab !== TAB_OVERVIEW && activeTab !== TAB_ORDERS) return
    void refetchOrdersQuiet()
    if (!parentCatalogSupplied && activeTab === TAB_OVERVIEW) {
      void (async () => {
        const snap = (await fetchProducts()) ?? readCatalogSnapshotSync()
        if (snap?.products?.length) {
          setStandaloneCatalog({
            products: refreshCatalogSearchTexts(snap.products),
            fileName: snap.fileName || '',
          })
        }
      })()
    }
  }, [activeTab, refetchOrdersQuiet, parentCatalogSupplied])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (activeTab === TAB_OVERVIEW || activeTab === TAB_ORDERS) {
        void refetchOrdersQuiet()
      }
      if (!parentCatalogSupplied && activeTab === TAB_OVERVIEW) {
        void fetchProducts().then((snap) => {
          if (snap?.products?.length) {
            setStandaloneCatalog({
              products: refreshCatalogSearchTexts(snap.products),
              fileName: snap.fileName || '',
            })
          }
        })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [activeTab, refetchOrdersQuiet, parentCatalogSupplied])

  const refreshPosReturnLedger = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      try {
        const { loadPosReturnDayLedger } = await import('./posReturnDayLedger.js')
        const v = loadPosReturnDayLedger()
        setReturnDayLedger(Array.isArray(v) ? v : [])
      } catch {
        setReturnDayLedger([])
      }
      return
    }
    setReturnLedgerRemoteLoading(true)
    try {
      const r = await fetchPosReturnLedgerEntries()
      if (!r.ok) {
        console.error('[AdminHub] Không tải pos_return_ledger', r.error)
        return
      }
      setReturnDayLedger(Array.isArray(r.entries) ? r.entries : [])
    } finally {
      setReturnLedgerRemoteLoading(false)
    }
  }, [])

  /** Một lần / phiên: đẩy ledger localStorage lên Supabase (không gọi lại mỗi lần refresh). */
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    void migrateLocalPosReturnLedgerToSupabaseOnce()
  }, [])

  useEffect(() => {
    void refreshPosReturnLedger()
  }, [refreshPosReturnLedger, refreshKey])

  useEffect(() => {
    const onBump = () => {
      void refreshPosReturnLedger()
    }
    window.addEventListener(POS_RETURN_LEDGER_BUMP_EVENT, onBump)
    return () => window.removeEventListener(POS_RETURN_LEDGER_BUMP_EVENT, onBump)
  }, [refreshPosReturnLedger])

  useEffect(() => {
    if (activeTab !== TAB_OVERVIEW && !isPosReturnDetailTabId(activeTab)) return
    void refreshPosReturnLedger()
  }, [activeTab, refreshPosReturnLedger])

  /* —— Tổng quan —— */
  const [ovRange, setOvRange] = useState(RANGE_TODAY)
  const [ovFrom, setOvFrom] = useState(todayYmd)
  const [ovTo, setOvTo] = useState(todayYmd)
  const [selected, setSelected] = useState(null)
  const [deletingOrderId, setDeletingOrderId] = useState('')
  const isDeletingOrder = String(deletingOrderId || '').trim().length > 0

  const ovFiltered = useMemo(
    () => filterOrdersForReport(orders, ovRange, ovFrom, ovTo),
    [orders, ovRange, ovFrom, ovTo]
  )

  const ovRevenueTableRows = useMemo(() => {
    try {
      const entries = filterPosReturnLedgerEntriesForReport(
        returnDayLedger,
        ovRange,
        ovFrom,
        ovTo
      )
      const returnRows = mapReturnLedgerToRevenueDisplayRows(orders, entries)
      return mergeRevenueTableRows(ovFiltered, returnRows)
    } catch (err) {
      console.warn('[AdminHub ovRevenueTableRows]', err)
      return mergeRevenueTableRows(ovFiltered, [])
    }
  }, [orders, ovFiltered, returnDayLedger, ovRange, ovFrom, ovTo])

  const handleExport = () => {
    if (revenueReadOnly) {
      alert('Chỉ tài khoản Admin mới xuất báo cáo Excel từ đây. Mở Doanh thu khi đã chọn Admin trên màn Bán hàng.')
      return
    }
    if (ovFiltered.length === 0) {
      alert('Không có đơn nào trong khoảng đang chọn để xuất.')
      return
    }
    try {
      exportOrdersToExcel(ovFiltered)
    } catch (e) {
      console.error(e)
      alert('Không xuất được file Excel.')
    }
  }

  const handleClearAll = async () => {
    if (revenueReadOnly) {
      alert('Chỉ Admin mới xóa được toàn bộ lịch sử đơn.')
      return
    }
    if (
      !window.confirm(
        'Xóa toàn bộ lịch sử đơn hàng trên trình duyệt này? Thao tác không thể hoàn tác.'
      )
    ) {
      return
    }
    try {
      clearPosReturnDayLedger()
      setReturnDayLedger([])
      setOpenPosReturnDetailLedgerIds([])
      await clearAllOrders()
      setSelected(null)
      await load()
    } catch (e) {
      console.error(e)
      alert('Không xóa được dữ liệu.')
    }
  }

  const handleReprint = (order) => {
    const cart = orderToCartLines(order)
    const total = Number(order.total)
    const created = new Date(order.createdAt)
    const einv = loadEInvoiceSettings()
    const html = buildK80ReceiptHtml(cart, total, {
      fixedAt: created,
      invoiceNo: order.invoiceNo,
      discount: Number(order.discount) || 0,
      ...(order.customerName ? { customerName: order.customerName } : {}),
      ...(order.customerPhone ? { customerPhone: order.customerPhone } : {}),
      ...(einv.qrLookup ? { eInvoice: { showQrLookup: true } } : {}),
    })
    printReceiptHtml(html)
  }

  async function handleDeleteOrder(orderRaw) {
    if (revenueReadOnly) {
      alert('Chỉ Admin mới xóa được đơn hàng.')
      return
    }
    const base = normalizePosOrder(orderRaw, catalogList, { preferStoredLineFinancials: true })
    const orderId = String(base?.id || '').trim()
    if (!orderId) {
      alert('Không xác định được mã đơn để xóa.')
      return
    }
    if (
      !window.confirm(
        'Sếp có chắc chắn muốn xóa vĩnh viễn đơn hàng này không? Hành động này sẽ hoàn tác cả tồn kho.'
      )
    ) {
      return
    }
    if (String(deletingOrderId || '').trim() === orderId) return

    // Đóng preview trước khi xóa để tránh lỗi render khi dữ liệu biến mất đột ngột.
    setSelected(null)
    setDeletingOrderId(orderId)
    try {
      let catalog = catalogList
      let catalogFileName = standaloneCatalog?.fileName || ''
      if (!catalog?.length) {
        const snap = (await fetchProducts()) ?? readCatalogSnapshotSync()
        if (!snap?.products?.length) {
          throw new Error('Chưa tải được danh mục hàng — không thể hoàn tồn kho.')
        }
        catalog = refreshCatalogSearchTexts(snap.products)
        catalogFileName = snap.fileName || catalogFileName
        if (!parentCatalogSupplied) {
          setStandaloneCatalog({
            products: catalog,
            fileName: catalogFileName,
          })
        }
      }

      const orderItems = Array.isArray(base?.items) ? base.items : []
      const { cartLines, needRestore, resolvedCount } = await buildOrderDeleteRestoreCartLines(
        catalog,
        orderItems
      )
      if (needRestore > 0 && resolvedCount === 0) {
        throw new Error(
          'Không khớp sản phẩm trong danh mục để hoàn tồn kho. Kiểm tra mã hàng / ĐVT trên đơn.'
        )
      }

      if (cartLines.length > 0) {
        const delDocCode = `DEL-${String(base.invoiceNo || base.id || '').trim() || '—'}`
        const stockRestoreResult = await persistCatalogStockRestoreFromCartLines({
          catalog,
          cartLines,
          catalogFileName,
          onBulkPatchCatalogVariants,
          setStandaloneCatalog: parentCatalogSupplied ? undefined : setStandaloneCatalog,
        })
        if (!stockRestoreResult.ok) {
          throw new Error(
            String(stockRestoreResult.error || 'Không thể hoàn tác tồn kho.')
          )
        }
        if (isSupabaseConfigured() && stockRestoreResult.nextProducts) {
          const invRows = buildPosReturnInventoryLogRows(
            stockRestoreResult.prevProducts,
            stockRestoreResult.nextProducts,
            { documentCode: delDocCode, staffName: staffNameForInventoryLog() },
            cartLines
          )
          await insertInventoryLogRows(invRows)
          try {
            window.dispatchEvent(new CustomEvent(INVENTORY_LOG_UPDATED_EVENT))
          } catch {
            /* ignore */
          }
        }
      }

      const rmLedger = await deletePosReturnLedgerByOrderId(orderId)
      if (!rmLedger.ok) {
        throw new Error(
          formatPostgrestErrorForUser(rmLedger.error) || 'Không thể xóa lịch sử hoàn trả liên quan.'
        )
      }

      await deleteOrderById(orderId)
      await Promise.all([refetchOrdersQuiet(), refreshPosReturnLedger()])
      showHubCameraToast('Xóa đơn hàng thành công.', 'ok')
    } catch (err) {
      console.error('[handleDeleteOrder] failed', err)
      showHubCameraToast(
        formatPostgrestErrorForUser(err) || 'Không thể xóa đơn hàng. Vui lòng thử lại.',
        'err'
      )
    } finally {
      setDeletingOrderId('')
    }
  }

  /* —— Hàng hóa —— */
  const [standaloneCatalog, setStandaloneCatalog] = useState(null)
  const standaloneImportRef = useRef(null)

  useEffect(() => {
    if (parentCatalogSupplied) {
      setStandaloneCatalog(null)
      return
    }
    let cancelled = false
    void (async () => {
      const snap = (await fetchProducts()) ?? readCatalogSnapshotSync()
      if (cancelled) return
      if (snap?.products?.length) {
        setStandaloneCatalog({
          products: refreshCatalogSearchTexts(snap.products),
          fileName: snap.fileName || '',
        })
      } else {
        setStandaloneCatalog(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parentCatalogSupplied, refreshKey])

  /** Tab khác ghi IndexedDB + bump → Hàng hóa độc lập cập nhật không cần F5. */
  useEffect(() => {
    if (parentCatalogSupplied) return
    const onStorage = (e) => {
      if (e.storageArea !== localStorage) return
      if (e.key !== CATALOG_SNAPSHOT_STORAGE_KEY && e.key !== CATALOG_SYNC_BUMP_KEY) return
      void (async () => {
        const snap = await fetchProducts()
        if (snap?.products?.length) {
          setStandaloneCatalog({
            products: refreshCatalogSearchTexts(snap.products),
            fileName: snap.fileName || '',
          })
        } else {
          setStandaloneCatalog(null)
        }
      })()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [parentCatalogSupplied])

  const catalogList = parentCatalogSupplied ? parentProducts : (standaloneCatalog?.products ?? EMPTY_CATALOG_LIST)

  const ovStats = useMemo(() => {
    try {
      const salesOrders = (ovFiltered || []).filter((o) =>
        String(o?.invoiceNo ?? '').trim().toUpperCase().startsWith('HD')
      )
      const returnOrders = (ovRevenueTableRows || [])
        .filter((row) => row?.kind === 'return')
        .map((row) => row?.returnRow)
        .filter((r) => String(r?.invoiceNo ?? '').trim().toUpperCase().startsWith('TH'))

      const salesRevenue = Math.round(
        salesOrders.reduce((sum, o) => Math.round(sum + safeMoney(o?.total)), 0)
      )
      const returnsRevenue = Math.round(
        returnOrders.reduce((sum, r) => Math.round(sum + Math.abs(safeMoney(r?.displayTotal))), 0)
      )
      const revenue = Math.round(salesRevenue - returnsRevenue)

      const returnLedgerEntries = filterPosReturnLedgerEntriesForReport(
        returnDayLedger,
        ovRange,
        ovFrom,
        ovTo
      )
      const returnsProfitReversal = Math.round(
        returnLedgerEntries.reduce(
          (sum, e) => sum + ledgerProfitSubFromParts(e),
          0
        )
      )

      // QUAN TRỌNG: Tiền vốn chỉ tính đơn bán HD, không cộng/trừ đơn TH.
      const cost = Math.round(
        salesOrders.reduce(
          (sum, o) => Math.round(sum + Math.round(orderReportCostFromCatalog(o, catalogList))),
          0
        )
      )
      const salesProfit = Math.round(
        salesOrders.reduce((sum, o) => Math.round(sum + orderTotalProfit(o)), 0)
      )
      const profit = Math.round(salesProfit - returnsProfitReversal)
      return { revenue, cost, profit, count: ovFiltered.length, countAll: orders.length }
    } catch (err) {
      console.error('[AdminHub ovStats]', err)
      return {
        revenue: 0,
        cost: 0,
        profit: 0,
        count: ovFiltered.length,
        countAll: orders.length,
      }
    }
  }, [ovFiltered, ovRevenueTableRows, orders.length, catalogList, returnDayLedger, ovRange, ovFrom, ovTo])

  /** Biến thể vừa thêm qua modal «Tạo mới» trên phiếu nhập (chờ `products` từ App kịp cập nhật). Được dọn trong useLayoutEffect khi đã có trong danh mục. */
  const [inboundPendingNewFlatVariants, setInboundPendingNewFlatVariants] = useState([])

  useLayoutEffect(() => {
    if (!inboundPendingNewFlatVariants.length) return
    const inCat = flattenCatalogVariantIdsForInboundMerge(catalogList)
    const codesInCat = flattenCatalogMaHangCodesLcForInboundMerge(catalogList)
    setInboundPendingNewFlatVariants((prev) => {
      const next = prev.filter((r) => {
        if (!r) return false
        if (inCat.has(String(r.id))) return false
        const k = String(r.code ?? '').trim().toLowerCase()
        if (k && codesInCat.has(k)) return false
        return true
      })
      return next.length === prev.length ? prev : next
    })
  }, [catalogList, inboundPendingNewFlatVariants])

  const catalogListForInbound = useMemo(() => {
    if (!inboundPendingNewFlatVariants.length) return catalogList
    const inCat = flattenCatalogVariantIdsForInboundMerge(catalogList)
    const codesInCat = flattenCatalogMaHangCodesLcForInboundMerge(catalogList)
    const extra = inboundPendingNewFlatVariants
      .filter((r) => {
        if (!r) return false
        if (inCat.has(String(r.id))) return false
        const k = String(r.code ?? '').trim().toLowerCase()
        if (k && codesInCat.has(k)) return false
        return true
      })
      .map(applyInboundStagingCatalogNumericDefaults)
    if (!extra.length) return catalogList
    let injected = []
    try {
      injected = prepareCatalogForPosSearch(buildDisplayCatalog(extra))
    } catch (e) {
      console.warn('[AdminHub catalogListForInbound]', e)
      return catalogList
    }
    return catalogList.length === 0 ? injected : [...catalogList, ...injected]
  }, [catalogList, inboundPendingNewFlatVariants])

  const catalogForInboundRef = useRef(catalogListForInbound)
  catalogForInboundRef.current = catalogListForInbound
  useEffect(() => {
    catalogForInboundRef.current = catalogListForInbound
  }, [catalogListForInbound])

  const catalogListRef = useRef(catalogList)
  catalogListRef.current = catalogList
  const catalogDisplayName = parentCatalogSupplied
    ? catalogFileName
    : (standaloneCatalog?.fileName || catalogFileName || '')

  /** Nhiều tab chi tiết SP (variantId), thứ tự = thứ tự trên nav. */
  const [openProductVariantIds, setOpenProductVariantIds] = useState([])
  const [soloGoodsDraftByVariantId, setSoloGoodsDraftByVariantId] = useState({})
  const soloGoodsDraftSeedFpByVariantIdRef = useRef({})
  /** `originTab` của modal kết quả cập nhật giá — dùng khi đóng hết tab SP. */
  const inboundCostResultOriginTabRef = useRef(null)
  const openProductVariantIdsRef = useRef([])
  useEffect(() => {
    openProductVariantIdsRef.current = openProductVariantIds
  }, [openProductVariantIds])

  const [stockCheckVouchers, setStockCheckVouchers] = useState(() => loadStockCheckVouchers())

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STOCK_CHECK_STORAGE_KEY || e.storageArea !== localStorage) return
      setStockCheckVouchers(loadStockCheckVouchers())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const stockCheckCreatedByLabel = useCallback(() => {
    return readStoredSellerId() === 'staff' ? 'Nhân viên bán hàng' : 'Admin — Chủ cửa hàng'
  }, [])

  const recordManualStockAdjustmentVoucher = useCallback(
    ({ variantId, productName, productCode, unitLabel, beforeQty, afterQty }) => {
      if (!stockQtyMeaningfullyChanged(beforeQty, afterQty)) return
      setStockCheckVouchers((prev) => {
        const next = appendAutoCompletedStockCheck(prev, {
          variantId,
          productName,
          productCode,
          unitLabel,
          beforeQty,
          afterQty,
          createdBy: stockCheckCreatedByLabel(),
        })
        saveStockCheckVouchers(next)
        return next
      })
    },
    [stockCheckCreatedByLabel]
  )

  const [costAdjustVouchers, setCostAdjustVouchers] = useState([])
  const [costAdjustStoreReady, setCostAdjustStoreReady] = useState(false)

  useEffect(() => {
    void loadCostAdjustVouchersFromStore().then((v) => {
      setCostAdjustVouchers(Array.isArray(v) ? v : [])
      setCostAdjustStoreReady(true)
    })
  }, [])

  useEffect(() => {
    if (!costAdjustStoreReady) return
    void saveCostAdjustVouchersToStore(costAdjustVouchers)
  }, [costAdjustStoreReady, costAdjustVouchers])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== COST_ADJUST_SYNC_BUMP_KEY || e.storageArea !== localStorage) return
      void loadCostAdjustVouchersFromStore().then((v) => setCostAdjustVouchers(Array.isArray(v) ? v : []))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Khi đổi giá vốn ở Hàng hóa và bấm Lưu — tạo phiếu GVxxx (chỉ sau khi IndexedDB đã hydrate). */
  const recordCostAdjustOnSave = useCallback(
    (prevVariant, patch, nameTrim) => {
      if (!prevVariant || !patch || !costAdjustStoreReady) return
      const oldCost = Number(prevVariant.cost) || 0
      const newCost = Number(patch.cost) || 0
      if (oldCost === newCost) return
      startTransition(() => {
        setCostAdjustVouchers((prev) =>
          appendCompletedCostAdjustFromGoods(prev, {
            variantId: prevVariant.id,
            productCode: String(patch.code ?? '').trim() || '—',
            productName:
              String(nameTrim || '').trim() ||
              String(prevVariant.name || '').trim() ||
              '—',
            unitLabel: normalizeCatalogUnitLabel(prevVariant.unitLabel),
            oldCost,
            newCost,
            createdBy: stockCheckCreatedByLabel(),
          })
        )
      })
    },
    [costAdjustStoreReady, stockCheckCreatedByLabel]
  )

  /** `single`: chỉ flatten nhóm SP khớp deep link — tránh dựng hàng chục nghìn dòng ngay khi mở tab. */
  const [hangHoaDeepLinkListScope, setHangHoaDeepLinkListScope] = useState('all')
  const [hangHoaDeepLinkVid, setHangHoaDeepLinkVid] = useState(null)
  const [goodsQ, setGoodsQ] = useState('')
  const goodsVirtualListApiRef = useRef(null)
  const [goodsSearchFilter, setGoodsSearchFilter] = useState('')
  const goodsSearchDebRef = useRef(null)
  if (goodsSearchDebRef.current == null) {
    goodsSearchDebRef.current = debounce((v) => setGoodsSearchFilter(v), 300)
  }
  useEffect(() => {
    goodsSearchDebRef.current(goodsQ)
  }, [goodsQ])
  useEffect(() => () => goodsSearchDebRef.current?.cancel(), [])
  /** `latest` = thời gian tạo giảm dần; `az` = tên hàng A→Z (locale `vi`). */
  const [goodsListSort, setGoodsListSort] = useState('latest')
  /** Mobile tab Hàng hóa: bộ lọc trong drawer — chỉ UI. */
  const [goodsMobileFiltersOpen, setGoodsMobileFiltersOpen] = useState(false)
  useEffect(() => {
    if (activeTab !== TAB_GOODS) setGoodsMobileFiltersOpen(false)
  }, [activeTab])
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const on = () => {
      if (!mq.matches) setGoodsMobileFiltersOpen(false)
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const goodsDeferred = useDeferredValue(goodsSearchFilter)

  const expandHangHoaGoodsListToFull = useCallback(() => {
    setHangHoaDeepLinkListScope('all')
    setHangHoaDeepLinkVid(null)
  }, [])

  const goodsRowsAll = useMemo(() => {
    const searching = goodsQ.trim().length > 0
    if (!searching && hangHoaDeepLinkListScope === 'single' && hangHoaDeepLinkVid) {
      const ctx = findVariantContext(catalogList, hangHoaDeepLinkVid)
      if (ctx?.product) return flattenCatalogToGoodsRows([ctx.product])
    }
    return flattenCatalogToGoodsRows(catalogList)
  }, [catalogList, hangHoaDeepLinkListScope, hangHoaDeepLinkVid, goodsQ])

  const hangHoaDeepLinkDisplayName = useMemo(() => {
    if (hangHoaDeepLinkListScope !== 'single' || !hangHoaDeepLinkVid) return ''
    const ctx = findVariantContext(catalogList, hangHoaDeepLinkVid)
    if (!ctx) return ''
    const v = ctx.variants.find((x) => x.id === hangHoaDeepLinkVid)
    const raw = String(v?.name || ctx.clicked?.name || '').trim()
    return raw || '—'
  }, [catalogList, hangHoaDeepLinkListScope, hangHoaDeepLinkVid])

  const brandOptions = useMemo(() => {
    const s = new Set()
    for (const p of catalogList || []) {
      for (const v of p.groupVariants || [p]) {
        const b = String(v.brand || '').trim()
        if (b) s.add(b)
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'vi'))
  }, [catalogList])

  const comboSearchRowsExcludingCombos = useMemo(
    () =>
      flattenCatalogToGoodsSearchRows(catalogList).filter((r) => !isComboCatalogProduct(r._product)),
    [catalogList]
  )

  const inventoryDateDefaults = useMemo(() => {
    const now = new Date()
    const toYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
    const fromDate = new Date(now.getTime())
    fromDate.setDate(fromDate.getDate() - 6)
    const fromYmd = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(fromDate.getDate()).padStart(2, '0')}`
    return { fromYmd, toYmd }
  }, [])

  const [goodsBrandKey, setGoodsBrandKey] = useState('')
  const [goodsBrandOpen, setGoodsBrandOpen] = useState(false)
  const [goodsDatePreset, setGoodsDatePreset] = useState('')
  const [goodsDateFromStr, setGoodsDateFromStr] = useState('')
  const [goodsDateToStr, setGoodsDateToStr] = useState('')
  const [goodsCreateOpen, setGoodsCreateOpen] = useState(false)
  const goodsCreateWrapRef = useRef(null)
  const [goodsSelected, setGoodsSelected] = useState(() => ({}))
  /** Modal sửa nhanh SP — dùng chung Tab Hàng hóa & Nhập hàng. */
  const [inboundQuickEditExpandId, setInboundQuickEditExpandId] = useState(null)
  const [inboundQuickEditSelectedVid, setInboundQuickEditSelectedVid] = useState(null)
  const [inboundQuickEditDraft, setInboundQuickEditDraft] = useState(null)
  const [inboundQuickEditSaving, setInboundQuickEditSaving] = useState(false)
  const [inboundQuickEditShelfTab, setInboundQuickEditShelfTab] = useState(GOODS_DETAIL_VIEW_TONKHO)
  const inboundQuickEditPreserveRef = useRef(null)
  const inboundQuickEditDraftSeedVariantIdRef = useRef('')
  /** Local State First: thay đổi ĐVT giữ cục bộ, chỉ ghi API khi bấm Lưu form chi tiết. */
  const [pendingUnitDraft, setPendingUnitDraft] = useState(null)
  const catalogListForGoodsEdit = useMemo(() => {
    if (!pendingUnitDraft?.anchorVariantId || !Array.isArray(pendingUnitDraft.replacements)) {
      return catalogList
    }
    const anchorCtx = findVariantContext(catalogList, pendingUnitDraft.anchorVariantId)
    if (!anchorCtx?.clicked) return catalogList
    const root = normalizeGroupRoot(anchorCtx.clicked.code, anchorCtx.clicked.linkedMasterCode)
    const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
    const kept = flat.filter((v) => normalizeGroupRoot(v.code, v.linkedMasterCode) !== root)
    return buildDisplayCatalog([...kept, ...pendingUnitDraft.replacements])
  }, [catalogList, pendingUnitDraft])
  const [goodsSfInventoryRows, setGoodsSfInventoryRows] = useState([])
  const [goodsSfInventoryLoading, setGoodsSfInventoryLoading] = useState(false)
  const [goodsSfInventoryFetchErr, setGoodsSfInventoryFetchErr] = useState(false)
  const [goodsInvLedgerDateFrom, setGoodsInvLedgerDateFrom] = useState(inventoryDateDefaults.fromYmd)
  const [goodsInvLedgerDateTo, setGoodsInvLedgerDateTo] = useState(inventoryDateDefaults.toYmd)
  const [goodsInvLedgerDocSearch, setGoodsInvLedgerDocSearch] = useState('')
  const [goodsInvLedgerDocDebounced, setGoodsInvLedgerDocDebounced] = useState('')
  const [soloSfInventoryRows, setSoloSfInventoryRows] = useState([])
  const [soloSfInventoryLoading, setSoloSfInventoryLoading] = useState(false)
  const [soloSfInventoryFetchErr, setSoloSfInventoryFetchErr] = useState(false)
  const [inventoryLogRefreshTick, setInventoryLogRefreshTick] = useState(0)
  const [soloInvLedgerDateFrom, setSoloInvLedgerDateFrom] = useState(inventoryDateDefaults.fromYmd)
  const [soloInvLedgerDateTo, setSoloInvLedgerDateTo] = useState(inventoryDateDefaults.toYmd)
  const [soloInvLedgerDocSearch, setSoloInvLedgerDocSearch] = useState('')
  const [soloInvLedgerDocDebounced, setSoloInvLedgerDocDebounced] = useState('')
  useEffect(() => {
    const onUpdated = () => setInventoryLogRefreshTick((x) => x + 1)
    window.addEventListener(INVENTORY_LOG_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(INVENTORY_LOG_UPDATED_EVENT, onUpdated)
  }, [])

  /** Tăng mỗi lần Lưu thành công — dùng làm key + chạy animation toast 2s. */
  const [goodsSaveToastGen, setGoodsSaveToastGen] = useState(0)

  const [goodsNewModalOpen, setGoodsNewModalOpen] = useState(false)
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false)
  const [barcodeScanMode, setBarcodeScanMode] = useState('goods')
  /** null | { mode: 'create' } | { mode: 'edit', product } */
  const [comboModal, setComboModal] = useState(null)

  useEffect(() => {
    const tid = window.setTimeout(
      () => setGoodsInvLedgerDocDebounced(goodsInvLedgerDocSearch.trim()),
      380
    )
    return () => window.clearTimeout(tid)
  }, [goodsInvLedgerDocSearch])

  useEffect(() => {
    const tid = window.setTimeout(
      () => setSoloInvLedgerDocDebounced(soloInvLedgerDocSearch.trim()),
      380
    )
    return () => window.clearTimeout(tid)
  }, [soloInvLedgerDocSearch])

  useEffect(() => {
    setGoodsInvLedgerDocSearch('')
    setGoodsInvLedgerDocDebounced('')
    setGoodsInvLedgerDateFrom(inventoryDateDefaults.fromYmd)
    setGoodsInvLedgerDateTo(inventoryDateDefaults.toYmd)
  }, [inboundQuickEditExpandId, inboundQuickEditSelectedVid, inventoryDateDefaults])

  useEffect(() => {
    if (activeTab !== TAB_GOODS) {
      setGoodsSelected({})
      setGoodsNewModalOpen(false)
      setComboModal(null)
      setHangHoaDeepLinkListScope('all')
      setHangHoaDeepLinkVid(null)
      setGoodsBrandKey('')
      setGoodsDatePreset('')
      setGoodsDateFromStr('')
      setGoodsDateToStr('')
    }
  }, [activeTab])

  useEffect(() => {
    if (!goodsCreateOpen) return
    const onDoc = (e) => {
      if (goodsCreateWrapRef.current?.contains(e.target)) return
      setGoodsCreateOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [goodsCreateOpen])

  const goodsCreatedAtRange = useMemo(
    () => resolveGoodsCreatedAtRangeMs(goodsDatePreset, goodsDateFromStr, goodsDateToStr),
    [goodsDatePreset, goodsDateFromStr, goodsDateToStr]
  )

  const goodsRowsFiltered = useMemo(() => {
    const val = goodsSearchFilter.trim()
    let list = goodsRowsAll
    const brandKey = String(goodsBrandKey || '').trim()
    if (brandKey) {
      list = list.filter((r) => String(r.brand || '').trim() === brandKey)
    }
    if (goodsCreatedAtRange) {
      const { startMs, endMs } = goodsCreatedAtRange
      list = list.filter((r) => {
        const t = Number(r.createdAtMs)
        return Number.isFinite(t) && t > 0 && t >= startMs && t <= endMs
      })
    }
    if (val.length) {
      list = filterAndSortGoodsRowsSimple(list, val)
    }
    return applyGoodsListSort(list, goodsListSort)
  }, [goodsRowsAll, goodsSearchFilter, goodsBrandKey, goodsCreatedAtRange, goodsListSort])

  const closeInboundProductQuickEdit = useCallback(() => {
    if (inboundQuickEditSaving) return
    setInboundQuickEditExpandId(null)
    setInboundQuickEditSelectedVid(null)
    setInboundQuickEditDraft(null)
    setInboundQuickEditShelfTab(GOODS_DETAIL_VIEW_TONKHO)
    setPendingUnitDraft(null)
  }, [inboundQuickEditSaving])

  const openInboundProductQuickEdit = useCallback(
    (variantIdOrLine, catalogHint) => {
      const ln = variantIdOrLine && typeof variantIdOrLine === 'object' ? variantIdOrLine : null
      if (ln?.lineId) scrollInboundLineIntoView(ln.lineId)
      const rawVid = ln
        ? resolveVariantIdForInboundLine(ln, catalogHint || catalogList)
        : String(variantIdOrLine || '').trim()
      const vid = rawVid
      if (!vid) return
      const ctx = findVariantContext(catalogListForGoodsEdit, vid)
      const rowVariantId = ctx?.clicked?.id ?? vid
      const baseVid = ctx?.variants?.[0]?.id ?? rowVariantId
      const vOpen = ctx?.variants.find((x) => x.id === baseVid) ?? ctx?.clicked
      if (vOpen) {
        setInboundQuickEditDraft(buildGoodsDetailDraft(vOpen))
        setInboundQuickEditSelectedVid(baseVid)
      } else {
        setInboundQuickEditDraft(null)
        setInboundQuickEditSelectedVid(null)
      }
      setInboundQuickEditShelfTab(GOODS_DETAIL_VIEW_TONKHO)
      setInboundQuickEditExpandId(rowVariantId)
    },
    [catalogListForGoodsEdit]
  )

  const openGoodsProductQuickEdit = useCallback(
    (rowVariantId) => {
      const id = String(rowVariantId ?? '').trim()
      if (!id) return
      const openModal = () => openInboundProductQuickEdit(id)
      const isDesktop =
        typeof window !== 'undefined' && window.matchMedia(DESKTOP_LAYOUT_MQ).matches
      if (isDesktop) {
        scrollGoodsRowIntoView(id, goodsVirtualListApiRef.current, openModal)
      } else {
        openModal()
      }
    },
    [openInboundProductQuickEdit]
  )

  const dismissInboundDraftProductSearch = useCallback(() => {
    setInboundFormProductQ('')
    setInboundProductSuggestIdx(0)
  }, [])

  useEffect(() => {
    const quickEditHostTab =
      activeTab === TAB_GOODS ||
      activeTab === TAB_INBOUND_DRAFT ||
      isInboundDetailTabId(activeTab)
    if (!quickEditHostTab && inboundQuickEditExpandId) {
      closeInboundProductQuickEdit()
    }
  }, [activeTab, inboundQuickEditExpandId, closeInboundProductQuickEdit])

  useEffect(() => {
    if (!inboundQuickEditExpandId) return
    const ctx = findVariantContext(catalogListForGoodsEdit, inboundQuickEditExpandId)
    if (ctx?.product && isComboCatalogProduct(ctx.product)) {
      setInboundQuickEditShelfTab(GOODS_DETAIL_VIEW_COMBO)
      return
    }
    setInboundQuickEditShelfTab(GOODS_DETAIL_VIEW_TONKHO)
  }, [inboundQuickEditExpandId, catalogListForGoodsEdit])

  const inboundQuickEditCtx = useMemo(() => {
    if (!inboundQuickEditExpandId) return null
    return findVariantContext(catalogListForGoodsEdit, inboundQuickEditExpandId)
  }, [catalogListForGoodsEdit, inboundQuickEditExpandId])

  const inboundQuickEditVariant = useMemo(() => {
    if (!inboundQuickEditCtx || !inboundQuickEditSelectedVid) return null
    return inboundQuickEditCtx.variants.find((x) => x.id === inboundQuickEditSelectedVid) ?? null
  }, [inboundQuickEditCtx, inboundQuickEditSelectedVid])

  useEffect(() => {
    if (!inboundQuickEditCtx?.variants?.length || !inboundQuickEditSelectedVid) return
    const ok = inboundQuickEditCtx.variants.some((x) => x.id === inboundQuickEditSelectedVid)
    if (!ok) setInboundQuickEditSelectedVid(inboundQuickEditCtx.variants[0].id)
  }, [inboundQuickEditCtx, inboundQuickEditSelectedVid])

  useEffect(() => {
    if (!inboundQuickEditExpandId) {
      inboundQuickEditDraftSeedVariantIdRef.current = ''
      return
    }
    const nextVid = String(inboundQuickEditSelectedVid ?? '')
    if (!nextVid || !inboundQuickEditVariant) return
    if (inboundQuickEditDraftSeedVariantIdRef.current === nextVid) return
    inboundQuickEditDraftSeedVariantIdRef.current = nextVid
    const preserve = inboundQuickEditPreserveRef.current
    inboundQuickEditPreserveRef.current = null
    const seeded = buildGoodsDetailDraft(inboundQuickEditVariant)
    if (preserve) {
      setInboundQuickEditDraft({
        ...seeded,
        name: preserve.name ?? seeded?.name ?? '',
        brand: preserve.brand ?? seeded?.brand ?? '',
        weightRaw: preserve.weightRaw ?? seeded?.weightRaw ?? '',
      })
      return
    }
    setInboundQuickEditDraft(seeded)
  }, [inboundQuickEditExpandId, inboundQuickEditSelectedVid, inboundQuickEditVariant, buildGoodsDetailDraft])

  useEffect(() => {
    if (!inboundQuickEditExpandId) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeInboundProductQuickEdit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inboundQuickEditExpandId, closeInboundProductQuickEdit])

  const triggerGoodsSaveSuccessToast = useCallback(() => {
    setGoodsSaveToastGen((g) => g + 1)
  }, [])

  const handleGoodsCreateSaved = useCallback(async () => {
    triggerGoodsSaveSuccessToast()
    if (typeof onRevalidateCatalog === 'function') {
      await onRevalidateCatalog()
      return
    }
    if (!parentCatalogSupplied && isSupabaseConfigured()) {
      const fresh = await revalidateCatalogFromStore()
      if (fresh?.products?.length) {
        setStandaloneCatalog({
          products: refreshCatalogSearchTexts(fresh.products),
          fileName: fresh.fileName || catalogFileName || '',
        })
      }
    }
  }, [
    triggerGoodsSaveSuccessToast,
    onRevalidateCatalog,
    parentCatalogSupplied,
    catalogFileName,
  ])

  const persistStandaloneProducts = useCallback(
    async (nextProducts, fileNameHint, upsertOnlyVariants, persistOpts = {}) => {
    const fn = String(fileNameHint || '')
    const persistResult = persistOpts?.snapshotOnly
      ? await persistCatalogSnapshotAndProducts(nextProducts, fn, { snapshotOnly: true })
      : upsertOnlyVariants?.length
        ? persistOpts.useUpdateSequential === true
          ? await updateProductDisplayVariantsSequential(upsertOnlyVariants)
          : await insertProductDisplayVariantsSequential(upsertOnlyVariants, {
              existingCatalogProducts: nextProducts,
            })
        : await persistCatalogSnapshotAndProducts(nextProducts, fn)
    if (!persistResult.ok) {
      console.error('Lỗi Insert Supabase:', persistResult.error)
      return {
        ok: false,
        error: describeCatalogPersistError(persistResult.error),
      }
    }
    if (upsertOnlyVariants?.length) {
      const prepared = persistResult.preparedVariants || upsertOnlyVariants
      if (isSupabaseConfigured()) {
        const fresh = await revalidateCatalogFromStore()
        if (fresh?.products?.length) {
          setStandaloneCatalog({
            products: refreshCatalogSearchTexts(fresh.products),
            fileName: fresh.fileName || fn,
          })
          if (typeof onRevalidateCatalog === 'function') {
            await onRevalidateCatalog()
          }
          return { ok: true, preparedVariants: prepared }
        }
      }
      const flat = (Array.isArray(nextProducts) ? nextProducts : []).flatMap((p) => p.groupVariants || [p])
      const withoutNew = flat.filter(
        (v) => !prepared.some((p) => String(p.id) === String(v.id))
      )
      const mergedFlat = mergeFlatCatalogRowsBySmartUomGroups([...withoutNew, ...prepared])
      const mergedProducts = prepareCatalogForPosSearch(buildDisplayCatalog(mergedFlat))
      setStandaloneCatalog({ products: mergedProducts, fileName: fn })
      if (typeof onRevalidateCatalog === 'function') {
        await onRevalidateCatalog()
      }
      return { ok: true, preparedVariants: prepared }
    }
    if (isSupabaseConfigured()) {
      const fresh = await revalidateCatalogFromStore()
      if (fresh?.products?.length) {
        setStandaloneCatalog({
          products: refreshCatalogSearchTexts(fresh.products),
          fileName: fresh.fileName || fn,
        })
        return { ok: true }
      }
    }
    if (!nextProducts?.length) {
      setStandaloneCatalog(null)
      return { ok: true }
    }
    setStandaloneCatalog({ products: nextProducts, fileName: fn })
    return { ok: true }
  }, [onRevalidateCatalog])

  const handleComboSaveDisplay = useCallback(
    (payload) => {
      const { mode, anchorVariantId, flatRow, replaceCatalogId } = payload
      const codeLc = String(flatRow.code || '').trim().toLowerCase()
      const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
      if (mode !== 'edit' && flat.some((r) => String(r.code || '').trim().toLowerCase() === codeLc)) {
        window.alert('Mã hàng đã tồn tại. Vui lòng đổi mã SKU.')
        return
      }
      if (onReplaceCatalogGroup && mode === 'edit' && anchorVariantId) {
        onReplaceCatalogGroup(anchorVariantId, [flatRow])
        setComboModal(null)
        setGoodsDetailShelfTab(GOODS_DETAIL_VIEW_COMBO)
        triggerGoodsSaveSuccessToast()
        return
      }
      if (onAppendCatalogVariants) {
        onAppendCatalogVariants([flatRow])
        setComboModal(null)
        triggerGoodsSaveSuccessToast()
        return
      }
      const without =
        mode === 'edit' && replaceCatalogId
          ? flat.filter((row) => {
              const p = catalogList.find((x) => x.id === replaceCatalogId)
              if (!p) return true
              const ids = new Set((p.groupVariants || [p]).map((v) => String(v.id)))
              return !ids.has(String(row.id))
            })
          : flat
      const nextFlat = mergeFlatCatalogRowsBySmartUomGroups([...without, flatRow])
      const nextProducts = prepareCatalogForPosSearch(buildDisplayCatalog(nextFlat))
      void persistStandaloneProducts(
        nextProducts,
        standaloneCatalog?.fileName || catalogFileName || 'hang-hoa-thu-cong'
      )
      setComboModal(null)
      triggerGoodsSaveSuccessToast()
    },
    [
      catalogList,
      onReplaceCatalogGroup,
      onAppendCatalogVariants,
      persistStandaloneProducts,
      standaloneCatalog?.fileName,
      catalogFileName,
      triggerGoodsSaveSuccessToast,
    ]
  )

  const openComboCreateModal = useCallback(() => {
    if (revenueReadOnly) {
      window.alert('Chỉ tài khoản Admin / Chủ cửa hàng mới thêm combo từ đây.')
      return
    }
    setGoodsCreateOpen(false)
    setComboModal({ mode: 'create' })
  }, [revenueReadOnly])

  const openGoodsCreateModal = useCallback(() => {
    if (revenueReadOnly) {
      window.alert('Chỉ tài khoản Admin / Chủ cửa hàng mới thêm hàng hóa từ đây.')
      return
    }
    setGoodsCreateOpen(false)
    setGoodsNewModalOpen(true)
  }, [revenueReadOnly])

  const replaceCatalogGroupFromModal = useCallback(
    (anchorVariantId, replacements, opts = {}) => {
      if (onReplaceCatalogGroup) {
        return onReplaceCatalogGroup(anchorVariantId, replacements, opts)
      }
      if (!catalogList?.length) return Promise.resolve({ ok: false })
      const deletedVariantIds = Array.isArray(opts.deletedVariantIds)
        ? opts.deletedVariantIds.map(String).filter(Boolean)
        : []
      const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
      const target = flat.find((v) => v.id === anchorVariantId)
      if (!target) return Promise.resolve({ ok: false })
      const root = normalizeGroupRoot(target.code, target.linkedMasterCode)
      const kept = flat.filter((v) => normalizeGroupRoot(v.code, v.linkedMasterCode) !== root)
      const merged = [...kept, ...replacements]
      const nextDisplay = buildDisplayCatalog(merged)
      const fn = standaloneCatalog?.fileName || catalogFileName || ''
      const prevStandalone = standaloneCatalog

      setStandaloneCatalog({
        products: nextDisplay,
        fileName: fn,
      })

      return (async () => {
        try {
          if (deletedVariantIds.length > 0 && isSupabaseConfigured()) {
            const dr = await deleteProductsForRemovedVariants(catalogList, deletedVariantIds)
            if (!dr.ok && !dr.skipped) {
              throw (
                dr.error ||
                new Error('Không xóa được đơn vị tính đã gỡ trên Supabase.')
              )
            }
          }
          const pr = await persistStandaloneProducts(nextDisplay, fn, replacements, {
            useUpdateSequential: true,
          })
          if (!pr?.ok) {
            throw new Error(pr?.error || 'Không lưu được đơn vị tính.')
          }
          return { ok: true }
        } catch (e) {
          console.error('[replaceCatalogGroupFromModal]', e)
          if (prevStandalone) {
            setStandaloneCatalog(prevStandalone)
          }
          window.alert(
            `Lỗi đồng bộ: ${describeCatalogPersistError(e)}. Đã hoàn tác thay đổi đơn vị tính!`
          )
          return { ok: false, error: e }
        }
      })()
    },
    [onReplaceCatalogGroup, catalogList, standaloneCatalog, catalogFileName, persistStandaloneProducts]
  )

  /** Modal thiết lập đa ĐVT + bảng hàng cùng loại (tab Hàng hóa / tab solo). */
  const [unitModal, setUnitModal] = useState(null)

  const closeUnitModal = useCallback(() => setUnitModal(null), [])

  useEffect(() => {
    if (!unitModal) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeUnitModal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [unitModal, closeUnitModal])

  useEffect(() => {
    if (!unitModal?.anchorVariantId) return
    if (findVariantContext(catalogListForGoodsEdit, unitModal.anchorVariantId)) return
    setUnitModal(null)
  }, [catalogListForGoodsEdit, unitModal?.anchorVariantId])

  const openInboundGoodsUnitModal = useCallback(() => {
    const anchor = inboundQuickEditSelectedVid || inboundQuickEditExpandId
    if (!anchor) return
    const ctx = findVariantContext(catalogListForGoodsEdit, String(anchor))
    if (!ctx?.variants?.length) return
    setUnitModal({
      anchorVariantId: String(anchor),
      lines: createUnitModalLinesFromVariants(ctx.variants),
      source: 'inbound',
      deletedVariantIds: [],
    })
  }, [catalogListForGoodsEdit, inboundQuickEditSelectedVid, inboundQuickEditExpandId])

  const saveProductDetailFromDraft = useCallback(
    async (variant, draft) => {
      if (!variant || !draft) return false
      const nameTrim = String(draft.name ?? '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const patch = {
        name: nameTrim,
        code: String(draft.code ?? '').trim(),
        barcode: normalizeBarcodeValue(draft.barcode),
        brand: String(draft.brand ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        weightRaw: String(draft.weightRaw ?? '')
          .replace(/\u00A0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        price: parseMoneyDraftVi(draft.price),
        wholesalePrice: parseMoneyDraftVi(draft.wholesalePrice ?? '0'),
        cost: parseMoneyDraftVi(draft.cost),
        stockQty: parseAdminStockNullable(draft.stockQty),
        stockNormMin: parseAdminStockNullable(draft.stockNormMin),
        stockNormMax:
          variant.stockNormMax != null && Number.isFinite(Number(variant.stockNormMax))
            ? Number(variant.stockNormMax)
            : null,
      }
      recordManualStockAdjustmentVoucher({
        variantId: variant.id,
        productName: nameTrim || String(variant.name || '').trim(),
        productCode: patch.code,
        unitLabel: normalizeCatalogUnitLabel(variant.unitLabel),
        beforeQty: variant.stockQty,
        afterQty: patch.stockQty,
      })
      const pendingForVariant =
        pendingUnitDraft &&
        findVariantContext(catalogListForGoodsEdit, pendingUnitDraft.anchorVariantId)?.variants?.some(
          (x) => x.id === variant.id
        )
          ? pendingUnitDraft
          : null

      if (pendingForVariant) {
        const patchedRows = pendingForVariant.replacements.map((row) => {
          if (row.id !== variant.id) {
            return {
              ...row,
              name: nameTrim,
              nameRaw: nameTrim,
            }
          }
          return {
            ...row,
            ...patch,
            name: nameTrim,
            nameRaw: nameTrim,
            unitLabel: row.unitLabel,
            conversion: row.conversion,
            conversionValue: row.conversionValue,
            linkedMasterCode: row.linkedMasterCode,
          }
        })
        void replaceCatalogGroupFromModal(pendingForVariant.anchorVariantId, patchedRows, {
          deletedVariantIds: pendingForVariant.deletedVariantIds || [],
        })
        setPendingUnitDraft(null)
        triggerGoodsSaveSuccessToast()
        return true
      }

      if (onUpdateCatalogVariant) {
        recordCostAdjustOnSave(variant, patch, nameTrim)
        const upd = onUpdateCatalogVariant(
          variant.id,
          patch,
          String(variant.code ?? '').trim()
        )
        if (upd && typeof upd.then === 'function') {
          const res = await upd
          if (res && res.ok === false) return false
        }
        triggerGoodsSaveSuccessToast()
        return true
      }
      if (standaloneCatalog?.products) {
        const flat = (Array.isArray(standaloneCatalog?.products) ? standaloneCatalog.products : []).flatMap(
          (p) => p.groupVariants || [p]
        )
        const target = flat.find((v) => v.id === variant.id)
        if (!target) return false
        const rootBefore = normalizeGroupRoot(target.code, target.linkedMasterCode)
        const nextFlat = flat.map((v) => {
          if (v.id === variant.id) return { ...v, ...patch }
          if (normalizeGroupRoot(v.code, v.linkedMasterCode) === rootBefore) {
            return { ...v, name: nameTrim }
          }
          return v
        })
        const nextProducts = buildDisplayCatalog(nextFlat)
        recordCostAdjustOnSave(variant, patch, nameTrim)
        void persistStandaloneProducts(nextProducts, standaloneCatalog.fileName || '')
        triggerGoodsSaveSuccessToast()
        return true
      }
      return false
    },
    [
      onUpdateCatalogVariant,
      standaloneCatalog,
      persistStandaloneProducts,
      triggerGoodsSaveSuccessToast,
      recordManualStockAdjustmentVoucher,
      recordCostAdjustOnSave,
      pendingUnitDraft,
      catalogListForGoodsEdit,
      replaceCatalogGroupFromModal,
    ]
  )

  const saveInboundQuickEditDetail = useCallback(async () => {
    if (inboundQuickEditSaving) return
    setInboundQuickEditSaving(true)
    try {
      const ok = await Promise.resolve(
        saveProductDetailFromDraft(inboundQuickEditVariant, inboundQuickEditDraft)
      )
      if (ok) {
        setInboundQuickEditExpandId(null)
        setInboundQuickEditSelectedVid(null)
        setInboundQuickEditDraft(null)
        setInboundQuickEditShelfTab(GOODS_DETAIL_VIEW_TONKHO)
      }
    } finally {
      setInboundQuickEditSaving(false)
    }
  }, [inboundQuickEditSaving, inboundQuickEditVariant, inboundQuickEditDraft, saveProductDetailFromDraft])

  const copyGoodsDetail = useCallback(() => {
    const v = inboundQuickEditVariant
    if (!v) return
    const d = inboundQuickEditDraft
    const name = d ? String(d.name ?? '').trim() : String(v.name ?? '').trim()
    const code = d ? String(d.code ?? '') : String(v.code ?? '')
    const barcode = d ? String(d.barcode ?? '') : String(v.barcode ?? '')
    const stockQty = d
      ? parseAdminStockNullable(d.stockQty)
      : v.stockQty != null && Number.isFinite(Number(v.stockQty))
        ? Number(v.stockQty)
        : ''
    const stockNormMin = d
      ? parseAdminStockNullable(d.stockNormMin)
      : v.stockNormMin != null && Number.isFinite(Number(v.stockNormMin))
        ? Number(v.stockNormMin)
        : ''
    const cost = d ? parseMoneyDraftVi(d.cost) : Number(v.cost) || 0
    const price = d ? parseMoneyDraftVi(d.price) : Number(v.price) || 0
    const wholesale = d ? parseMoneyDraftVi(d.wholesalePrice ?? '0') : Number(v.wholesalePrice) || 0
    const brand = d ? String(d.brand ?? '').trim() : String(v.brand ?? '').trim()
    const weightRaw = d ? String(d.weightRaw ?? '').trim() : String(v.weightRaw ?? '').trim()
    const t = [
      `Tên sản phẩm\t${name}`,
      `Mã hàng\t${code}`,
      `Mã vạch\t${barcode}`,
      `Tồn kho\t${stockQty === null || stockQty === '' ? '' : stockQty}`,
      `Tồn nhỏ nhất\t${stockNormMin === null || stockNormMin === '' ? '' : stockNormMin}`,
      `Giá vốn\t${cost}`,
      `Giá bán lẻ\t${price}`,
      `Giá sỉ\t${wholesale}`,
      `Thương hiệu\t${brand}`,
      `Trọng lượng\t${weightRaw}`,
    ].join('\n')
    navigator.clipboard.writeText(t).catch(() => {})
  }, [inboundQuickEditVariant, inboundQuickEditDraft])

  const discardGoodsDetailDraft = useCallback(() => {
    const v = inboundQuickEditVariant
    if (!v) return
    setPendingUnitDraft(null)
    setInboundQuickEditDraft(buildGoodsDetailDraft(v))
  }, [inboundQuickEditVariant, buildGoodsDetailDraft])

  const deleteGoodsDetailVariant = useCallback(() => {
    const v = inboundQuickEditVariant
    if (!v) return
    if (!window.confirm(`Xóa mặt hàng "${v.name || v.code}" khỏi danh sách?`)) return
    if (onRemoveCatalogVariants) {
      onRemoveCatalogVariants([v.id])
    } else if (standaloneCatalog?.products) {
      void (async () => {
        if (isSupabaseConfigured()) {
          const dr = await deleteProductsForRemovedVariants(catalogList, [v.id])
          if (!dr.ok && !dr.skipped) {
            window.alert(
              describeCatalogPersistError(dr.error) || 'Không xóa được sản phẩm trên Supabase.'
            )
            return
          }
        }
        const idSet = new Set([v.id])
        const remaining = []
        for (const p of standaloneCatalog.products) {
          for (const gv of p.groupVariants || [p]) {
            if (!idSet.has(gv.id)) remaining.push(gv)
          }
        }
        const nextProducts = buildDisplayCatalog(remaining)
        const pr = await persistStandaloneProducts(
          nextProducts,
          standaloneCatalog.fileName || '',
          null,
          { snapshotOnly: true }
        )
        if (!pr?.ok) {
          window.alert(String(pr?.error || 'Không lưu snapshot sau khi xóa.'))
          return
        }
        closeInboundProductQuickEdit()
      })()
      return
    }
    closeInboundProductQuickEdit()
  }, [
    inboundQuickEditVariant,
    onRemoveCatalogVariants,
    standaloneCatalog,
    catalogList,
    persistStandaloneProducts,
    closeInboundProductQuickEdit,
  ])

  const soloActiveVariantId = useMemo(() => parseSoloProductTabId(activeTab), [activeTab])

  useEffect(() => {
    setSoloInvLedgerDocSearch('')
    setSoloInvLedgerDocDebounced('')
    setSoloInvLedgerDateFrom(inventoryDateDefaults.fromYmd)
    setSoloInvLedgerDateTo(inventoryDateDefaults.toYmd)
  }, [soloActiveVariantId, inventoryDateDefaults])

  const soloGoodsCtx = useMemo(() => {
    if (!soloActiveVariantId) return null
    return findVariantContext(catalogListForGoodsEdit, soloActiveVariantId)
  }, [catalogListForGoodsEdit, soloActiveVariantId])

  const soloGoodsVariant = useMemo(() => {
    if (!soloGoodsCtx || !soloActiveVariantId) return null
    return soloGoodsCtx.variants.find((x) => x.id === soloActiveVariantId) ?? null
  }, [soloGoodsCtx, soloActiveVariantId])

  const soloGoodsVariantFp = useMemo(() => {
    const v = soloGoodsVariant
    if (!v) return ''
    return [
      v.id,
      v.code,
      v.barcode,
      v.name,
      v.price,
      v.cost,
      v.stockQty,
      v.stockNormMin,
      v.stockNormMax,
      v.brand,
      v.weightRaw,
    ].join('\u001f')
  }, [soloGoodsVariant])

  const soloGoodsDraft = useMemo(() => {
    if (!soloActiveVariantId) return null
    return soloGoodsDraftByVariantId[soloActiveVariantId] ?? null
  }, [soloActiveVariantId, soloGoodsDraftByVariantId])

  const applySoloGoodsVariantSelection = useCallback(
    (newVid) => {
      const nv = String(newVid ?? '').trim()
      const oldVid = soloActiveVariantId
      if (!oldVid || !nv || nv === oldVid) return
      delete soloGoodsDraftSeedFpByVariantIdRef.current[oldVid]
      delete soloGoodsDraftSeedFpByVariantIdRef.current[nv]
      setOpenProductVariantIds((prev) => prev.map((x) => (x === oldVid ? nv : x)))
      setSoloGoodsDraftByVariantId((prev) => {
        const n = { ...prev }
        delete n[oldVid]
        delete n[nv]
        return n
      })
      setActiveTab(toSoloProductTabId(nv))
    },
    [soloActiveVariantId]
  )

  const patchSoloGoodsDraft = useCallback((fnOrVal) => {
    const vid = parseSoloProductTabId(activeTab)
    if (!vid) return
    setSoloGoodsDraftByVariantId((prev) => {
      const cur = prev[vid]
      const next = typeof fnOrVal === 'function' ? fnOrVal(cur) : fnOrVal
      if (next === cur) return prev
      return { ...prev, [vid]: next }
    })
  }, [activeTab])

  const closeSoloProductTabByVariantId = useCallback((variantId) => {
    const vid = String(variantId ?? '')
    if (!vid) return
    const prev = openProductVariantIdsRef.current
    if (!prev.includes(vid)) return
    const next = prev.filter((x) => x !== vid)
    setOpenProductVariantIds(next)
    delete soloGoodsDraftSeedFpByVariantIdRef.current[vid]
    setSoloGoodsDraftByVariantId((d) => {
      if (!d[vid]) return d
      const o = { ...d }
      delete o[vid]
      return o
    })
    setActiveTab((cur) => {
      if (parseSoloProductTabId(cur) !== vid) return cur
      if (next.length > 0) return toSoloProductTabId(next[next.length - 1])
      return inboundCostResultOriginTabRef.current ?? TAB_GOODS
    })
  }, [])

  const closeSoloProductTab = useCallback(() => {
    const vid = parseSoloProductTabId(activeTab)
    if (!vid) return
    closeSoloProductTabByVariantId(vid)
  }, [activeTab, closeSoloProductTabByVariantId])

  const openProductDetailTab = useCallback((variantId) => {
    if (!variantId) return
    const vid = String(variantId)
    const ctx = findVariantContext(catalogList, vid)
    const v = ctx?.variants.find((x) => x.id === vid)
    if (v) {
      const fp = [
        v.id,
        v.code,
        v.barcode,
        v.name,
        v.price,
        v.wholesalePrice,
        v.cost,
        v.stockQty,
        v.stockNormMin,
        v.stockNormMax,
        v.brand,
        v.weightRaw,
      ].join('\u001f')
      const seedKey = `${vid}\u0000${fp}`
      soloGoodsDraftSeedFpByVariantIdRef.current[vid] = seedKey
      setSoloGoodsDraftByVariantId((prev) => ({ ...prev, [vid]: buildGoodsDetailDraft(v) }))
    }
    setOpenProductVariantIds((prev) => {
      if (prev.includes(vid)) return prev
      const appended = [...prev, vid]
      if (appended.length <= MAX_OPEN_PRODUCT_DETAIL_TABS) return appended
      return appended.slice(-MAX_OPEN_PRODUCT_DETAIL_TABS)
    })
    setActiveTab(toSoloProductTabId(vid))
  }, [catalogList])

  useEffect(() => {
    const raw = hangHoaGoodsOpenRequest?.rawId ? String(hangHoaGoodsOpenRequest.rawId).trim() : ''
    if (!raw) return
    const vid = resolveGoodsVariantIdFromGoodsDeepLink(catalogList, raw)
    if (!vid) {
      const t = window.setTimeout(() => onHangHoaGoodsOpenConsumed?.(), 12000)
      return () => window.clearTimeout(t)
    }
    startTransition(() => {
      setActiveTab(TAB_GOODS)
      syncHubUrlToMainTab(TAB_GOODS)
      setHangHoaDeepLinkVid(vid)
      setHangHoaDeepLinkListScope('single')
      openInboundProductQuickEdit(vid)
      setGoodsQ('')
      setGoodsBrandKey('')
      setGoodsBrandOpen(false)
      setGoodsSelected({})
    })
    let raf1 = 0
    let raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        onHangHoaGoodsOpenConsumed?.()
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [hangHoaGoodsOpenRequest, catalogList, onHangHoaGoodsOpenConsumed, syncHubUrlToMainTab])

  const goodsSearchQueryHandledRef = useRef('')
  useEffect(() => {
    try {
      const searchFromUrl = new URLSearchParams(location.search).get('search')
      const ma_hang = String(searchFromUrl ?? '').trim()
      if (!ma_hang) {
        goodsSearchQueryHandledRef.current = ''
        return
      }
      const routeKey = `${location.pathname}?${ma_hang}`
      if (goodsSearchQueryHandledRef.current === routeKey) return
      goodsSearchQueryHandledRef.current = routeKey
      startTransition(() => {
        setActiveTab(TAB_GOODS)
        setGoodsQ(ma_hang)
        setGoodsBrandKey('')
        setGoodsBrandOpen(false)
        setGoodsSelected({})
      })
      if (!Array.isArray(catalogList) || catalogList.length === 0) return
      const codeNeedle = ma_hang.toLowerCase()
      const matchedVariantIds = []
      for (const p of catalogList) {
        const variants = Array.isArray(p?.groupVariants) && p.groupVariants.length ? p.groupVariants : [p]
        for (const v of variants) {
          const maHangValue = String(v?.ma_hang ?? v?.code ?? '').trim().toLowerCase()
          if (!maHangValue || maHangValue !== codeNeedle) continue
          const vid = String(v?.id ?? '').trim()
          if (!vid) continue
          matchedVariantIds.push(vid)
        }
      }
      if (matchedVariantIds.length === 1) {
        const matchedVid = matchedVariantIds[0]
        startTransition(() => {
          setHangHoaDeepLinkListScope('all')
          setHangHoaDeepLinkVid(null)
          openInboundProductQuickEdit(matchedVid)
        })
      }
    } catch (error) {
      console.error('[AdminHub] Failed to handle goods search query', error)
    }
  }, [location.pathname, location.search, catalogList.length])

  useEffect(() => {
    if (openProductVariantIds.length === 0) return
    setSoloGoodsDraftByVariantId((prevDrafts) => {
      const next = { ...prevDrafts }
      let changed = false
      for (const variantId of openProductVariantIds) {
        const ctx = findVariantContext(catalogList, variantId)
        const v = ctx?.variants.find((x) => x.id === variantId)
        if (!v) continue
        const fp = [
          v.id,
          v.code,
          v.barcode,
          v.name,
          v.price,
          v.wholesalePrice,
          v.cost,
          v.stockQty,
          v.stockNormMin,
          v.stockNormMax,
          v.brand,
          v.weightRaw,
        ].join('\u001f')
        const key = `${variantId}\u0000${fp}`
        if ((soloGoodsDraftSeedFpByVariantIdRef.current[variantId] ?? '') === key) continue
        soloGoodsDraftSeedFpByVariantIdRef.current[variantId] = key
        next[variantId] = buildGoodsDetailDraft(v)
        changed = true
      }
      return changed ? next : prevDrafts
    })
  }, [openProductVariantIds, catalogList])

  useEffect(() => {
    if (openProductVariantIds.length === 0) return
    const invalid = openProductVariantIds.filter((id) => !findVariantContext(catalogList, id))
    if (invalid.length === 0) return
    for (const id of invalid) delete soloGoodsDraftSeedFpByVariantIdRef.current[id]
    setOpenProductVariantIds((prev) => prev.filter((id) => !invalid.includes(id)))
    setSoloGoodsDraftByVariantId((prev) => {
      const n = { ...prev }
      for (const id of invalid) delete n[id]
      return n
    })
    const curVid = parseSoloProductTabId(activeTab)
    if (curVid && invalid.includes(curVid)) {
      setActiveTab(inboundCostResultOriginTabRef.current ?? TAB_GOODS)
    }
  }, [openProductVariantIds, catalogList, activeTab])

  useEffect(() => {
    if (!isSoloProductTabId(activeTab)) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSoloProductTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, closeSoloProductTab])

  const saveSoloGoodsDetail = useCallback(async () => {
    if (!soloGoodsVariant || !soloGoodsDraft) return
    const nameTrim = String(soloGoodsDraft.name ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const patch = {
      name: nameTrim,
      code: String(soloGoodsDraft.code ?? '').trim(),
      barcode: normalizeBarcodeValue(soloGoodsDraft.barcode),
      brand: String(soloGoodsDraft.brand ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
      weightRaw: String(soloGoodsDraft.weightRaw ?? '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      price: parseMoneyDraftVi(soloGoodsDraft.price),
      wholesalePrice: parseMoneyDraftVi(soloGoodsDraft.wholesalePrice ?? '0'),
      cost: parseMoneyDraftVi(soloGoodsDraft.cost),
      stockQty: parseAdminStockNullable(soloGoodsDraft.stockQty),
      stockNormMin: parseAdminStockNullable(soloGoodsDraft.stockNormMin),
      stockNormMax:
        soloGoodsVariant.stockNormMax != null &&
        Number.isFinite(Number(soloGoodsVariant.stockNormMax))
          ? Number(soloGoodsVariant.stockNormMax)
          : null,
    }
    const pendingForVariant =
      pendingUnitDraft &&
      findVariantContext(catalogListForGoodsEdit, pendingUnitDraft.anchorVariantId)?.variants?.some(
        (x) => x.id === soloGoodsVariant.id
      )
        ? pendingUnitDraft
        : null
    if (pendingForVariant) {
      const patchedRows = pendingForVariant.replacements.map((row) => {
        if (row.id !== soloGoodsVariant.id) {
          return { ...row, name: nameTrim, nameRaw: nameTrim }
        }
        return {
          ...row,
          ...patch,
          name: nameTrim,
          nameRaw: nameTrim,
          unitLabel: row.unitLabel,
          conversion: row.conversion,
          conversionValue: row.conversionValue,
          linkedMasterCode: row.linkedMasterCode,
        }
      })
      await replaceCatalogGroupFromModal(pendingForVariant.anchorVariantId, patchedRows, {
        deletedVariantIds: pendingForVariant.deletedVariantIds || [],
      })
      setPendingUnitDraft(null)
      triggerGoodsSaveSuccessToast()
      return
    }
    recordManualStockAdjustmentVoucher({
      variantId: soloGoodsVariant.id,
      productName: nameTrim || String(soloGoodsVariant.name || '').trim(),
      productCode: patch.code,
      unitLabel: normalizeCatalogUnitLabel(soloGoodsVariant.unitLabel),
      beforeQty: soloGoodsVariant.stockQty,
      afterQty: patch.stockQty,
    })
    if (onUpdateCatalogVariant) {
      recordCostAdjustOnSave(soloGoodsVariant, patch, nameTrim)
      const upd = onUpdateCatalogVariant(
        soloGoodsVariant.id,
        patch,
        String(soloGoodsVariant.code ?? '').trim()
      )
      if (upd && typeof upd.then === 'function') {
        const res = await upd
        if (res && res.ok === false) return
      }
      triggerGoodsSaveSuccessToast()
      return
    }
    if (standaloneCatalog?.products) {
      const flat = (Array.isArray(standaloneCatalog?.products) ? standaloneCatalog.products : []).flatMap(
        (p) => p.groupVariants || [p]
      )
      const target = flat.find((v) => v.id === soloGoodsVariant.id)
      if (!target) return
      const rootBefore = normalizeGroupRoot(target.code, target.linkedMasterCode)
      const nextFlat = flat.map((v) => {
        if (v.id === soloGoodsVariant.id) return { ...v, ...patch }
        if (normalizeGroupRoot(v.code, v.linkedMasterCode) === rootBefore) {
          return { ...v, name: nameTrim }
        }
        return v
      })
      const nextProducts = buildDisplayCatalog(nextFlat)
      recordCostAdjustOnSave(soloGoodsVariant, patch, nameTrim)
      void persistStandaloneProducts(nextProducts, standaloneCatalog.fileName || '')
      triggerGoodsSaveSuccessToast()
    }
  }, [
    soloGoodsVariant,
    soloGoodsDraft,
    onUpdateCatalogVariant,
    standaloneCatalog,
    persistStandaloneProducts,
    triggerGoodsSaveSuccessToast,
    recordManualStockAdjustmentVoucher,
    recordCostAdjustOnSave,
    pendingUnitDraft,
    catalogListForGoodsEdit,
    replaceCatalogGroupFromModal,
  ])

  const copySoloGoodsDetail = useCallback(() => {
    const v = soloGoodsVariant
    if (!v) return
    const d = soloGoodsDraft
    const name = d ? String(d.name ?? '').trim() : String(v.name ?? '').trim()
    const code = d ? String(d.code ?? '') : String(v.code ?? '')
    const barcode = d ? String(d.barcode ?? '') : String(v.barcode ?? '')
    const stockQty = d
      ? parseAdminStockNullable(d.stockQty)
      : v.stockQty != null && Number.isFinite(Number(v.stockQty))
        ? Number(v.stockQty)
        : ''
    const stockNormMin = d
      ? parseAdminStockNullable(d.stockNormMin)
      : v.stockNormMin != null && Number.isFinite(Number(v.stockNormMin))
        ? Number(v.stockNormMin)
        : ''
    const cost = d ? parseMoneyDraftVi(d.cost) : Number(v.cost) || 0
    const price = d ? parseMoneyDraftVi(d.price) : Number(v.price) || 0
    const wholesale = d ? parseMoneyDraftVi(d.wholesalePrice ?? '0') : Number(v.wholesalePrice) || 0
    const brand = d ? String(d.brand ?? '').trim() : String(v.brand ?? '').trim()
    const weightRaw = d ? String(d.weightRaw ?? '').trim() : String(v.weightRaw ?? '').trim()
    const t = [
      `Tên sản phẩm\t${name}`,
      `Mã hàng\t${code}`,
      `Mã vạch\t${barcode}`,
      `Tồn kho\t${stockQty === null || stockQty === '' ? '' : stockQty}`,
      `Tồn nhỏ nhất\t${stockNormMin === null || stockNormMin === '' ? '' : stockNormMin}`,
      `Giá vốn\t${cost}`,
      `Giá bán lẻ\t${price}`,
      `Giá sỉ\t${wholesale}`,
      `Thương hiệu\t${brand}`,
      `Trọng lượng\t${weightRaw}`,
    ].join('\n')
    navigator.clipboard.writeText(t).catch(() => {})
  }, [soloGoodsVariant, soloGoodsDraft])

  const discardSoloGoodsDraftChanges = useCallback(() => {
    const vid = parseSoloProductTabId(activeTab)
    if (!vid || !soloGoodsVariant) return
    setPendingUnitDraft(null)
    setSoloGoodsDraftByVariantId((prev) => ({
      ...prev,
      [vid]: buildGoodsDetailDraft(soloGoodsVariant),
    }))
  }, [activeTab, soloGoodsVariant])

  const deleteSoloGoodsVariant = useCallback(() => {
    const v = soloGoodsVariant
    if (!v) return
    if (!window.confirm(`Xóa mặt hàng "${v.name || v.code}" khỏi danh sách?`)) return
    if (onRemoveCatalogVariants) {
      onRemoveCatalogVariants([v.id])
    } else if (standaloneCatalog?.products) {
      void (async () => {
        if (isSupabaseConfigured()) {
          const dr = await deleteProductsForRemovedVariants(catalogList, [v.id])
          if (!dr.ok && !dr.skipped) {
            window.alert(
              describeCatalogPersistError(dr.error) || 'Không xóa được sản phẩm trên Supabase.'
            )
            return
          }
        }
        const idSet = new Set([v.id])
        const remaining = []
        for (const p of standaloneCatalog.products) {
          for (const gv of p.groupVariants || [p]) {
            if (!idSet.has(gv.id)) remaining.push(gv)
          }
        }
        const nextProducts = buildDisplayCatalog(remaining)
        const pr = await persistStandaloneProducts(
          nextProducts,
          standaloneCatalog.fileName || '',
          null,
          { snapshotOnly: true }
        )
        if (!pr?.ok) {
          window.alert(String(pr?.error || 'Không lưu snapshot sau khi xóa.'))
          return
        }
        closeSoloProductTab()
      })()
      return
    }
    closeSoloProductTab()
  }, [
    soloGoodsVariant,
    onRemoveCatalogVariants,
    standaloneCatalog,
    catalogList,
    persistStandaloneProducts,
    closeSoloProductTab,
  ])

  const openSoloGoodsUnitModal = useCallback(() => {
    if (!soloActiveVariantId) return
    const ctx = findVariantContext(catalogListForGoodsEdit, soloActiveVariantId)
    if (!ctx?.variants?.length) return
    setUnitModal({
      anchorVariantId: String(soloActiveVariantId),
      lines: createUnitModalLinesFromVariants(ctx.variants),
      source: 'solo',
      deletedVariantIds: [],
    })
  }, [catalogListForGoodsEdit, soloActiveVariantId])

  const commitUnitModal = useCallback(async () => {
    if (!unitModal) return

    const ctx = findVariantContext(catalogListForGoodsEdit, unitModal.anchorVariantId)
    if (!ctx?.variants?.length) {
      setUnitModal(null)
      return
    }
    const template = sortVariantsSmallestUnitFirst(ctx.variants)[0]
    const sortedLines = sortUnitModalLinesByConversion(unitModal.lines)
    const nameTrim =
      unitModal.source === 'inbound'
        ? String(inboundQuickEditDraft?.name ?? inboundQuickEditVariant?.name ?? '')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : String(soloGoodsDraft?.name ?? soloGoodsVariant?.name ?? '')
              .replace(/\u00A0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
    if (!nameTrim) {
      window.alert('Vui lòng nhập tên sản phẩm trước khi lưu đơn vị.')
      return
    }
    const err = validateUnitModalLines(sortedLines, String(template.code ?? '').trim())
    if (err) {
      window.alert(err)
      return
    }
    const prevById = new Map(ctx.variants.map((v) => [v.id, v]))
    const replacements = buildCatalogVariantsFromUnitModal({
      templateVariant: template,
      linesSorted: sortedLines,
      nameTrim,
      prevByVariantId: prevById,
    })
    const payload = replacements.map((v) => {
      const prev = prevById.get(v.id)
      const ma_hang = String(v.persistMaHang ?? prev?.code ?? v.code ?? '').trim()
      return {
        ma_hang,
        ma_vach: String(v.barcode ?? '').trim(),
        ten_hang: nameTrim,
        thuong_hieu: String(v.brand ?? '').trim(),
        gia_ban: Number(v.price) || 0,
        gia_von: Number(v.cost) || 0,
        ton_kho:
          v.stockQty != null && v.stockQty !== '' && Number.isFinite(Number(v.stockQty))
            ? Number(v.stockQty)
            : 0,
        dvt: normalizeCatalogUnitLabel(v.unitLabel),
        quy_doi:
          v.conversion != null &&
          String(v.conversion).trim() !== '' &&
          Number.isFinite(Number(v.conversion))
            ? String(v.conversion)
            : String(v.raw?.quy_doi ?? v.quy_doi ?? ''),
      }
    })
    if (isSupabaseConfigured()) {
      try {
        const sb = getSupabaseClient()
        if (!sb) throw new Error('Không tạo được Supabase client.')
        console.warn('KIỂM TRA CẤU TRÚC PAYLOAD:', payload)
        if (!Array.isArray(payload) || payload.length === 0) {
          window.alert('Lỗi lưu ĐVT: payload trống — không gửi lên Supabase.')
          return
        }
        const missingMa = payload.filter((row) => !String(row?.ma_hang ?? '').trim())
        if (missingMa.length > 0) {
          console.warn('[Đơn vị tính · Lưu] Dòng thiếu ma_hang:', missingMa)
          window.alert('Lỗi lưu ĐVT: thiếu mã hàng (ma_hang) trên một hoặc nhiều dòng.')
          return
        }
        const response = await sb.from('products').upsert(payload)
        console.error('--- DEBUG SAU KHI UPSERT ĐVT ---', response)
        if (response?.error) throw response.error
      } catch (e) {
        console.error('[Đơn vị tính · Lưu] lỗi Supabase:', e)
        window.alert('Lỗi lưu ĐVT lên Supabase!')
        return
      }
    }
    const nextIds = new Set(replacements.map((v) => String(v.id)))
    const implicitDeleted = ctx.variants
      .map((v) => String(v.id))
      .filter((id) => !nextIds.has(id))
    const deletedVariantIds = [
      ...new Set([
        ...(unitModal.deletedVariantIds || []).map(String),
        ...implicitDeleted,
      ]),
    ]
    const mainId = replacements[0]?.id
    const src = unitModal.source
    const oldAnchor = unitModal.anchorVariantId
    const anchorForSave = unitModal.anchorVariantId

    setUnitModal(null)
    setPendingUnitDraft({
      anchorVariantId: anchorForSave,
      replacements,
      deletedVariantIds,
    })

    if (mainId && src === 'inbound') {
      inboundQuickEditPreserveRef.current = {
        name: inboundQuickEditDraft?.name,
        brand: inboundQuickEditDraft?.brand,
        weightRaw: inboundQuickEditDraft?.weightRaw,
      }
      setInboundQuickEditExpandId(mainId)
      setInboundQuickEditSelectedVid(mainId)
      inboundQuickEditDraftSeedVariantIdRef.current = ''
    }
    if (mainId && src === 'solo') {
      if (oldAnchor !== mainId) {
        setOpenProductVariantIds((prev) => prev.map((x) => (x === oldAnchor ? mainId : x)))
      }
      delete soloGoodsDraftSeedFpByVariantIdRef.current[oldAnchor]
      delete soloGoodsDraftSeedFpByVariantIdRef.current[mainId]
      setActiveTab(toSoloProductTabId(mainId))
    }

  }, [
    unitModal,
    catalogListForGoodsEdit,
    inboundQuickEditDraft,
    inboundQuickEditVariant,
    soloGoodsDraft,
    soloGoodsVariant,
  ])

  const updateUnitModalConversionAtKey = useCallback((key, raw) => {
    setUnitModal((m) => {
      if (!m) return m
      let lines = m.lines.map((r) => (r.key === key ? { ...r, conversion: raw } : r))
      lines = sortUnitModalLinesByConversion(lines)
      const bc = parseMoneyDigitsVi(lines[0].cost)
      const bp = parseMoneyDigitsVi(lines[0].price)
      lines = propagateBaseUnitMoney(lines, bc, bp)
      return { ...m, lines }
    })
  }, [])

  const updateUnitModalCostAtKey = useCallback((key, digits) => {
    setUnitModal((m) => {
      if (!m) return m
      const n = digits === '' ? 0 : parseInt(digits, 10)
      const costStr = digits === '' ? '' : formatMoneyDraftVi(n)
      let lines = m.lines.map((r) => (r.key === key ? { ...r, cost: costStr } : r))
      lines = sortUnitModalLinesByConversion(lines)
      if (lines[0]?.key === key) {
        lines = lines.map((r, i) =>
          i === 0 ? { ...r, costManual: false, priceManual: false } : r
        )
        const bc = parseMoneyDigitsVi(lines[0].cost)
        const bp = parseMoneyDigitsVi(lines[0].price)
        lines = propagateBaseUnitMoney(lines, bc, bp)
      } else {
        lines = lines.map((r) => (r.key === key ? { ...r, costManual: true } : r))
      }
      return { ...m, lines }
    })
  }, [])

  const updateUnitModalPriceAtKey = useCallback((key, digits) => {
    setUnitModal((m) => {
      if (!m) return m
      const n = digits === '' ? 0 : parseInt(digits, 10)
      const priceStr = digits === '' ? '' : formatMoneyDraftVi(n)
      let lines = m.lines.map((r) => (r.key === key ? { ...r, price: priceStr } : r))
      lines = sortUnitModalLinesByConversion(lines)
      if (lines[0]?.key === key) {
        lines = lines.map((r, i) =>
          i === 0 ? { ...r, costManual: false, priceManual: false } : r
        )
        const bc = parseMoneyDigitsVi(lines[0].cost)
        const bp = parseMoneyDigitsVi(lines[0].price)
        lines = propagateBaseUnitMoney(lines, bc, bp)
      } else {
        lines = lines.map((r) => (r.key === key ? { ...r, priceManual: true } : r))
      }
      return { ...m, lines }
    })
  }, [])

  const addUnitModalRow = useCallback(() => {
    setUnitModal((m) => {
      if (!m) return m
      const s = sortUnitModalLinesByConversion(m.lines)
      const last = s[s.length - 1]
      const lastC = parsePositiveConversion(last?.conversion) ?? 1
      const nextC = Math.max(2, Math.round(lastC * 2))
      let lines = [
        ...m.lines,
        {
          key: newUnitModalRowKey(),
          variantId: '',
          unitLabel: '',
          conversion: String(nextC),
          code: '',
          barcode: '',
          cost: '',
          price: '',
          costManual: false,
          priceManual: false,
        },
      ]
      lines = sortUnitModalLinesByConversion(lines)
      const bc = parseMoneyDigitsVi(lines[0].cost)
      const bp = parseMoneyDigitsVi(lines[0].price)
      lines = propagateBaseUnitMoney(lines, bc, bp)
      return { ...m, lines }
    })
  }, [])

  const removeUnitModalRowKey = useCallback((key) => {
    setUnitModal((m) => {
      if (!m || m.lines.length <= 1) return m
      const removed = m.lines.find((r) => r.key === key)
      const deletedVariantIds = [...(m.deletedVariantIds || [])]
      const vid = String(removed?.variantId ?? '').trim()
      if (vid) deletedVariantIds.push(vid)
      let lines = m.lines.filter((r) => r.key !== key)
      lines = sortUnitModalLinesByConversion(lines)
      const bc = parseMoneyDigitsVi(lines[0].cost)
      const bp = parseMoneyDigitsVi(lines[0].price)
      lines = propagateBaseUnitMoney(lines, bc, bp)
      return { ...m, lines, deletedVariantIds }
    })
  }, [])

  const unitModalSortedRows = useMemo(
    () => (unitModal ? sortUnitModalLinesByConversion(unitModal.lines) : []),
    [unitModal]
  )

  const goodsSelectedIds = useMemo(
    () => new Set(Object.keys(goodsSelected).filter((k) => goodsSelected[k])),
    [goodsSelected]
  )

  const goodsAllFilteredSelected =
    goodsRowsFiltered.length > 0 && goodsRowsFiltered.every((r) => goodsSelected[r.id])

  const toggleGoodsSelect = (id) => {
    setGoodsSelected((m) => ({ ...m, [id]: !m[id] }))
  }

  const toggleGoodsSelectAll = () => {
    if (goodsAllFilteredSelected) {
      setGoodsSelected((m) => {
        const next = { ...m }
        for (const r of goodsRowsFiltered) delete next[r.id]
        return next
      })
    } else {
      setGoodsSelected((m) => {
        const next = { ...m }
        for (const r of goodsRowsFiltered) next[r.id] = true
        return next
      })
    }
  }

  const handleGoodsImport = () => {
    if (onTriggerCatalogImport) onTriggerCatalogImport()
    else standaloneImportRef.current?.click()
  }

  const onStandaloneCsv = async (e) => {
    const file = e.target.files?.[0]
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
        alert(res.error)
        return
      }
      await persistCatalogSnapshotAndProducts(res.products, file.name)
      const refreshed = refreshCatalogSearchTexts(res.products)
      startTransition(() => {
        setStandaloneCatalog({
          products: refreshed,
          fileName: file.name,
        })
        setGoodsSelected({})
      })
    } catch (err) {
      console.error(err)
      alert('Không đọc được file.')
    }
  }

  const handleGoodsExport = () => {
    const pick =
      goodsSelectedIds.size > 0
        ? goodsRowsAll.filter((r) => goodsSelectedIds.has(r.id))
        : goodsRowsFiltered
    if (pick.length === 0) {
      alert('Không có dòng nào để xuất.')
      return
    }
    try {
      exportGoodsRowsToKiotCsv(pick)
    } catch (err) {
      console.error(err)
      alert('Không xuất được file CSV.')
    }
  }

  const handleGoodsDeleteSelected = () => {
    const ids = [...goodsSelectedIds]
    if (ids.length === 0) {
      alert('Chọn ít nhất một dòng (ô đầu dòng).')
      return
    }
    if (!window.confirm(`Xóa ${ids.length} mặt hàng khỏi danh sách trên trình duyệt này?`)) return
    if (onRemoveCatalogVariants) {
      onRemoveCatalogVariants(ids)
      setGoodsSelected({})
      return
    }
    const idSet = new Set(ids)
    const remaining = []
    for (const p of standaloneCatalog?.products ?? []) {
      for (const v of p.groupVariants || [p]) {
        if (!idSet.has(v.id)) remaining.push(v)
      }
    }
    const nextProducts = buildDisplayCatalog(remaining)
    const fn = standaloneCatalog?.fileName || ''
    void persistStandaloneProducts(nextProducts, fn)
    setGoodsSelected({})
  }

  const handleGoodsMobileCardDelete = useCallback(
    (variantId) => {
      const id = String(variantId ?? '').trim()
      if (!id) return
      const row = goodsRowsAll.find((r) => r.id === id)
      if (!row) return
      if (!window.confirm(`Xóa mặt hàng "${row.name || row.code}" khỏi danh sách?`)) return
      if (inboundQuickEditExpandId === id) closeInboundProductQuickEdit()
      if (onRemoveCatalogVariants) {
        onRemoveCatalogVariants([id])
      } else {
        const idSet = new Set([id])
        const remaining = []
        for (const p of standaloneCatalog?.products ?? []) {
          for (const v of p.groupVariants || [p]) {
            if (!idSet.has(v.id)) remaining.push(v)
          }
        }
        const nextProducts = buildDisplayCatalog(remaining)
        const fn = standaloneCatalog?.fileName || ''
        void persistStandaloneProducts(nextProducts, fn)
      }
      setGoodsSelected((prev) => {
        if (!prev[id]) return prev
        const n = { ...prev }
        delete n[id]
        return n
      })
    },
    [
      goodsRowsAll,
      inboundQuickEditExpandId,
      closeInboundProductQuickEdit,
      onRemoveCatalogVariants,
      standaloneCatalog,
      persistStandaloneProducts,
    ]
  )

  /* —— Nhập hàng —— */
  const [inboundOrders, setInboundOrders] = useState(() => loadInboundOrdersFromStorage())
  const inboundOrdersRef = useRef(inboundOrders)
  inboundOrdersRef.current = inboundOrders
  const [inboundRemoteLoading, setInboundRemoteLoading] = useState(false)
  const [inboundQ, setInboundQ] = useState('')
  const inboundDebounced = useDebounced(inboundQ)
  const [inboundSelected, setInboundSelected] = useState(() => ({}))

  useEffect(() => {
    if (activeTab !== TAB_INBOUND && activeTab !== TAB_ORDERS) {
      setInboundSelected({})
    }
  }, [activeTab])

  useEffect(() => {
    try {
      localStorage.setItem(INBOUND_STORAGE_KEY, JSON.stringify(inboundOrders))
    } catch (e) {
      console.warn(e)
    }
  }, [inboundOrders])

  const refreshInboundInvoices = useCallback(async (opts = {}) => {
    const quiet = opts?.quiet === true
    if (!isSupabaseConfigured()) {
      setInboundOrders(loadInboundOrdersFromStorage())
      return
    }
    if (!quiet) setInboundRemoteLoading(true)
    try {
      const r = await fetchInboundInvoices()
      if (!r.ok) {
        console.warn('[AdminHub] Không tải được inbound_history', r.error)
        return
      }
      const remote = Array.isArray(r.rows)
        ? r.rows.map((x) => normalizeInboundRow(x)).filter((x) => x.id && x.code)
        : []
      setInboundOrders((prev) => {
        const byId = new Map(remote.map((row) => [row.id, row]))
        for (const row of prev) {
          if (row.id && row.code && !byId.has(row.id)) byId.set(row.id, row)
        }
        return [...byId.values()].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      })
    } finally {
      if (!quiet) setInboundRemoteLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshInboundInvoices()
  }, [refreshInboundInvoices])

  useEffect(() => {
    if (activeTab !== TAB_INBOUND) return
    void refreshInboundInvoices({ quiet: true })
  }, [activeTab, refreshInboundInvoices])

  useEffect(() => {
    const onBump = () => {
      void refreshInboundInvoices({ quiet: true })
    }
    window.addEventListener(INBOUND_SYNC_BUMP_EVENT, onBump)
    return () => window.removeEventListener(INBOUND_SYNC_BUMP_EVENT, onBump)
  }, [refreshInboundInvoices])

  const inboundRowsFiltered = useMemo(() => {
    const q = inboundDebounced.trim().toLowerCase()
    if (!q) return inboundOrders
    return inboundOrders.filter(
      (r) =>
        String(r.code).toLowerCase().includes(q) ||
        String(r.supplier).toLowerCase().includes(q) ||
        inboundStatusLabel(r.status).toLowerCase().includes(q)
    )
  }, [inboundOrders, inboundDebounced])

  const inboundSelectedIds = useMemo(
    () => new Set(Object.keys(inboundSelected).filter((k) => inboundSelected[k])),
    [inboundSelected]
  )

  const inboundAllFilteredSelected =
    inboundRowsFiltered.length > 0 && inboundRowsFiltered.every((r) => inboundSelected[r.id])

  const toggleInboundSelect = (id) => {
    setInboundSelected((m) => ({ ...m, [id]: !m[id] }))
  }

  const toggleInboundSelectAll = () => {
    if (inboundAllFilteredSelected) {
      setInboundSelected((m) => {
        const next = { ...m }
        for (const r of inboundRowsFiltered) delete next[r.id]
        return next
      })
    } else {
      setInboundSelected((m) => {
        const next = { ...m }
        for (const r of inboundRowsFiltered) next[r.id] = true
        return next
      })
    }
  }

  const handleInboundDeleteSelected = () => {
    const ids = [...inboundSelectedIds]
    if (ids.length === 0) {
      alert('Chọn ít nhất một đơn (ô đầu dòng).')
      return
    }
    if (!window.confirm(`Xóa ${ids.length} đơn nhập đã chọn?`)) return
    const idSet = new Set(ids)
    setInboundOrders((rows) => rows.filter((r) => !idSet.has(r.id)))
    setInboundSelected({})
  }

  const handleInboundExportSelected = () => {
    if (inboundSelectedIds.size === 0) {
      alert('Chọn ít nhất một đơn để xuất file.')
      return
    }
    const pick = inboundOrders.filter((r) => inboundSelectedIds.has(r.id))
    try {
      exportInboundRowsToCsvFile(pick)
    } catch (err) {
      console.error(err)
      alert('Không xuất được file.')
    }
  }

  const inboundListImportRef = useRef(null)
  const [suppliers, setSuppliers] = useState(() => loadSuppliersFromStorage())

  const persistSuppliers = useCallback((rows) => {
    try {
      localStorage.setItem(SUPPLIERS_STORAGE_KEY, JSON.stringify(rows))
    } catch (e) {
      console.warn(e)
    }
    setSuppliers(rows)
  }, [])

  /** Một lần / phiên làm việc khi lần đầu mở tab Nhập hàng — không phụ thuộc refreshKey, không lặp khi đổi tab. */
  const suppliersInboundFetchedOnceRef = useRef(false)
  useEffect(() => {
    if (activeTab !== TAB_INBOUND && activeTab !== TAB_INBOUND_DRAFT) return
    if (suppliersInboundFetchedOnceRef.current) return
    let cancelled = false
    void (async () => {
      if (!isSupabaseConfigured()) {
        if (cancelled) return
        setSuppliers(loadSuppliersFromStorage())
        suppliersInboundFetchedOnceRef.current = true
        return
      }
      try {
        const remote = await fetchSuppliersFromSupabase()
        if (cancelled) return
        const local = loadSuppliersFromStorage()
        const merged = mergeSupplierListsDedupe(remote, local)
        persistSuppliers(merged)
        suppliersInboundFetchedOnceRef.current = true
      } catch (e) {
        console.warn('[AdminHub] Đồng bộ nhà cung cấp (suppliers)', e)
        if (!cancelled) {
          setSuppliers(loadSuppliersFromStorage())
          suppliersInboundFetchedOnceRef.current = true
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTab, persistSuppliers])

  /** Khi true, hiện tab "Phiếu nhập mới" trên nav (cho đến khi đóng / lưu). */
  const [inboundDraftSession, setInboundDraftSession] = useState(() => Boolean(standaloneInboundCreate))
  const inboundCompletePendingRef = useRef(null)
  /** Modal xác nhận ghi đè giá vốn khi Hoàn thành. */
  const [inboundCostDiffModal, setInboundCostDiffModal] = useState(null)
  const [inboundFormLines, setInboundFormLines] = useState([])
  const inboundFormLinesRef = useRef(inboundFormLines)
  inboundFormLinesRef.current = inboundFormLines
  const [inboundFormProductQ, setInboundFormProductQ] = useState('')
  const [inboundProductSuggestIdx, setInboundProductSuggestIdx] = useState(0)
  const inboundProductSearchRef = useRef(null)
  const [inboundQuickPickOpen, setInboundQuickPickOpen] = useState(false)
  const [inboundQuickPickSelected, setInboundQuickPickSelected] = useState(() => new Set())
  const inboundFormProductDebounced = useDebounced(inboundFormProductQ)
  const [inboundFormSupplierQ, setInboundFormSupplierQ] = useState('')
  const [inboundFormSupplierName, setInboundFormSupplierName] = useState('')
  const [inboundFormCode, setInboundFormCode] = useState('')
  const [inboundFormNote, setInboundFormNote] = useState('')
  const [inboundFormDiscMode, setInboundFormDiscMode] = useState('amount')
  const [inboundFormDiscRaw, setInboundFormDiscRaw] = useState('')
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [supplierSavedToastGen, setSupplierSavedToastGen] = useState(0)
  const triggerSupplierSavedToast = useCallback(() => {
    setSupplierSavedToastGen((g) => g + 1)
  }, [])
  /** Toast ngắn sau Lưu phiếu / Hoàn thành (thay cho alert). */
  const [inboundSaveToastGen, setInboundSaveToastGen] = useState(0)
  const triggerInboundSaveToast = useCallback(() => {
    setInboundSaveToastGen((g) => g + 1)
  }, [])
  /** Quét liên tục — toast phía trên (camera vẫn mở), 2s. */
  const [hubCameraToast, setHubCameraToast] = useState(null)
  const hubCameraToastClearRef = useRef(null)
  const showHubCameraToast = useCallback((msg, kind = 'ok') => {
    const t = String(msg ?? '').trim()
    if (!t) return
    if (hubCameraToastClearRef.current != null) {
      window.clearTimeout(hubCameraToastClearRef.current)
      hubCameraToastClearRef.current = null
    }
    setHubCameraToast({ text: t, kind })
    hubCameraToastClearRef.current = window.setTimeout(() => {
      setHubCameraToast(null)
      hubCameraToastClearRef.current = null
    }, 2000)
  }, [])
  /** Lỗi đồng bộ phiếu nhập chạy ngầm. */
  const [inboundSyncErrMsg, setInboundSyncErrMsg] = useState('')
  useEffect(() => {
    if (!inboundSyncErrMsg) return undefined
    const tid = window.setTimeout(() => setInboundSyncErrMsg(''), 8000)
    return () => window.clearTimeout(tid)
  }, [inboundSyncErrMsg])
  const openGoodsBrandSupplierModal = useCallback(() => {
    setSupplierModalOpen(true)
  }, [])
  const [customerSaving, setCustomerSaving] = useState(false)
  const [employeeSaving, setEmployeeSaving] = useState(false)
  /** Đang sửa phiếu nhập có sẵn (id đơn). */
  const [inboundFormEditOrderId, setInboundFormEditOrderId] = useState(null)
  /** Hoàn trả: đơn + số lượng trả nhập theo lineId (chuỗi ô input). */
  const [inboundReturnModal, setInboundReturnModal] = useState(null)
  const [inboundReturnQtyDraft, setInboundReturnQtyDraft] = useState({})
  /** Hủy đơn: xác nhận floating. */
  const [inboundCancelModal, setInboundCancelModal] = useState(null)
  /** Tab nav: nhiều phiếu chi tiết cùng lúc. */
  const [openInboundDetailOrderIds, setOpenInboundDetailOrderIds] = useState([])
  /** Chỉnh sửa inline trong tab chi tiết: orderId → dòng draft. */
  const [inboundDetailLineDrafts, setInboundDetailLineDrafts] = useState({})
  const openInboundDetailOrderIdsRef = useRef([])
  useEffect(() => {
    openInboundDetailOrderIdsRef.current = openInboundDetailOrderIds
  }, [openInboundDetailOrderIds])

  const [openPosDetailOrderIds, setOpenPosDetailOrderIds] = useState([])
  const [posDetailEditDrafts, setPosDetailEditDrafts] = useState({})
  const [posReturnModal, setPosReturnModal] = useState(null)
  const [posReturnQtyDraft, setPosReturnQtyDraft] = useState({})
  const [posReturnSubmitting, setPosReturnSubmitting] = useState(false)
  const [posCancelModal, setPosCancelModal] = useState(null)
  const openPosDetailOrderIdsRef = useRef([])
  useEffect(() => {
    openPosDetailOrderIdsRef.current = openPosDetailOrderIds
  }, [openPosDetailOrderIds])

  const [openPosReturnDetailLedgerIds, setOpenPosReturnDetailLedgerIds] = useState([])
  const openPosReturnDetailLedgerIdsRef = useRef([])
  useEffect(() => {
    openPosReturnDetailLedgerIdsRef.current = openPosReturnDetailLedgerIds
  }, [openPosReturnDetailLedgerIds])

  /** Giá trị duy nhất từ `thuong_hieu` / `brand` trong toàn bộ kho hàng (CSV cột D). */
  const catalogThuongHieuUnique = useMemo(
    () => collectUniqueThuongHieuFromCatalog(catalogList),
    [catalogList]
  )

  /** Gợi ý NCC: ưu tiên bảng `suppliers` (Supabase), thêm thương hiệu trong danh mục nếu chưa có. */
  const inboundNccAutocompleteOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const s of suppliers || []) {
      const n = String(s?.name || '').trim()
      if (!n) continue
      const k = n.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
    for (const br of catalogThuongHieuUnique || []) {
      const n = String(br || '').trim()
      if (!n) continue
      const k = n.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
    return out.sort((a, b) => a.localeCompare(b, 'vi'))
  }, [suppliers, catalogThuongHieuUnique])

  const inboundProductSuggest = useMemo(() => {
    const raw = inboundFormProductDebounced.trim()
    if (!raw || catalogListForInbound.length === 0) return []
    return suggestCatalogVariantPairsV9(catalogListForInbound, raw, {
      maxHits: 20,
      surface: 'admin-inbound-product-suggest',
    })
  }, [catalogListForInbound, inboundFormProductDebounced])

  const inboundDraftProductQuickAdd = !revenueReadOnly
  const inboundProductSuggestPanelOpen = useMemo(
    () =>
      Boolean(
        inboundFormProductDebounced.trim() &&
          (inboundProductSuggest.length > 0 || inboundDraftProductQuickAdd)
      ),
    [inboundFormProductDebounced, inboundProductSuggest.length, inboundDraftProductQuickAdd]
  )
  const inboundProductSuggestRowCount = useMemo(
    () => (inboundDraftProductQuickAdd ? 1 : 0) + inboundProductSuggest.length,
    [inboundDraftProductQuickAdd, inboundProductSuggest.length]
  )

  useEffect(() => {
    setInboundProductSuggestIdx(0)
  }, [inboundFormProductDebounced, inboundProductSuggest])

  const inboundFormGoodsSubtotal = useMemo(
    () => inboundFormLines.reduce((s, ln) => s + inboundLineTotal(ln), 0),
    [inboundFormLines]
  )

  const inboundFormOrderDiscountAmount = useMemo(() => {
    const sub = inboundFormGoodsSubtotal
    if (inboundFormDiscMode === 'percent') {
      const p = parsePercentDraftVi(inboundFormDiscRaw)
      return Math.round((sub * p) / 100)
    }
    return Math.min(sub, Math.max(0, parseMoneyDraftVi(inboundFormDiscRaw)))
  }, [inboundFormGoodsSubtotal, inboundFormDiscMode, inboundFormDiscRaw])

  const inboundFormTotalPay = useMemo(
    () => Math.max(0, inboundFormGoodsSubtotal - inboundFormOrderDiscountAmount),
    [inboundFormGoodsSubtotal, inboundFormOrderDiscountAmount]
  )

  const resetInboundForm = useCallback(() => {
    setInboundFormEditOrderId(null)
    setInboundFormLines([])
    setInboundFormProductQ('')
    setInboundQuickPickOpen(false)
    setInboundQuickPickSelected(new Set())
    setInboundFormSupplierQ('')
    setInboundFormSupplierName('')
    setInboundFormCode('')
    setInboundFormNote('')
    setInboundFormDiscMode('amount')
    setInboundFormDiscRaw('')
    setSupplierModalOpen(false)
  }, [])

  /** Sau khi lưu phiếu nhập: thoát form nháp, đưa tab + URL về danh sách `/nhap-hang` (tránh kẹt `/nhap-hang/tao-moi`). */
  const completeInboundFlowReturnToList = useCallback(() => {
    setInboundDraftSession(false)
    resetInboundForm()
    setActiveTab(TAB_INBOUND)
    syncHubUrlToMainTab(TAB_INBOUND)
    void refreshInboundInvoices({ quiet: true })
  }, [resetInboundForm, syncHubUrlToMainTab, refreshInboundInvoices])

  const openInboundCreateForm = useCallback(() => {
    const url = getInboundCreateAbsUrl()
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const closeInboundForm = useCallback(() => {
    if (standaloneInboundCreate) {
      window.close()
      return
    }
    setInboundDraftSession(false)
    setActiveTab((prev) => (prev === TAB_INBOUND_DRAFT ? TAB_INBOUND : prev))
    resetInboundForm()
    syncHubUrlToMainTab(TAB_INBOUND)
  }, [resetInboundForm, standaloneInboundCreate, syncHubUrlToMainTab])

  const addInboundFormLine = useCallback((product, variant) => {
    const hint = brandThuongHieuFromProductVariant(product, variant)
    setInboundFormLines((prev) => [...prev, createInboundFormLineFromProductVariant(product, variant)])
    setInboundFormProductQ('')
    if (hint) {
      setInboundFormSupplierName((p) => (String(p ?? '').trim() ? p : hint))
      setInboundFormSupplierQ((p) => (String(p ?? '').trim() ? p : hint))
    }
  }, [])

  const openInboundDraftWithProductPairs = useCallback(
    (pairs) => {
      if (!Array.isArray(pairs) || pairs.length === 0) return
      resetInboundForm()
      setInboundDraftSession(true)
      setActiveTab(TAB_INBOUND_DRAFT)
      syncHubUrlToMainTab(TAB_INBOUND)
      const lines = []
      const seen = new Set()
      let supplierHint = ''
      for (const row of pairs) {
        const product = row?.product
        const variant = row?.variant
        if (!product || !variant) continue
        const vid = String(variant.id ?? '').trim()
        if (vid && seen.has(vid)) continue
        if (vid) seen.add(vid)
        lines.push(createInboundFormLineFromProductVariant(product, variant))
        if (!supplierHint) {
          supplierHint = brandThuongHieuFromProductVariant(product, variant)
        }
      }
      if (!lines.length) return
      setInboundFormLines(lines)
      if (supplierHint) {
        setInboundFormSupplierName(supplierHint)
        setInboundFormSupplierQ(supplierHint)
      }
    },
    [resetInboundForm, syncHubUrlToMainTab]
  )

  useEffect(() => {
    const pairs = inboundLowStockPrefillRequest?.pairs
    if (!pairs?.length) return
    openInboundDraftWithProductPairs(pairs)
    onInboundLowStockPrefillConsumed?.()
  }, [
    inboundLowStockPrefillRequest,
    openInboundDraftWithProductPairs,
    onInboundLowStockPrefillConsumed,
  ])

  const applyInboundScannedCode = useCallback(
    (raw) => {
      const q = String(raw || '').trim()
      if (!q) return
      blurActiveElement()
      setInboundFormProductQ(q)
      setInboundProductSuggestIdx(0)
      if (!catalogListForInbound.length) return

      const toastAdded = (product, variant) => {
        const label = String(variant?.name || product?.name || variant?.code || '').trim() || '—'
        const u = normalizeCatalogUnitLabel(variant?.unitLabel)
        showHubCameraToast(`Đã thêm: ${label} - ${u}`, 'ok')
      }

      if (posQueryLooksLikeBarcodeKeyInput(q)) {
        const needle = String(normalizeBarcodeValue(q))
        for (const p of catalogListForInbound) {
          for (const v of p.groupVariants || [p]) {
            if (needle && String(normalizeBarcodeValue(v.barcode ?? '')) === needle) {
              addInboundFormLine(p, v)
              toastAdded(p, v)
              return
            }
          }
        }
      }
      for (const p of catalogListForInbound) {
        for (const v of p.groupVariants || [p]) {
          if (String(v.code ?? '').trim() === q) {
            addInboundFormLine(p, v)
            toastAdded(p, v)
            return
          }
        }
      }
      const hits = suggestCatalogVariantPairsV9(catalogListForInbound, q, {
        maxHits: 20,
        surface: 'admin-inbound-barcode-scan',
      })
      if (hits.length > 0) {
        const { product, variant } = hits[0]
        addInboundFormLine(product, variant)
        toastAdded(product, variant)
        return
      }
      const disp = String(normalizeBarcodeValue(q) || q).trim() || q
      showHubCameraToast(`Mã ${disp} chưa có trong hệ thống`, 'err')
    },
    [catalogListForInbound, addInboundFormLine, showHubCameraToast]
  )

  const applyGoodsScannedCode = useCallback((raw) => {
    const q = String(raw || '').trim()
    if (!q) return
    blurActiveElement()
    setGoodsQ(q)
    setHangHoaDeepLinkListScope('all')
  }, [])

  const openInboundBarcodeScan = useCallback(() => {
    setBarcodeScanMode('inbound')
    setBarcodeScanOpen(true)
  }, [])

  const openGoodsBarcodeScan = useCallback(() => {
    setBarcodeScanMode('goods')
    setBarcodeScanOpen(true)
  }, [])

  /** Modal «Tạo mới»: đồng bộ staging + một dòng lưới (SL=1); gọi App append — chỉ trong tab nháp nhập hàng. */
  const appendCatalogVariantsFromInboundProductModal = useCallback(
    async (rows) => {
      const list = Array.isArray(rows) ? rows : []
      if (typeof onAppendCatalogVariants === 'function') {
        const res = await onAppendCatalogVariants(list)
        if (!res || res.ok === false) {
          console.error('Lỗi Insert Supabase:', res?.error)
          return res ?? { ok: false, error: 'Không lưu được sản phẩm mới.' }
        }
        if (
          activeTabForInboundSyncRef.current === TAB_INBOUND_DRAFT &&
          list.length > 0
        ) {
          const prepared = res.preparedVariants || list
          setInboundPendingNewFlatVariants((prev) => mergeInboundPendingFlatVariantsById(prev, prepared))
          appendInboundDraftLinesFromFlatRows(setInboundFormLines, prepared)
        }
        return res
      }
      return { ok: false, error: 'Thiếu cấu hình lưu danh mục (onAppendCatalogVariants).' }
    },
    [onAppendCatalogVariants]
  )

  /** Nhánh standalone: modal gọi persist — staging + lưới giống trên sau khi lưu thành công. */
  const persistStandaloneProductsForInboundModal = useCallback(
    async (nextProducts, fileNameHint, upsertOnlyVariants) => {
      const result = await persistStandaloneProducts(nextProducts, fileNameHint, upsertOnlyVariants)
      if (
        result?.ok &&
        activeTabForInboundSyncRef.current === TAB_INBOUND_DRAFT &&
        Array.isArray(upsertOnlyVariants) &&
        upsertOnlyVariants.length > 0
      ) {
        const prepared = result.preparedVariants || upsertOnlyVariants
        setInboundPendingNewFlatVariants((prev) => mergeInboundPendingFlatVariantsById(prev, prepared))
        appendInboundDraftLinesFromFlatRows(setInboundFormLines, prepared)
      }
      return result
    },
    [persistStandaloneProducts]
  )

  /**
   * Sau khi App gọi `persistCatalogSnapshotAndProducts` + revalidate: thay id client (modal) bằng id catalog từ DB
   * (`sb-…-{ma_hang}`) — khớp lưới phiếu nhập + staging với `catalogListForInbound`.
   */
  const handleInboundCatalogUpsertReconcile = useCallback(({ requested, returned }) => {
    if (!Array.isArray(returned) || returned.length === 0 || !Array.isArray(requested)) return
    const byCode = new Map()
    for (const v of returned) {
      const k = String(v?.code ?? '').trim().toLowerCase()
      if (!k) continue
      byCode.set(k, applyInboundStagingCatalogNumericDefaults(v))
    }
    if (byCode.size === 0) return

    const oldIdByCode = new Map()
    for (const v of requested) {
      const k = String(v?.code ?? '').trim().toLowerCase()
      if (k && v.id != null) oldIdByCode.set(k, String(v.id))
    }

    setInboundPendingNewFlatVariants((prev) => {
      const withoutOldClient = (prev || []).filter((r) => {
        const k = String(r?.code ?? '').trim().toLowerCase()
        if (!k) return true
        const oldId = oldIdByCode.get(k)
        const nv = byCode.get(k)
        if (!nv || !oldId) return true
        if (String(r.id) === oldId) return false
        return true
      })
      return mergeInboundPendingFlatVariantsById(withoutOldClient, [...byCode.values()])
    })

    setInboundFormLines((lines) =>
      lines.map((ln) => {
        const k = String(ln.ma_hang || ln.code || '')
          .trim()
          .toLowerCase()
        const nv = k ? byCode.get(k) : null
        const oldId = k ? oldIdByCode.get(k) : null
        if (!nv || !oldId || String(ln.variantId) !== oldId) return ln
        return { ...ln, variantId: String(nv.id) }
      })
    )
  }, [])

  useEffect(() => {
    if (typeof registerInboundCatalogUpsertReconcile !== 'function') return undefined
    registerInboundCatalogUpsertReconcile(handleInboundCatalogUpsertReconcile)
    return () => {
      registerInboundCatalogUpsertReconcile(null)
    }
  }, [registerInboundCatalogUpsertReconcile, handleInboundCatalogUpsertReconcile])

  const toggleInboundQuickPickSel = useCallback((vid) => {
    const id = String(vid)
    setInboundQuickPickSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const confirmInboundQuickPick = useCallback((pickedRows) => {
    const rows = Array.isArray(pickedRows) ? pickedRows : []
    const catalog = catalogForInboundRef.current
    setInboundFormLines((cur) => {
      const have = new Set(cur.map((l) => String(l.variantId)))
      const toAdd = []
      let brandHint = ''
      for (const r of rows) {
        const { product, variant } = resolveInboundCatalogProductVariant(
          catalog,
          r._product,
          r._variant
        )
        const vid = String(variant?.id ?? '').trim()
        if (!vid || have.has(vid)) continue
        have.add(vid)
        const line = createInboundFormLineFromProductVariant(product, variant)
        if (!brandHint) brandHint = String(line.thuong_hieu || '').trim()
        toAdd.push(line)
      }
      if (toAdd.length === 0) return cur
      if (brandHint) {
        queueMicrotask(() => {
          setInboundFormSupplierName((p) => (String(p ?? '').trim() ? p : brandHint))
          setInboundFormSupplierQ((p) => (String(p ?? '').trim() ? p : brandHint))
        })
      }
      return [...cur, ...toAdd]
    })
    setInboundQuickPickOpen(false)
    setInboundQuickPickSelected(new Set())
    setInboundFormProductQ('')
  }, [])

  const updateInboundFormLine = useCallback((lineId, patch) => {
    setInboundFormLines((prev) =>
      prev.map((ln) => {
        if (ln.lineId !== lineId) return ln
        const merged = { ...ln, ...patch }
        const n = normalizeInboundLine(merged)
        let qty = n.qty
        if (qty < n.returnedQty) qty = n.returnedQty
        return { ...merged, qty, returnedQty: n.returnedQty }
      })
    )
  }, [])

  const removeInboundFormLine = useCallback((lineId) => {
    setInboundFormLines((prev) => prev.filter((ln) => ln.lineId !== lineId))
  }, [])

  const submitNewSupplier = useCallback(
    async (draft) => {
      const name = String(draft?.name || '').trim()
      if (!name) {
        alert('Nhập tên nhà cung cấp.')
        return
      }
      setSupplierSaving(true)
      try {
        const row = {
          id: createInboundId(),
          name,
          phone: String(draft?.phone || '').trim(),
          address: String(draft?.address || '').trim(),
          cccd: String(draft?.cccd || '').trim(),
          mail: String(draft?.mail || '').trim(),
        }
        const ins = await insertSupplierSupabase(row)
        if (ins.ok && ins.row?.id) {
          row.id = ins.row.id
        } else if (!ins.ok && !ins.skipped) {
          window.alert(formatPostgrestErrorForUser(ins.error))
          return
        }
        if (isSupabaseConfigured() && ins.ok) {
          try {
            const remote = await fetchSuppliersFromSupabase()
            const local = loadSuppliersFromStorage()
            persistSuppliers(mergeSupplierListsDedupe(remote, local))
          } catch (e) {
            console.warn('[AdminHub] Tải lại NCC sau lưu', e)
            persistSuppliers(mergeSupplierListsDedupe([], [...suppliers, row]))
          }
        } else {
          persistSuppliers([...suppliers, row])
        }
        setInboundFormSupplierName(name)
        setInboundFormSupplierQ(name)
        setSupplierModalOpen(false)
        triggerSupplierSavedToast()
      } catch (e) {
        window.alert(formatPostgrestErrorForUser(e))
      } finally {
        setSupplierSaving(false)
      }
    },
    [suppliers, persistSuppliers, triggerSupplierSavedToast]
  )

  const submitNewCustomerAdmin = useCallback(async (draft) => {
    const name = String(draft?.name || '').trim()
    if (!name) {
      alert('Nhập họ tên khách.')
      return
    }
    setCustomerSaving(true)
    try {
      const row = {
        name,
        phone: String(draft?.phone || '').trim(),
        address: String(draft?.address || '').trim(),
        cccd: String(draft?.cccd || '').trim(),
        mail: String(draft?.mail || '').trim(),
      }
      const ins = await insertCustomerSupabase(row)
      if (!ins.ok) {
        if (ins.skipped) {
          const local = loadCustomersFromStorage()
          const merged = mergeCustomerListsDedupe([], [row, ...local])
          setCustomers(merged)
          try {
            localStorage.setItem(POS_CUSTOMERS_KEY, JSON.stringify(merged))
          } catch (err) {
            console.warn(err)
          }
        } else {
          window.alert(formatPostgrestErrorForUser(ins.error))
          return
        }
      } else {
        try {
          const remote = await fetchCustomersFromSupabase()
          const local = loadCustomersFromStorage()
          const merged = mergeCustomerListsDedupe(remote, local)
          setCustomers(merged)
          try {
            localStorage.setItem(POS_CUSTOMERS_KEY, JSON.stringify(merged))
          } catch (err) {
            console.warn(err)
          }
        } catch (e) {
          window.alert(
            'Đã ghi khách trên máy chủ nhưng không tải lại danh sách.\n' + formatPostgrestErrorForUser(e)
          )
        }
      }
      setCustomerModalOpen(false)
      setEditingCustomer(null)
      window.dispatchEvent(new CustomEvent('csv-preview-customers-changed'))
    } catch (e) {
      window.alert(formatPostgrestErrorForUser(e))
    } finally {
      setCustomerSaving(false)
    }
  }, [])

  const submitUpdateCustomerAdmin = useCallback(
    async (draft) => {
      const id = String(editingCustomer?.id ?? '').trim()
      const name = String(draft?.name || '').trim()
      if (!name) {
        alert('Nhập họ tên khách.')
        return
      }
      if (!id) {
        alert('Không có mã khách trên máy chủ — không sửa được. Thử thêm mới hoặc đồng bộ lại.')
        return
      }
      setCustomerSaving(true)
      try {
        const row = {
          name,
          phone: String(draft?.phone || '').trim(),
          address: String(draft?.address || '').trim(),
          cccd: String(draft?.cccd || '').trim(),
          mail: String(draft?.mail || '').trim(),
        }
        const upd = await updateCustomerSupabase(id, row)
        if (!upd.ok) {
          if (!upd.skipped) window.alert(formatPostgrestErrorForUser(upd.error))
          return
        }
        try {
          const remote = await fetchCustomersFromSupabase()
          const local = loadCustomersFromStorage()
          const merged = mergeCustomerListsDedupe(remote, local)
          setCustomers(merged)
          try {
            localStorage.setItem(POS_CUSTOMERS_KEY, JSON.stringify(merged))
          } catch (err) {
            console.warn(err)
          }
        } catch (e) {
          window.alert(
            'Đã cập nhật khách trên máy chủ nhưng không tải lại danh sách.\n' +
              formatPostgrestErrorForUser(e)
          )
        }
        setCustomerModalOpen(false)
        setEditingCustomer(null)
        window.dispatchEvent(new CustomEvent('csv-preview-customers-changed'))
      } catch (e) {
        window.alert(formatPostgrestErrorForUser(e))
      } finally {
        setCustomerSaving(false)
      }
    },
    [editingCustomer]
  )

  const submitNewEmployeeAdmin = useCallback(async (draft) => {
    const name = String(draft?.name || '').trim()
    if (!name) {
      alert('Nhập họ tên nhân viên.')
      return
    }
    setEmployeeSaving(true)
    try {
      const row = {
        name,
        phone: String(draft?.phone || '').trim(),
        address: String(draft?.address || '').trim(),
        cccd: String(draft?.cccd || '').trim(),
        mail: String(draft?.mail || '').trim(),
      }
      const ins = await insertEmployeeSupabase(row)
      if (!ins.ok && !ins.skipped) {
        window.alert(formatPostgrestErrorForUser(ins.error))
        return
      }
      if (!ins.skipped && ins.ok) {
        try {
          const remote = await fetchEmployeesFromSupabase()
          if (remote.length > 0) {
            setStaffRows(
              remote.map((r) => ({
              id: String(r.id ?? r.employee_id ?? '').trim(),
                name: r.name,
                phone: r.phone || '—',
                address: r.address || '—',
                cccd: r.cccd || '—',
                mail: r.mail || '—',
              }))
            )
          }
        } catch (e) {
          window.alert(
            'Đã ghi nhân viên nhưng không tải lại danh sách.\n' + formatPostgrestErrorForUser(e)
          )
        }
      }
      setEmployeeModalOpen(false)
      setEditingEmployee(null)
      window.dispatchEvent(new CustomEvent('csv-preview-employees-changed'))
    } catch (e) {
      window.alert(formatPostgrestErrorForUser(e))
    } finally {
      setEmployeeSaving(false)
    }
  }, [])

  const submitUpdateEmployeeAdmin = useCallback(
    async (draft) => {
      const id = String(editingEmployee?.id ?? '').trim()
      const name = String(draft?.name || '').trim()
      if (!name) {
        alert('Nhập họ tên nhân viên.')
        return
      }
      if (!id) {
        alert('Không có mã nhân viên trên máy chủ — không sửa được.')
        return
      }
      setEmployeeSaving(true)
      try {
        const row = {
          name,
          phone: String(draft?.phone || '').trim(),
          address: String(draft?.address || '').trim(),
          cccd: String(draft?.cccd || '').trim(),
          mail: String(draft?.mail || '').trim(),
        }
        const upd = await updateEmployeeSupabase(id, row)
        if (!upd.ok) {
          if (!upd.skipped) window.alert(formatPostgrestErrorForUser(upd.error))
          return
        }
        try {
          const remote = await fetchEmployeesFromSupabase()
          if (remote.length > 0) {
            setStaffRows(
              remote.map((r) => ({
                id: String(r.id ?? r.employee_id ?? '').trim(),
                name: r.name,
                phone: r.phone || '—',
                address: r.address || '—',
                cccd: r.cccd || '—',
                mail: r.mail || '—',
              }))
            )
          }
        } catch (e) {
          window.alert(
            'Đã cập nhật nhân viên nhưng không tải lại danh sách.\n' + formatPostgrestErrorForUser(e)
          )
        }
        setEmployeeModalOpen(false)
        setEditingEmployee(null)
        window.dispatchEvent(new CustomEvent('csv-preview-employees-changed'))
      } catch (e) {
        window.alert(formatPostgrestErrorForUser(e))
      } finally {
        setEmployeeSaving(false)
      }
    },
    [editingEmployee]
  )

  const openAddCustomerModal = useCallback(() => {
    setEditingCustomer(null)
    setCustomerModalOpen(true)
  }, [])

  const openEditCustomerModal = useCallback((row) => {
    setEditingCustomer(row)
    setCustomerModalOpen(true)
  }, [])

  const openAddEmployeeModal = useCallback(() => {
    setEditingEmployee(null)
    setEmployeeModalOpen(true)
  }, [])

  const openEditEmployeeModal = useCallback((row) => {
    const safe = row && typeof row === 'object' ? row : {}
    console.log('Dữ liệu hàng nhân viên:', safe)
    setEditingEmployee({
      id: String(safe.id ?? safe.employee_id ?? '').trim(),
      name: String(safe.name ?? '').trim(),
      phone: String(safe.phone ?? '').trim() || '—',
      address: String(safe.address ?? '').trim() || '—',
      cccd: String(safe.cccd ?? '').trim() || '—',
      mail: String(safe.mail ?? '').trim() || '—',
    })
    setEmployeeModalOpen(true)
  }, [])

  const buildInboundOrderPayload = useCallback(
    (status) => {
      const supplier = String(inboundFormSupplierName || '').trim()
      const editRow = inboundFormEditOrderId
        ? inboundOrders.find((o) => o.id === inboundFormEditOrderId)
        : null
      let code = String(inboundFormCode || '').trim()
      if (editRow) {
        code = String(editRow.code || '').trim()
      } else if (!code) {
        code = computeNextInboundCode(inboundOrders)
      }
      if (!editRow) {
        const used = new Set(inboundOrders.map((o) => String(o.code || '').toUpperCase()))
        let tryCode = code
        if (used.has(tryCode.toUpperCase())) {
          const m0 = tryCode.match(/^NH(\d+)$/i)
          if (m0) {
            let seq = parseInt(m0[1], 10)
            do {
              seq += 1
              tryCode = `NH${String(seq).padStart(3, '0')}`
            } while (used.has(tryCode.toUpperCase()) && seq < 99999)
          } else {
            const base = tryCode
            let k = 0
            do {
              k += 1
              tryCode = `${base}-${k}`
            } while (used.has(tryCode.toUpperCase()) && k < 5000)
          }
        }
        code = tryCode
      }
      const lines = inboundFormLines.map(normalizeInboundLine)
      const id = editRow ? editRow.id : createInboundId()
      const createdAtMs = editRow ? editRow.createdAtMs : Date.now()
      return normalizeInboundRow({
        id,
        code,
        createdAtMs,
        supplier,
        totalValue: inboundFormTotalPay,
        goodsSubtotal: inboundFormGoodsSubtotal,
        status,
        lines,
        note: String(inboundFormNote || '').trim(),
        orderDiscountMode: inboundFormDiscMode,
        orderDiscountValue:
          inboundFormDiscMode === 'percent'
            ? parsePercentDraftVi(inboundFormDiscRaw)
            : inboundFormOrderDiscountAmount,
      })
    },
    [
      inboundFormEditOrderId,
      inboundFormSupplierName,
      inboundFormCode,
      inboundOrders,
      inboundFormLines,
      inboundFormTotalPay,
      inboundFormGoodsSubtotal,
      inboundFormNote,
      inboundFormDiscMode,
      inboundFormDiscRaw,
      inboundFormOrderDiscountAmount,
    ]
  )

  const applyInboundStockIncrease = useCallback(
    async (lines) => {
      const valid = lines.filter((l) => {
        const n = normalizeInboundLine(l)
        return n.variantId && inboundLineReturnableQty(n) > 0
      })
      if (valid.length === 0) return
      if (typeof onBulkPatchCatalogVariants === 'function') {
        const flat = (Array.isArray(catalogListForInbound) ? catalogListForInbound : []).flatMap(
          (p) => p.groupVariants || [p]
        )
        const patches = []
        for (const l of valid) {
          const n = normalizeInboundLine(l)
          const v = flat.find((x) => x.id === n.variantId)
          if (!v) continue
          const cur =
            v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? Number(v.stockQty) : 0
          const add = inboundLineReturnableQty(n)
          patches.push({ variantId: n.variantId, patch: { stockQty: cur + add } })
        }
        if (patches.length) await onBulkPatchCatalogVariants(patches, {})
        return
      }
      if (!standaloneCatalog?.products?.length) return
      const flat = (Array.isArray(standaloneCatalog?.products) ? standaloneCatalog.products : []).flatMap(
        (p) => p.groupVariants || [p]
      )
      const nextFlat = flat.map((v) => {
        const hit = valid.find((l) => normalizeInboundLine(l).variantId === v.id)
        if (!hit) return v
        const n = normalizeInboundLine(hit)
        const cur =
          v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? Number(v.stockQty) : 0
        return { ...v, stockQty: cur + inboundLineReturnableQty(n) }
      })
      const nextProducts = buildDisplayCatalog(nextFlat)
      void persistStandaloneProducts(nextProducts, standaloneCatalog.fileName || '')
    },
    [
      catalogListForInbound,
      onBulkPatchCatalogVariants,
      standaloneCatalog,
      persistStandaloneProducts,
    ]
  )

  /** delta > 0 nhập thêm tồn, < 0 trừ tồn (clamp về 0). */
  const applyInboundStockDeltas = useCallback(
    async (deltaByVariant, stockMeta) => {
      if (!deltaByVariant || deltaByVariant.size === 0) return { ok: true }
      if (typeof onBulkPatchCatalogVariants === 'function') {
        const srcList = Array.isArray(catalogListForInbound) ? catalogListForInbound : []
        const flat = (Array.isArray(srcList) ? srcList : []).flatMap((p) => p?.groupVariants || [p]).filter(Boolean)
        const patches = []
        for (const [variantId, delta] of deltaByVariant) {
          if (!delta) continue
          const v = flat.find((x) => x.id === variantId)
          if (!v) continue
          const cur =
            v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? Number(v.stockQty) : 0
          patches.push({ variantId, patch: { stockQty: Math.max(0, cur + delta) } })
        }
        if (patches.length === 0) return { ok: true }
        const ib =
          stockMeta?.documentCode || stockMeta?.inboundOrderId
            ? {
                inboundInventoryMeta: {
                  documentCode: String(stockMeta.documentCode || '').trim(),
                  inboundOrderId: String(stockMeta.inboundOrderId || '').trim(),
                },
              }
            : {}
        return onBulkPatchCatalogVariants(patches, ib)
      }
      if (!standaloneCatalog?.products?.length) return { ok: false, error: 'Chưa có danh mục.' }
      const standaloneProducts = Array.isArray(standaloneCatalog?.products) ? standaloneCatalog.products : []
      let nextFlat = (Array.isArray(standaloneProducts) ? standaloneProducts : [])
        .flatMap((p) => p?.groupVariants || [p])
        .filter(Boolean)
      for (const [variantId, delta] of deltaByVariant) {
        if (!delta) continue
        nextFlat = nextFlat.map((v) => {
          if (v.id !== variantId) return v
          const cur =
            v.stockQty != null && Number.isFinite(Number(v.stockQty)) ? Number(v.stockQty) : 0
          return { ...v, stockQty: Math.max(0, cur + delta) }
        })
      }
      const nextProducts = buildDisplayCatalog(nextFlat)
      const r = await persistStandaloneProducts(nextProducts, standaloneCatalog.fileName || '')
      return r?.ok ? { ok: true } : { ok: false, error: r?.error || 'Không ghi được danh mục.' }
    },
    [catalogListForInbound, onBulkPatchCatalogVariants, standaloneCatalog, persistStandaloneProducts]
  )

  const applyInboundStockDeltasFromNetMaps = useCallback(
    async (oldMap, newMap) => {
      const keys = new Set([...oldMap.keys(), ...newMap.keys()])
      const deltas = new Map()
      for (const k of keys) {
        const d = (newMap.get(k) || 0) - (oldMap.get(k) || 0)
        if (d) deltas.set(k, d)
      }
      return applyInboundStockDeltas(deltas)
    },
    [applyInboundStockDeltas]
  )

  /** Đồng bộ Supabase tại App — Hub không gọi `supabase.from` (tránh unmount / Auth lock). */
  const syncInboundToApp = useCallback(
    ({ row, patches }) => {
      if (typeof onConfirmInboundComplete === 'function') {
        return onConfirmInboundComplete({ row, patches })
      }
      if (!standaloneCatalog?.products?.length) {
        return Promise.reject(new Error('Chưa có danh mục để ghi phiếu nhập.'))
      }
      return Promise.reject(
        new Error('Chưa kết nối đồng bộ Supabase từ App (onConfirmInboundComplete).')
      )
    },
    [onConfirmInboundComplete, standaloneCatalog?.products?.length]
  )

  /**
   * Hoàn thành phiếu mới: cập nhật UI + đóng form ngay; đồng bộ Supabase nền (rollback nếu lỗi).
   */
  const finalizeInboundCompleted = useCallback(
    (fulfillmentPatches) => {
      const row = normalizeInboundRow(buildInboundOrderPayload('completed'))
      const ordersSnapshot = snapshotInboundOrdersList(inboundOrdersRef.current)
      startTransition(() => {
        setInboundOrders((prev) => {
          const rest = prev.filter((o) => o.id !== row.id)
          return [row, ...rest]
        })
      })
      completeInboundFlowReturnToList()
      triggerInboundSaveToast()
      bumpInboundSync()
      void refreshInboundInvoices({ quiet: true })

      void syncInboundToApp({ row, patches: fulfillmentPatches })
        .then((saved) => {
          const merged = normalizeInboundRow(saved)
          startTransition(() => {
            setInboundOrders((prev) => {
              const rest = prev.filter((o) => o.id !== merged.id && o.id !== row.id)
              return [merged, ...rest]
            })
          })
          void refreshInboundInvoices({ quiet: true })
        })
        .catch((e) => {
          console.error('[inbound] Hoàn thành phiếu mới thất bại', e)
          setInboundOrders(ordersSnapshot)
          setInboundSyncErrMsg(
            `Lỗi đồng bộ: ${e instanceof Error ? e.message : String(e)}. Đã hoàn tác thay đổi!`
          )
        })
    },
    [
      buildInboundOrderPayload,
      syncInboundToApp,
      completeInboundFlowReturnToList,
      triggerInboundSaveToast,
      refreshInboundInvoices,
    ]
  )

  const finalizeInboundEditCompleted = useCallback(
    (fulfillmentPatches) => {
      const editId = inboundFormEditOrderId
      if (!editId) return
      const prevRow = inboundOrders.find((o) => o.id === editId)
      if (!prevRow) return
      const payload = buildInboundOrderPayload('completed')
      const merged = normalizeInboundRow({
        ...payload,
        id: prevRow.id,
        code: prevRow.code,
        createdAtMs: prevRow.createdAtMs,
        status: computeInboundStatusAfterLines(payload.lines),
      })
      const ordersSnapshot = snapshotInboundOrdersList(inboundOrdersRef.current)
      startTransition(() => {
        setInboundOrders((prev) => {
          const rest = prev.filter((o) => o.id !== editId)
          return [merged, ...rest]
        })
        setInboundFormEditOrderId(null)
      })
      completeInboundFlowReturnToList()
      triggerInboundSaveToast()
      bumpInboundSync()
      void refreshInboundInvoices({ quiet: true })

      void syncInboundToApp({ row: merged, patches: fulfillmentPatches })
        .then((saved) => {
          const normalized = normalizeInboundRow(saved)
          startTransition(() => {
            setInboundOrders((prev) => {
              const rest = prev.filter((o) => o.id !== editId && o.id !== normalized.id)
              return [normalized, ...rest]
            })
          })
          void refreshInboundInvoices({ quiet: true })
        })
        .catch((e) => {
          console.error('[inbound] Hoàn thành sửa phiếu thất bại', e)
          setInboundOrders(ordersSnapshot)
          setInboundSyncErrMsg(
            `Lỗi đồng bộ: ${e instanceof Error ? e.message : String(e)}. Đã hoàn tác thay đổi!`
          )
        })
    },
    [
      inboundFormEditOrderId,
      inboundOrders,
      buildInboundOrderPayload,
      syncInboundToApp,
      completeInboundFlowReturnToList,
      triggerInboundSaveToast,
      refreshInboundInvoices,
    ]
  )

  const handleInboundCompleteClick = useCallback(() => {
    const supplier = String(inboundFormSupplierName || '').trim()
    if (!supplier) {
      alert('Vui lòng chọn hoặc nhập tên nhà cung cấp (bắt buộc).')
      return
    }
    const hasQty = inboundFormLines.some((l) => Number(l.qty) > 0)
    if (!hasQty) {
      alert('Thêm ít nhất một dòng hàng với số lượng > 0 để hoàn thành phiếu.')
      return
    }
    const catalogSnap = catalogForInboundRef.current
    if (!catalogSnap?.length) {
      alert('Chưa có danh mục hàng — không thể cập nhật tồn kho.')
      return
    }
    void (async () => {
      try {
        const linesSnap = inboundFormLinesRef.current
        const catSnap = catalogForInboundRef.current
        const priorLines = inboundFormEditOrderId
          ? inboundOrders.find((o) => o.id === inboundFormEditOrderId)?.lines
          : null
        const codes = collectInboundMaHangCodes(catSnap, linesSnap)
        let serverMap = new Map()
        if (codes.length > 0 && isSupabaseConfigured()) {
          try {
            serverMap = await fetchProductsCostAndStockByMaHang(codes)
          } catch (e) {
            console.error(e)
            alert(
              'Không đọc được giá vốn / tồn kho trên Supabase (bảng products). Kiểm tra mạng và quyền.'
            )
            return
          }
        }
        const { diffs, patches } = computeInboundFulfillmentPlan(
          catSnap,
          linesSnap,
          serverMap,
          priorLines || undefined
        )
        if (!patches?.length) {
          alert('Không có dòng nhập hợp lệ để cập nhật danh mục / tồn kho.')
          return
        }
        if (diffs.length > 0) {
          inboundCompletePendingRef.current = {
            diffs,
            patches,
            mode: inboundFormEditOrderId ? 'edit' : 'create',
          }
          setInboundCostDiffModal({ diffs })
          return
        }
        if (inboundFormEditOrderId) {
          finalizeInboundEditCompleted(patches)
        } else {
          finalizeInboundCompleted(patches)
        }
      } catch (e) {
        console.error('[inbound] handleInboundCompleteClick', e)
      }
    })()
  }, [
    inboundFormSupplierName,
    inboundOrders,
    inboundFormEditOrderId,
    finalizeInboundCompleted,
    finalizeInboundEditCompleted,
  ])

  const cancelInboundCostDiffModal = useCallback(() => {
    inboundCompletePendingRef.current = null
    setInboundCostDiffModal(null)
  }, [])

  const confirmInboundCostSave = useCallback(() => {
    const pending = inboundCompletePendingRef.current
    if (!pending?.patches?.length) {
      cancelInboundCostDiffModal()
      return
    }
    const diffs = pending.diffs || []
    const patches = pending.patches
    const mode = pending.mode || 'create'
    const mergedRow = pending.mergedRow
    const oldRow = pending.oldRow

    const closeInboundCostDiffModal = () => {
      inboundCompletePendingRef.current = null
      setInboundCostDiffModal(null)
      appendInboundCostChangeNotifications(diffs)
    }

    if (mode === 'detail_edit' && mergedRow && oldRow) {
      const oid = mergedRow.id
      const ordersSnapshot = snapshotInboundOrdersList(inboundOrdersRef.current)
      closeInboundCostDiffModal()
      startTransition(() => {
        setInboundOrders((p) => {
          const rest = p.filter((o) => o.id !== oid)
          return [normalizeInboundRow(mergedRow), ...rest]
        })
        setInboundDetailLineDrafts((prev) => {
          if (!prev[oid]) return prev
          const n = { ...prev }
          delete n[oid]
          return n
        })
      })
      completeInboundFlowReturnToList()
      triggerInboundSaveToast()

      void syncInboundToApp({ row: mergedRow, patches })
        .then((saved) => {
          const normalized = normalizeInboundRow(saved)
          startTransition(() => {
            setInboundOrders((p) => {
              const rest = p.filter((o) => o.id !== oid && o.id !== normalized.id)
              return [normalized, ...rest]
            })
          })
        })
        .catch((e) => {
          console.error('[inbound] Hoàn thành chi tiết phiếu thất bại', e)
          setInboundOrders(ordersSnapshot)
          setInboundSyncErrMsg(
            `Lỗi đồng bộ: ${e instanceof Error ? e.message : String(e)}. Đã hoàn tác thay đổi!`
          )
        })
      return
    }

    closeInboundCostDiffModal()
    if (mode === 'edit') {
      finalizeInboundEditCompleted(patches)
    } else {
      finalizeInboundCompleted(patches)
    }
  }, [
    finalizeInboundCompleted,
    finalizeInboundEditCompleted,
    cancelInboundCostDiffModal,
    syncInboundToApp,
    triggerInboundSaveToast,
    completeInboundFlowReturnToList,
  ])

  const focusInboundDraftField = useCallback((lineId, field) => {
    const id = String(lineId ?? '')
    if (!id || !field) return
    try {
      const el = document.querySelector(
        `input[data-inbound-line="${id}"][data-inbound-field="${field}"]`
      )
      if (el && typeof el.focus === 'function') {
        el.focus()
        requestAnimationFrame(() => {
          try {
            if (typeof el.select === 'function') el.select()
          } catch {
            /* ignore */
          }
        })
      }
    } catch {
      /* ignore */
    }
  }, [])

  const handleInboundNumericKeyDown = useCallback(
    (e, lineId, field) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const idx = inboundFormLines.findIndex((l) => l.lineId === lineId)
      if (idx < 0 || idx >= inboundFormLines.length - 1) return
      const nextId = inboundFormLines[idx + 1].lineId
      focusInboundDraftField(nextId, field)
    },
    [inboundFormLines, focusInboundDraftField]
  )

  const selectInboundInputOnFocus = useCallback((e) => {
    const el = e.target
    if (!el || el.tagName !== 'INPUT') return
    requestAnimationFrame(() => {
      try {
        if (typeof el.select === 'function') el.select()
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    if (activeTab !== TAB_INBOUND_DRAFT) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (supplierModalOpen) return
      if (inboundQuickPickOpen) {
        e.preventDefault()
        setInboundQuickPickOpen(false)
        setInboundQuickPickSelected(new Set())
        return
      }
      if (inboundCostDiffModal) {
        e.preventDefault()
        cancelInboundCostDiffModal()
        return
      }
      if (inboundReturnModal || inboundCancelModal) {
        e.preventDefault()
        return
      }
      /* Không đóng phiếu nhập bằng ESC — chỉ nút Đóng / Thoát / Hủy. */
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeTab,
    supplierModalOpen,
    inboundQuickPickOpen,
    inboundCostDiffModal,
    inboundReturnModal,
    inboundCancelModal,
    cancelInboundCostDiffModal,
  ])

  useEffect(() => {
    if (activeTab !== TAB_INBOUND_DRAFT) return
    const onKey = (e) => {
      if (e.key !== 'F3') return
      if (inboundQuickPickOpen) return
      if (
        supplierModalOpen ||
        inboundCostDiffModal ||
        inboundReturnModal ||
        inboundCancelModal
      )
        return
      e.preventDefault()
      inboundProductSearchRef.current?.focus?.()
      inboundProductSearchRef.current?.select?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    activeTab,
    inboundQuickPickOpen,
    supplierModalOpen,
    inboundCostDiffModal,
    inboundReturnModal,
    inboundCancelModal,
  ])

  const saveInboundForm = useCallback(
    (status) => {
      const supplier = String(inboundFormSupplierName || '').trim()
      if (!supplier) {
        alert('Vui lòng chọn hoặc nhập tên nhà cung cấp (bắt buộc).')
        return
      }
      if (inboundFormEditOrderId && status === 'saved_temp') {
        const prev = inboundOrders.find((o) => o.id === inboundFormEditOrderId)
        if (
          prev &&
          (prev.status === 'completed' ||
            prev.status === 'returned_partial' ||
            prev.status === 'returned_full')
        ) {
          alert('Phiếu đã hoàn thành: dùng nút Hoàn thành để cập nhật tồn kho và tổng tiền.')
          return
        }
        const row = buildInboundOrderPayload('saved_temp')
        setInboundOrders((p) => p.map((o) => (o.id === inboundFormEditOrderId ? row : o)))
        setInboundFormEditOrderId(null)
        completeInboundFlowReturnToList()
        triggerInboundSaveToast()
        return
      }
      if (status === 'completed') {
        handleInboundCompleteClick()
        return
      }
      const row = buildInboundOrderPayload(status)
      setInboundOrders((prev) => [row, ...prev])
      completeInboundFlowReturnToList()
      triggerInboundSaveToast()
    },
    [
      inboundFormSupplierName,
      inboundFormEditOrderId,
      inboundOrders,
      buildInboundOrderPayload,
      handleInboundCompleteClick,
      triggerInboundSaveToast,
      completeInboundFlowReturnToList,
    ]
  )

  const openInboundReturnModal = useCallback((order) => {
    const row = normalizeInboundRow(order)
    if (row.status === 'cancelled') return
    if (!['completed', 'returned_partial', 'returned_full'].includes(row.status)) {
      alert('Chỉ hoàn trả được đơn đã hoàn thành (còn hàng trong kho từ phiếu).')
      return
    }
    if (!row.lines.some((l) => inboundLineReturnableQty(l) > 0 && l.variantId)) {
      alert('Không còn dòng hàng để hoàn trả.')
      return
    }
    if (catalogListForInbound.length === 0) {
      alert('Chưa có danh mục hàng — không thể cập nhật tồn kho.')
      return
    }
    setInboundReturnQtyDraft({})
    setInboundReturnModal(row)
  }, [catalogListForInbound.length])

  const confirmInboundReturnSubmit = useCallback(async () => {
    if (!inboundReturnModal) return
    const order = normalizeInboundRow(inboundReturnModal)
    const deltas = new Map()
    let anyTake = false
    const newLines = order.lines.map((raw) => {
      const ln = normalizeInboundLine(raw)
      const cap = inboundLineReturnableQty(ln)
      const draft = parseReturnQtyDraft(inboundReturnQtyDraft[ln.lineId], cap)
      if (draft <= 0) return ln
      anyTake = true
      if (ln.variantId) deltas.set(ln.variantId, (deltas.get(ln.variantId) || 0) - draft)
      return { ...ln, returnedQty: ln.returnedQty + draft }
    })
    if (!anyTake) {
      alert('Nhập số lượng trả (> 0) cho ít nhất một dòng.')
      return
    }
    const stockRes = await applyInboundStockDeltas(deltas)
    if (stockRes && stockRes.ok === false) {
      window.alert(String(stockRes.error || 'Không cập nhật được tồn kho.'))
      return
    }
    const allReturned = newLines.every((raw) => {
      const n = normalizeInboundLine(raw)
      return n.qty <= 0 || n.returnedQty >= n.qty
    })
    const anyReturned = newLines.some((raw) => normalizeInboundLine(raw).returnedQty > 0)
    let status = order.status
    if (allReturned && newLines.some((raw) => normalizeInboundLine(raw).qty > 0)) {
      status = 'returned_full'
    } else if (anyReturned) {
      status = 'returned_partial'
    }
    const nextRow = normalizeInboundRow({ ...order, lines: newLines, status })
    setInboundOrders((p) => p.map((o) => (o.id === order.id ? nextRow : o)))
    setInboundDetailLineDrafts((prev) => {
      if (!prev[order.id]) return prev
      const n = { ...prev }
      delete n[order.id]
      return n
    })
    setInboundReturnModal(null)
    setInboundReturnQtyDraft({})
  }, [inboundReturnModal, inboundReturnQtyDraft, applyInboundStockDeltas])

  const requestInboundCancel = useCallback((order) => {
    const row = normalizeInboundRow(order)
    if (row.status === 'cancelled') return
    setInboundCancelModal(row)
  }, [])

  const confirmInboundCancelSubmit = useCallback(async () => {
    if (!inboundCancelModal) return
    const row = normalizeInboundRow(inboundCancelModal)
    const hadStock =
      row.status === 'completed' ||
      row.status === 'returned_partial' ||
      row.status === 'returned_full'
    const deltas = new Map()
    if (hadStock) {
      for (const l of row.lines) {
        const q = inboundLineReturnableQty(l)
        if (q > 0 && l.variantId) deltas.set(l.variantId, (deltas.get(l.variantId) || 0) - q)
      }
      const stockRes = await applyInboundStockDeltas(deltas)
      if (stockRes && stockRes.ok === false) {
        window.alert(String(stockRes.error || 'Không cập nhật được tồn kho.'))
        return
      }
    }
    setInboundOrders((p) =>
      p.map((o) => (o.id === row.id ? normalizeInboundRow({ ...row, status: 'cancelled' }) : o))
    )
    setInboundDetailLineDrafts((prev) => {
      if (!prev[row.id]) return prev
      const n = { ...prev }
      delete n[row.id]
      return n
    })
    setInboundCancelModal(null)
  }, [inboundCancelModal, applyInboundStockDeltas])

  const closeInboundDetailTabByOrderId = useCallback((orderId) => {
    const oid = String(orderId ?? '')
    if (!oid) return
    const prev = openInboundDetailOrderIdsRef.current
    const next = prev.filter((x) => x !== oid)
    setOpenInboundDetailOrderIds(next)
    setInboundDetailLineDrafts((d) => {
      if (!d[oid]) return d
      const o = { ...d }
      delete o[oid]
      return o
    })
    setActiveTab((cur) => {
      if (parseInboundDetailTabId(cur) !== oid) return cur
      if (next.length > 0) return toInboundDetailTabId(next[next.length - 1])
      return TAB_ORDERS
    })
  }, [])

  const openInboundDetailTab = useCallback((orderRow) => {
    const row = normalizeInboundRow(orderRow)
    if (!row.id) return
    const oid = String(row.id)
    setOpenInboundDetailOrderIds((prev) => {
      if (prev.includes(oid)) return prev
      const appended = [...prev, oid]
      if (appended.length <= MAX_OPEN_INBOUND_DETAIL_TABS) return appended
      return appended.slice(-MAX_OPEN_INBOUND_DETAIL_TABS)
    })
    setActiveTab(toInboundDetailTabId(oid))
  }, [])

  const startInboundDetailEdit = useCallback((orderRow) => {
    const row = normalizeInboundRow(orderRow)
    if (row.status === 'cancelled') return
    setInboundDetailLineDrafts((prev) => ({
      ...prev,
      [row.id]: row.lines.map((ln) => normalizeInboundLine(ln)),
    }))
  }, [])

  const clearInboundDetailEdit = useCallback((orderId) => {
    const oid = String(orderId ?? '')
    if (!oid) return
    setInboundDetailLineDrafts((prev) => {
      if (!prev[oid]) return prev
      const n = { ...prev }
      delete n[oid]
      return n
    })
  }, [])

  const updateInboundDetailDraftLine = useCallback((orderId, lineId, patch) => {
    setInboundDetailLineDrafts((prev) => {
      const cur = prev[orderId]
      if (!cur) return prev
      const next = cur.map((ln) => {
        if (ln.lineId !== lineId) return ln
        const merged = { ...ln, ...patch }
        const n = normalizeInboundLine(merged)
        let qty = n.qty
        if (qty < n.returnedQty) qty = n.returnedQty
        return { ...merged, qty, returnedQty: n.returnedQty }
      })
      return { ...prev, [orderId]: next }
    })
  }, [])

  const changeInboundDetailDraftUnit = useCallback((orderId, line, newLabelRaw) => {
    const res = applyInboundLineUnitChange(catalogListForInbound, line, newLabelRaw)
    if (!res.ok || !res.changed) return
    setInboundDetailLineDrafts((prev) => {
      const cur = prev[orderId]
      if (!cur) return prev
      return {
        ...prev,
        [orderId]: cur.map((l) => (l.lineId === line.lineId ? res.line : l)),
      }
    })
  }, [catalogListForInbound])

  const submitInboundDetailCommit = useCallback(() => {
    const oid = parseInboundDetailTabId(activeTab)
    if (!oid) return
    const draft = inboundDetailLineDrafts[oid]
    if (!draft) return
    const prevRow = inboundOrders.find((o) => o.id === oid)
    if (!prevRow) return
    if (!catalogForInboundRef.current?.length) {
      alert('Chưa có danh mục hàng — không thể cập nhật tồn kho.')
      return
    }
    const normLines = draft.map((ln) => normalizeInboundLine(ln))
    if (!normLines.some((l) => l.qty > 0)) {
      alert('Cần ít nhất một dòng có số lượng > 0.')
      return
    }
    const totals = computeInboundOrderTotalsFromDiscountedLines(
      normLines,
      prevRow.orderDiscountMode,
      prevRow.orderDiscountValue
    )
    const merged = normalizeInboundRow({
      ...prevRow,
      lines: normLines,
      goodsSubtotal: totals.goodsSubtotal,
      totalValue: totals.totalValue,
      status: computeInboundStatusAfterLines(normLines),
    })
    void (async () => {
      const catSnap = catalogForInboundRef.current
      // eslint-disable-next-line no-console -- xác minh chi tiết phiếu nhập + catalog mới nhất
      console.log('Submit detail normLines:', normLines, 'Submit Catalog:', catSnap)
      const codes = [
        ...new Set([
          ...collectInboundMaHangCodes(catSnap, normLines),
          ...collectInboundMaHangCodes(catSnap, prevRow.lines || []),
        ]),
      ]
      let serverMap = new Map()
      if (codes.length > 0 && isSupabaseConfigured()) {
        try {
          serverMap = await fetchProductsCostAndStockByMaHang(codes)
        } catch (e) {
          console.error(e)
          alert(
            'Không đọc được giá vốn / tồn kho trên Supabase (bảng products). Kiểm tra mạng và quyền.'
          )
          return
        }
      }
      const { diffs, patches } = computeInboundFulfillmentPlan(
        catSnap,
        normLines,
        serverMap,
        prevRow.lines
      )
      if (!patches?.length) {
        alert('Không có thay đổi nhập / tồn hợp lệ để cập nhật danh mục.')
        return
      }
      if (diffs.length > 0) {
        inboundCompletePendingRef.current = {
          diffs,
          patches,
          mode: 'detail_edit',
          mergedRow: merged,
          oldRow: prevRow,
        }
        setInboundCostDiffModal({ diffs })
        return
      }
      appendInboundCostChangeNotifications(diffs)
      const ordersSnapshot = snapshotInboundOrdersList(inboundOrdersRef.current)
      startTransition(() => {
        setInboundOrders((p) => {
          const rest = p.filter((o) => o.id !== oid)
          return [merged, ...rest]
        })
        setInboundDetailLineDrafts((prev) => {
          if (!prev[oid]) return prev
          const n = { ...prev }
          delete n[oid]
          return n
        })
      })
      completeInboundFlowReturnToList()
      triggerInboundSaveToast()

      void syncInboundToApp({ row: merged, patches })
        .then((saved) => {
          const normalized = normalizeInboundRow(saved)
          startTransition(() => {
            setInboundOrders((p) => {
              const rest = p.filter((o) => o.id !== oid && o.id !== normalized.id)
              return [normalized, ...rest]
            })
          })
        })
        .catch((e) => {
          console.error('[inbound] Lưu chi tiết phiếu thất bại', e)
          setInboundOrders(ordersSnapshot)
          setInboundSyncErrMsg(
            `Lỗi đồng bộ: ${e instanceof Error ? e.message : String(e)}. Đã hoàn tác thay đổi!`
          )
        })
    })()
  }, [
    activeTab,
    inboundDetailLineDrafts,
    inboundOrders,
    syncInboundToApp,
    triggerInboundSaveToast,
    completeInboundFlowReturnToList,
  ])

  const persistPosOrderAndReload = useCallback(async (nextOrder) => {
    try {
      await saveOrder(nextOrder)
      await load()
    } catch (e) {
      console.error(e)
      alert('Không lưu được đơn hàng.')
    }
  }, [load])

  const closePosDetailTabByOrderId = useCallback((orderId) => {
    const oid = String(orderId ?? '')
    if (!oid) return
    const prev = openPosDetailOrderIdsRef.current
    const next = prev.filter((x) => x !== oid)
    setOpenPosDetailOrderIds(next)
    setPosDetailEditDrafts((d) => {
      if (!d[oid]) return d
      const o = { ...d }
      delete o[oid]
      return o
    })
    setActiveTab((cur) => {
      if (parsePosOrderDetailTabId(cur) !== oid) return cur
      if (next.length > 0) return toPosOrderDetailTabId(next[next.length - 1])
      return TAB_ORDERS
    })
  }, [])

  const closePosReturnDetailTabByLedgerId = useCallback((ledgerId) => {
    const lid = String(ledgerId ?? '')
    if (!lid) return
    const prev = openPosReturnDetailLedgerIdsRef.current
    const next = prev.filter((x) => x !== lid)
    setOpenPosReturnDetailLedgerIds(next)
    setActiveTab((cur) => {
      if (parsePosReturnDetailTabId(cur) !== lid) return cur
      if (next.length > 0) return toPosReturnDetailTabId(next[next.length - 1])
      return TAB_OVERVIEW
    })
  }, [])

  const openPosReturnDetailTab = useCallback((ledgerEntryId) => {
    const lid = String(ledgerEntryId ?? '').trim()
    if (!lid) return
    setSelected(null)
    setOpenPosReturnDetailLedgerIds((prev) => {
      if (prev.includes(lid)) return prev
      const appended = [...prev, lid]
      if (appended.length <= MAX_OPEN_POS_RETURN_DETAIL_TABS) return appended
      return appended.slice(-MAX_OPEN_POS_RETURN_DETAIL_TABS)
    })
    setActiveTab(toPosReturnDetailTabId(lid))
  }, [])

  const openPosDetailTab = useCallback((order) => {
    if (!order?.id) return
    const oid = String(order.id)
    setOpenPosDetailOrderIds((prev) => {
      if (prev.includes(oid)) return prev
      const appended = [...prev, oid]
      if (appended.length <= MAX_OPEN_POS_ORDER_DETAIL_TABS) return appended
      return appended.slice(-MAX_OPEN_POS_ORDER_DETAIL_TABS)
    })
    setActiveTab(toPosOrderDetailTabId(oid))
  }, [])

  const handleInventoryLedgerDocActivate = useCallback(
    (row) => {
      if (!row || row.inventoryNavSource !== 'supabase') return
      const doc = String(row.docNo ?? '').trim()
      setSelected(null)
      if (/^HD/i.test(doc)) {
        const o = orders.find(
          (x) => String(x.invoiceNo ?? '').trim().toUpperCase() === doc.toUpperCase()
        )
        if (o) {
          syncHubUrlToMainTab(TAB_ORDERS)
          openPosDetailTab(o)
        } else window.alert('Không tìm thấy đơn bán (Hóa đơn) tương ứng chứng từ này.')
        return
      }
      if (/^(NH|PN)/i.test(doc)) {
        const rRow = inboundOrders.find(
          (x) => String(x.code ?? '').trim().toUpperCase() === doc.toUpperCase()
        )
        if (rRow) {
          syncHubUrlToMainTab(TAB_INBOUND)
          openInboundDetailTab(rRow)
        } else window.alert('Không tìm thấy phiếu nhập tương ứng chứng từ này.')
      }
    },
    [orders, inboundOrders, openPosDetailTab, openInboundDetailTab, syncHubUrlToMainTab]
  )

  const [soloGoodsUiTab, setSoloGoodsUiTab] = useState(GOODS_DETAIL_VIEW_TONKHO)
  useEffect(() => {
    if (soloGoodsCtx?.product && isComboCatalogProduct(soloGoodsCtx.product)) {
      setSoloGoodsUiTab(GOODS_DETAIL_VIEW_COMBO)
      return
    }
    setSoloGoodsUiTab(GOODS_DETAIL_VIEW_TONKHO)
  }, [soloActiveVariantId, soloGoodsCtx?.product])

  const hubDeepLinkHandledKeyRef = useRef(null)
  const hubDeepLinkConsumeRef = useRef(onHubDeepLinkConsumed)
  hubDeepLinkConsumeRef.current = onHubDeepLinkConsumed

  useLayoutEffect(() => {
    if (standaloneInboundCreate) return
    const tab = hubMainTabFromPathname(location.pathname)
    if (tab == null) return
    setActiveTab(tab)
    setSelected(null)
  }, [location.pathname, standaloneInboundCreate])

  useEffect(() => {
    if (!hubDeepLink) {
      hubDeepLinkHandledKeyRef.current = null
      return
    }
    const hubOpen = hubDeepLink.hubOpen
    if (hubOpen === 'orders' || hubOpen === 'returns') {
      const kOpen = `hubopen:${hubOpen}`
      if (hubDeepLinkHandledKeyRef.current === kOpen) return
      hubDeepLinkHandledKeyRef.current = kOpen
      const nextTab = hubOpen === 'orders' ? TAB_ORDERS : TAB_OVERVIEW
      setActiveTab(nextTab)
      syncHubUrlToMainTab(nextTab)
      hubDeepLinkConsumeRef.current?.()
      return
    }
    if (loading) return
    const k = `${hubDeepLink.posOrderId ?? ''}|${hubDeepLink.inboundOrderId ?? ''}|${hubDeepLink.posReturnLedgerId ?? ''}`
    if (hubDeepLinkHandledKeyRef.current === k) return
    hubDeepLinkHandledKeyRef.current = k

    const { posOrderId, inboundOrderId, posReturnLedgerId } = hubDeepLink
    if (posOrderId) {
      const o = orders.find((x) => String(x.id) === String(posOrderId))
      if (o) openPosDetailTab(o)
      else window.alert('Không tìm thấy đơn bán.')
    } else if (inboundOrderId) {
      const row = inboundOrders.find((x) => String(x.id) === String(inboundOrderId))
      if (row) openInboundDetailTab(row)
      else window.alert('Không tìm thấy phiếu nhập.')
    } else if (posReturnLedgerId) {
      const ok = (returnDayLedger || []).some((e) => String(e.id) === String(posReturnLedgerId))
      if (ok) openPosReturnDetailTab(posReturnLedgerId)
      else window.alert('Không tìm thấy phiếu hoàn trả.')
    }
    hubDeepLinkConsumeRef.current?.()
  }, [
    hubDeepLink,
    loading,
    orders,
    inboundOrders,
    returnDayLedger,
    openPosDetailTab,
    openInboundDetailTab,
    openPosReturnDetailTab,
    syncHubUrlToMainTab,
  ])

  const soloStockLedgerRows = useMemo(() => {
    if (!isSoloProductTabId(activeTab)) return []
    if (!soloActiveVariantId || !soloGoodsVariant) return []
    if (!Array.isArray(returnDayLedger)) return []
    try {
      return buildVariantStockLedgerRows({
        variantId: soloActiveVariantId,
        catalogList,
        currentStockQty: soloGoodsVariant.stockQty,
        orders,
        inboundOrders,
        returnDayLedger,
      })
    } catch (e) {
      console.warn('[AdminHub soloStockLedgerRows]', e)
      return []
    }
  }, [
    activeTab,
    soloActiveVariantId,
    soloGoodsVariant,
    catalogList,
    orders,
    inboundOrders,
    returnDayLedger,
  ])

  useEffect(() => {
    const productId = String(inboundQuickEditCtx?.product?.id ?? '').trim()
    const want =
      Boolean(inboundQuickEditExpandId) &&
      Boolean(productId) &&
      (inboundQuickEditShelfTab === GOODS_DETAIL_VIEW_TONKHO ||
        inboundQuickEditShelfTab === GOODS_DETAIL_VIEW_LICHSU)
    if (!want || !isSupabaseConfigured()) {
      setGoodsSfInventoryRows([])
      setGoodsSfInventoryLoading(false)
      setGoodsSfInventoryFetchErr(false)
      return undefined
    }
    let cancelled = false
    setGoodsSfInventoryLoading(true)
    fetchInventoryLogsByProductId(productId, catalogList, {
      limit: 200,
      dateFrom: goodsInvLedgerDateFrom,
      dateTo: goodsInvLedgerDateTo,
      documentSearch: goodsInvLedgerDocDebounced,
    }).then((r) => {
      if (cancelled) return
      setGoodsSfInventoryLoading(false)
      if (r.ok) {
        setGoodsSfInventoryRows(r.rows)
        setGoodsSfInventoryFetchErr(false)
      } else {
        setGoodsSfInventoryRows([])
        setGoodsSfInventoryFetchErr(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    inboundQuickEditExpandId,
    inboundQuickEditCtx?.product?.id,
    inboundQuickEditShelfTab,
    catalogList,
    inventoryLogRefreshTick,
    goodsInvLedgerDateFrom,
    goodsInvLedgerDateTo,
    goodsInvLedgerDocDebounced,
  ])

  useEffect(() => {
    const productId = String(soloGoodsCtx?.product?.id ?? '').trim()
    const want =
      isSoloProductTabId(activeTab) &&
      Boolean(productId) &&
      (soloGoodsUiTab === GOODS_DETAIL_VIEW_TONKHO || soloGoodsUiTab === GOODS_DETAIL_VIEW_LICHSU)
    if (!want || !isSupabaseConfigured()) {
      setSoloSfInventoryRows([])
      setSoloSfInventoryLoading(false)
      setSoloSfInventoryFetchErr(false)
      return undefined
    }
    let cancelled = false
    setSoloSfInventoryLoading(true)
    fetchInventoryLogsByProductId(productId, catalogList, {
      limit: 200,
      dateFrom: soloInvLedgerDateFrom,
      dateTo: soloInvLedgerDateTo,
      documentSearch: soloInvLedgerDocDebounced,
    }).then((r) => {
      if (cancelled) return
      setSoloSfInventoryLoading(false)
      if (r.ok) {
        setSoloSfInventoryRows(r.rows)
        setSoloSfInventoryFetchErr(false)
      } else {
        setSoloSfInventoryRows([])
        setSoloSfInventoryFetchErr(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    soloActiveVariantId,
    soloGoodsCtx?.product?.id,
    soloGoodsUiTab,
    catalogList,
    inventoryLogRefreshTick,
    soloInvLedgerDateFrom,
    soloInvLedgerDateTo,
    soloInvLedgerDocDebounced,
  ])

  const goodsMergedInventoryLedgerRows = useMemo(() => {
    if (!isSupabaseConfigured() || goodsSfInventoryFetchErr) return { mode: 'supabase', rows: [] }
    if (goodsSfInventoryLoading && goodsSfInventoryRows.length === 0)
      return { mode: 'loading', rows: [] }
    const mapped = (goodsSfInventoryRows || []).map((row) =>
      mapInventoryLogDbRowToDisplay(row, { catalogProducts: catalogList })
    )
    return { mode: 'supabase', rows: mapped }
  }, [
    goodsSfInventoryRows,
    goodsSfInventoryLoading,
    goodsSfInventoryFetchErr,
    catalogList,
  ])

  const soloMergedInventoryLedgerRows = useMemo(() => {
    if (!isSupabaseConfigured() || soloSfInventoryFetchErr) return { mode: 'supabase', rows: [] }
    if (soloSfInventoryLoading && soloSfInventoryRows.length === 0)
      return { mode: 'loading', rows: [] }
    const mapped = (soloSfInventoryRows || []).map((row) =>
      mapInventoryLogDbRowToDisplay(row, { catalogProducts: catalogList })
    )
    return { mode: 'supabase', rows: mapped }
  }, [soloSfInventoryRows, soloSfInventoryLoading, soloSfInventoryFetchErr, catalogList])

  const goodsInventoryPreviewRows = useMemo(() => {
    const r = goodsMergedInventoryLedgerRows.rows
    return Array.isArray(r) ? r.slice(0, 8) : []
  }, [goodsMergedInventoryLedgerRows.rows])

  const soloInventoryPreviewRows = useMemo(() => {
    const r = soloMergedInventoryLedgerRows.rows
    return Array.isArray(r) ? r.slice(0, 8) : []
  }, [soloMergedInventoryLedgerRows.rows])

  const inboundQuickEditSlot = useMemo(() => {
    if (!inboundQuickEditExpandId || !inboundQuickEditCtx || !inboundQuickEditVariant || !inboundQuickEditDraft) {
      return null
    }
    return (
      <AdminHubGoodsExpandedBelow
        GOODS_DETAIL_VIEW_TONKHO={GOODS_DETAIL_VIEW_TONKHO}
        GOODS_DETAIL_VIEW_LICHSU={GOODS_DETAIL_VIEW_LICHSU}
        GOODS_DETAIL_VIEW_COMBO={GOODS_DETAIL_VIEW_COMBO}
        goodsDetailShelfTab={inboundQuickEditShelfTab}
        setGoodsDetailShelfTab={setInboundQuickEditShelfTab}
        discardGoodsDetailDraft={() => {
          if (inboundQuickEditVariant) {
            setInboundQuickEditDraft(buildGoodsDetailDraft(inboundQuickEditVariant))
          } else {
            setInboundQuickEditDraft(null)
          }
        }}
        saveGoodsDetail={saveInboundQuickEditDetail}
        v={inboundQuickEditVariant}
        d={inboundQuickEditDraft}
        goodsDetailCtx={inboundQuickEditCtx}
        goodsDetailSelectedVid={inboundQuickEditSelectedVid}
        setGoodsDetailSelectedVid={setInboundQuickEditSelectedVid}
        setGoodsDetailDraft={setInboundQuickEditDraft}
        buildGoodsDetailDraft={buildGoodsDetailDraft}
        copyGoodsDetail={copyGoodsDetail}
        deleteGoodsDetailVariant={deleteGoodsDetailVariant}
        formatMoneyDraftVi={formatMoneyDraftVi}
        goodsStockLedgerMerged={goodsMergedInventoryLedgerRows}
        goodsInventoryPreviewRows={goodsInventoryPreviewRows}
        goodsInvLedgerDateFrom={goodsInvLedgerDateFrom}
        goodsInvLedgerDateTo={goodsInvLedgerDateTo}
        goodsInvLedgerDocumentSearch={goodsInvLedgerDocSearch}
        onGoodsInvLedgerDateFromChange={setGoodsInvLedgerDateFrom}
        onGoodsInvLedgerDateToChange={setGoodsInvLedgerDateTo}
        onGoodsInvLedgerDocumentSearchChange={setGoodsInvLedgerDocSearch}
        onInventoryDocumentActivate={handleInventoryLedgerDocActivate}
        getStockLedgerDetailAbsoluteUrl={getStockLedgerDetailAbsoluteUrl}
        openGoodsUnitModal={openInboundGoodsUnitModal}
        catalogList={catalogListForGoodsEdit}
        isComboDetail={shouldShowComboBomTab(inboundQuickEditCtx?.product)}
        comboDetailProduct={inboundQuickEditCtx?.product ?? null}
        onEditComboProduct={() => {
          if (inboundQuickEditCtx?.product && isComboCatalogProduct(inboundQuickEditCtx.product)) {
            setComboModal({ mode: 'edit', product: inboundQuickEditCtx.product })
          }
        }}
        goodsBrandAutocompleteOptions={inboundNccAutocompleteOptions}
        onRequestAddSupplier={revenueReadOnly ? undefined : openGoodsBrandSupplierModal}
        onCloseGoodsDetail={closeInboundProductQuickEdit}
      />
    )
  }, [
    inboundQuickEditExpandId,
    inboundQuickEditCtx,
    inboundQuickEditVariant,
    inboundQuickEditDraft,
    inboundQuickEditShelfTab,
    inboundQuickEditSelectedVid,
    goodsMergedInventoryLedgerRows,
    goodsInventoryPreviewRows,
    goodsInvLedgerDateFrom,
    goodsInvLedgerDateTo,
    goodsInvLedgerDocSearch,
    handleInventoryLedgerDocActivate,
    saveInboundQuickEditDetail,
    buildGoodsDetailDraft,
    copyGoodsDetail,
    deleteGoodsDetailVariant,
    openInboundGoodsUnitModal,
    catalogList,
    inboundNccAutocompleteOptions,
    revenueReadOnly,
    openGoodsBrandSupplierModal,
    closeInboundProductQuickEdit,
  ])

  const productQuickEditModalOpen = Boolean(inboundQuickEditExpandId)

  useEffect(() => {
    if (!productQuickEditModalOpen) return undefined
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow || ''
    }
  }, [productQuickEditModalOpen])

  const openPosReturnModal = useCallback(
    (order) => {
      if (revenueReadOnly) {
        alert('Chỉ tài khoản Admin mới chỉnh sửa đơn bán từ đây.')
        return
      }
      const n = normalizePosOrder(order, catalogList, { preferStoredLineFinancials: true })
      if (!posOrderCanPartialReturn(n)) {
        alert('Không còn hàng để hoàn trả (đã hoàn hết hoặc đơn đã hủy).')
        return
      }
      setPosReturnSubmitting(false)
      setPosReturnQtyDraft({})
      setPosReturnModal(n)
    },
    [catalogList, revenueReadOnly]
  )

  const confirmPosReturnSubmit = useCallback(async () => {
    if (revenueReadOnly) return
    if (!posReturnModal) return
    if (posReturnSubmitting) return
    setPosReturnSubmitting(true)
    try {
      const base = normalizePosOrder(posReturnModal, catalogList, { preferStoredLineFinancials: true })
      let revenueSub = 0
      let costSub = 0
      let profitSub = 0
      let anyTake = false
      /** @type {Array<object>} */
      const returnLines = []
      const returnQtyByLineId = new Map()
      const newItems = []
      for (const it of base.items) {
        const ret = posOrderLineReturnableQty(it)
        const draft = parseReturnQtyDraft(posReturnQtyDraft[it.orderLineId], ret)
        if (draft <= 0) {
          newItems.push(it)
          continue
        }
        anyTake = true
        returnQtyByLineId.set(it.orderLineId, draft)
        const originalOrderLine = it
        const orderQty = Math.max(0, Number(originalOrderLine.qty) || 0)
        const lineProfitReversal =
          orderQty > 0
            ? (Number(originalOrderLine.lineProfit ?? originalOrderLine.line_profit ?? 0) /
                orderQty) *
              draft
            : 0
        const lineProfitReversalRounded = Math.round(lineProfitReversal)
        const { lineRefund, lineCostReturn, unitCost } =
          posReturnLedgerAmountsFromStoredOrderLine(originalOrderLine, draft)
        revenueSub += lineRefund
        costSub += lineCostReturn
        profitSub += lineProfitReversalRounded
        console.error('--- DEBUG TRẢ HÀNG COMBO ---', {
          line_profit: originalOrderLine.lineProfit ?? originalOrderLine.line_profit,
          revenue: originalOrderLine.lineRevenue ?? originalOrderLine.line_revenue,
          qty: orderQty,
          profitSub_ket_qua: lineProfitReversalRounded,
        })
        returnLines.push({
          code: String(it.code || '').trim(),
          name: String(it.name || '').trim(),
          unitLabel: String(it.unitLabel || '').trim() || '—',
          qtyReturned: draft,
          unitRefund: Math.round(Math.max(0, Number(it.price) || 0)),
          unitCost,
          lineRefund,
          lineCostReturn,
          lineProfitReversal: lineProfitReversalRounded,
          variantId: String(it.variantId || '').trim(),
        })
        const prevR = Math.max(0, Number(it.returnedQty) || 0)
        const q = Math.max(0, Number(it.qty) || 0)
        newItems.push({ ...it, returnedQty: Math.min(q, prevR + draft) })
      }
      if (!anyTake) {
        alert('Nhập số lượng trả (> 0) cho ít nhất một dòng.')
        return
      }
      const returnDocCode = `TH-${String(base.invoiceNo || base.id || '').trim() || '—'}`
      const restoreCartLines = await buildPosReturnRestoreCartLines(catalogList, base.items, (it) =>
        returnQtyByLineId.get(it.orderLineId) || 0
      )
      if (restoreCartLines.length === 0) {
        throw new Error(
          'Không khớp sản phẩm trong danh mục để hoàn tồn kho (kiểm tra combo / mã hàng trên đơn).'
        )
      }
      const stockRestoreResult = await persistCatalogStockRestoreFromCartLines({
        catalog: catalogList,
        cartLines: restoreCartLines,
        catalogFileName: standaloneCatalog?.fileName || catalogFileName || '',
        onBulkPatchCatalogVariants,
        setStandaloneCatalog: parentCatalogSupplied ? undefined : setStandaloneCatalog,
      })
      if (!stockRestoreResult.ok) {
        throw new Error(
          String(stockRestoreResult.error || 'Không cập nhật được tồn kho trên máy chủ.')
        )
      }
      if (isSupabaseConfigured() && stockRestoreResult.nextProducts) {
        const invRows = buildPosReturnInventoryLogRows(
          stockRestoreResult.prevProducts,
          stockRestoreResult.nextProducts,
          { documentCode: returnDocCode, staffName: staffNameForInventoryLog() },
          restoreCartLines
        )
        await insertInventoryLogRows(invRows)
        try {
          window.dispatchEvent(new CustomEvent(INVENTORY_LOG_UPDATED_EVENT))
        } catch {
          /* ignore */
        }
      }
      const nextStatus = computePosOrderStatusFromItems(newItems)
      const merged = normalizePosOrder(
        { ...base, items: newItems, status: nextStatus },
        catalogList,
        { preferStoredLineFinancials: true }
      )
      await persistPosOrderAndReload(merged)
      const profitSubRounded = Math.round(profitSub)
      const revenueSubRounded = Math.round(revenueSub)
      const costSubRounded = Math.round(costSub)
      console.error('--- DEBUG TRƯỚC INSERT LEDGER ---', {
        revenueSub: revenueSubRounded,
        costSub: costSubRounded,
        profitSub: profitSubRounded,
        profit_delta: -profitSubRounded,
      })
      const ins = await insertPosReturnLedgerEntry({
        atMs: Date.now(),
        orderId: String(base.id || ''),
        revenueSub: revenueSubRounded,
        costSub: costSubRounded,
        profitSub: profitSubRounded,
        sourceInvoiceNo: String(base.invoiceNo || '').trim(),
        lines: returnLines,
      })
      if (!ins.ok) {
        console.error('[confirmPosReturnSubmit] insert pos_return_ledger', ins.error)
        throw new Error(
          formatPostgrestErrorForUser(ins.error) ||
            'Đơn và tồn kho đã cập nhật nhưng không ghi được phiếu trả hàng lên Supabase.'
        )
      }
      await refreshPosReturnLedger()
      setPosReturnModal(null)
      setPosReturnQtyDraft({})
      setPosDetailEditDrafts((prev) => {
        if (!prev[base.id]) return prev
        const o = { ...prev }
        delete o[base.id]
        return o
      })
      showHubCameraToast('Hoàn trả đơn hàng thành công!', 'ok')
    } catch (err) {
      console.error('[confirmPosReturnSubmit] failed', err)
      showHubCameraToast('Lỗi: Không thể kết nối tới máy chủ. Vui lòng thử lại!', 'err')
    } finally {
      setPosReturnSubmitting(false)
    }
  }, [
    posReturnModal,
    posReturnQtyDraft,
    posReturnSubmitting,
    catalogList,
    catalogFileName,
    standaloneCatalog?.fileName,
    parentCatalogSupplied,
    onBulkPatchCatalogVariants,
    persistPosOrderAndReload,
    refreshPosReturnLedger,
    revenueReadOnly,
    showHubCameraToast,
  ])

  const requestPosCancel = useCallback(
    (order) => {
      if (revenueReadOnly) {
        alert('Chỉ tài khoản Admin mới chỉnh sửa đơn bán từ đây.')
        return
      }
      const n = normalizePosOrder(order, catalogList)
      if (n.status === 'cancelled') return
      setPosCancelModal(n)
    },
    [catalogList, revenueReadOnly]
  )

  const confirmPosCancelSubmit = useCallback(async () => {
    if (revenueReadOnly) return
    if (!posCancelModal) return
    const base = normalizePosOrder(posCancelModal, catalogList)
    const restoreCartLines = await buildPosReturnRestoreCartLines(catalogList, base.items, (it) =>
      posOrderLineReturnableQty(it)
    )
    if (restoreCartLines.length > 0) {
      const cancelDocCode = `HUY-${String(base.invoiceNo || base.id || '').trim() || '—'}`
      const stockRestoreResult = await persistCatalogStockRestoreFromCartLines({
        catalog: catalogList,
        cartLines: restoreCartLines,
        catalogFileName: standaloneCatalog?.fileName || catalogFileName || '',
        onBulkPatchCatalogVariants,
        setStandaloneCatalog: parentCatalogSupplied ? undefined : setStandaloneCatalog,
      })
      if (!stockRestoreResult.ok) {
        window.alert(String(stockRestoreResult.error || 'Không cập nhật được tồn kho.'))
        return
      }
      if (isSupabaseConfigured() && stockRestoreResult.nextProducts) {
        const invRows = buildPosReturnInventoryLogRows(
          stockRestoreResult.prevProducts,
          stockRestoreResult.nextProducts,
          { documentCode: cancelDocCode, staffName: staffNameForInventoryLog() },
          restoreCartLines
        )
        await insertInventoryLogRows(invRows)
        try {
          window.dispatchEvent(new CustomEvent(INVENTORY_LOG_UPDATED_EVENT))
        } catch {
          /* ignore */
        }
      }
    }
    const merged = normalizePosOrder({ ...base, status: 'cancelled' }, catalogList)
    await persistPosOrderAndReload(merged)
    setPosCancelModal(null)
    setPosDetailEditDrafts((prev) => {
      if (!prev[base.id]) return prev
      const o = { ...prev }
      delete o[base.id]
      return o
    })
  }, [
    posCancelModal,
    catalogList,
    catalogFileName,
    standaloneCatalog?.fileName,
    parentCatalogSupplied,
    onBulkPatchCatalogVariants,
    persistPosOrderAndReload,
    revenueReadOnly,
  ])

  const startPosDetailEdit = useCallback(
    (order) => {
      if (revenueReadOnly) {
        alert('Chỉ tài khoản Admin mới chỉnh sửa đơn bán từ đây.')
        return
      }
      const n = normalizePosOrder(order, catalogList, { preferStoredLineFinancials: true })
      if (n.status === 'cancelled') return
      try {
        const clone = JSON.parse(JSON.stringify(n))
        setPosDetailEditDrafts((prev) => ({ ...prev, [String(n.id)]: clone }))
      } catch {
        /* ignore */
      }
    },
    [catalogList, revenueReadOnly]
  )

  const clearPosDetailEdit = useCallback((orderId) => {
    const oid = String(orderId ?? '')
    setPosDetailEditDrafts((prev) => {
      if (!prev[oid]) return prev
      const n = { ...prev }
      delete n[oid]
      return n
    })
  }, [])

  const updatePosDetailDraftItem = useCallback((orderId, lineId, patch) => {
    setPosDetailEditDrafts((prev) => {
      const cur = prev[orderId]
      if (!cur?.items) return prev
      const nextItems = cur.items.map((it) => {
        if (String(it.orderLineId) !== String(lineId)) return it
        const merged = { ...it, ...patch }
        const qty = Math.max(0, Number(merged.qty) || 0)
        let returnedQty = Math.max(0, Number(merged.returnedQty) || 0)
        if (returnedQty > qty) returnedQty = qty
        const price = Math.max(0, Number(merged.price) || 0)
        const cost = Math.max(0, Number(merged.cost) || 0)
        const lineRevenue = price * qty
        const lineCost = cost * qty
        return {
          ...merged,
          qty,
          returnedQty,
          price,
          cost,
          lineRevenue,
          lineCost,
          lineProfit: lineRevenue - lineCost,
        }
      })
      return { ...prev, [orderId]: recomputePosDraftAgg({ ...cur, items: nextItems }) }
    })
  }, [])

  const removePosDetailDraftLine = useCallback((orderId, lineId) => {
    setPosDetailEditDrafts((prev) => {
      const cur = prev[orderId]
      if (!cur?.items) return prev
      const nextItems = cur.items.filter((it) => String(it.orderLineId) !== String(lineId))
      return { ...prev, [orderId]: recomputePosDraftAgg({ ...cur, items: nextItems }) }
    })
  }, [])

  const addPosDetailLineFromVariantId = useCallback(
    (orderId, variantIdRaw) => {
      const vid = String(variantIdRaw || '').trim()
      if (!vid) return
      const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
      const v = flat.find((x) => x.id === vid)
      if (!v) return
      setPosDetailEditDrafts((prev) => {
        const cur = prev[orderId]
        if (!cur) return prev
        const price = Math.max(0, Number(v.price) || 0)
        const cost = Math.max(0, Number(v.cost) || 0)
        const qty = 1
        const orderLineId = `pol-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        const line = {
          orderLineId,
          variantId: v.id,
          code: String(v.code || '').trim(),
          name: String(v.name || '').trim(),
          unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
          price,
          cost,
          qty,
          returnedQty: 0,
          lineRevenue: price * qty,
          lineCost: cost * qty,
          lineProfit: (price - cost) * qty,
        }
        const next = { ...cur, items: [...(cur.items || []), line] }
        return { ...prev, [orderId]: recomputePosDraftAgg(next) }
      })
    },
    [catalogList]
  )

  const submitPosDetailEditCommit = useCallback(async () => {
    if (revenueReadOnly) return
    const oid = parsePosOrderDetailTabId(activeTab)
    if (!oid) return
    const draft = posDetailEditDrafts[oid]
    if (!draft) return
    if (catalogList.length === 0) {
      alert('Chưa có danh mục hàng — không thể cập nhật tồn kho.')
      return
    }
    const prevRow = orders.find((o) => String(o.id) === String(oid))
    if (!prevRow) return
    if (!(draft.items || []).some((it) => (Number(it.qty) || 0) > 0)) {
      alert('Cần ít nhất một dòng có số lượng > 0.')
      return
    }
    const oldN = normalizePosOrder(prevRow, catalogList, { preferStoredLineFinancials: true })
    const newN = normalizePosOrder(draft, catalogList, { preferStoredLineFinancials: true })
    const deltaMap = posOrderSaleQtyDeltaMap(oldN.items, newN.items)
    const stockDeltas = new Map()
    for (const [vid, dq] of deltaMap) {
      stockDeltas.set(vid, -(dq || 0))
    }
    const stockRes = await applyInboundStockDeltas(stockDeltas)
    if (stockRes && stockRes.ok === false) {
      window.alert(String(stockRes.error || 'Không cập nhật được tồn kho.'))
      return
    }
    const nextStatus = computePosOrderStatusFromItems(newN.items)
    const merged = normalizePosOrder(
      { ...newN, status: nextStatus },
      catalogList,
      { preferStoredLineFinancials: true }
    )
    await persistPosOrderAndReload(merged)
    clearPosDetailEdit(oid)
  }, [
    activeTab,
    posDetailEditDrafts,
    orders,
    catalogList,
    applyInboundStockDeltas,
    persistPosOrderAndReload,
    clearPosDetailEdit,
    revenueReadOnly,
  ])

  const inboundEditFromStockApplied = useMemo(() => {
    if (!inboundFormEditOrderId) return false
    const o = inboundOrders.find((x) => x.id === inboundFormEditOrderId)
    return (
      !!o &&
      (o.status === 'completed' ||
        o.status === 'returned_partial' ||
        o.status === 'returned_full')
    )
  }, [inboundFormEditOrderId, inboundOrders])

  const handleInboundExportAll = useCallback(() => {
    if (inboundOrders.length === 0) {
      alert('Chưa có phiếu để xuất.')
      return
    }
    try {
      exportInboundRowsToCsvFile(inboundOrders)
    } catch (err) {
      console.error(err)
      alert('Không xuất được file.')
    }
  }, [inboundOrders])

  const handleInboundListImport = useCallback(
    (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const text = String(reader.result || '').replace(/^\uFEFF/, '')
          const lines = text.split(/\r?\n/).filter((ln) => ln.trim())
          if (lines.length < 2) {
            alert('File không đủ dòng dữ liệu.')
            return
          }
          const firstLine = String(lines?.[0] ?? '')
          if (!firstLine) {
            alert('Không đọc được dòng tiêu đề.')
            return
          }
          const delim = firstLine.includes(';') ? ';' : ','
          const head = firstLine.split(delim).map((c) => c.replace(/^"|"$/g, '').trim())
          const idxCode = head.findIndex((h) => /mã đơn nhập/i.test(h))
          const idxDate = head.findIndex((h) => /ngày nhập/i.test(h))
          const idxSup = head.findIndex((h) => /nhà cung cấp/i.test(h))
          const idxVal = head.findIndex((h) => /giá trị đơn/i.test(h))
          const idxSt = head.findIndex((h) => /trạng thái/i.test(h))
          if (idxCode < 0) {
            alert('Không tìm thấy cột Mã đơn nhập trong file.')
            return
          }
          const parseStatus = (cell) => {
            const t = String(cell || '').toLowerCase()
            if (t.includes('hoàn')) return 'completed'
            if (t.includes('lưu tạm')) return 'saved_temp'
            if (t.includes('đang nhập')) return 'receiving'
            return 'draft'
          }
          const added = []
          for (let i = 1; i < lines.length; i++) {
            const rowText = String(lines?.[i] ?? '')
            if (!rowText) continue
            const cells = rowText.split(delim).map((c) => c.replace(/^"|"$/g, '').trim())
            const code = cells[idxCode] || ''
            if (!code) continue
            const supplier = idxSup >= 0 ? cells[idxSup] || '' : ''
            const valRaw = idxVal >= 0 ? cells[idxVal].replace(/\./g, '').replace(/[^\d]/g, '') : '0'
            const totalValue = Math.max(0, parseInt(valRaw, 10) || 0)
            const st = idxSt >= 0 ? parseStatus(cells[idxSt]) : 'saved_temp'
            let createdAtMs = Date.now()
            if (idxDate >= 0 && cells[idxDate]) {
              const d = new Date(cells[idxDate])
              if (!Number.isNaN(d.getTime())) createdAtMs = d.getTime()
            }
            added.push(
              normalizeInboundRow({
                id: createInboundId(),
                code,
                createdAtMs,
                supplier,
                totalValue,
                goodsSubtotal: totalValue,
                status: st,
                lines: [],
                note: '',
              })
            )
          }
          if (added.length === 0) {
            alert('Không đọc được dòng hợp lệ.')
            return
          }
          setInboundOrders((prev) => [...added, ...prev])
        } catch (err) {
          console.error(err)
          alert('Không đọc được file.')
        }
      }
      reader.readAsText(file, 'UTF-8')
    },
    []
  )

  /* —— Đơn hàng —— */
  const [ordRange, setOrdRange] = useState(RANGE_TODAY)
  const [ordFrom, setOrdFrom] = useState(todayYmd)
  const [ordTo, setOrdTo] = useState(todayYmd)
  const [ordQ, setOrdQ] = useState('')
  const ordDebounced = useDebounced(ordQ)
  /** Tab Đơn hàng: đơn nhập kho vs đơn bán POS. */
  const [ordersSubTab, setOrdersSubTab] = useState('pos')
  const [ordersDateDdOpen, setOrdersDateDdOpen] = useState(false)
  const ordersTimeDdRef = useRef(null)

  const ordFiltered = useMemo(
    () => filterOrdersForReport(orders, ordRange, ordFrom, ordTo),
    [orders, ordRange, ordFrom, ordTo]
  )

  const ordList = useMemo(() => {
    const q = ordDebounced.trim().toLowerCase()
    if (!q) return ordFiltered
    return ordFiltered.filter((o) =>
      String(o.invoiceNo || '')
        .toLowerCase()
        .includes(q)
    )
  }, [ordFiltered, ordDebounced])

  const inboundDateFilteredForOrdersTab = useMemo(
    () => filterInboundOrdersForReport(inboundOrders, ordRange, ordFrom, ordTo),
    [inboundOrders, ordRange, ordFrom, ordTo]
  )

  const inboundRowsOrdersTab = useMemo(() => {
    const q = inboundDebounced.trim().toLowerCase()
    if (!q) return inboundDateFilteredForOrdersTab
    return inboundDateFilteredForOrdersTab.filter(
      (r) =>
        String(r.code).toLowerCase().includes(q) ||
        String(r.supplier).toLowerCase().includes(q) ||
        inboundStatusLabel(r.status).toLowerCase().includes(q)
    )
  }, [inboundDateFilteredForOrdersTab, inboundDebounced])

  const ordersTabPosTotal = useMemo(
    () => ordFiltered.reduce((s, o) => s + safeMoney(o.total), 0),
    [ordFiltered]
  )

  const ordersTabInboundTotal = useMemo(
    () => inboundDateFilteredForOrdersTab.reduce((s, r) => s + safeMoney(r.totalValue), 0),
    [inboundDateFilteredForOrdersTab]
  )

  const ordersRangeTriggerLabel = useMemo(() => {
    if (ordRange === RANGE_CUSTOM) {
      const a = String(ordFrom || '').replace(/-/g, '/')
      const b = String(ordTo || '').replace(/-/g, '/')
      if (a && b) return `${a} – ${b}`
      return ORDERS_TAB_CUSTOM_RANGE_LABEL
    }
    return RANGE_LABELS[ordRange] ?? String(ordRange)
  }, [ordRange, ordFrom, ordTo])

  const pickOrdersRange = useCallback((k) => {
    setOrdRange(k)
    setOrdersDateDdOpen(false)
  }, [])

  const prevActiveTabForOrdersResetRef = useRef(null)
  useEffect(() => {
    const prev = prevActiveTabForOrdersResetRef.current
    prevActiveTabForOrdersResetRef.current = activeTab
    if (activeTab !== TAB_ORDERS) return
    if (prev === TAB_ORDERS) return
    setOrdRange(RANGE_TODAY)
    const t = todayYmd()
    setOrdFrom(t)
    setOrdTo(t)
    setOrdersDateDdOpen(false)
  }, [activeTab])

  useEffect(() => {
    if (!ordersDateDdOpen) return
    const onDown = (e) => {
      if (ordersTimeDdRef.current && !ordersTimeDdRef.current.contains(e.target)) {
        setOrdersDateDdOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ordersDateDdOpen])

  useEffect(() => {
    if (activeTab !== TAB_ORDERS || !ordersDateDdOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOrdersDateDdOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, ordersDateDdOpen])

  /* —— Khách hàng —— */
  const [custQ, setCustQ] = useState('')
  const custDebounced = useDebounced(custQ)
  const [customers, setCustomers] = useState(() => loadCustomersFromStorage())
  /** Một lần / phiên: tải từ Supabase khi lần đầu mở tab — không dùng refreshKey (tránh bão API khi salesRefresh tăng). */
  const customersRemoteFetchedOnceRef = useRef(false)
  const [customersRemoteLoading, setCustomersRemoteLoading] = useState(false)

  useEffect(() => {
    if (activeTab !== TAB_CUSTOMERS) return
    if (customersRemoteFetchedOnceRef.current) return
    if (!isSupabaseConfigured()) {
      customersRemoteFetchedOnceRef.current = true
      setCustomers(loadCustomersFromStorage())
      return
    }
    let cancelled = false
    setCustomersRemoteLoading(true)
    void (async () => {
      try {
        const remote = await fetchCustomersFromSupabase()
        if (cancelled) return
        const local = loadCustomersFromStorage()
        const merged = mergeCustomerListsDedupe(remote, local)
        setCustomers(merged)
        try {
          localStorage.setItem(POS_CUSTOMERS_KEY, JSON.stringify(merged))
        } catch (e) {
          console.warn(e)
        }
        /* Không dispatch csv-preview-customers-changed ở đây — tránh App.jsx gọi fetch /customers lần 2 (vòng lặp gấp đôi). */
        customersRemoteFetchedOnceRef.current = true
      } catch (e) {
        console.warn('[AdminHub] Tải khách hàng (customers)', e)
        if (!cancelled) {
          setCustomers(loadCustomersFromStorage())
          customersRemoteFetchedOnceRef.current = true
        }
      } finally {
        if (!cancelled) setCustomersRemoteLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTab])

  const custFiltered = useMemo(() => {
    const q = custDebounced.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(
      (c) =>
        String(c.name || '')
          .toLowerCase()
          .includes(q) ||
        String(c.phone || '')
          .toLowerCase()
          .includes(q) ||
        String(c.address || '')
          .toLowerCase()
          .includes(q) ||
        String(c.cccd || '')
          .toLowerCase()
          .includes(q) ||
        String(c.mail || '')
          .toLowerCase()
          .includes(q)
    )
  }, [customers, custDebounced])

  const customerModalSeed = useMemo(() => {
    if (!editingCustomer) return null
    return {
      name: editingCustomer.name,
      phone: editingCustomer.phone === '—' ? '' : editingCustomer.phone,
      address: editingCustomer.address === '—' ? '' : editingCustomer.address,
      cccd: editingCustomer.cccd === '—' ? '' : editingCustomer.cccd,
      mail: editingCustomer.mail === '—' ? '' : editingCustomer.mail,
    }
  }, [editingCustomer])

  const employeeModalSeed = useMemo(() => {
    if (!editingEmployee) return null
    return {
      name: editingEmployee.name,
      phone: editingEmployee.phone === '—' ? '' : editingEmployee.phone,
      address: editingEmployee.address === '—' ? '' : editingEmployee.address,
      cccd: editingEmployee.cccd === '—' ? '' : editingEmployee.cccd,
      mail: editingEmployee.mail === '—' ? '' : editingEmployee.mail,
    }
  }, [editingEmployee])

  const renderCustomerVirtualRow = useCallback(
    (c) => {
      if (isHubMobileLayout) {
        return (
          <div className="ah-hub-entity-mobile-card ah-cust-mobile-card">
            <div className="ah-cust-mobile-card-title-row">
              <div className="ah-cust-mobile-card-title">{c.name || '—'}</div>
              <button
                type="button"
                className="ah-hub-entity-edit-btn"
                title="Sửa khách hàng"
                aria-label={`Sửa ${c.name || 'khách hàng'}`}
                onClick={() => openEditCustomerModal(c)}
              >
                ✎
              </button>
            </div>
            <div className="ah-cust-mobile-card-row">
              <span className="ah-cust-mobile-lbl">Số điện thoại</span>
              <span>{c.phone || '—'}</span>
            </div>
            <div className="ah-cust-mobile-card-row">
              <span className="ah-cust-mobile-lbl">Địa chỉ</span>
              <span>{c.address || '—'}</span>
            </div>
            <div className="ah-cust-mobile-card-row">
              <span className="ah-cust-mobile-lbl">CCCD</span>
              <span>{c.cccd || '—'}</span>
            </div>
            <div className="ah-cust-mobile-card-row">
              <span className="ah-cust-mobile-lbl">Mail</span>
              <span>{c.mail || '—'}</span>
            </div>
          </div>
        )
      }
      return (
        <div className="ah-cust-virt-row">
          <div className="ah-cust-virt-cell ah-cust-virt-name">{c.name}</div>
          <div className="ah-cust-virt-cell ah-cust-virt-phone">{c.phone || '—'}</div>
          <div className="ah-cust-virt-cell ah-cust-virt-addr ah-cust-virt-muted">{c.address || '—'}</div>
          <div className="ah-cust-virt-cell ah-cust-virt-cccd">{c.cccd || '—'}</div>
          <div className="ah-cust-virt-cell ah-cust-virt-mail ah-cust-virt-muted">{c.mail || '—'}</div>
          <div className="ah-cust-virt-cell ah-cust-virt-actions">
            <button
              type="button"
              className="ah-hub-entity-edit-btn"
              title="Sửa khách hàng"
              aria-label={`Sửa ${c.name || 'khách hàng'}`}
              onClick={() => openEditCustomerModal(c)}
            >
              ✎
            </button>
          </div>
        </div>
      )
    },
    [isHubMobileLayout, openEditCustomerModal]
  )

  const [staffQ, setStaffQ] = useState('')
  const staffDebounced = useDebounced(staffQ)
  const [staffRows, setStaffRows] = useState(STAFF_ROWS_DEFAULT)
  const staffRemoteFetchedOnceRef = useRef(false)
  const [staffRemoteLoading, setStaffRemoteLoading] = useState(false)

  useEffect(() => {
    if (activeTab !== TAB_STAFF) return
    if (staffRemoteFetchedOnceRef.current) return
    if (!isSupabaseConfigured()) {
      staffRemoteFetchedOnceRef.current = true
      setStaffRows(STAFF_ROWS_DEFAULT)
      return
    }
    let cancelled = false
    setStaffRemoteLoading(true)
    void (async () => {
      try {
        const remote = await fetchEmployeesFromSupabase()
        if (cancelled) return
        if (remote.length > 0) {
          setStaffRows(
            remote.map((r) => ({
              id: String(r.id ?? r.employee_id ?? '').trim(),
              name: r.name,
              phone: r.phone || '—',
              address: r.address || '—',
              cccd: r.cccd || '—',
              mail: r.mail || '—',
            }))
          )
        } else {
          setStaffRows(STAFF_ROWS_DEFAULT)
        }
        staffRemoteFetchedOnceRef.current = true
      } catch (e) {
        console.warn('[AdminHub] Tải nhân viên (employees)', e)
        if (!cancelled) {
          setStaffRows(STAFF_ROWS_DEFAULT)
          staffRemoteFetchedOnceRef.current = true
        }
      } finally {
        if (!cancelled) setStaffRemoteLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTab])

  const staffFiltered = useMemo(() => {
    const q = staffDebounced.trim().toLowerCase()
    if (!q) return staffRows
    return staffRows.filter(
      (r) =>
        String(r.name || '')
          .toLowerCase()
          .includes(q) ||
        String(r.phone || '')
          .toLowerCase()
          .includes(q) ||
        String(r.address || '')
          .toLowerCase()
          .includes(q) ||
        String(r.cccd || '')
          .toLowerCase()
          .includes(q) ||
        String(r.mail || '')
          .toLowerCase()
          .includes(q)
    )
  }, [staffDebounced, staffRows])

  const sellHref = sellHomeHref()

  const inboundDetailTabOid = useMemo(() => parseInboundDetailTabId(activeTab), [activeTab])
  const inboundDetailOrderRow = useMemo(() => {
    if (!inboundDetailTabOid) return null
    return inboundOrders.find((o) => String(o.id) === String(inboundDetailTabOid)) ?? null
  }, [inboundDetailTabOid, inboundOrders])
  const inboundDetailDraftLines = inboundDetailTabOid
    ? inboundDetailLineDrafts[inboundDetailTabOid] ?? null
    : null
  const inboundDetailIsEditing = !!inboundDetailDraftLines

  useEffect(() => {
    if (openInboundDetailOrderIds.length === 0) return
    const validIds = new Set(inboundOrders.map((o) => String(o.id)))
    const invalid = openInboundDetailOrderIds.filter((id) => !validIds.has(String(id)))
    if (invalid.length === 0) return
    const nextOpen = openInboundDetailOrderIds.filter((id) => !invalid.includes(id))
    setOpenInboundDetailOrderIds(nextOpen)
    setInboundDetailLineDrafts((prev) => {
      const n = { ...prev }
      let ch = false
      for (const id of invalid) {
        if (n[id]) {
          delete n[id]
          ch = true
        }
      }
      return ch ? n : prev
    })
    setActiveTab((cur) => {
      const curOid = parseInboundDetailTabId(cur)
      if (curOid && invalid.includes(curOid)) {
        if (nextOpen.length > 0) return toInboundDetailTabId(nextOpen[nextOpen.length - 1])
        return TAB_ORDERS
      }
      return cur
    })
  }, [inboundOrders, openInboundDetailOrderIds])

  const posDetailTabOid = useMemo(() => parsePosOrderDetailTabId(activeTab), [activeTab])
  const posDetailOrderRow = useMemo(() => {
    if (!posDetailTabOid) return null
    return orders.find((o) => String(o.id) === String(posDetailTabOid)) ?? null
  }, [posDetailTabOid, orders])
  const posDetailNorm = useMemo(
    () =>
      posDetailOrderRow
        ? normalizePosOrder(posDetailOrderRow, catalogList, { preferStoredLineFinancials: true })
        : null,
    [posDetailOrderRow, catalogList]
  )
  const posDetailDraft = posDetailTabOid ? posDetailEditDrafts[posDetailTabOid] ?? null : null
  const posDetailIsEditing = !!posDetailDraft

  const posReturnDetailLedgerId = useMemo(() => parsePosReturnDetailTabId(activeTab), [activeTab])
  const posReturnDetailEntry = useMemo(() => {
    if (!posReturnDetailLedgerId) return null
    const arr = Array.isArray(returnDayLedger) ? returnDayLedger : []
    return arr.find((e) => String(e?.id) === String(posReturnDetailLedgerId)) ?? null
  }, [returnDayLedger, posReturnDetailLedgerId])

  const catalogFlatVariantsForPosAdd = useMemo(
    () =>
      (Array.isArray(catalogList) ? catalogList : []).flatMap((p) =>
        (p.groupVariants || [p]).map((v) => ({
          id: v.id,
          code: String(v.code || '').trim(),
          name: String(v.name || '').trim(),
          unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
        }))
      ),
    [catalogList]
  )

  useEffect(() => {
    if (loading) return
    if (openPosDetailOrderIds.length === 0) return
    const validIds = new Set(orders.map((o) => String(o.id)))
    const invalid = openPosDetailOrderIds.filter((id) => !validIds.has(String(id)))
    if (invalid.length === 0) return
    const nextOpen = openPosDetailOrderIds.filter((id) => !invalid.includes(id))
    setOpenPosDetailOrderIds(nextOpen)
    setPosDetailEditDrafts((prev) => {
      const n = { ...prev }
      let ch = false
      for (const id of invalid) {
        if (n[id]) {
          delete n[id]
          ch = true
        }
      }
      return ch ? n : prev
    })
    setActiveTab((cur) => {
      const curOid = parsePosOrderDetailTabId(cur)
      if (curOid && invalid.includes(curOid)) {
        if (nextOpen.length > 0) return toPosOrderDetailTabId(nextOpen[nextOpen.length - 1])
        return TAB_ORDERS
      }
      return cur
    })
  }, [loading, orders, openPosDetailOrderIds])

  useEffect(() => {
    if (openPosReturnDetailLedgerIds.length === 0) return
    const valid = new Set(
      (Array.isArray(returnDayLedger) ? returnDayLedger : []).map((e) => String(e?.id ?? ''))
    )
    const invalid = openPosReturnDetailLedgerIds.filter((id) => !valid.has(String(id)))
    if (invalid.length === 0) return
    const nextOpen = openPosReturnDetailLedgerIds.filter((id) => !invalid.includes(id))
    setOpenPosReturnDetailLedgerIds(nextOpen)
    setActiveTab((cur) => {
      const curLid = parsePosReturnDetailTabId(cur)
      if (curLid && invalid.includes(curLid)) {
        if (nextOpen.length > 0) return toPosReturnDetailTabId(nextOpen[nextOpen.length - 1])
        return TAB_OVERVIEW
      }
      return cur
    })
  }, [returnDayLedger, openPosReturnDetailLedgerIds])

  const adminHubNavTabs = useMemo(() => {
    let tabs = [...NAV_ITEMS]
    const ins = (idAfter, item) => {
      const j = tabs.findIndex((t) => t.id === idAfter)
      if (j < 0) return
      tabs = [...tabs.slice(0, j + 1), item, ...tabs.slice(j + 1)]
    }
    for (const vid of openProductVariantIds) {
      const ctx = findVariantContext(catalogList, vid)
      const v = ctx?.variants.find((x) => x.id === vid)
      const code = v ? String(v.code || '').trim() : ''
      const name = v ? String(v.name || '').trim() : ''
      const full = code && name ? `${code} — ${name}` : code || name || 'Chi tiết SP'
      const label = full.length > 56 ? `${full.slice(0, 53)}…` : full
      ins(TAB_STOCK_CHECK, { id: toSoloProductTabId(vid), label, soloCloseVariantId: vid })
    }
    if (inboundDraftSession) {
      ins(TAB_INBOUND, { id: TAB_INBOUND_DRAFT, label: 'Phiếu nhập mới' })
    }
    const ordIdx = tabs.findIndex((t) => t.id === TAB_ORDERS)
    if (ordIdx >= 0 && openInboundDetailOrderIds.length > 0) {
      const detailItems = openInboundDetailOrderIds.map((oid) => {
        const ord = inboundOrders.find((o) => String(o.id) === String(oid))
        const code = String(ord?.code ?? '').trim() || String(oid)
        const rawLabel = `Chi tiết ${code}`
        const label = rawLabel.length > 56 ? `${rawLabel.slice(0, 53)}…` : rawLabel
        return { id: toInboundDetailTabId(oid), label, detailCloseOrderId: oid }
      })
      tabs = [...tabs.slice(0, ordIdx + 1), ...detailItems, ...tabs.slice(ordIdx + 1)]
    }
    if (ordIdx >= 0 && openPosDetailOrderIds.length > 0) {
      const insertAt = ordIdx + 1 + openInboundDetailOrderIds.length
      const posItems = openPosDetailOrderIds.map((oid) => {
        const ord = orders.find((o) => String(o.id) === String(oid))
        const inv = String(ord?.invoiceNo ?? '').trim() || String(oid)
        const rawLabel = `Chi tiết ${inv}`
        const label = rawLabel.length > 56 ? `${rawLabel.slice(0, 53)}…` : rawLabel
        return { id: toPosOrderDetailTabId(oid), label, posDetailCloseOrderId: oid }
      })
      tabs = [...tabs.slice(0, insertAt), ...posItems, ...tabs.slice(insertAt)]
    }
    if (ordIdx >= 0 && openPosReturnDetailLedgerIds.length > 0) {
      const insertAt = ordIdx + 1 + openInboundDetailOrderIds.length + openPosDetailOrderIds.length
      const retItems = openPosReturnDetailLedgerIds.map((lid) => {
        const entry = (returnDayLedger || []).find((e) => String(e?.id) === String(lid))
        const srcInv =
          String(entry?.sourceInvoiceNo || '').trim() ||
          (() => {
            const ord = orders.find((o) => String(o.id) === String(entry?.orderId))
            return String(ord?.invoiceNo || '').trim()
          })() ||
          String(entry?.orderId || '').trim() ||
          '—'
        const rawLabel = `Chi tiết TH-${srcInv}`
        const label = rawLabel.length > 56 ? `${rawLabel.slice(0, 53)}…` : rawLabel
        return { id: toPosReturnDetailTabId(lid), label, posReturnDetailCloseLedgerId: lid }
      })
      tabs = [...tabs.slice(0, insertAt), ...retItems, ...tabs.slice(insertAt)]
    }
    return tabs
  }, [
    inboundDraftSession,
    openProductVariantIds,
    catalogList,
    openInboundDetailOrderIds,
    inboundOrders,
    openPosDetailOrderIds,
    openPosReturnDetailLedgerIds,
    returnDayLedger,
    orders,
  ])

  const adminHubActiveTabLabel =
    adminHubNavTabs.find((t) => t.id === activeTab)?.label ?? String(activeTab)

  return (
    <div
      className={`admin-hub${activeTab === TAB_GOODS ? ' admin-hub--goods-tab' : ''}${
        activeTab === TAB_STOCK_CHECK ? ' admin-hub--stock-check-tab' : ''
      }${activeTab === TAB_COST_ADJUST ? ' admin-hub--cost-adjust-tab' : ''}`}
    >
      <nav className="admin-hub-nav" aria-label="Menu quản trị">
        <AdminHubMobileChrome
          adminHubNavTabs={adminHubNavTabs}
          activeTab={activeTab}
          onAdminHubNavItemActivate={onAdminHubNavItemActivate}
          closeSoloProductTabByVariantId={closeSoloProductTabByVariantId}
          closeInboundDetailTabByOrderId={closeInboundDetailTabByOrderId}
          closePosDetailTabByOrderId={closePosDetailTabByOrderId}
          closePosReturnDetailTabByLedgerId={closePosReturnDetailTabByLedgerId}
        />
        <div className="admin-hub-nav-inner">
          <div className="admin-hub-nav-brand" title={RECEIPT_STORE_NAME}>
            <span className="admin-hub-nav-store">{RECEIPT_STORE_NAME}</span>
            <a
              className="admin-hub-nav-doanh-thu"
              href={getDoanhThuAbsUrl()}
              target="_blank"
              rel="noopener noreferrer"
              title="Mở báo cáo Doanh thu (/doanh-thu) trên tab mới"
            >
              Báo cáo /doanh-thu
            </a>
          </div>
          {adminHubNavTabs.map((it) =>
            it.soloCloseVariantId ? (
              <div
                key={it.id}
                className={`admin-hub-tab-pill${activeTab === it.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-hub-tab admin-hub-tab--in-pill"
                  onClick={() => onAdminHubNavItemActivate(it.id)}
                >
                  <span className="admin-hub-tab-label">{it.label}</span>
                </button>
                <button
                  type="button"
                  className="admin-hub-tab-x"
                  aria-label={`Đóng tab ${it.label}`}
                  title="Đóng tab"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    closeSoloProductTabByVariantId(it.soloCloseVariantId)
                  }}
                >
                  ×
                </button>
              </div>
            ) : it.detailCloseOrderId ? (
              <div
                key={it.id}
                className={`admin-hub-tab-pill${activeTab === it.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-hub-tab admin-hub-tab--in-pill"
                  onClick={() => onAdminHubNavItemActivate(it.id)}
                >
                  <span className="admin-hub-tab-label">{it.label}</span>
                </button>
                <button
                  type="button"
                  className="admin-hub-tab-x"
                  aria-label={`Đóng tab ${it.label}`}
                  title="Đóng tab"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    closeInboundDetailTabByOrderId(it.detailCloseOrderId)
                  }}
                >
                  ×
                </button>
              </div>
            ) : it.posDetailCloseOrderId ? (
              <div
                key={it.id}
                className={`admin-hub-tab-pill${activeTab === it.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-hub-tab admin-hub-tab--in-pill"
                  onClick={() => onAdminHubNavItemActivate(it.id)}
                >
                  <span className="admin-hub-tab-label">{it.label}</span>
                </button>
                <button
                  type="button"
                  className="admin-hub-tab-x"
                  aria-label={`Đóng tab ${it.label}`}
                  title="Đóng tab"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    closePosDetailTabByOrderId(it.posDetailCloseOrderId)
                  }}
                >
                  ×
                </button>
              </div>
            ) : it.posReturnDetailCloseLedgerId ? (
              <div
                key={it.id}
                className={`admin-hub-tab-pill${activeTab === it.id ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-hub-tab admin-hub-tab--in-pill"
                  onClick={() => onAdminHubNavItemActivate(it.id)}
                >
                  <span className="admin-hub-tab-label">{it.label}</span>
                </button>
                <button
                  type="button"
                  className="admin-hub-tab-x"
                  aria-label={`Đóng tab ${it.label}`}
                  title="Đóng tab"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    closePosReturnDetailTabByLedgerId(it.posReturnDetailCloseLedgerId)
                  }}
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                key={it.id}
                type="button"
                className={`admin-hub-tab${activeTab === it.id ? ' is-active' : ''}`}
                onClick={() => onAdminHubNavItemActivate(it.id)}
              >
                {it.label}
              </button>
            )
          )}
        </div>
        <a className="admin-hub-sell" href={sellHref} target="_blank" rel="noopener noreferrer">
          <svg
            className="admin-hub-sell-svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <circle cx="9" cy="20" r="1" />
            <circle cx="18" cy="20" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          Bán hàng
        </a>
      </nav>

      <main
        className={`admin-hub-main${
          activeTab === TAB_INBOUND_DRAFT ? ' admin-hub-main--inbound-draft' : ''
        }${isSoloProductTabId(activeTab) ? ' admin-hub-main--solo-product' : ''}${
          isInboundDetailTabId(activeTab) ? ' admin-hub-main--inbound-detail' : ''
        }${isPosOrderDetailTabId(activeTab) ? ' admin-hub-main--pos-order-detail' : ''
        }${isPosReturnDetailTabId(activeTab) ? ' admin-hub-main--pos-return-detail' : ''}${
          activeTab === TAB_GOODS ? ' admin-hub-main--goods' : ''
        }${activeTab === TAB_STOCK_CHECK ? ' admin-hub-main--stock-check' : ''}${
          activeTab === TAB_COST_ADJUST ? ' admin-hub-main--cost-adjust' : ''
        }`}
      >
        <AdminHubTabErrorBoundary tabLabel={adminHubActiveTabLabel}>
          <>
            {activeTab === TAB_STOCK_CHECK && (
              <AdminHubStockCheckPanel vouchers={stockCheckVouchers} />
            )}

            {activeTab === TAB_COST_ADJUST && (
              <AdminHubCostAdjustPanel vouchers={costAdjustVouchers} />
            )}

            {activeTab === TAB_OVERVIEW && (
              <AdminHubRevenuePanel
                revenueReadOnly={revenueReadOnly}
                orders={orders}
                loading={loading}
                ovRange={ovRange}
                setOvRange={setOvRange}
                ovFrom={ovFrom}
                ovTo={ovTo}
                setOvFrom={setOvFrom}
                setOvTo={setOvTo}
                showCustomDateRange={ovRange === RANGE_CUSTOM}
                ovFiltered={ovFiltered}
                ovRevenueTableRows={ovRevenueTableRows}
                ovStats={ovStats}
                selected={selected}
                setSelected={setSelected}
                rangePresets={RANGE_PRESETS}
                rangeLabels={RANGE_LABELS}
                onExport={handleExport}
                onClearAll={handleClearAll}
                onOpenPosReturnDetail={openPosReturnDetailTab}
                onDeleteOrder={handleDeleteOrder}
                deletingOrderId={deletingOrderId}
                isDeletingOrder={isDeletingOrder}
              />
            )}

            {activeTab === TAB_GOODS && (
          <section className="ah-goods-page" aria-labelledby="ah-goods-title">
            <input
              ref={standaloneImportRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="ah-goods-file-input"
              aria-hidden
              tabIndex={-1}
              onChange={onStandaloneCsv}
            />
            <h2 id="ah-goods-title" className="admin-hub-panel-title ah-goods-title">
              Hàng hóa
            </h2>
            {catalogDisplayName ? (
              <p className="admin-hub-muted ah-goods-file-meta">
                File: <strong>{catalogDisplayName}</strong> · {goodsRowsAll.length.toLocaleString('vi-VN')} dòng
                hiển thị
              </p>
            ) : (
              <p className="admin-hub-muted ah-goods-file-meta">
                Nhập file CSV từ <strong>Import file</strong> hoặc tải catalog từ màn <strong>Bán hàng</strong>.
              </p>
            )}

            {catalogSupabaseDirty && isSupabaseConfigured() && parentCatalogSupplied ? (
              <div className="ah-catalog-sync-banner" role="status">
                <span className="ah-catalog-sync-banner__text">
                  Đã chỉnh danh mục trên máy này — bấm «Đồng bộ Supabase» để ghi lên máy chủ.
                </span>
                <button
                  type="button"
                  className="ah-catalog-sync-banner__btn"
                  disabled={catalogSupabaseFlushBusy}
                  onClick={() => {
                    if (typeof onFlushCatalogToSupabase !== 'function') return
                    void onFlushCatalogToSupabase().catch((e) => {
                      console.warn('[AdminHub] Đồng bộ catalog', e)
                      window.alert(e instanceof Error ? e.message : String(e))
                    })
                  }}
                >
                  {catalogSupabaseFlushBusy ? 'Đang ghi…' : 'Đồng bộ Supabase'}
                </button>
              </div>
            ) : null}

            {hangHoaDeepLinkListScope === 'single' ? (
              <div className="ah-goods-deeplink-scope" role="status">
                <span>
                  Đang hiển thị sản phẩm: <strong>{hangHoaDeepLinkDisplayName || '—'}</strong>
                </span>
                <button type="button" className="ah-goods-deeplink-scope-btn" onClick={expandHangHoaGoodsListToFull}>
                  Xem tất cả hàng hóa
                </button>
              </div>
            ) : null}

            <div className="ah-goods-catalog-shell">
            <div className="ah-goods-toolbar ah-goods-toolbar--v2 ah-goods-catalog-toolbar">
              <div className="ah-goods-toolbar__row1 ah-goods-toolbar__row1--with-brand">
                <div className="ah-goods-toolbar__row1-search ah-goods-toolbar__row1-search--with-loc">
                  <div className="ah-goods-search-combo ah-goods-search-combo--clearable">
                    <input
                      className="ah-goods-search ah-goods-search--with-scan"
                      type="search"
                      placeholder="Tìm kiếm sản phẩm (mã, tên)…"
                      value={goodsQ}
                      onChange={(e) => {
                        const v = e.target.value
                        setGoodsQ(v)
                        if (v.trim()) setHangHoaDeepLinkListScope('all')
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return
                        e.preventDefault()
                        e.stopPropagation()
                        setGoodsQ('')
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {goodsQ.trim() !== '' ? (
                      <button
                        type="button"
                        className="ah-search-clear-btn ah-search-clear-btn--goods"
                        aria-label="Xóa ô tìm"
                        onClick={() => setGoodsQ('')}
                      >
                        ×
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ah-goods-search-scan barcode-scan-trigger"
                      aria-label="Quét mã vạch bằng camera"
                      title="Quét mã"
                      onClick={openGoodsBarcodeScan}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ah-goods-mobile-filter-open"
                    onClick={() => setGoodsMobileFiltersOpen(true)}
                  >
                    Lọc
                  </button>
                </div>
                <div className="ah-goods-toolbar__row1-brand" aria-label="Lọc thương hiệu">
                  <span className="ah-goods-filter-lbl" id="ah-goods-brand-lbl-mobile">
                    Thương hiệu
                  </span>
                  <div className="ah-inbound-ncc-input-wrap ah-inbound-ncc-input-wrap--combo ah-goods-toolbar-brand-wrap">
                    <InboundThuongHieuAutocomplete
                      id="ah-goods-toolbar-th-mobile"
                      value={goodsBrandKey}
                      onValueChange={(v) => {
                        setHangHoaDeepLinkListScope('all')
                        setGoodsBrandKey(String(v ?? '').trim())
                      }}
                      options={brandOptions}
                      placeholder="Tất cả thương hiệu…"
                      listMaxHeight={248}
                    />
                  </div>
                </div>
                <div className="ah-goods-toolbar__row1-actions">
                  <div className="ah-split-create" ref={goodsCreateWrapRef}>
                    <button
                      type="button"
                      className="ah-split-create-main"
                      disabled={revenueReadOnly}
                      title={
                        revenueReadOnly
                          ? 'Chỉ Admin / Chủ cửa hàng mới thêm hàng hóa'
                          : 'Tạo hàng hóa mới'
                      }
                      onClick={openGoodsCreateModal}
                    >
                      + Tạo mới
                    </button>
                    <button
                      type="button"
                      className="ah-split-create-caret"
                      disabled={revenueReadOnly}
                      aria-expanded={goodsCreateOpen}
                      aria-haspopup="menu"
                      aria-label="Mở lựa chọn loại tạo mới"
                      onClick={() => !revenueReadOnly && setGoodsCreateOpen((o) => !o)}
                    >
                      ▾
                    </button>
                    {goodsCreateOpen && (
                      <div className="ah-split-create-menu ah-split-create-menu--toolbar-anchor" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setGoodsCreateOpen(false)
                            openGoodsCreateModal()
                          }}
                        >
                          Hàng hóa
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setGoodsCreateOpen(false)
                            openComboCreateModal()
                          }}
                        >
                          Combo — Đóng gói
                        </button>
                      </div>
                    )}
                  </div>
                  <button type="button" className="ah-goods-io-btn" onClick={handleGoodsImport}>
                    <span className="ah-goods-io-icon" aria-hidden>
                      ↑
                    </span>
                    Import file
                  </button>
                  <button type="button" className="ah-goods-io-btn" onClick={handleGoodsExport}>
                    <span className="ah-goods-io-icon" aria-hidden>
                      ↓
                    </span>
                    Xuất file
                  </button>
                  <button
                    type="button"
                    className="ah-goods-io-btn ah-goods-io-btn--danger"
                    onClick={handleGoodsDeleteSelected}
                    disabled={goodsSelectedIds.size === 0}
                  >
                    Xóa đã chọn
                  </button>
                </div>
              </div>

              {goodsMobileFiltersOpen ? (
                <button
                  type="button"
                  className="ah-goods-filter-drawer-backdrop"
                  aria-label="Đóng bộ lọc"
                  onClick={() => setGoodsMobileFiltersOpen(false)}
                />
              ) : null}
              <div
                className={`ah-goods-toolbar-filters ah-goods-toolbar-filters--row2 ah-goods-toolbar__row2 ah-goods-filters-drawer-target${
                  goodsMobileFiltersOpen ? ' is-open' : ''
                }`}
                aria-label="Bộ lọc danh mục"
              >
                <div className="ah-goods-filter-drawer-head">
                  <span className="ah-goods-filter-drawer-title">Bộ lọc</span>
                  <button
                    type="button"
                    className="ah-goods-filter-drawer-done"
                    onClick={() => setGoodsMobileFiltersOpen(false)}
                  >
                    Xong
                  </button>
                </div>
                <div className="ah-goods-toolbar-filters__grid">
                  <div className="ah-goods-filter-field ah-goods-filter-field--sort">
                    <label className="ah-goods-filter-lbl" htmlFor="ah-goods-list-sort">
                      Sắp xếp
                    </label>
                    <select
                      id="ah-goods-list-sort"
                      className="ah-inbound-form-input ah-goods-toolbar-select ah-goods-toolbar-select--row2"
                      aria-label="Sắp xếp danh sách hàng hóa"
                      value={goodsListSort}
                      onChange={(e) => setGoodsListSort(e.target.value)}
                    >
                      <option value="latest">Mới nhất</option>
                      <option value="az">Tên hàng (A -&gt; Z)</option>
                    </select>
                  </div>
                  <div className="ah-goods-filter-field">
                    <label className="ah-goods-filter-lbl" htmlFor="ah-goods-date-preset">
                      Ngày tạo
                    </label>
                    <select
                      id="ah-goods-date-preset"
                      className="ah-inbound-form-input ah-goods-toolbar-select ah-goods-toolbar-select--row2"
                      value={goodsDatePreset}
                      onChange={(e) => {
                        const v = e.target.value
                        setGoodsDatePreset(v)
                        setHangHoaDeepLinkListScope('all')
                        if (v !== 'custom') {
                          setGoodsDateFromStr('')
                          setGoodsDateToStr('')
                        }
                      }}
                    >
                      {GOODS_DATE_PRESET_OPTIONS.map((o) => (
                        <option key={o.id === '' ? '__all' : o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {goodsDatePreset === 'custom' ? (
                      <div className="ah-goods-date-custom">
                        <input
                          type="text"
                          className="ah-inbound-form-input ah-goods-date-input"
                          placeholder="Từ dd/mm/yyyy"
                          value={goodsDateFromStr}
                          onChange={(e) => {
                            setGoodsDateFromStr(e.target.value)
                            setHangHoaDeepLinkListScope('all')
                          }}
                          autoComplete="off"
                          spellCheck={false}
                          aria-label="Từ ngày (dd/mm/yyyy)"
                        />
                        <span className="ah-goods-date-sep" aria-hidden>
                          —
                        </span>
                        <input
                          type="text"
                          className="ah-inbound-form-input ah-goods-date-input"
                          placeholder="Đến dd/mm/yyyy"
                          value={goodsDateToStr}
                          onChange={(e) => {
                            setGoodsDateToStr(e.target.value)
                            setHangHoaDeepLinkListScope('all')
                          }}
                          autoComplete="off"
                          spellCheck={false}
                          aria-label="Đến ngày (dd/mm/yyyy)"
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="ah-goods-filter-field ah-goods-filter-field--brand ah-goods-filter-field--brand-drawer">
                    <span className="ah-goods-filter-lbl" id="ah-goods-brand-lbl">
                      Thương hiệu
                    </span>
                    <div className="ah-inbound-ncc-input-wrap ah-inbound-ncc-input-wrap--combo ah-goods-toolbar-brand-wrap">
                      <InboundThuongHieuAutocomplete
                        id="ah-goods-toolbar-th"
                        value={goodsBrandKey}
                        onValueChange={(v) => {
                          setHangHoaDeepLinkListScope('all')
                          setGoodsBrandKey(String(v ?? '').trim())
                        }}
                        options={brandOptions}
                        placeholder="Tất cả thương hiệu…"
                        listMaxHeight={248}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="admin-hub-table-wrap ah-goods-table-wrap ah-goods-table-wrap--virtual">
              <div className="ah-goods-catalog-head" role="row">
                <div className="ah-goods-vcell ah-goods-col-check ah-goods-catalog-th" role="columnheader">
                  <input
                    type="checkbox"
                    checked={goodsAllFilteredSelected}
                    onChange={toggleGoodsSelectAll}
                    aria-label="Chọn tất cả dòng đang hiển thị"
                    disabled={goodsRowsFiltered.length === 0}
                  />
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th" role="columnheader">
                  Mã hàng
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-goods-col-name" role="columnheader">
                  Tên hàng
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-goods-col-dvt" role="columnheader">
                  ĐVT (Đơn vị tính cơ bản)
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-goods-col-brand" role="columnheader">
                  Thương hiệu
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-num" role="columnheader">
                  Giá bán
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-num" role="columnheader">
                  Giá vốn
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-num" role="columnheader">
                  Tồn kho
                </div>
                <div className="ah-goods-vcell ah-goods-catalog-th ah-goods-col-time" role="columnheader">
                  Thời gian tạo
                </div>
              </div>
              {goodsRowsFiltered.length === 0 ? (
                <div className="ah-goods-empty-stack">
                  {catalogList.length === 0 ? (
                    <p className="ah-goods-loading-line" role="status">
                      Đang tải dữ liệu...
                    </p>
                  ) : null}
                  <div className="admin-hub-muted ah-goods-empty-inset">
                    {catalogList.length === 0
                      ? 'Chưa có dữ liệu hàng hóa. Dùng Import file hoặc nhập CSV ở màn Bán hàng.'
                      : 'Không có dòng nào khớp tìm kiếm hoặc bộ lọc (ngày tạo, thương hiệu).'}
                  </div>
                </div>
              ) : (
                <div className="ah-goods-virtual-host">
                  <AutoSizer
                    box="border-box"
                    renderProp={({ height, width }) => {
                      const w = Math.max(220, Math.floor(width ?? 1000))
                      const h = Math.max(280, Math.floor(height ?? 800))
                      return (
                        <AdminHubGoodsVirtualList
                          ref={goodsVirtualListApiRef}
                          height={h}
                          width={w}
                          rows={goodsRowsFiltered}
                          productQuickEditExpandId={inboundQuickEditExpandId}
                          goodsSelected={goodsSelected}
                          onOpenProductQuickEdit={openGoodsProductQuickEdit}
                          toggleGoodsSelect={toggleGoodsSelect}
                          onGoodsMobileDelete={handleGoodsMobileCardDelete}
                          listResetKey={`${goodsDeferred}|${goodsBrandKey}|${goodsDatePreset}|${goodsDateFromStr}|${goodsDateToStr}|${goodsListSort}|${goodsRowsFiltered.length}`}
                        />
                      )
                    }}
                  />
                </div>
              )}
            </div>
            </div>          </section>
        )}

        {activeTab === TAB_INBOUND && (
          <section className="ah-inbound-page" aria-labelledby="ah-inbound-title">
            <h2 id="ah-inbound-title" className="admin-hub-panel-title ah-inbound-title">
              Nhập hàng
            </h2>
            <p className="admin-hub-muted ah-inbound-meta">
              Danh sách phiếu nhập — ưu tiên đồng bộ trực tiếp từ Supabase.
            </p>

            <input
              ref={inboundListImportRef}
              type="file"
              accept=".csv,text/csv"
              className="ah-goods-file-input"
              aria-hidden
              tabIndex={-1}
              onChange={handleInboundListImport}
            />
            <div className="ah-inbound-toolbar">
              <div className="ah-inbound-toolbar-left">
                <div className="ah-inbound-search-wrap">
                  <svg
                    className="ah-inbound-search-icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM21 21l-6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    className="ah-inbound-search"
                    type="search"
                    placeholder="Theo mã đơn, nhà cung cấp, trạng thái…"
                    value={inboundQ}
                    onChange={(e) => setInboundQ(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Tìm phiếu nhập"
                  />
                </div>
              </div>
              <div className="ah-inbound-toolbar-right">
                <button type="button" className="ah-inbound-btn-create" onClick={openInboundCreateForm}>
                  + Tạo đơn nhập hàng
                </button>
                <button
                  type="button"
                  className="ah-goods-io-btn"
                  onClick={() => void refreshInboundInvoices()}
                  disabled={inboundRemoteLoading}
                  title="Tải lại danh sách phiếu nhập từ Supabase"
                >
                  {inboundRemoteLoading ? 'Đang làm mới…' : 'Làm mới'}
                </button>
                <button
                  type="button"
                  className="ah-goods-io-btn"
                  onClick={() => inboundListImportRef.current?.click()}
                >
                  <span className="ah-goods-io-icon" aria-hidden>
                    ↑
                  </span>
                  Import file
                </button>
                <button type="button" className="ah-goods-io-btn" onClick={handleInboundExportAll}>
                  <span className="ah-goods-io-icon" aria-hidden>
                    ↓
                  </span>
                  Xuất file
                </button>
              </div>
            </div>

            {inboundSelectedIds.size > 0 && (
              <div className="ah-inbound-bulk-bar" role="toolbar" aria-label="Thao tác đơn đã chọn">
                <span className="ah-inbound-bulk-count">
                  Đã chọn <strong>{inboundSelectedIds.size}</strong> đơn
                </span>
                <div className="ah-inbound-bulk-actions">
                  <button
                    type="button"
                    className="ah-goods-io-btn"
                    onClick={handleInboundExportSelected}
                  >
                    <span className="ah-goods-io-icon" aria-hidden>
                      ↓
                    </span>
                    Xuất file các đơn đã chọn
                  </button>
                  <button
                    type="button"
                    className="ah-goods-io-btn ah-goods-io-btn--danger"
                    onClick={handleInboundDeleteSelected}
                  >
                    <span className="ah-inbound-bulk-del-icon" aria-hidden>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
                          stroke="currentColor"
                          strokeWidth="1.85"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M10 11v6M14 11v6"
                          stroke="currentColor"
                          strokeWidth="1.85"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    Xóa đơn đã chọn
                  </button>
                </div>
              </div>
            )}

            <div className="admin-hub-table-wrap ah-inbound-table-wrap ah-responsive-table-wrap">
              <table className="admin-hub-table ah-inbound-table ah-responsive-table">
                <thead>
                  <tr>
                    <th className="ah-inbound-col-check">
                      <input
                        type="checkbox"
                        checked={inboundAllFilteredSelected}
                        onChange={toggleInboundSelectAll}
                        aria-label="Chọn tất cả đơn đang hiển thị"
                        disabled={inboundRowsFiltered.length === 0}
                      />
                    </th>
                    <th>Mã đơn nhập</th>
                    <th>Ngày nhập</th>
                    <th>Nhà cung cấp</th>
                    <th className="ah-num">Giá trị đơn</th>
                    <th>Trạng thái nhập</th>
                  </tr>
                </thead>
                <tbody>
                  {inboundRowsFiltered.length === 0 ? (
                    <tr className="ah-responsive-table-empty">
                      <td colSpan={6} className="admin-hub-muted">
                        {inboundOrders.length === 0
                          ? 'Chưa có phiếu nhập.'
                          : 'Không có đơn khớp tìm kiếm.'}
                      </td>
                    </tr>
                  ) : (
                    inboundRowsFiltered.map((r) => (
                      <tr key={r.id} className="ah-responsive-table-card-row">
                        <td
                          className="ah-inbound-col-check"
                          data-label=""
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={!!inboundSelected[r.id]}
                            onChange={() => toggleInboundSelect(r.id)}
                            aria-label={`Chọn đơn ${r.code}`}
                          />
                        </td>
                        <td className="ah-inbound-code" data-label="Mã đơn nhập">
                          <button
                            type="button"
                            className="ah-inbound-code-link"
                            onClick={() => openInboundDetailTab(r)}
                          >
                            {r.code || '—'}
                          </button>
                        </td>
                        <td className="ah-inbound-time" data-label="Ngày nhập">
                          {new Date(r.createdAtMs).toLocaleString('vi-VN')}
                        </td>
                        <td data-label="Nhà cung cấp">{r.supplier || '—'}</td>
                        <td className="ah-num ah-inbound-value" data-label="Giá trị đơn">
                          {r.totalValue.toLocaleString('vi-VN')} đ
                        </td>
                        <td data-label="Trạng thái nhập">
                          <span
                            className={`ah-inbound-status ah-inbound-status--${r.status}`}
                            title={inboundStatusLabel(r.status)}
                          >
                            {inboundStatusLabel(r.status)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === TAB_ORDERS && (
          <section aria-labelledby="ah-ord-title">
            <h2 id="ah-ord-title" className="admin-hub-panel-title">
              Đơn hàng
            </h2>
            <p className="admin-hub-muted" style={{ marginTop: '-0.35rem', marginBottom: '0.65rem' }}>
              Đơn nhập kho (phiếu mua) và đơn bán hàng (POS) trên trình duyệt này.
            </p>
            <div className="admin-hub-chip-row" role="tablist" aria-label="Loại đơn hàng">
              <button
                type="button"
                className={`admin-hub-chip${ordersSubTab === 'inbound' ? ' is-active' : ''}`}
                onClick={() => setOrdersSubTab('inbound')}
              >
                Đơn nhập kho
              </button>
              <button
                type="button"
                className={`admin-hub-chip${ordersSubTab === 'pos' ? ' is-active' : ''}`}
                onClick={() => setOrdersSubTab('pos')}
              >
                Đơn bán (POS)
              </button>
            </div>

            {ordRange === RANGE_CUSTOM && (
              <div
                className="admin-hub-date-row ah-revenue-date-row"
                role="group"
                aria-label="Khoảng ngày tùy chọn"
              >
                <label>
                  Từ
                  <input
                    type="date"
                    className="admin-hub-date-input"
                    value={ordFrom}
                    onChange={(e) => setOrdFrom(e.target.value)}
                  />
                </label>
                <label>
                  Đến
                  <input
                    type="date"
                    className="admin-hub-date-input"
                    value={ordTo}
                    onChange={(e) => setOrdTo(e.target.value)}
                  />
                </label>
              </div>
            )}

            <div
              className="ah-orders-list-toolbar"
              role="toolbar"
              aria-label="Tìm kiếm và lọc thời gian đơn hàng"
            >
              <div className="ah-orders-list-toolbar-left">
                {ordersSubTab === 'inbound' ? (
                  <div className="ah-inbound-search-wrap ah-orders-search-wrap">
                    <input
                      className="admin-hub-search"
                      type="search"
                      placeholder="Tìm theo mã đơn nhập, NCC, trạng thái…"
                      value={inboundQ}
                      onChange={(e) => setInboundQ(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Tìm phiếu nhập"
                    />
                  </div>
                ) : (
                  <div className="ah-orders-search-wrap">
                    <input
                      className="admin-hub-search"
                      type="search"
                      placeholder="Tìm theo mã đơn hàng…"
                      value={ordQ}
                      onChange={(e) => setOrdQ(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Tìm đơn bán POS"
                    />
                  </div>
                )}
              </div>
              <div className="ah-orders-list-toolbar-right">
                <div className="ah-orders-time-dd" ref={ordersTimeDdRef}>
                  <button
                    type="button"
                    className={`admin-hub-chip ah-orders-time-dd-trigger${ordersDateDdOpen ? ' is-dd-open' : ''}`}
                    id="ah-orders-time-dd-trigger"
                    aria-expanded={ordersDateDdOpen}
                    aria-haspopup="menu"
                    onClick={() => setOrdersDateDdOpen((o) => !o)}
                  >
                    <span className="ah-orders-time-dd-trigger-text">{ordersRangeTriggerLabel}</span>
                    <span className="ah-orders-time-dd-chevron" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {ordersDateDdOpen && (
                    <div
                      className="ah-orders-time-dd-menu"
                      role="menu"
                      aria-labelledby="ah-orders-time-dd-trigger"
                    >
                      {RANGE_PRESETS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="menuitem"
                          className={`ah-orders-time-dd-item${ordRange === k ? ' is-active' : ''}`}
                          onClick={() => pickOrdersRange(k)}
                        >
                          {k === RANGE_CUSTOM ? ORDERS_TAB_CUSTOM_RANGE_LABEL : RANGE_LABELS[k]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ah-orders-toolbar-meta dash-toolbar-meta" aria-live="polite">
                  <strong>
                    {ordersSubTab === 'inbound'
                      ? inboundDateFilteredForOrdersTab.length
                      : ordFiltered.length}
                  </strong>
                  {' đơn'}
                  <span className="ah-orders-toolbar-meta-sep"> · </span>
                  <strong>
                    {(ordersSubTab === 'inbound' ? ordersTabInboundTotal : ordersTabPosTotal).toLocaleString(
                      'vi-VN'
                    )}
                  </strong>
                  {' đ'}
                </div>
              </div>
            </div>

            {ordersSubTab === 'inbound' && (
              <>
                <div className="admin-hub-table-wrap ah-inbound-table-wrap ah-responsive-table-wrap">
                  <table className="admin-hub-table ah-inbound-table ah-responsive-table">
                    <thead>
                      <tr>
                        <th>Mã đơn nhập</th>
                        <th>Ngày nhập</th>
                        <th>Nhà cung cấp</th>
                        <th className="ah-num">Giá trị đơn</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboundRowsOrdersTab.length === 0 ? (
                        <tr className="ah-responsive-table-empty">
                          <td colSpan={5} className="admin-hub-muted">
                            {inboundOrders.length === 0
                              ? 'Chưa có phiếu nhập.'
                              : inboundDateFilteredForOrdersTab.length === 0
                                ? 'Không có phiếu nhập trong khoảng thời gian đang chọn.'
                                : 'Không có phiếu khớp tìm kiếm.'}
                          </td>
                        </tr>
                      ) : (
                        inboundRowsOrdersTab.map((r) => (
                          <tr key={r.id} className="ah-responsive-table-card-row">
                            <td className="ah-inbound-code" data-label="Mã đơn nhập">
                              <button
                                type="button"
                                className="ah-inbound-code-link"
                                onClick={() => openInboundDetailTab(r)}
                              >
                                {r.code || '—'}
                              </button>
                            </td>
                            <td className="ah-inbound-time" data-label="Ngày nhập">
                              {new Date(r.createdAtMs).toLocaleString('vi-VN')}
                            </td>
                            <td data-label="Nhà cung cấp">{r.supplier || '—'}</td>
                            <td className="ah-num ah-inbound-value" data-label="Giá trị đơn">
                              {r.totalValue.toLocaleString('vi-VN')} đ
                            </td>
                            <td data-label="Trạng thái">
                              <span
                                className={`ah-inbound-status ah-inbound-status--${r.status}`}
                                title={inboundStatusLabel(r.status)}
                              >
                                {inboundStatusLabel(r.status)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {ordersSubTab === 'pos' && (
              <>
                <div className="admin-hub-table-wrap ah-responsive-table-wrap">
                  <table className="admin-hub-table ah-responsive-table">
                    <thead>
                      <tr>
                        <th>Mã đơn</th>
                        <th>Thời gian</th>
                        <th className="ah-orders-th-customer">Khách hàng</th>
                        <th>Trạng thái</th>
                        <th className="ah-num">Tổng tiền</th>
                        <th className="ah-num">Lợi nhuận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr className="ah-responsive-table-empty">
                          <td colSpan={6} className="admin-hub-muted">
                            Đang tải…
                          </td>
                        </tr>
                      ) : ordList.length === 0 ? (
                        <tr className="ah-responsive-table-empty">
                          <td colSpan={6} className="admin-hub-muted">
                            {orders.length === 0
                              ? 'Chưa có đơn bán.'
                              : ordFiltered.length === 0
                                ? 'Không có đơn bán trong khoảng thời gian đang chọn.'
                                : 'Không có đơn khớp mã tìm kiếm.'}
                          </td>
                        </tr>
                      ) : (
                        ordList.map((raw) => {
                          const rowStatus = ['completed', 'returned_partial', 'returned_full', 'cancelled'].includes(
                            raw.status
                          )
                            ? raw.status
                            : computePosOrderStatusFromItems(raw.items)
                          const rowTotal = safeMoney(raw.total)
                          const rowProfit = Number.isFinite(Number(raw.totalProfit))
                            ? safeMoney(raw.totalProfit)
                            : safeMoney(orderTotalProfit(raw))
                          return (
                          <tr key={raw.id} className="ah-responsive-table-card-row">
                            <td data-label="Mã đơn">
                              <button
                                type="button"
                                className="ah-inbound-code-link"
                                onClick={() => openPosDetailTab(raw)}
                              >
                                {raw.invoiceNo || '—'}
                              </button>
                            </td>
                            <td data-label="Thời gian">{new Date(raw.createdAt).toLocaleString('vi-VN')}</td>
                            <td className="ah-orders-cell-customer" data-label="Khách hàng">
                              {formatPosOrderCustomerDisplay(raw)}
                            </td>
                            <td data-label="Trạng thái">
                              <span
                                className={`ah-inbound-status ah-inbound-status--${rowStatus === 'cancelled' ? 'cancelled' : rowStatus === 'returned_full' ? 'returned_full' : rowStatus === 'returned_partial' ? 'returned_partial' : 'completed'}`}
                                title={posOrderStatusLabel(rowStatus)}
                              >
                                {posOrderStatusLabel(rowStatus)}
                              </span>
                            </td>
                            <td className="ah-num" data-label="Tổng tiền">
                              {rowTotal.toLocaleString('vi-VN')} đ
                            </td>
                            <td className="ah-num" data-label="Lợi nhuận">
                              {rowProfit.toLocaleString('vi-VN')} đ
                            </td>
                          </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === TAB_CUSTOMERS && (
          <section aria-labelledby="ah-cust-title">
            <h2 id="ah-cust-title" className="admin-hub-panel-title">
              Khách hàng
            </h2>
            <div className="admin-hub-toolbar ah-hub-toolbar-split">
              <input
                className="admin-hub-search ah-hub-toolbar-search"
                type="search"
                placeholder="Tìm theo họ tên, SĐT, địa chỉ, CCCD, mail…"
                value={custQ}
                onChange={(e) => setCustQ(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="ah-hub-add-entity-btn"
                onClick={openAddCustomerModal}
                title="Thêm khách hàng mới"
              >
                + Thêm khách hàng mới
              </button>
            </div>
            <div className="admin-hub-table-wrap ah-cust-table-wrap">
              {customersRemoteLoading && isSupabaseConfigured() ? (
                <table className="admin-hub-table ah-cust-status-table">
                  <tbody>
                    <tr>
                      <td colSpan={5} className="admin-hub-muted">
                        Đang tải danh sách từ Supabase (một lần)…
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : custFiltered.length === 0 ? (
                <table className="admin-hub-table ah-cust-status-table">
                  <tbody>
                    <tr>
                      <td colSpan={5} className="admin-hub-muted">
                        {customers.length === 0
                          ? 'Chưa có khách — thêm mới hoặc đồng bộ từ Supabase.'
                          : 'Không có khách khớp tìm kiếm.'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : isHubMobileLayout ? (
                <div className="ah-hub-entity-mobile-list">
                  {custFiltered.map((c, i) => (
                    <div key={`${c.id || c.name}-${c.phone}-${i}`} className="ah-hub-entity-mobile-card ah-cust-mobile-card">
                      <div className="ah-cust-mobile-card-title-row">
                        <div className="ah-cust-mobile-card-title">{c.name || '—'}</div>
                        <button
                          type="button"
                          className="ah-hub-entity-edit-btn"
                          title="Sửa khách hàng"
                          aria-label={`Sửa ${c.name || 'khách hàng'}`}
                          onClick={() => openEditCustomerModal(c)}
                        >
                          ✎
                        </button>
                      </div>
                      <div className="ah-cust-mobile-card-row">
                        <span className="ah-cust-mobile-lbl">Số điện thoại</span>
                        <span>{c.phone || '—'}</span>
                      </div>
                      <div className="ah-cust-mobile-card-row">
                        <span className="ah-cust-mobile-lbl">Địa chỉ</span>
                        <span>{c.address || '—'}</span>
                      </div>
                      <div className="ah-cust-mobile-card-row">
                        <span className="ah-cust-mobile-lbl">CCCD</span>
                        <span>{c.cccd || '—'}</span>
                      </div>
                      <div className="ah-cust-mobile-card-row">
                        <span className="ah-cust-mobile-lbl">Mail</span>
                        <span>{c.mail || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : custFiltered.length > 120 ? (
                <div className="ah-cust-virt-host">
                  {!isHubMobileLayout ? (
                    <div className="ah-cust-virt-header" aria-hidden>
                      <span>Họ tên</span>
                      <span>Số điện thoại</span>
                      <span>Địa chỉ</span>
                      <span>Số CCCD</span>
                      <span>Mail</span>
                      <span>Thao tác</span>
                    </div>
                  ) : null}
                  <AutoSizer>
                    {({ height, width }) => (
                      <SimpleVirtualList
                        height={height}
                        width={width}
                        rows={custFiltered}
                        rowHeight={isHubMobileLayout ? 148 : 52}
                        renderRow={renderCustomerVirtualRow}
                        overscanCount={12}
                      />
                    )}
                  </AutoSizer>
                </div>
              ) : (
                <table className="admin-hub-table ah-responsive-table ah-cust-data-table">
                  <thead>
                    <tr>
                      <th>Họ tên</th>
                      <th>Số điện thoại</th>
                      <th>Địa chỉ</th>
                      <th>Số CCCD</th>
                      <th>Mail</th>
                      <th aria-label="Thao tác" />
                    </tr>
                  </thead>
                  <tbody>
                    {custFiltered.map((c, i) => (
                      <tr key={`${c.id || c.name}-${c.phone}-${i}`} className="ah-responsive-table-card-row">
                        <td data-label="Họ tên">{c.name}</td>
                        <td data-label="Số điện thoại">{c.phone || '—'}</td>
                        <td data-label="Địa chỉ">{c.address || '—'}</td>
                        <td data-label="Số CCCD">{c.cccd || '—'}</td>
                        <td data-label="Mail">{c.mail || '—'}</td>
                        <td data-label="Thao tác">
                          <button
                            type="button"
                            className="ah-hub-entity-edit-btn"
                            title="Sửa khách hàng"
                            aria-label={`Sửa ${c.name || 'khách hàng'}`}
                            onClick={() => openEditCustomerModal(c)}
                          >
                            ✎
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}

        {activeTab === TAB_STAFF && (
          <section aria-labelledby="ah-staff-title">
            <h2 id="ah-staff-title" className="admin-hub-panel-title">
              Nhân viên
            </h2>
            <div className="admin-hub-toolbar ah-hub-toolbar-split">
              <input
                className="admin-hub-search ah-hub-toolbar-search"
                type="search"
                placeholder="Tìm trong danh sách…"
                value={staffQ}
                onChange={(e) => setStaffQ(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="ah-hub-add-entity-btn"
                onClick={openAddEmployeeModal}
                title="Thêm nhân viên"
              >
                + Thêm nhân viên
              </button>
            </div>
            <div className="admin-hub-table-wrap ah-staff-table-wrap">
              <table className="admin-hub-table ah-hub-voucher-table ah-staff-hub-table">
                <thead>
                  <tr>
                    <th>Họ tên / Vai trò</th>
                    <th>Số điện thoại</th>
                    <th>Địa chỉ</th>
                    <th>Số CCCD</th>
                    <th>Mail</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {staffRemoteLoading && isSupabaseConfigured() ? (
                    <tr className="ah-hub-voucher-empty-row">
                      <td colSpan={6} className="admin-hub-muted">
                        Đang tải danh sách từ Supabase (một lần)…
                      </td>
                    </tr>
                  ) : staffFiltered.length === 0 ? (
                    <tr className="ah-hub-voucher-empty-row">
                      <td colSpan={6} className="admin-hub-muted">
                        Không có dòng khớp tìm kiếm.
                      </td>
                    </tr>
                  ) : (
                    staffFiltered.map((r, i) => (
                      <tr key={r.id || i} className="ah-hub-voucher-summary-row ah-hub-entity-mobile-card-row">
                        <td data-label="Họ tên / Vai trò">{r.name}</td>
                        <td data-label="Số điện thoại">{r.phone}</td>
                        <td data-label="Địa chỉ">{r.address}</td>
                        <td data-label="Số CCCD">{r.cccd}</td>
                        <td data-label="Mail">{r.mail}</td>
                        <td data-label="Thao tác">
                          <button
                            type="button"
                            className="ah-hub-entity-edit-btn"
                            title="Sửa nhân viên"
                            aria-label={`Sửa ${r.name || 'nhân viên'}`}
                            onClick={() => openEditEmployeeModal(r)}
                          >
                            ✎
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="admin-hub-muted" style={{ marginTop: '0.65rem' }}>
              Danh sách vai trò mặc định; có thể mở rộng lưu hồ sơ chi tiết trong phiên bản sau.
            </p>
          </section>
        )}

        {activeTab === TAB_SUPPLIER && <SupplierManager revenueReadOnly={revenueReadOnly} />}

        {isSoloProductTabId(activeTab) &&
          (soloGoodsCtx && soloGoodsVariant && soloGoodsDraft ? (
            <section className="ah-solo-product-root" aria-labelledby="ah-solo-product-title">
              <header className="ah-solo-product-head ah-solo-product-head--sticky">
                <div className="ah-solo-product-tabs-bar ah-hub-tabstrip--dark" aria-label="Điều hướng chi tiết sản phẩm">
                  <div className="ah-solo-product-tabstrip" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={soloGoodsUiTab === GOODS_DETAIL_VIEW_TONKHO}
                      className={`ah-solo-product-tab${soloGoodsUiTab === GOODS_DETAIL_VIEW_TONKHO ? ' is-active' : ''}`}
                      onClick={() => setSoloGoodsUiTab(GOODS_DETAIL_VIEW_TONKHO)}
                    >
                      Mô tả
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={soloGoodsUiTab === GOODS_DETAIL_VIEW_LICHSU}
                      className={`ah-solo-product-tab${soloGoodsUiTab === GOODS_DETAIL_VIEW_LICHSU ? ' is-active' : ''}`}
                      onClick={() => setSoloGoodsUiTab(GOODS_DETAIL_VIEW_LICHSU)}
                    >
                      Lịch sử kho
                    </button>
                    {soloGoodsCtx?.product && shouldShowComboBomTab(soloGoodsCtx.product) ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={soloGoodsUiTab === GOODS_DETAIL_VIEW_COMBO}
                        className={`ah-solo-product-tab${soloGoodsUiTab === GOODS_DETAIL_VIEW_COMBO ? ' is-active' : ''}`}
                        onClick={() => setSoloGoodsUiTab(GOODS_DETAIL_VIEW_COMBO)}
                      >
                        Thành phần combo
                      </button>
                    ) : null}
                  </div>
                  <div
                    className="ah-solo-product-primary-tools ah-hub-tabstrip-tools--dark"
                    role="toolbar"
                    aria-label="Lưu và hủy thay đổi"
                  >
                    <button
                      type="button"
                      className="ah-solo-product-icon-btn ah-solo-product-icon-btn--discard"
                      onClick={discardSoloGoodsDraftChanges}
                      title="Hủy thay đổi (khôi phục từ danh mục)"
                    >
                      <svg className="ah-solo-product-tool-svg" viewBox="0 0 24 24" aria-hidden>
                        <path
                          fill="currentColor"
                          d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                        />
                      </svg>
                    </button>
                    <button type="button" className="ah-solo-product-icon-btn ah-solo-product-icon-btn--save" onClick={() => void saveSoloGoodsDetail()} title="Lưu">
                      ✓
                    </button>
                  </div>
                </div>
                <div className="ah-solo-product-head-row ah-solo-product-head-row--title ah-solo-product-head-row--below-tabs">
                  <h1 id="ah-solo-product-title" className="ah-solo-product-h1">
                    {String(soloGoodsDraft.name || soloGoodsVariant.name || '').trim() || '—'}
                  </h1>
                  <div className="ah-solo-product-head-tools" role="toolbar" aria-label="Thao tác">
                    <button type="button" className="ah-solo-product-icon-btn" onClick={copySoloGoodsDetail} title="Sao chép">
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="ah-solo-product-icon-btn ah-solo-product-icon-btn--danger"
                      onClick={deleteSoloGoodsVariant}
                      title="Xóa mặt hàng"
                    >
                      ×
                    </button>
                    <button type="button" className="ah-solo-product-close-tab" onClick={closeSoloProductTab}>
                      Đóng tab
                    </button>
                  </div>
                </div>
              </header>
              {soloGoodsUiTab === GOODS_DETAIL_VIEW_TONKHO && (
              <div className="ah-solo-product-body">
                <div className="ah-solo-product-photo" aria-label="Ảnh sản phẩm (placeholder)" />
                <div className="ah-solo-product-main">
                  {soloGoodsCtx.variants.length > 1 && (
                    <>
                      {(() => {
                        const ordered = sortVariantsSmallestUnitFirst(soloGoodsCtx.variants)
                        const baseV = ordered[0]
                        const rest = ordered.slice(1)
                        return (
                          <div
                            className="ah-goods-unit-smart-summary ah-goods-unit-smart-summary--solo"
                            role="region"
                            aria-label="Tóm tắt đơn vị"
                          >
                            <p className="ah-goods-unit-smart-summary__base">
                              <strong>Đơn vị cơ bản:</strong>{' '}
                              {normalizeCatalogUnitLabel(baseV.unitLabel)} · Mã{' '}
                              <span className="ah-muted-code">
                                {String(baseV.code || '').trim() || '—'}
                              </span>{' '}
                              · Giá bán{' '}
                              <strong>{Number(baseV.price || 0).toLocaleString('vi-VN')} đ</strong>
                            </p>
                            {rest.length > 0 && (
                              <>
                                <p className="ah-goods-unit-smart-summary__subhead">Đơn vị quy đổi</p>
                                <ul className="ah-goods-unit-smart-summary__list">
                                  {rest.map((vv) => (
                                    <li key={vv.id}>
                                      <button
                                        type="button"
                                        className={`ah-goods-unit-smart-summary__btn${
                                          vv.id === soloActiveVariantId ? ' is-active' : ''
                                        }`}
                                        onClick={() => applySoloGoodsVariantSelection(vv.id)}
                                      >
                                        <span className="ah-goods-unit-smart-summary__u">
                                          {normalizeCatalogUnitLabel(vv.unitLabel)}
                                        </span>
                                        <span className="ah-goods-unit-smart-summary__meta">
                                          {String(vv.code || '').trim() || '—'} —{' '}
                                          {Number(vv.price || 0).toLocaleString('vi-VN')} đ
                                          {vv.conversion != null && Number(vv.conversion) > 1
                                            ? ` · ×${vv.conversion}`
                                            : ''}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        )
                      })()}
                      <div className="ah-solo-product-unit-row">
                        <span className="ah-goods-detail-unit-label">Đang chỉnh</span>
                        <select
                          className="ah-goods-detail-unit-select"
                          value={soloActiveVariantId ?? ''}
                          onChange={(e) => applySoloGoodsVariantSelection(e.target.value)}
                        >
                          {soloGoodsCtx.variants.map((vv) => (
                            <option key={vv.id} value={vv.id}>
                              {normalizeCatalogUnitLabel(vv.unitLabel)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="ah-solo-product-grid">
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-code">
                        Mã hàng
                      </label>
                      <input
                        id="solo-gd-code"
                        className="ah-goods-card-input"
                        value={soloGoodsDraft.code}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, code: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-barcode">
                        Mã vạch
                      </label>
                      <input
                        id="solo-gd-barcode"
                        className="ah-goods-card-input ah-goods-card-input--barcode"
                        value={soloGoodsDraft.barcode}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, barcode: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field ah-solo-product-span-2">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-name">
                        Tên hàng
                      </label>
                      <input
                        id="solo-gd-name"
                        className="ah-goods-card-input"
                        value={soloGoodsDraft.name}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, name: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-unit">
                        ĐVT
                      </label>
                      <input
                        id="solo-gd-unit"
                        readOnly
                        className="ah-goods-card-input ah-goods-card-input--readonly"
                        value={normalizeCatalogUnitLabel(soloGoodsVariant?.unitLabel)}
                        title="Đổi ĐVT bằng cách chọn biến thể khác (nếu có)"
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-stock">
                        Tồn kho
                      </label>
                      <input
                        id="solo-gd-stock"
                        className="ah-goods-card-input ah-goods-card-input--num"
                        inputMode="decimal"
                        value={soloGoodsDraft.stockQty}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, stockQty: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-norm">
                        Tồn nhỏ nhất
                      </label>
                      <input
                        id="solo-gd-norm"
                        className="ah-goods-card-input ah-goods-card-input--num"
                        inputMode="decimal"
                        value={soloGoodsDraft.stockNormMin}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, stockNormMin: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-cost">
                        Giá vốn
                      </label>
                      <input
                        id="solo-gd-cost"
                        className="ah-goods-card-input ah-goods-card-input--num"
                        inputMode="numeric"
                        value={soloGoodsDraft.cost}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '')
                          const n = digits === '' ? 0 : parseInt(digits, 10)
                          patchSoloGoodsDraft((x) =>
                            x
                              ? {
                                  ...x,
                                  cost: digits === '' ? '' : formatMoneyDraftVi(n),
                                }
                              : x
                          )
                        }}
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-price">
                        Giá bán lẻ
                      </label>
                      <input
                        id="solo-gd-price"
                        className="ah-goods-card-input ah-goods-card-input--num"
                        inputMode="numeric"
                        value={soloGoodsDraft.price}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '')
                          const n = digits === '' ? 0 : parseInt(digits, 10)
                          patchSoloGoodsDraft((x) =>
                            x
                              ? {
                                  ...x,
                                  price: digits === '' ? '' : formatMoneyDraftVi(n),
                                }
                              : x
                          )
                        }}
                      />
                    </div>
                    <div className="ah-goods-card-field">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-wholesale">
                        Giá sỉ
                      </label>
                      <input
                        id="solo-gd-wholesale"
                        className="ah-goods-card-input ah-goods-card-input--num"
                        inputMode="numeric"
                        value={soloGoodsDraft.wholesalePrice ?? ''}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '')
                          const n = digits === '' ? 0 : parseInt(digits, 10)
                          patchSoloGoodsDraft((x) =>
                            x
                              ? {
                                  ...x,
                                  wholesalePrice: digits === '' ? '' : formatMoneyDraftVi(n),
                                }
                              : x
                          )
                        }}
                      />
                    </div>
                    <div className="ah-goods-card-field ah-solo-product-span-2">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-brand">
                        Thương hiệu
                      </label>
                      <input
                        id="solo-gd-brand"
                        className="ah-goods-card-input"
                        value={soloGoodsDraft.brand}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, brand: e.target.value } : x))
                        }
                      />
                    </div>
                    <div className="ah-goods-card-field ah-solo-product-span-2">
                      <label className="ah-goods-card-lbl" htmlFor="solo-gd-weight">
                        Trọng lượng
                      </label>
                      <input
                        id="solo-gd-weight"
                        className="ah-goods-card-input"
                        value={soloGoodsDraft.weightRaw}
                        onChange={(e) =>
                          patchSoloGoodsDraft((x) => (x ? { ...x, weightRaw: e.target.value } : x))
                        }
                      />
                    </div>
                  </div>
                  <div className="ah-goods-unit-modal-open-wrap ah-goods-unit-modal-open-wrap--solo">
                    <button
                      type="button"
                      className="ah-goods-unit-modal-open-link"
                      onClick={() => openSoloGoodsUnitModal()}
                    >
                      + Thêm đơn vị tính
                    </button>
                  </div>
                  {soloInventoryPreviewRows?.length ? (
                    <div
                      className="ah-goods-inventory-movement-preview ah-goods-inventory-movement-preview--solo"
                      aria-label="Lịch sử biến động kho — xem trước"
                    >
                      <h4 className="ah-goods-inventory-movement-preview__title">Lịch sử biến động</h4>
                      <p className="admin-hub-muted ah-goods-inventory-movement-preview__hint">
                        Tóm tắt gần nhất — đầy đủ trong tab «Lịch sử kho». Bấm mã (HD… / PN…) để mở chứng từ.
                      </p>
                      <div className="admin-hub-table-wrap">
                        <table className="admin-hub-table ah-solo-stock-table">
                          <thead>
                            <tr>
                              <th>Ngày</th>
                              <th>Nhân viên</th>
                              <th>Thao tác</th>
                              <th className="ah-num">Số lượng</th>
                              <th className="ah-num">Tồn kho</th>
                              <th>Mã chứng từ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {soloInventoryPreviewRows.map((pr) => (
                              <tr key={`spv-${pr.key}`}>
                                <td className="ah-solo-stock-cell-time">{pr.dateLabel}</td>
                                <td>{pr.staffNameLabel ?? pr.staff}</td>
                                <td>{pr.transactionTypeLabel ?? pr.action}</td>
                                <td
                                  className={`ah-num${
                                    pr.delta > 0
                                      ? ' ah-solo-stock-delta--pos'
                                      : pr.delta < 0
                                        ? ' ah-solo-stock-delta--neg'
                                        : ''
                                  }`}
                                >
                                  {pr.qtyLabel ?? pr.deltaLabel}
                                </td>
                                <td className="ah-num">{pr.stockAfterLabel ?? pr.balanceLabel}</td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  {pr.inventoryNavSource === 'supabase' && pr.inventoryDocClickable ? (
                                    <button
                                      type="button"
                                      className="ah-solo-stock-doc-link"
                                      onClick={() => handleInventoryLedgerDocActivate(pr)}
                                    >
                                      {pr.docNo}
                                    </button>
                                  ) : (
                                    pr.docNo
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              )}
              {soloGoodsUiTab === GOODS_DETAIL_VIEW_LICHSU && (
                <div className="ah-solo-product-stock-panel">
                  <p className="admin-hub-muted ah-solo-stock-lead">
                    Dữ liệu từ <strong>Supabase</strong> (mới nhất trước) khi có cấu hình; nếu không, dùng biến động ước
                    tính cục bộ. Đơn bán (HD…) / phiếu nhập (PN…) — bấm mã để xem chứng từ trong Hub.
                  </p>
                  <div className="ah-inv-ledger-filter-bar">
                    <div className="ah-inv-ledger-filter-field">
                      <label className="ah-inv-ledger-filter-lbl" htmlFor="ah-solo-inv-from">
                        Từ ngày
                      </label>
                      <input
                        id="ah-solo-inv-from"
                        type="date"
                        className="ah-goods-card-input ah-inv-ledger-filter-input"
                        value={soloInvLedgerDateFrom}
                        onChange={(e) => setSoloInvLedgerDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="ah-inv-ledger-filter-field">
                      <label className="ah-inv-ledger-filter-lbl" htmlFor="ah-solo-inv-to">
                        Đến ngày
                      </label>
                      <input
                        id="ah-solo-inv-to"
                        type="date"
                        className="ah-goods-card-input ah-inv-ledger-filter-input"
                        value={soloInvLedgerDateTo}
                        onChange={(e) => setSoloInvLedgerDateTo(e.target.value)}
                      />
                    </div>
                    <div className="ah-inv-ledger-filter-field ah-inv-ledger-filter-field--grow">
                      <label className="ah-inv-ledger-filter-lbl" htmlFor="ah-solo-inv-doc">
                        Mã chứng từ
                      </label>
                      <input
                        id="ah-solo-inv-doc"
                        type="search"
                        className="ah-goods-card-input ah-inv-ledger-filter-input"
                        placeholder="Tìm HD…, PN…"
                        value={soloInvLedgerDocSearch}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setSoloInvLedgerDocSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="admin-hub-table-wrap ah-solo-stock-table-wrap ah-solo-stock-table-wrap--bounded">
                    <table className="admin-hub-table ah-solo-stock-table">
                      <thead>
                        <tr>
                          <th>Ngày</th>
                          <th>Nhân viên</th>
                          <th>Thao tác</th>
                          <th>ĐVT giao dịch</th>
                          <th>Quy đổi</th>
                          <th className="ah-num">SL cơ bản</th>
                          <th className="ah-num">Tồn kho</th>
                          <th>Mã chứng từ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {soloMergedInventoryLedgerRows.mode === 'loading' ? (
                          <tr>
                            <td colSpan={8} className="admin-hub-muted">
                              Đang tải nhật ký từ Supabase…
                            </td>
                          </tr>
                        ) : soloMergedInventoryLedgerRows.rows?.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="admin-hub-muted">
                              Chưa có dòng nhật ký trên Supabase cho sản phẩm này (mọi đơn vị tính).
                            </td>
                          </tr>
                        ) : (
                          soloMergedInventoryLedgerRows.rows.map((row) => {
                            const detailUrl =
                              row.inventoryNavSource === 'supabase'
                                ? ''
                                : row.docLink
                                  ? getStockLedgerDetailAbsoluteUrl(row.docLink)
                                  : ''
                            return (
                              <tr key={row.key}>
                                <td className="ah-solo-stock-cell-time">{row.dateLabel}</td>
                                <td>{row.staffNameLabel ?? row.staff}</td>
                                <td>{row.transactionTypeLabel ?? row.action}</td>
                                <td
                                  className="ah-inv-ledger-unit-txn"
                                  title={row.unitConversionDetailLabel}
                                >
                                  {row.unitTxnLabel ?? '—'}
                                </td>
                                <td
                                  className="ah-inv-ledger-conversion"
                                  title={row.unitConversionDetailLabel}
                                >
                                  {row.conversionLabel ?? '—'}
                                </td>
                                <td
                                  className={`ah-num${
                                    row.delta > 0
                                      ? ' ah-solo-stock-delta--pos'
                                      : row.delta < 0
                                        ? ' ah-solo-stock-delta--neg'
                                        : ''
                                  }`}
                                >
                                  {row.qtyLabel ?? row.deltaLabel}
                                </td>
                                <td className="ah-num">{row.stockAfterLabel ?? row.balanceLabel}</td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  {detailUrl ? (
                                    <a
                                      className="ah-solo-stock-doc-link"
                                      href={detailUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Mở chi tiết chứng từ (tab mới)"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                      }}
                                    >
                                      {row.docNo}
                                    </a>
                                  ) : row.inventoryNavSource === 'supabase' && row.inventoryDocClickable ? (
                                    <button
                                      type="button"
                                      className="ah-solo-stock-doc-link"
                                      onClick={() => handleInventoryLedgerDocActivate(row)}
                                    >
                                      {row.docNo}
                                    </button>
                                  ) : (
                                    row.docNo
                                  )}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {soloGoodsUiTab === GOODS_DETAIL_VIEW_COMBO &&
                soloGoodsCtx?.product &&
                shouldShowComboBomTab(soloGoodsCtx.product) && (
                  <div className="ah-solo-product-stock-panel">
                    <AdminHubComboBomPanel
                      catalogList={catalogList}
                      comboProduct={soloGoodsCtx.product}
                      onEditComboProduct={() =>
                        setComboModal({ mode: 'edit', product: soloGoodsCtx.product })
                      }
                    />
                  </div>
                )}
            </section>
          ) : (
            <section className="ah-solo-product-root ah-solo-product-root--empty">
              <p className="admin-hub-muted">Không tìm thấy sản phẩm hoặc đang tải…</p>
              <button type="button" className="ah-solo-product-close-tab" onClick={closeSoloProductTab}>
                Đóng tab
              </button>
            </section>
          ))}

        {isInboundDetailTabId(activeTab) && (
            <section
              className={`ah-inbound-detail-page${inboundDetailIsEditing ? ' ah-inbound-detail-page--editing' : ''}`}
              aria-labelledby="ah-inbound-detail-title"
            >
              {!inboundDetailTabOid ? (
                <div className="ah-inbound-detail-missing">
                  <p className="admin-hub-muted">Tab không hợp lệ.</p>
                  <button type="button" className="ah-inbound-btn-create" onClick={() => onAdminHubNavItemActivate(TAB_ORDERS)}>
                    Về Đơn hàng
                  </button>
                </div>
              ) : inboundDetailOrderRow ? (
                <>
                  <header className="ah-inbound-detail-head">
                    <div className="ah-inbound-detail-head-main">
                      <h2 id="ah-inbound-detail-title" className="admin-hub-panel-title ah-inbound-detail-h2">
                        Chi tiết {inboundDetailOrderRow.code || '—'}
                      </h2>
                      <p className="admin-hub-muted ah-inbound-detail-meta">
                        {new Date(inboundDetailOrderRow.createdAtMs).toLocaleString('vi-VN')}
                        {' · '}
                        {inboundDetailOrderRow.supplier || '—'}
                        {' · '}
                        <strong>{inboundDetailOrderRow.totalValue.toLocaleString('vi-VN')} đ</strong>
                      </p>
                      <span
                        className={`ah-inbound-status ah-inbound-status--${inboundDetailOrderRow.status}`}
                        title={inboundStatusLabel(inboundDetailOrderRow.status)}
                      >
                        {inboundStatusLabel(inboundDetailOrderRow.status)}
                      </span>
                    </div>
                    <div className="ah-inbound-detail-tools" role="toolbar" aria-label="Thao tác phiếu nhập">
                      <button
                        type="button"
                        className="ah-inbound-row-act"
                        onClick={() => openInboundReturnModal(inboundDetailOrderRow)}
                        disabled={
                          inboundDetailIsEditing ||
                          inboundDetailOrderRow.status === 'cancelled' ||
                          !inboundOrderCanPartialReturn(inboundDetailOrderRow)
                        }
                      >
                        Hoàn trả
                      </button>
                      <button
                        type="button"
                        className="ah-inbound-row-act ah-inbound-row-act--danger"
                        onClick={() => requestInboundCancel(inboundDetailOrderRow)}
                        disabled={inboundDetailIsEditing || inboundDetailOrderRow.status === 'cancelled'}
                      >
                        Hủy đơn
                      </button>
                      <button
                        type="button"
                        className="ah-inbound-row-act ah-inbound-row-act--primary"
                        onClick={() => startInboundDetailEdit(inboundDetailOrderRow)}
                        disabled={inboundDetailIsEditing || inboundDetailOrderRow.status === 'cancelled'}
                      >
                        Sửa đơn
                      </button>
                    </div>
                  </header>
                  {inboundDetailIsEditing && (
                    <div className="ah-inbound-detail-edit-bar" role="group" aria-label="Hoàn tất chỉnh sửa">
                      <button
                        type="button"
                        className="ah-inbound-row-act"
                        onClick={() => clearInboundDetailEdit(inboundDetailTabOid)}
                      >
                        Hủy sửa
                      </button>
                      <button type="button" className="ah-inbound-btn-create" onClick={submitInboundDetailCommit}>
                        Hoàn thành
                      </button>
                    </div>
                  )}
                  <div className="admin-hub-table-wrap ah-inbound-table-wrap ah-inbound-detail-table-wrap ah-responsive-table-wrap ah-inbound-detail-lines-wrap">
                    <table className="admin-hub-table ah-inbound-table ah-inbound-detail-lines-table ah-responsive-table">
                      <colgroup>
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--stt" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--code" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--name" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--dvt" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--qty" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--price" />
                        <col className="ah-inbound-detail-col ah-inbound-detail-col--total" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="ah-inbound-ln-stt">STT</th>
                          <th>Mã hàng</th>
                          <th>Tên hàng</th>
                          <th>ĐVT</th>
                          <th className="ah-num">Số lượng</th>
                          <th className="ah-num">Đơn giá</th>
                          <th className="ah-num">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inboundDetailDraftLines ?? inboundDetailOrderRow.lines).length === 0 ? (
                          <tr className="ah-responsive-table-empty">
                            <td colSpan={7} className="admin-hub-muted">
                              Chưa có dòng hàng.
                            </td>
                          </tr>
                        ) : (
                          (inboundDetailDraftLines ?? inboundDetailOrderRow.lines).map((rawLn, idx) => {
                            const ln = normalizeInboundLine(rawLn)
                            const inboundDvtOptions = buildInboundDvtSelectOptions(catalogListForInbound, ln)
                            const inboundDvtLocked = inboundDvtOptions.length <= 1
                            const lineTotal = inboundLineTotal(ln)
                            return (
                              <tr
                                key={ln.lineId}
                                className="ah-responsive-table-card-row ah-inbound-detail-line-card"
                                data-inbound-line-id={ln.lineId}
                              >
                                <td className="ah-inbound-ln-stt ah-inbound-detail-line-stt">{idx + 1}</td>
                                <td data-label="Mã hàng">{renderInboundLineCodeLink(ln)}</td>
                                <td className="ah-inbound-detail-line-name" data-label="Tên hàng">
                                  {renderInboundLineNameButton(ln, openInboundProductQuickEdit, catalogListForInbound)}
                                </td>
                                <td className="ah-inbound-ln-dvt-cell" data-label="ĐVT">
                                  {inboundDetailIsEditing ? (
                                    <select
                                      className={`ah-inbound-dvt-select${
                                        inboundDvtLocked ? ' ah-inbound-dvt-select--locked' : ''
                                      }`}
                                      aria-label={`Đơn vị tính ${ln.name}`}
                                      disabled={inboundDvtLocked}
                                      value={normalizeCatalogUnitLabel(ln.unitLabel)}
                                      onChange={(e) =>
                                        changeInboundDetailDraftUnit(inboundDetailTabOid, ln, e.target.value)
                                      }
                                    >
                                      {inboundDvtOptions.map((opt) => (
                                        <option key={opt} value={opt}>
                                          {opt}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    normalizeCatalogUnitLabel(ln.unitLabel) || '—'
                                  )}
                                </td>
                                <td className="ah-num ah-inbound-detail-line-qty" data-label="Số lượng">
                                  <span className="ah-inbound-line-qty-price-mobile">
                                    {ln.qty.toLocaleString('vi-VN')} ×{' '}
                                    {ln.unitPrice.toLocaleString('vi-VN')} đ
                                  </span>
                                  <span className="ah-inbound-line-qty-desktop">
                                  {inboundDetailIsEditing ? (
                                    <input
                                      className="ah-inbound-cell-input ah-inbound-cell-input--qty ah-inbound-cell-input--soft"
                                      type="text"
                                      inputMode="numeric"
                                      aria-label={`Số lượng ${ln.name}`}
                                      value={ln.qty === 0 ? '' : String(ln.qty)}
                                      onFocus={selectInboundInputOnFocus}
                                      onChange={(e) => {
                                        const raw = e.target.value.replace(/[^\d.]/g, '')
                                        const n =
                                          raw === ''
                                            ? 0
                                            : Math.max(0, parseFloat(raw.replace(/,/g, '.')) || 0)
                                        updateInboundDetailDraftLine(inboundDetailTabOid, ln.lineId, { qty: n })
                                      }}
                                    />
                                  ) : (
                                    ln.qty.toLocaleString('vi-VN')
                                  )}
                                  </span>
                                </td>
                                <td className="ah-num ah-inbound-detail-line-price" data-label="Đơn giá">
                                  <span className="ah-inbound-line-qty-desktop">
                                  {inboundDetailIsEditing ? (
                                    <input
                                      className="ah-inbound-cell-input ah-inbound-cell-input--soft"
                                      type="text"
                                      inputMode="decimal"
                                      aria-label={`Đơn giá ${ln.name}`}
                                      value={formatMoneyDraftVi(ln.unitPrice)}
                                      onFocus={selectInboundInputOnFocus}
                                      onChange={(e) =>
                                        updateInboundDetailDraftLine(inboundDetailTabOid, ln.lineId, {
                                          unitPrice: parseMoneyDraftVi(e.target.value),
                                        })
                                      }
                                    />
                                  ) : (
                                    `${ln.unitPrice.toLocaleString('vi-VN')} đ`
                                  )}
                                  </span>
                                </td>
                                <td className="ah-num ah-inbound-detail-line-sum" data-label="Thành tiền">
                                  {lineTotal.toLocaleString('vi-VN')} đ
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="ah-inbound-detail-missing">
                  <p className="admin-hub-muted">Không tìm thấy phiếu nhập này (có thể đã bị xóa).</p>
                  <button
                    type="button"
                    className="ah-inbound-btn-create"
                    onClick={() => closeInboundDetailTabByOrderId(inboundDetailTabOid)}
                  >
                    Đóng tab
                  </button>
                </div>
              )}
            </section>
          )}

        {isPosOrderDetailTabId(activeTab) && (
          <section className="ah-inbound-detail-page ah-pos-order-detail-page" aria-labelledby="ah-pos-ord-title">
            {!posDetailTabOid ? (
              <div className="ah-inbound-detail-missing">
                <p className="admin-hub-muted">Tab không hợp lệ.</p>
                <button type="button" className="ah-inbound-btn-create" onClick={() => onAdminHubNavItemActivate(TAB_ORDERS)}>
                  Về Đơn hàng
                </button>
              </div>
            ) : posDetailNorm ? (
              <>
                <header className="ah-inbound-detail-head">
                  <div className="ah-inbound-detail-head-main">
                    <h2 id="ah-pos-ord-title" className="admin-hub-panel-title ah-inbound-detail-h2">
                      Chi tiết {posDetailNorm.invoiceNo || '—'}
                    </h2>
                    <p className="admin-hub-muted ah-inbound-detail-meta">
                      {new Date(posDetailNorm.createdAt).toLocaleString('vi-VN')}
                      {posDetailNorm.customerName ? ` · ${posDetailNorm.customerName}` : ''}
                      {' · '}
                      <strong>{Number(posDetailNorm.total).toLocaleString('vi-VN')} đ</strong>
                      {' · LN '}
                      <strong>{Number(posDetailNorm.totalProfit).toLocaleString('vi-VN')} đ</strong>
                    </p>
                    <span
                      className={`ah-inbound-status ah-inbound-status--${
                        posDetailNorm.status === 'cancelled'
                          ? 'cancelled'
                          : posDetailNorm.status === 'returned_full'
                            ? 'returned_full'
                            : posDetailNorm.status === 'returned_partial'
                              ? 'returned_partial'
                              : 'completed'
                      }`}
                      title={posOrderStatusLabel(posDetailNorm.status)}
                    >
                      {posOrderStatusLabel(posDetailNorm.status)}
                    </span>
                  </div>
                  <div className="ah-inbound-detail-tools" role="toolbar" aria-label="Thao tác đơn bán POS">
                    <button
                      type="button"
                      className="ah-inbound-row-act ah-inbound-row-act--primary"
                      onClick={() => startPosDetailEdit(posDetailNorm)}
                      disabled={
                        revenueReadOnly ||
                        posDetailIsEditing ||
                        posDetailNorm.status === 'cancelled'
                      }
                    >
                      Sửa đơn
                    </button>
                    <button
                      type="button"
                      className="ah-inbound-row-act ah-inbound-row-act--danger"
                      onClick={() => requestPosCancel(posDetailNorm)}
                      disabled={revenueReadOnly || posDetailIsEditing || posDetailNorm.status === 'cancelled'}
                    >
                      Hủy đơn
                    </button>
                    <button
                      type="button"
                      className="ah-inbound-row-act"
                      onClick={() => openPosReturnModal(posDetailNorm)}
                      disabled={revenueReadOnly || posDetailIsEditing || posDetailNorm.status === 'cancelled'}
                    >
                      Hoàn trả
                    </button>
                  </div>
                </header>
                {posDetailIsEditing && posDetailTabOid && (
                  <div className="ah-inbound-detail-edit-bar" role="group" aria-label="Hoàn tất chỉnh sửa đơn POS">
                    <select
                      className="ah-inbound-dvt-select ah-pos-order-add-select"
                      aria-label="Thêm món từ danh mục"
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) addPosDetailLineFromVariantId(posDetailTabOid, v)
                        e.target.value = ''
                      }}
                    >
                      <option value="" disabled>
                        + Thêm món từ danh mục…
                      </option>
                      {catalogFlatVariantsForPosAdd.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.code || '—'} — {v.name || '—'} ({v.unitLabel || '—'})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="ah-inbound-row-act"
                      onClick={() => clearPosDetailEdit(posDetailTabOid)}
                    >
                      Hủy sửa
                    </button>
                    <button type="button" className="ah-inbound-btn-create" onClick={submitPosDetailEditCommit}>
                      Hoàn thành
                    </button>
                  </div>
                )}
                <div className="admin-hub-table-wrap ah-inbound-table-wrap ah-inbound-detail-table-wrap ah-responsive-table-wrap ah-pos-order-lines-wrap">
                  <table className="admin-hub-table ah-inbound-table ah-inbound-detail-lines-table ah-responsive-table">
                    <thead>
                      <tr>
                        <th className="ah-inbound-ln-stt">STT</th>
                        <th>Mã hàng</th>
                        <th>Tên hàng</th>
                        <th>ĐVT</th>
                        <th className="ah-num">Số lượng</th>
                        <th className="ah-num">Đơn giá bán</th>
                        <th className="ah-num">Giá vốn</th>
                        <th className="ah-num">Thành tiền</th>
                        {!posDetailIsEditing ? (
                          <th className="ah-num">Đã hoàn</th>
                        ) : (
                          <th aria-label="Xóa dòng" />
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(posDetailDraft ?? posDetailNorm).items.length === 0 ? (
                        <tr className="ah-responsive-table-empty">
                          <td colSpan={posDetailIsEditing ? 9 : 9} className="admin-hub-muted">
                            Chưa có dòng hàng.
                          </td>
                        </tr>
                      ) : (
                        (posDetailDraft ?? posDetailNorm).items.map((rawIt, idx) => {
                          const it = rawIt
                          const lineTotal = Number(it.price) * Number(it.qty)
                          return (
                            <tr key={it.orderLineId || idx} className="ah-responsive-table-card-row ah-pos-order-line-card">
                              <td className="ah-inbound-ln-stt ah-pos-order-line-stt">{idx + 1}</td>
                              <td data-label="Mã hàng">{it.code || '—'}</td>
                              <td className="ah-pos-order-line-name" data-label="Tên hàng">
                                {(() => {
                                  const ma_hang = String(it.ma_hang ?? it.code ?? '').trim()
                                  const url = buildOpenHangHoaGoodsAbsUrl(it.variantId, ma_hang)
                                  if (!url) return it.name || '—'
                                  return (
                                    <a
                                      className="ah-inbound-detail-name-link"
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Mở sản phẩm trên tab Hàng hóa"
                                    >
                                      {it.name || '—'}
                                    </a>
                                  )
                                })()}
                              </td>
                              <td data-label="ĐVT">{it.unitLabel || '—'}</td>
                              <td className="ah-num ah-pos-order-line-qty" data-label="Số lượng">
                                <span className="ah-pos-order-line-qty-price-mobile">
                                  {Number(it.qty).toLocaleString('vi-VN')} ×{' '}
                                  {Number(it.price).toLocaleString('vi-VN')} đ
                                </span>
                                <span className="ah-pos-order-line-qty-desktop">
                                {posDetailIsEditing ? (
                                  <input
                                    className="ah-inbound-cell-input ah-inbound-cell-input--qty ah-inbound-cell-input--soft"
                                    type="text"
                                    inputMode="decimal"
                                    aria-label={`Số lượng ${it.name}`}
                                    value={it.qty === 0 ? '' : String(it.qty)}
                                    onFocus={selectInboundInputOnFocus}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(/[^\d.]/g, '')
                                      const n =
                                        raw === ''
                                          ? 0
                                          : Math.max(0, parseFloat(raw.replace(/,/g, '.')) || 0)
                                      updatePosDetailDraftItem(posDetailTabOid, it.orderLineId, { qty: n })
                                    }}
                                  />
                                ) : (
                                  Number(it.qty).toLocaleString('vi-VN')
                                )}
                                </span>
                              </td>
                              <td className="ah-num ah-pos-order-line-price" data-label="Đơn giá bán">
                                <span className="ah-pos-order-line-qty-desktop">
                                {posDetailIsEditing ? (
                                  <input
                                    className="ah-inbound-cell-input ah-inbound-cell-input--soft"
                                    type="text"
                                    inputMode="numeric"
                                    aria-label={`Đơn giá ${it.name}`}
                                    value={formatMoneyDraftVi(it.price)}
                                    onFocus={selectInboundInputOnFocus}
                                    onChange={(e) =>
                                      updatePosDetailDraftItem(posDetailTabOid, it.orderLineId, {
                                        price: parseMoneyDraftVi(e.target.value),
                                      })
                                    }
                                  />
                                ) : (
                                  `${Number(it.price).toLocaleString('vi-VN')} đ`
                                )}
                                </span>
                              </td>
                              <td className="ah-num" data-label="Giá vốn">
                                {Number(it.cost).toLocaleString('vi-VN')} đ
                              </td>
                              <td className="ah-num ah-pos-order-line-sum" data-label="Thành tiền">
                                {lineTotal.toLocaleString('vi-VN')} đ
                              </td>
                              {!posDetailIsEditing ? (
                                <td className="ah-num">
                                  {(Number(it.returnedQty) > 0
                                    ? Number(it.returnedQty)
                                    : 0
                                  ).toLocaleString('vi-VN')}
                                </td>
                              ) : (
                                <td>
                                  <button
                                    type="button"
                                    className="ah-inbound-row-del"
                                    aria-label="Xóa dòng"
                                    onClick={() => removePosDetailDraftLine(posDetailTabOid, it.orderLineId)}
                                  >
                                    ×
                                  </button>
                                </td>
                              )}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="ah-inbound-detail-missing">
                <p className="admin-hub-muted">Không tìm thấy đơn hàng (có thể đã bị xóa).</p>
                <button
                  type="button"
                  className="ah-inbound-btn-create"
                  onClick={() => closePosDetailTabByOrderId(posDetailTabOid)}
                >
                  Đóng tab
                </button>
              </div>
            )}
          </section>
        )}

        {isPosReturnDetailTabId(activeTab) && (
          <section
            className="ah-pos-return-detail-page"
            aria-labelledby="ah-pos-ret-detail-title"
          >
            {!posReturnDetailLedgerId ? (
              <div className="ah-inbound-detail-missing">
                <p className="admin-hub-muted">Tab không hợp lệ.</p>
                <button type="button" className="ah-inbound-btn-create" onClick={() => onAdminHubNavItemActivate(TAB_OVERVIEW)}>
                  Về Doanh thu
                </button>
              </div>
            ) : posReturnDetailEntry ? (
              <>
                <header className="ah-pos-return-detail-head">
                  <div className="ah-pos-return-detail-head-main">
                    <h2 id="ah-pos-ret-detail-title" className="admin-hub-panel-title ah-pos-return-detail-h2">
                      {(() => {
                        const srcInv =
                          String(posReturnDetailEntry.sourceInvoiceNo || '').trim() ||
                          (() => {
                            const ord = orders.find(
                              (o) => String(o.id) === String(posReturnDetailEntry.orderId)
                            )
                            return String(ord?.invoiceNo || '').trim()
                          })() ||
                          String(posReturnDetailEntry.orderId || '').trim() ||
                          '—'
                        return `Chi tiết TH-${srcInv}`
                      })()}
                    </h2>
                    <p className="admin-hub-muted ah-pos-return-detail-meta">
                      Phiếu chi — hoàn trả khách ·{' '}
                      {(() => {
                        try {
                          return new Date(posReturnDetailEntry.atMs).toLocaleString('vi-VN')
                        } catch {
                          return '—'
                        }
                      })()}
                    </p>
                    <span className="ah-pos-return-detail-badge">Trả hàng</span>
                  </div>
                  <div className="ah-pos-return-detail-tools">
                    <button
                      type="button"
                      className="ah-inbound-btn-create"
                      onClick={() => closePosReturnDetailTabByLedgerId(posReturnDetailLedgerId)}
                    >
                      Đóng tab
                    </button>
                  </div>
                </header>
                <div className="admin-hub-table-wrap ah-pos-return-detail-table-wrap ah-responsive-table-wrap">
                  <table className="admin-hub-table ah-pos-return-detail-table ah-responsive-table">
                    <thead>
                      <tr>
                        <th>Mã hàng</th>
                        <th>Tên hàng</th>
                        <th>ĐVT</th>
                        <th className="ah-num">Số lượng trả</th>
                        <th className="ah-num">Đơn giá hoàn tiền</th>
                        <th className="ah-num">Thành tiền hoàn trả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(posReturnDetailEntry.lines) && posReturnDetailEntry.lines.length > 0 ? (
                        posReturnDetailEntry.lines.map((ln, idx) => (
                          <tr key={`${ln.code}-${idx}`} className="ah-responsive-table-card-row">
                            <td data-label="Mã hàng">{String(ln.code || '').trim() || '—'}</td>
                            <td data-label="Tên hàng">{String(ln.name || '').trim() || '—'}</td>
                            <td data-label="ĐVT">{String(ln.unitLabel || '').trim() || '—'}</td>
                            <td className="ah-num" data-label="Số lượng trả">
                              {Number.isFinite(Number(ln.qtyReturned))
                                ? Number(ln.qtyReturned).toLocaleString('vi-VN')
                                : '—'}
                            </td>
                            <td className="ah-num" data-label="Đơn giá hoàn tiền">
                              {Number.isFinite(Number(ln.unitRefund))
                                ? `${Math.round(Number(ln.unitRefund)).toLocaleString('vi-VN')} đ`
                                : '—'}
                            </td>
                            <td className="ah-num" data-label="Thành tiền hoàn trả">
                              {Number.isFinite(Number(ln.lineRefund))
                                ? `${Math.round(Number(ln.lineRefund)).toLocaleString('vi-VN')} đ`
                                : '—'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr className="ah-responsive-table-empty">
                          <td colSpan={6} className="admin-hub-muted">
                            Giao dịch lưu trước khi có chi tiết từng dòng — chỉ có tổng hoàn bên dưới.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="ah-pos-return-detail-tfoot">
                        <td colSpan={5} className="ah-num ah-pos-return-detail-tfoot-label">
                          <strong>Tổng tiền đã chi trả lại cho khách</strong>
                        </td>
                        <td className="ah-num ah-pos-return-detail-tfoot-sum">
                          <strong>
                            {Math.max(0, Number(posReturnDetailEntry.revenueSub) || 0).toLocaleString('vi-VN')} đ
                          </strong>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            ) : (
              <div className="ah-inbound-detail-missing">
                <p className="admin-hub-muted">Không tìm thấy giao dịch hoàn trả (có thể đã bị xóa).</p>
                <button
                  type="button"
                  className="ah-inbound-btn-create"
                  onClick={() => closePosReturnDetailTabByLedgerId(posReturnDetailLedgerId)}
                >
                  Đóng tab
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === TAB_INBOUND_DRAFT && (
          <section
            className="ah-inbound-draft-root"
            aria-labelledby="ah-inbound-draft-title"
            role="region"
          >
            <header className="ah-inbound-draft-head">
              <h2 id="ah-inbound-draft-title" className="ah-inbound-draft-title">
                {inboundFormEditOrderId
                  ? `Sửa phiếu nhập (${
                      inboundOrders.find((o) => o.id === inboundFormEditOrderId)?.code ||
                      inboundFormCode ||
                      '—'
                    })`
                  : 'Phiếu nhập mới'}
              </h2>
              <button
                type="button"
                className="ah-inbound-draft-close"
                aria-label={standaloneInboundCreate ? 'Thoát (đóng tab trình duyệt)' : 'Đóng tab phiếu nhập'}
                onClick={closeInboundForm}
              >
                {standaloneInboundCreate ? 'Thoát' : 'Đóng'}
              </button>
            </header>

            <div className="ah-inbound-draft-body">
              <div className="ah-inbound-draft-col-lines">
                <label className="ah-inbound-form-lbl" htmlFor="ah-inbound-prod-q">
                  Tìm kiếm sản phẩm{' '}
                  <span className="ah-inbound-req">
                    (quét mã vạch / gõ tên, Enter để thêm · phím F3 vào ô tìm)
                  </span>
                </label>
                <div className="ah-inbound-draft-search-row">
                  <div className="ah-inbound-line-search-box ah-inbound-draft-line-search ah-inbound-line-search-box--clearable">
                    <input
                      ref={inboundProductSearchRef}
                      id="ah-inbound-prod-q"
                      className="ah-inbound-form-input ah-inbound-form-input--line-search"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={inboundFormProductQ}
                      onChange={(e) => {
                        setInboundFormProductQ(e.target.value)
                        setInboundProductSuggestIdx(0)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          dismissInboundDraftProductSearch()
                          return
                        }
                        if (e.key === 'ArrowDown') {
                          if (!inboundProductSuggestPanelOpen || inboundProductSuggestRowCount <= 0) return
                          e.preventDefault()
                          setInboundProductSuggestIdx((i) =>
                            Math.min(i + 1, inboundProductSuggestRowCount - 1)
                          )
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          if (!inboundProductSuggestPanelOpen || inboundProductSuggestRowCount <= 0) return
                          e.preventDefault()
                          setInboundProductSuggestIdx((i) => Math.max(i - 1, 0))
                          return
                        }
                        if (e.key !== 'Enter') return
                        const q = inboundFormProductQ.trim()
                        if (!q) return

                        if (
                          inboundProductSuggestPanelOpen &&
                          inboundProductSuggestRowCount > 0
                        ) {
                          if (inboundDraftProductQuickAdd && inboundProductSuggestIdx === 0) {
                            e.preventDefault()
                            openGoodsCreateModal()
                            return
                          }
                          const prodIdx = inboundDraftProductQuickAdd
                            ? inboundProductSuggestIdx - 1
                            : inboundProductSuggestIdx
                          if (prodIdx >= 0 && prodIdx < inboundProductSuggest.length) {
                            e.preventDefault()
                            const hit = inboundProductSuggest[prodIdx]
                            addInboundFormLine(hit.product, hit.variant)
                            return
                          }
                        }

                        if (catalogListForInbound.length === 0) return

                        e.preventDefault()
                        if (posQueryLooksLikeBarcodeKeyInput(q)) {
                          const needle = String(normalizeBarcodeValue(q))
                          for (const p of catalogListForInbound) {
                            for (const v of p.groupVariants || [p]) {
                              if (needle && String(normalizeBarcodeValue(v.barcode ?? '')) === needle) {
                                addInboundFormLine(p, v)
                                return
                              }
                            }
                          }
                        }
                        if (inboundProductSuggest.length > 0) {
                          const hit = inboundProductSuggest[0]
                          addInboundFormLine(hit.product, hit.variant)
                        }
                      }}
                      placeholder="Mã vạch, mã hàng hoặc tên…"
                    />
                    {inboundFormProductQ.trim() !== '' ? (
                      <button
                        type="button"
                        className="ah-search-clear-btn ah-search-clear-btn--inbound"
                        aria-label="Xóa ô tìm"
                        onClick={dismissInboundDraftProductSearch}
                      >
                        ×
                      </button>
                    ) : null}
                    {inboundProductSuggestPanelOpen && (
                      <ul className="ah-inbound-suggest-list" role="listbox">
                        {inboundDraftProductQuickAdd ? (
                          <li role="none">
                            <button
                              type="button"
                              role="option"
                              id="ah-inbound-sug-quick-add"
                              className={`ah-inbound-suggest-item ah-inbound-suggest-item--draft ah-inbound-suggest-item--quick-add${
                                inboundProductSuggestIdx === 0 ? ' ah-inbound-suggest-item--active' : ''
                              }`}
                              title="Tạo mới sản phẩm trong danh mục"
                              onMouseEnter={() => setInboundProductSuggestIdx(0)}
                              onClick={() => openGoodsCreateModal()}
                            >
                              <span className="ah-inbound-sug-name ah-inbound-sug-quick-label">
                                + Thêm mới sản phẩm
                              </span>
                            </button>
                          </li>
                        ) : null}
                        {inboundProductSuggest.map(({ product, variant }, si) => {
                          const rowIdx = (inboundDraftProductQuickAdd ? 1 : 0) + si
                          const titleName =
                            String(product.name || variant.name || '').trim() || '—'
                          const dvt = normalizeCatalogUnitLabel(variant.unitLabel)
                          const ton = formatInboundTonLabelVi(variant.stockQty, variant)
                          return (
                            <li key={variant.id} role="none">
                              <button
                                type="button"
                                role="option"
                                id={`ah-inbound-sug-${rowIdx}`}
                                className={`ah-inbound-suggest-item ah-inbound-suggest-item--draft${
                                  inboundProductSuggestIdx === rowIdx
                                    ? ' ah-inbound-suggest-item--active'
                                    : ''
                                }`}
                                title={`${titleName} · ${dvt} · ${ton}`}
                                onMouseEnter={() => setInboundProductSuggestIdx(rowIdx)}
                                onClick={() => addInboundFormLine(product, variant)}
                              >
                                <span className="ah-inbound-sug-name">{titleName}</span>
                                <span className="ah-inbound-sug-dvt">{dvt}</span>
                                <span className="ah-inbound-sug-stock">{ton}</span>
                              </button>
                            </li>
                          )
                        })}
                        {inboundFormProductDebounced.trim() && inboundProductSuggest.length === 0 ? (
                          <li className="ah-inbound-suggest-empty" role="presentation">
                            Không có sản phẩm khớp.
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    className="barcode-scan-trigger"
                    aria-label="Quét mã vạch bằng camera"
                    title="Quét mã"
                    onClick={openInboundBarcodeScan}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="ah-inbound-quick-pick-btn"
                    onClick={() => {
                      setInboundQuickPickSelected(new Set())
                      setInboundQuickPickOpen(true)
                    }}
                  >
                    Chọn nhanh
                  </button>
                </div>

                {catalogListForInbound.length === 0 && (
                  <p className="admin-hub-muted ah-inbound-catalog-warn">
                    Chưa có danh mục hàng trên trình duyệt này — có thể lưu phiếu tạm, nhưng{' '}
                    <strong>Hoàn thành</strong> sẽ không cập nhật được tồn kho.
                  </p>
                )}

                <div className="admin-hub-table-wrap ah-inbound-lines-table-wrap ah-inbound-draft-table-wrap">
                  <table className="admin-hub-table ah-inbound-lines-table ah-inbound-draft-lines-table">
                    <colgroup>
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--del" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--stt" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--code" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--name" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--ncc" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--dvt" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--qty" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--price" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--disc" />
                      <col className="ah-inbound-draft-col ah-inbound-draft-col--total" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="ah-inbound-draft-th-del" aria-label="Xóa dòng" />
                        <th className="ah-inbound-ln-stt ah-inbound-draft-th-stt">STT</th>
                        <th className="ah-inbound-draft-th-code">Mã hàng</th>
                        <th className="ah-inbound-draft-th-name">Tên hàng</th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread ah-inbound-draft-th-ncc">
                          Nhà cung cấp
                        </th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread">ĐVT</th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread">Số lượng</th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread">Đơn giá</th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread">Giảm giá</th>
                        <th className="ah-inbound-ln-mid ah-inbound-ln-spread">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboundFormLines.length === 0 ? (
                        <tr className="ah-inbound-draft-line-empty">
                          <td colSpan={10} className="admin-hub-muted">
                            Chưa có dòng hàng — tìm và chọn sản phẩm ở ô phía trên.
                          </td>
                        </tr>
                      ) : (
                        inboundFormLines.map((ln, idx) => (
                          <AdminHubInboundDraftLineRow
                            key={ln.lineId}
                            ln={ln}
                            idx={idx}
                            catalogListForInbound={catalogListForInbound}
                            removeInboundFormLine={removeInboundFormLine}
                            updateInboundFormLine={updateInboundFormLine}
                            selectInboundInputOnFocus={selectInboundInputOnFocus}
                            handleInboundNumericKeyDown={handleInboundNumericKeyDown}
                            onOpenProductQuickEdit={openInboundProductQuickEdit}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="ah-inbound-draft-sidebar" aria-label="Thông tin đơn nhập">
                <label className="ah-inbound-form-lbl">
                  Nhà cung cấp <span className="ah-inbound-req">*</span>
                </label>
                <div className="ah-inbound-ncc-row ah-inbound-ncc-row--draft">
                  <div className="ah-inbound-ncc-input-wrap ah-inbound-ncc-input-wrap--combo">
                    <InboundThuongHieuAutocomplete
                      id="ah-inbound-draft-ncc"
                      value={inboundFormSupplierQ}
                      onValueChange={(v) => {
                        setInboundFormSupplierQ(v)
                        setInboundFormSupplierName(v)
                      }}
                      options={inboundNccAutocompleteOptions}
                      filterDebounceMs={500}
                      listMaxHeight={280}
                      placeholder="Chọn hoặc gõ tên NCC (bảng suppliers)…"
                    />
                  </div>
                  <button
                    type="button"
                    className="ah-inbound-ncc-add"
                    onClick={() => setSupplierModalOpen(true)}
                    title="Thêm nhà cung cấp mới"
                  >
                    <span className="ah-inbound-ncc-add-plus" aria-hidden>
                      +
                    </span>
                    Thêm NCC
                  </button>
                </div>
                <p className="ah-inbound-ncc-hint">
                  Gợi ý ưu tiên từ <strong>Supabase · bảng suppliers</strong> (tải khi mở tab; gõ tìm sau 500ms, không
                  gọi API theo từng phím). Có thêm thương hiệu từ <strong>thuong_hieu</strong> (danh mục) nếu chưa trùng.
                  Tối đa <strong>50</strong> dòng — hoặc <strong>+ Thêm NCC</strong> để lưu và làm mới danh sách.
                </p>

                <label className="ah-inbound-form-lbl" htmlFor="ah-inbound-order-code">
                  Mã đơn hàng
                </label>
                <input
                  id="ah-inbound-order-code"
                  className="ah-inbound-form-input"
                  type="text"
                  value={inboundFormCode}
                  onChange={(e) => setInboundFormCode(e.target.value)}
                  placeholder={`Để trống → ${computeNextInboundCode(inboundOrders)}`}
                  autoComplete="off"
                  spellCheck={false}
                />

                <div className="ah-inbound-readonly-block">
                  <span className="ah-inbound-readonly-lbl">Tổng tiền hàng</span>
                  <strong className="ah-inbound-readonly-val">
                    {inboundFormGoodsSubtotal.toLocaleString('vi-VN')} đ
                  </strong>
                </div>

                <fieldset className="ah-inbound-disc-fieldset">
                  <legend className="ah-inbound-form-lbl">Giảm giá đơn hàng</legend>
                  <div className="ah-inbound-disc-mode">
                    <label className="ah-inbound-radio">
                      <input
                        type="radio"
                        name="inbound-disc-mode"
                        checked={inboundFormDiscMode === 'amount'}
                        onChange={() => setInboundFormDiscMode('amount')}
                      />
                      Số tiền (đ)
                    </label>
                    <label className="ah-inbound-radio">
                      <input
                        type="radio"
                        name="inbound-disc-mode"
                        checked={inboundFormDiscMode === 'percent'}
                        onChange={() => setInboundFormDiscMode('percent')}
                      />
                      Phần trăm (%)
                    </label>
                  </div>
                  <input
                    className="ah-inbound-form-input"
                    type="text"
                    inputMode="decimal"
                    value={inboundFormDiscRaw}
                    onChange={(e) => setInboundFormDiscRaw(e.target.value)}
                    placeholder={inboundFormDiscMode === 'percent' ? 'Ví dụ: 5' : 'Ví dụ: 50000'}
                  />
                </fieldset>

                <div className="ah-inbound-readonly-block ah-inbound-readonly-block--accent">
                  <span className="ah-inbound-readonly-lbl">Tổng thanh toán</span>
                  <strong className="ah-inbound-readonly-val">
                    {inboundFormTotalPay.toLocaleString('vi-VN')} đ
                  </strong>
                </div>

                <label className="ah-inbound-form-lbl" htmlFor="ah-inbound-note">
                  Ghi chú
                </label>
                <textarea
                  id="ah-inbound-note"
                  className="ah-inbound-form-textarea"
                  rows={3}
                  value={inboundFormNote}
                  onChange={(e) => setInboundFormNote(e.target.value)}
                  placeholder="Lưu ý cho đơn nhập…"
                />
              </aside>
            </div>

            <footer className="ah-inbound-draft-foot">
              {!inboundEditFromStockApplied && (
                <button
                  type="button"
                  className="ah-inbound-footer-btn ah-inbound-footer-btn--draft"
                  onClick={() => saveInboundForm('saved_temp')}
                >
                  Lưu tạm
                </button>
              )}
              <button
                type="button"
                className="ah-inbound-footer-btn ah-inbound-footer-btn--done"
                onClick={() => saveInboundForm('completed')}
              >
                Hoàn thành
              </button>
            </footer>
          </section>
        )}
          </>
        </AdminHubTabErrorBoundary>
      </main>

      {selected && !isDeletingOrder && (
        <div
          className="dash-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dash-detail-title"
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className="dash-modal dash-modal-wide">
            <div className="dash-modal-head">
              <h3 id="dash-detail-title">Chi tiết {selected.invoiceNo}</h3>
              <button
                type="button"
                className="dash-modal-close"
                onClick={() => setSelected(null)}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>
            <p className="dash-detail-meta">
              {new Date(selected.createdAt).toLocaleString('vi-VN')}
            </p>
            <ul className="dash-detail-lines">
              {(selected.items || []).map((it, i) => {
                const rev = orderLineRevenue(it)
                const ctot = orderLineCostTotal(it)
                const lp = orderLineProfit(it)
                return (
                  <li key={i}>
                    <span className="dd-name">{it.name}</span>
                    <span className="dd-sub">
                      Giá bán {Number(it.price).toLocaleString('vi-VN')} đ × {it.qty} ={' '}
                      {rev.toLocaleString('vi-VN')} đ
                    </span>
                    <span className="dd-cost">
                      Giá vốn {(Number(it.cost) || 0).toLocaleString('vi-VN')} đ × {it.qty} ={' '}
                      {ctot.toLocaleString('vi-VN')} đ
                    </span>
                    <span className="dd-profit">
                      Lợi nhuận dòng: <strong>{lp.toLocaleString('vi-VN')} đ</strong>
                    </span>
                  </li>
                )
              })}
            </ul>
            {Number(selected.discount) > 0 && (
              <div className="dash-detail-total dash-detail-subrow">
                <span>Chiết khấu</span>
                <strong>-{Number(selected.discount).toLocaleString('vi-VN')} đ</strong>
              </div>
            )}
            <div className="dash-detail-total dash-detail-subrow">
              <span>Tổng giá vốn đơn</span>
              <strong>{orderTotalCost(selected).toLocaleString('vi-VN')} đ</strong>
            </div>
            <div className="dash-detail-total dash-detail-subrow dash-detail-profit-row">
              <span>Lợi nhuận đơn</span>
              <strong>{orderTotalProfit(selected).toLocaleString('vi-VN')} đ</strong>
            </div>
            <div className="dash-detail-total">
              <span>Tổng thanh toán</span>
              <strong>{Number(selected.total).toLocaleString('vi-VN')} đ</strong>
            </div>
            <div className="dash-modal-actions">
              <button
                type="button"
                className="btn-dash btn-dash-primary"
                onClick={() => handleReprint(selected)}
              >
                In lại hóa đơn
              </button>
              <button type="button" className="btn-dash" onClick={() => setSelected(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      <CostAdjustQuickPickModal
        open={inboundQuickPickOpen && activeTab === TAB_INBOUND_DRAFT}
        products={catalogListForInbound}
        preferParentCatalog
        selectedIds={inboundQuickPickSelected}
        onToggleId={toggleInboundQuickPickSel}
        onConfirm={confirmInboundQuickPick}
        onCancel={() => {
          setInboundQuickPickOpen(false)
          setInboundQuickPickSelected(new Set())
        }}
      />

      <EntityPersonModal
        open={supplierModalOpen}
        title="Thêm nhà cung cấp"
        saveLabel="Lưu NCC"
        isSaving={supplierSaving}
        onClose={() => {
          if (supplierSaving) return
          setSupplierModalOpen(false)
        }}
        onSubmit={(draft) => submitNewSupplier(draft)}
      />
      <EntityPersonModal
        open={customerModalOpen}
        title={editingCustomer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
        saveLabel={editingCustomer ? 'Lưu thay đổi' : 'Lưu'}
        isSaving={customerSaving}
        seedDraft={customerModalSeed}
        onClose={() => {
          if (customerSaving) return
          setCustomerModalOpen(false)
          setEditingCustomer(null)
        }}
        onSubmit={(draft) =>
          editingCustomer ? submitUpdateCustomerAdmin(draft) : submitNewCustomerAdmin(draft)
        }
      />
      <EntityPersonModal
        open={employeeModalOpen}
        title={editingEmployee ? 'Sửa nhân viên' : 'Thêm nhân viên'}
        saveLabel={editingEmployee ? 'Lưu thay đổi' : 'Lưu'}
        isSaving={employeeSaving}
        seedDraft={employeeModalSeed}
        onClose={() => {
          if (employeeSaving) return
          setEmployeeModalOpen(false)
          setEditingEmployee(null)
        }}
        onSubmit={(draft) =>
          editingEmployee ? submitUpdateEmployeeAdmin(draft) : submitNewEmployeeAdmin(draft)
        }
      />

      {inboundCostDiffModal && (
        <div
          className="ah-iv-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancelInboundCostDiffModal()
          }}
        >
          <div
            className="ah-iv-modal ah-iv-modal--save-price"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ah-iv-save-price-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ah-iv-modal__head">
              <h2 id="ah-iv-save-price-title" className="ah-iv-modal__title">
                Lưu giá nhập
              </h2>
            </header>
            <div className="ah-iv-modal__body">
              <p className="ah-iv-modal__lead">
                Một số mặt hàng có <strong>đơn giá nhập</strong> trên phiếu khác <strong>giá vốn</strong> hiện
                tại trong danh mục. Bạn có muốn ghi đè giá vốn theo đơn giá nhập không?
              </p>
              <ul className="ah-iv-diff-list">
                {inboundCostDiffModal.diffs.map((d) => (
                  <li key={d.variantId} className="ah-iv-diff-item">
                    <a
                      className="ah-iv-diff-code ah-iv-diff-code-link"
                      href={`/admin/goods?search=${encodeURIComponent(String(d.ma_hang ?? d.code ?? '').trim())}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {String(d.ma_hang ?? d.code ?? '').trim() || '—'}
                    </a>
                    <span className="ah-iv-diff-name"> — {d.name}</span>
                    <div className="ah-iv-diff-prices">
                      <span>Giá vốn cũ: {Number(d.oldCost || 0).toLocaleString('vi-VN')} đ</span>
                      <span> → </span>
                      <span className="ah-iv-diff-new">Giá vốn mới: {Number(d.newCost || 0).toLocaleString('vi-VN')} đ</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="ah-iv-modal__foot">
              <button
                type="button"
                className="ah-iv-btn ah-iv-btn--ghost"
                onClick={cancelInboundCostDiffModal}
              >
                Hủy
              </button>
              <button
                type="button"
                className="ah-iv-btn ah-iv-btn--primary"
                onClick={confirmInboundCostSave}
              >
                Cập nhật
              </button>
            </footer>
          </div>
        </div>
      )}

      {inboundReturnModal && (
        <div
          className="ah-inbound-float-panel ah-inbound-float-panel--left ah-inbound-float-panel--return-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ah-inbound-ret-title"
        >
          <div className="ah-inbound-float-panel__card">
            <header className="ah-inbound-float-panel__head">
              <h2 id="ah-inbound-ret-title" className="ah-inbound-float-panel__title">
                Trả hàng — {inboundReturnModal.code}
              </h2>
              <button
                type="button"
                className="ah-inbound-float-panel__x"
                aria-label="Đóng"
                onClick={() => {
                  setInboundReturnModal(null)
                  setInboundReturnQtyDraft({})
                }}
              >
                ×
              </button>
            </header>
            <p className="ah-inbound-float-panel__lead">
              Nhập <strong>số lượng trả</strong> cho từng dòng (mặc định 0). Khi hoàn tất, hệ thống{' '}
              <strong>trừ tồn kho</strong> theo số lượng trả. Bạn vẫn có thể chuyển tab khác.
            </p>
            <div className="ah-inbound-float-panel__scroll">
              <div className="ah-return-lines-wrap">
              <table className="ah-inbound-ret-table ah-return-lines-table">
                <thead>
                  <tr>
                    <th className="ah-return-col-stt">#</th>
                    <th className="ah-return-col-thumb" aria-hidden />
                    <th>Sản phẩm</th>
                    <th>ĐVT</th>
                    <th className="ah-return-col-qty">SL trả / đã mua</th>
                    <th className="ah-num ah-return-col-price">Đơn giá</th>
                    <th className="ah-num ah-return-col-refund">Giá trị trả</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const list = normalizeInboundRow(inboundReturnModal).lines
                      .map((raw) => {
                        const ln = normalizeInboundLine(raw)
                        const rq = inboundLineReturnableQty(ln)
                        if (rq <= 0 || !ln.variantId) return null
                        const purchased = ln.qty
                        const draft = parseReturnQtyDraft(inboundReturnQtyDraft[ln.lineId], rq)
                        const unitP = Math.max(0, Number(ln.unitPrice) || 0)
                        const refund = Math.round(draft * unitP)
                        const lineGross = Math.round(purchased * unitP)
                        return { ln, rq, purchased, draft, unitP, refund, lineGross }
                      })
                      .filter(Boolean)
                    return list.map((row, idx) => {
                      const { ln, rq, purchased, draft, unitP, refund, lineGross } = row
                      return (
                        <tr key={ln.lineId} className="ah-return-line-card-row">
                          <td className="ah-return-col-stt">{idx + 1}</td>
                          <td className="ah-return-col-thumb">
                            <div className="ah-return-thumb" title="Ảnh" />
                          </td>
                          <td className="ah-return-col-prod" data-label="Sản phẩm">
                            <div className="ah-return-prod-name">{ln.name || '—'}</div>
                            <div className="ah-return-prod-sub">Mặc định · {ln.unitLabel || '—'}</div>
                            <div className="ah-return-prod-code">{ln.code || '—'}</div>
                          </td>
                          <td className="ah-return-col-unit" data-label="ĐVT">{ln.unitLabel || '—'}</td>
                          <td className="ah-return-col-qty" data-label="Số lượng trả">
                            <span className="ah-return-qty-split">
                              <input
                                className="ah-return-qty-input ah-return-qty-input--panel"
                                type="text"
                                inputMode="decimal"
                                aria-label={`Số lượng trả ${ln.name}`}
                                placeholder="0"
                                value={inboundReturnQtyDraft[ln.lineId] ?? ''}
                                onChange={(e) =>
                                  setInboundReturnQtyDraft((m) => ({
                                    ...m,
                                    [ln.lineId]: e.target.value,
                                  }))
                                }
                              />
                              <span className="ah-return-qty-sep">/</span>
                              <span className="ah-return-qty-max">Đã mua: {purchased.toLocaleString('vi-VN')}</span>
                            </span>
                            <div className="ah-return-qty-cap">Tối đa còn trả: {rq.toLocaleString('vi-VN')}</div>
                          </td>
                          <td
                            className="ah-num ah-return-col-price ah-inbound-ret-code"
                            data-label="Đơn giá"
                          >
                            <div className="ah-return-price-purchased-mobile">
                              <span>Đơn giá: {unitP.toLocaleString('vi-VN')} đ</span>
                              <span className="ah-return-price-purchased-sep">·</span>
                              <span>Đã mua: {purchased.toLocaleString('vi-VN')}</span>
                            </div>
                            <span className="ah-return-price-desktop">{unitP.toLocaleString('vi-VN')} đ</span>
                          </td>
                          <td className="ah-num ah-return-col-refund" data-label="Giá trị trả">
                            {draft > 0 ? (
                              <>
                                <span className="ah-return-strike">{lineGross.toLocaleString('vi-VN')} đ</span>
                                <br />
                                <strong>{refund.toLocaleString('vi-VN')} đ</strong>
                              </>
                            ) : (
                              <strong>0 đ</strong>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
              </div>
            </div>
            <footer className="ah-inbound-float-panel__foot">
              <button
                type="button"
                className="ah-iv-btn ah-iv-btn--ghost"
                onClick={() => {
                  setInboundReturnModal(null)
                  setInboundReturnQtyDraft({})
                }}
              >
                Đóng
              </button>
              <button type="button" className="ah-iv-btn ah-iv-btn--primary" onClick={confirmInboundReturnSubmit}>
                Hoàn thành trả hàng
              </button>
            </footer>
          </div>
        </div>
      )}

      {inboundCancelModal && (
        <div
          className="ah-inbound-float-panel ah-inbound-float-panel--left ah-inbound-float-panel--narrow"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ah-inbound-can-title"
        >
          <div className="ah-inbound-float-panel__card">
            <header className="ah-inbound-float-panel__head">
              <h2 id="ah-inbound-can-title" className="ah-inbound-float-panel__title">
                Hủy đơn nhập?
              </h2>
              <button
                type="button"
                className="ah-inbound-float-panel__x"
                aria-label="Đóng"
                onClick={() => setInboundCancelModal(null)}
              >
                ×
              </button>
            </header>
            <p className="ah-inbound-float-panel__lead">
              Đơn <strong>{inboundCancelModal.code}</strong>: hệ thống sẽ trừ toàn bộ số lượng còn trong kho từ
              phiếu này và đánh dấu <strong>Hủy đơn</strong>.
            </p>
            <footer className="ah-inbound-float-panel__foot">
              <button type="button" className="ah-iv-btn ah-iv-btn--ghost" onClick={() => setInboundCancelModal(null)}>
                Không
              </button>
              <button type="button" className="ah-iv-btn ah-iv-btn--primary" onClick={confirmInboundCancelSubmit}>
                Hủy đơn
              </button>
            </footer>
          </div>
        </div>
      )}

      {posReturnModal && (
        <div
          className="ah-inbound-float-panel ah-inbound-float-panel--left ah-inbound-float-panel--return-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ah-pos-ret-title"
        >
          <div className="ah-inbound-float-panel__card">
            <header className="ah-inbound-float-panel__head">
              <h2 id="ah-pos-ret-title" className="ah-inbound-float-panel__title">
                Trả hàng — {posReturnModal.invoiceNo || '—'}
              </h2>
              <button
                type="button"
                className="ah-inbound-float-panel__x"
                aria-label="Đóng"
                disabled={posReturnSubmitting}
                onClick={() => {
                  if (posReturnSubmitting) return
                  setPosReturnModal(null)
                  setPosReturnQtyDraft({})
                  setPosReturnSubmitting(false)
                }}
              >
                ×
              </button>
            </header>
            <p className="ah-inbound-float-panel__lead">
              Nhập <strong>số lượng trả</strong> (mặc định 0). Tiền hoàn theo <strong>đơn giá / giá vốn đã lưu trên
              đơn</strong>. Khi hoàn tất, hệ thống trừ doanh thu / vốn / lợi nhuận vào <strong>báo cáo ngày hôm
              nay</strong>; dòng khớp được biến thể trong danh mục thì <strong>cộng tồn kho</strong> tương ứng.
            </p>
            <div className="ah-inbound-float-panel__scroll">
              <div className="ah-return-lines-wrap">
              <table className="ah-inbound-ret-table ah-return-lines-table">
                <thead>
                  <tr>
                    <th className="ah-return-col-stt">#</th>
                    <th className="ah-return-col-thumb" aria-hidden />
                    <th>Sản phẩm</th>
                    <th>ĐVT</th>
                    <th className="ah-return-col-qty">SL trả / đã mua</th>
                    <th className="ah-num ah-return-col-price">Đơn giá</th>
                    <th className="ah-num ah-return-col-refund">Tiền hoàn</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const norm = normalizePosOrder(posReturnModal, catalogList, {
                      preferStoredLineFinancials: true,
                    })
                    const list = norm.items
                      .map((it, idx) => {
                        const rq = posOrderLineReturnableQty(it)
                        if (rq <= 0) return null
                        const lid =
                          String(it.orderLineId || `row-${norm.id}-${idx}-${it.code || ''}`).trim() ||
                          `row-${idx}`
                        const purchased = Math.max(0, Number(it.qty) || 0)
                        const draft = parseReturnQtyDraft(posReturnQtyDraft[lid], rq)
                        const price = Math.max(0, Number(it.price) || 0)
                        const refund = Math.round(draft * price)
                        const lineSold = Math.round(purchased * price)
                        const hasVid = Boolean(String(it.variantId || '').trim())
                        return { it, lid, rq, purchased, draft, price, refund, lineSold, hasVid }
                      })
                      .filter(Boolean)
                    return list.map((row, idx) => {
                      const { it, lid, rq, purchased, draft, price, refund, lineSold, hasVid } = row
                      return (
                        <tr key={`${lid}-${idx}`} className="ah-return-line-card-row">
                          <td className="ah-return-col-stt">{idx + 1}</td>
                          <td className="ah-return-col-thumb">
                            <div className="ah-return-thumb" title="Ảnh" />
                          </td>
                          <td className="ah-return-col-prod" data-label="Sản phẩm">
                            <div className="ah-return-prod-name">{it.name || '—'}</div>
                            <div className="ah-return-prod-sub">
                              {hasVid ? `Mặc định · ${it.unitLabel || '—'}` : 'Chưa khớp biến thể — hoàn tiền theo đơn'}
                            </div>
                            <div className="ah-return-prod-code">{it.code || '—'}</div>
                          </td>
                          <td className="ah-return-col-unit" data-label="ĐVT">{it.unitLabel || '—'}</td>
                          <td className="ah-return-col-qty" data-label="Số lượng trả">
                            <span className="ah-return-qty-split">
                              <input
                                className="ah-return-qty-input ah-return-qty-input--panel"
                                type="text"
                                inputMode="decimal"
                                aria-label={`Số lượng trả ${it.name}`}
                                placeholder="0"
                                value={posReturnQtyDraft[lid] ?? ''}
                                disabled={posReturnSubmitting}
                                onChange={(e) =>
                                  setPosReturnQtyDraft((m) => ({
                                    ...m,
                                    [lid]: e.target.value,
                                  }))
                                }
                              />
                              <span className="ah-return-qty-sep">/</span>
                              <span className="ah-return-qty-max">Đã mua: {purchased.toLocaleString('vi-VN')}</span>
                            </span>
                            <div className="ah-return-qty-cap">Tối đa còn trả: {rq.toLocaleString('vi-VN')}</div>
                          </td>
                          <td
                            className="ah-num ah-return-col-price ah-inbound-ret-code"
                            data-label="Đơn giá"
                          >
                            <div className="ah-return-price-purchased-mobile">
                              <span>Đơn giá: {price.toLocaleString('vi-VN')} đ</span>
                              <span className="ah-return-price-purchased-sep">·</span>
                              <span>Đã mua: {purchased.toLocaleString('vi-VN')}</span>
                            </div>
                            <span className="ah-return-price-desktop">{price.toLocaleString('vi-VN')} đ</span>
                          </td>
                          <td className="ah-num ah-return-col-refund" data-label="Tiền hoàn">
                            {draft > 0 ? (
                              <>
                                <span className="ah-return-strike">{lineSold.toLocaleString('vi-VN')} đ</span>
                                <br />
                                <strong>{refund.toLocaleString('vi-VN')} đ</strong>
                              </>
                            ) : (
                              <strong>0 đ</strong>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
              </div>
            </div>
            <footer className="ah-inbound-float-panel__foot">
              <button
                type="button"
                className="ah-iv-btn ah-iv-btn--ghost"
                disabled={posReturnSubmitting}
                onClick={() => {
                  if (posReturnSubmitting) return
                  setPosReturnModal(null)
                  setPosReturnQtyDraft({})
                  setPosReturnSubmitting(false)
                }}
              >
                Đóng
              </button>
              <button
                type="button"
                className="ah-iv-btn ah-iv-btn--primary"
                disabled={posReturnSubmitting}
                onClick={() => void confirmPosReturnSubmit()}
              >
                {posReturnSubmitting ? (
                  <>
                    <span className="ah-entity-spinner" aria-hidden="true" />
                    Đang xử lý...
                  </>
                ) : (
                  'Hoàn thành trả hàng'
                )}
              </button>
            </footer>
          </div>
        </div>
      )}

      {posCancelModal && (
        <div
          className="ah-inbound-float-panel ah-inbound-float-panel--left ah-inbound-float-panel--narrow"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ah-pos-can-title"
        >
          <div className="ah-inbound-float-panel__card">
            <header className="ah-inbound-float-panel__head">
              <h2 id="ah-pos-can-title" className="ah-inbound-float-panel__title">
                Hủy đơn bán?
              </h2>
              <button
                type="button"
                className="ah-inbound-float-panel__x"
                aria-label="Đóng"
                onClick={() => setPosCancelModal(null)}
              >
                ×
              </button>
            </header>
            <p className="ah-inbound-float-panel__lead">
              Đơn <strong>{posCancelModal.invoiceNo || '—'}</strong>: hoàn toàn bộ hàng còn lại vào kho và đánh dấu{' '}
              <strong>Hủy đơn</strong>.
            </p>
            <footer className="ah-inbound-float-panel__foot">
              <button type="button" className="ah-iv-btn ah-iv-btn--ghost" onClick={() => setPosCancelModal(null)}>
                Không
              </button>
              <button type="button" className="ah-iv-btn ah-iv-btn--primary" onClick={() => void confirmPosCancelSubmit()}>
                Hủy đơn
              </button>
            </footer>
          </div>
        </div>
      )}

      {comboModal && (
        <AdminHubComboModal
          open
          onClose={() => setComboModal(null)}
          catalogList={catalogList}
          searchRowsExcludingCombos={comboSearchRowsExcludingCombos}
          mode={comboModal.mode}
          initialDisplayProduct={comboModal.mode === 'edit' ? comboModal.product : null}
          onSaveDisplayProduct={handleComboSaveDisplay}
          revenueReadOnly={revenueReadOnly}
        />
      )}

      {inboundQuickEditExpandId ? (
        <div
          className="ah-inbound-quick-edit-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInboundProductQuickEdit()
          }}
        >
          <div
            className="ah-inbound-quick-edit-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Sửa nhanh sản phẩm"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ah-inbound-quick-edit-head">
              <h2 className="ah-inbound-quick-edit-title">Sửa nhanh sản phẩm</h2>
              <button
                type="button"
                className="ah-inbound-quick-edit-close"
                aria-label="Đóng"
                onClick={closeInboundProductQuickEdit}
              >
                ×
              </button>
            </header>
            <div className="ah-inbound-quick-edit-body">
              {inboundQuickEditSlot ? (
                inboundQuickEditSlot
              ) : inboundQuickEditSaving ? (
                <p className="admin-hub-muted" style={{ padding: '1rem' }}>
                  Đang lưu cập nhật sản phẩm…
                </p>
              ) : (
                <p className="admin-hub-muted" style={{ padding: '1rem' }}>
                  Đang tải dữ liệu sản phẩm…
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <BarcodeScanModal
        open={barcodeScanOpen}
        onClose={() => setBarcodeScanOpen(false)}
        title={barcodeScanMode === 'inbound' ? 'Quét mã — thêm dòng nhập' : 'Quét mã — lọc hàng hóa'}
        onScan={(t) => {
          if (barcodeScanMode === 'inbound') applyInboundScannedCode(t)
          else applyGoodsScannedCode(t)
        }}
      />

      <AdminHubGoodsCreateModal
        open={goodsNewModalOpen}
        onClose={() => setGoodsNewModalOpen(false)}
        catalogList={activeTab === TAB_INBOUND_DRAFT ? catalogListForInbound : catalogList}
        brandAutocompleteOptions={inboundNccAutocompleteOptions}
        onRequestAddSupplier={revenueReadOnly ? undefined : openGoodsBrandSupplierModal}
        revenueReadOnly={revenueReadOnly}
        onAppendCatalogVariants={appendCatalogVariantsFromInboundProductModal}
        persistStandaloneProducts={persistStandaloneProductsForInboundModal}
        fileNameHint={standaloneCatalog?.fileName || catalogFileName || 'hang-hoa-thu-cong'}
        onSaved={handleGoodsCreateSaved}
        disableEnforceFocus={supplierModalOpen}
      />

      {unitModal && (
        <div
          className={`ah-unit-modal-overlay${
            unitModal.source === 'inbound' ? ' ah-unit-modal-overlay--stack' : ''
          }`}
          role="presentation"
          onClick={closeUnitModal}
        >
          <div
            className="ah-unit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ah-unit-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ah-unit-modal__head">
              <h2 id="ah-unit-modal-title" className="ah-unit-modal__title">
                Thiết lập đơn vị tính và thuộc tính
              </h2>
              <button type="button" className="ah-unit-modal__close" aria-label="Đóng" onClick={closeUnitModal}>
                ×
              </button>
            </header>
            <div className="ah-unit-modal__scroll">
            <div className="ah-unit-modal__body">
              <section className="ah-unit-modal__section">
                <h3 className="ah-unit-modal__section-title">Đơn vị tính</h3>
                <p className="ah-unit-modal__lead">
                  Thêm đơn vị bán hoặc nhập như chai, lốc, thùng. Đặt công thức quy đổi để tính nhanh giá và tồn
                  kho. Ví dụ: 1 lốc = 6 chai, 1 thùng = 24 chai.
                </p>
                <div className="ah-unit-modal__chips ah-unit-modal__chips--desktop" aria-label="Danh sách đơn vị">
                  {unitModalSortedRows.map((row, idx) => {
                    const baseLbl =
                      normalizeCatalogUnitLabel(unitModalSortedRows[0]?.unitLabel || '').trim() ||
                      'đơn vị cơ bản'
                    const conv = parsePositiveConversion(row.conversion) ?? 1
                    const sub =
                      idx === 0
                        ? 'Đơn vị cơ bản'
                        : `1 ${normalizeCatalogUnitLabel(row.unitLabel) || '…'} = ${conv} ${baseLbl}`
                    return (
                      <div
                        key={row.key}
                        className={`ah-unit-modal__chip${idx === 0 ? ' ah-unit-modal__chip--base' : ''}`}
                      >
                        <div className="ah-unit-modal__chip-meta">{sub}</div>
                        <div className="ah-unit-modal__chip-fields">
                          <label className="ah-unit-modal__sr" htmlFor={`um-u-${row.key}`}>
                            Đơn vị
                          </label>
                          <input
                            id={`um-u-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__chip-input"
                            value={row.unitLabel}
                            onChange={(e) =>
                              setUnitModal((m) =>
                                m
                                  ? {
                                      ...m,
                                      lines: m.lines.map((r) =>
                                        r.key === row.key ? { ...r, unitLabel: e.target.value } : r
                                      ),
                                    }
                                  : m
                              )
                            }
                            placeholder="Ví dụ: Chai"
                            autoComplete="off"
                          />
                          <label className="ah-unit-modal__sr" htmlFor={`um-c-${row.key}`}>
                            Quy đổi
                          </label>
                          <input
                            id={`um-c-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__chip-input ah-unit-modal__chip-input--conv"
                            inputMode="decimal"
                            value={row.conversion}
                            onChange={(e) => updateUnitModalConversionAtKey(row.key, e.target.value)}
                            placeholder="1"
                          />
                          {idx > 0 ? (
                            <button
                              type="button"
                              className="ah-unit-modal__chip-remove"
                              aria-label="Xóa đơn vị"
                              onClick={() => removeUnitModalRowKey(row.key)}
                            >
                              ×
                            </button>
                          ) : (
                            <span className="ah-unit-modal__chip-spacer" aria-hidden />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="ah-unit-modal__add-inline ah-unit-modal__add-inline--desktop"
                  onClick={addUnitModalRow}
                >
                  + Thêm đơn vị
                </button>
              </section>
              <section className="ah-unit-modal__section">
                <h3 className="ah-unit-modal__section-title">Thuộc tính</h3>
                <p className="ah-unit-modal__muted">Chưa có thuộc tính.</p>
              </section>
              <section className="ah-unit-modal__section">
                <h3 className="ah-unit-modal__section-title">Hàng cùng loại</h3>
                <p className="ah-unit-modal__lead ah-unit-modal__lead--tight">
                  Bảng đồng bộ với đơn vị ở trên. Nhập giá vốn / giá bán ở đơn vị nhỏ nhất để hệ thống nhân theo tỷ
                  lệ quy đổi (có thể chỉnh tay từng dòng).
                </p>
                <div className="admin-hub-table-wrap ah-unit-modal__table-wrap">
                  <table className="admin-hub-table ah-unit-modal__table ah-unit-modal__table--desktop">
                    <thead>
                      <tr>
                        <th>Đơn vị</th>
                        <th className="ah-num">Quy đổi</th>
                        <th>Mã hàng</th>
                        <th>Mã vạch</th>
                        <th className="ah-num">Giá vốn</th>
                        <th className="ah-num">Giá bán</th>
                        <th aria-label="Xóa" />
                      </tr>
                    </thead>
                    <tbody>
                      {unitModalSortedRows.map((row, idx) => (
                        <tr key={`tbl-${row.key}`}>
                          <td>
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input"
                              value={row.unitLabel}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, unitLabel: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--narrow"
                              inputMode="decimal"
                              value={row.conversion}
                              onChange={(e) => updateUnitModalConversionAtKey(row.key, e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input"
                              value={row.code}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, code: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input"
                              value={row.barcode}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, barcode: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--money"
                              inputMode="numeric"
                              value={row.cost}
                              onChange={(e) =>
                                updateUnitModalCostAtKey(row.key, e.target.value.replace(/\D/g, ''))
                              }
                            />
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--money"
                              inputMode="numeric"
                              value={row.price}
                              onChange={(e) =>
                                updateUnitModalPriceAtKey(row.key, e.target.value.replace(/\D/g, ''))
                              }
                            />
                          </td>
                          <td>
                            {idx > 0 ? (
                              <button
                                type="button"
                                className="ah-unit-modal__row-remove"
                                aria-label="Xóa dòng"
                                onClick={() => removeUnitModalRowKey(row.key)}
                              >
                                Xóa
                              </button>
                            ) : (
                              <span className="admin-hub-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div
                    className="ah-unit-modal__dvt-cards-mobile"
                    aria-label="Đơn vị tính: nhập liệu dạng thẻ (mobile)"
                  >
                    {unitModalSortedRows.map((row, idx) => {
                      const baseLbl =
                        normalizeCatalogUnitLabel(unitModalSortedRows[0]?.unitLabel || '').trim() ||
                        'đơn vị cơ bản'
                      const conv = parsePositiveConversion(row.conversion) ?? 1
                      const sub =
                        idx === 0
                          ? 'Đơn vị cơ bản'
                          : `1 ${normalizeCatalogUnitLabel(row.unitLabel) || '…'} = ${conv} ${baseLbl}`
                      return (
                        <div
                          key={`um-mob-${row.key}`}
                          className={`ah-unit-modal__dvt-card${idx === 0 ? ' ah-unit-modal__dvt-card--base' : ''}`}
                        >
                          <p className="ah-unit-modal__dvt-card-meta">{sub}</p>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-u-${row.key}`}>Tên ĐVT</label>
                            <input
                              id={`um-mob-u-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                              value={row.unitLabel}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, unitLabel: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </div>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-c-${row.key}`}>Quy đổi</label>
                            <input
                              id={`um-mob-c-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                              inputMode="decimal"
                              value={row.conversion}
                              onChange={(e) => updateUnitModalConversionAtKey(row.key, e.target.value)}
                            />
                          </div>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-code-${row.key}`}>Mã hàng</label>
                            <input
                              id={`um-mob-code-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                              value={row.code}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, code: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </div>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-bc-${row.key}`}>Mã vạch</label>
                            <input
                              id={`um-mob-bc-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                              value={row.barcode}
                              onChange={(e) =>
                                setUnitModal((m) =>
                                  m
                                    ? {
                                        ...m,
                                        lines: m.lines.map((r) =>
                                          r.key === row.key ? { ...r, barcode: e.target.value } : r
                                        ),
                                      }
                                    : m
                                )
                              }
                            />
                          </div>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-cost-${row.key}`}>Giá vốn</label>
                            <input
                              id={`um-mob-cost-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--money ah-unit-modal__touch-input"
                              inputMode="numeric"
                              value={row.cost}
                              onChange={(e) =>
                                updateUnitModalCostAtKey(row.key, e.target.value.replace(/\D/g, ''))
                              }
                            />
                          </div>
                          <div className="ah-unit-modal__dvt-card-field">
                            <label htmlFor={`um-mob-p-${row.key}`}>Giá bán</label>
                            <input
                              id={`um-mob-p-${row.key}`}
                              className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--money ah-unit-modal__touch-input"
                              inputMode="numeric"
                              value={row.price}
                              onChange={(e) =>
                                updateUnitModalPriceAtKey(row.key, e.target.value.replace(/\D/g, ''))
                              }
                            />
                          </div>
                          {idx > 0 ? (
                            <button
                              type="button"
                              className="ah-unit-modal__row-remove ah-unit-modal__row-remove--mobile-block"
                              onClick={() => removeUnitModalRowKey(row.key)}
                            >
                              Xóa đơn vị
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="ah-unit-modal__add-inline ah-unit-modal__add-inline--mobile"
                    onClick={addUnitModalRow}
                  >
                    + Thêm đơn vị
                  </button>
                </div>
              </section>
            </div>
            </div>
            <footer className="ah-unit-modal__foot">
              <button type="button" className="ah-iv-btn ah-iv-btn--ghost" onClick={closeUnitModal}>
                Bỏ qua
              </button>
              <button type="button" className="ah-iv-btn ah-iv-btn--primary" onClick={commitUnitModal}>
                Xong
              </button>
            </footer>
          </div>
        </div>
      )}

      {typeof document !== 'undefined'
        ? createPortal(
            <>
              {hubCameraToast ? (
                <div
                  className={`ah-hub-scan-toast${hubCameraToast.kind === 'err' ? ' ah-hub-scan-toast--error' : ''}`}
                  role={hubCameraToast.kind === 'err' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {hubCameraToast.text}
                </div>
              ) : null}

              {inboundSyncErrMsg ? (
                <div className="ah-inbound-sync-err-toast" role="alert">
                  Đồng bộ thất bại: {inboundSyncErrMsg}
                </div>
              ) : null}

              {goodsSaveToastGen > 0 ? (
                <div
                  key={goodsSaveToastGen}
                  className="ah-save-toast"
                  role="status"
                  aria-live="polite"
                  onAnimationEnd={(e) => {
                    if (e.target !== e.currentTarget) return
                    setGoodsSaveToastGen(0)
                  }}
                >
                  Cập nhật sản phẩm thành công
                </div>
              ) : null}

              {supplierSavedToastGen > 0 ? (
                <div
                  key={`ncc-toast-${supplierSavedToastGen}`}
                  className="ah-save-toast ah-save-toast--supplier"
                  role="status"
                  aria-live="polite"
                  onAnimationEnd={(e) => {
                    if (e.target !== e.currentTarget) return
                    setSupplierSavedToastGen(0)
                  }}
                >
                  Đã lưu nhà cung cấp
                </div>
              ) : null}

              {inboundSaveToastGen > 0 ? (
                <div
                  key={`inb-toast-${inboundSaveToastGen}`}
                  className="ah-save-toast ah-save-toast--inbound"
                  role="status"
                  aria-live="polite"
                  onAnimationEnd={(e) => {
                    if (e.target !== e.currentTarget) return
                    setInboundSaveToastGen(0)
                  }}
                >
                  Đã lưu phiếu nhập — xem thêm ở chuông thông báo nếu có thay đổi giá vốn
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </div>
  )
}
