import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import debounce from 'lodash/debounce'
import { List, useListRef } from 'react-window'
import {
  filterAndSortGoodsRowsSimpleWithFallback,
  prepareCatalogForPosSearch,
} from './catalogSearchSimple.js'
import { fetchProducts } from './catalogRepository.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import { flattenCatalogToGoodsSearchRows } from './catalogGoodsSearchRows.js'
import CostAdjustCatalogSearchInput from './CostAdjustCatalogSearchInput.jsx'

const ROW_H = 56
/** Chiều cao cố định — tránh AutoSizer co về 0 khiến vùng list đen/trống. */
const MODAL_LIST_HEIGHT_PX = 460

/** react-window List trải `rowProps` ra props top-level. */
const QuickPickVirtualRow = memo(function QuickPickVirtualRow({ index, style, rows, selectedIds, onToggleId }) {
  const row = rows[index]
  if (!row) return null
  const v = row._variant
  const p = row._product
  if (!v || !p) return null
  const vid = String(v.id)
  const checked = selectedIds.has(vid)
  return (
    <div className="cac-modal__vrow" style={style}>
      <label className="cac-modal__row">
        <input type="checkbox" checked={checked} onChange={() => onToggleId(v.id)} />
        <span>
          <strong>{p.name || '—'}</strong>
          <div className="cac-modal__row-sub">
            {String(v.code ?? '').trim() || '—'} · {normalizeCatalogUnitLabel(v.unitLabel)}
          </div>
        </span>
      </label>
    </div>
  )
})

/**
 * @param {{ open: boolean, products: Array, selectedIds: Set<string>, onToggleId: (id: string|number) => void, onConfirm: (pickedRows: Array<{ _product: object, _variant: object }>) => void, onCancel: () => void }} props
 */
export default function CostAdjustQuickPickModal({
  open,
  products,
  preferParentCatalog = false,
  selectedIds,
  onToggleId,
  onConfirm,
  onCancel,
}) {
  const modalSearchRef = useRef(null)
  const listWrapRef = useRef(null)
  const [modalSearchQ, setModalSearchQ] = useState('')
  const [modalSearchDebounced, setModalSearchDebounced] = useState('')
  const modalSearchDebouncedRef = useRef(null)
  if (modalSearchDebouncedRef.current == null) {
    modalSearchDebouncedRef.current = debounce((q) => setModalSearchDebounced(q), 300)
  }
  useEffect(() => {
    modalSearchDebouncedRef.current(modalSearchQ)
  }, [modalSearchQ])
  useEffect(() => () => modalSearchDebouncedRef.current?.cancel(), [])

  const [catalogSnapshot, setCatalogSnapshot] = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [listWidth, setListWidth] = useState(640)
  const listRef = useListRef()

  /**
   * catalogSnapshot null: chưa fetch xong → dùng products từ trang.
   * Sau fetch: ưu tiên snapshot IndexedDB; nếu kho trả [] nhưng trang vẫn có cache thì dùng products.
   */
  const effectiveProducts = useMemo(() => {
    if (catalogSnapshot == null) return Array.isArray(products) ? products : []
    if (catalogSnapshot.length > 0) return catalogSnapshot
    return Array.isArray(products) && products.length > 0 ? products : catalogSnapshot
  }, [catalogSnapshot, products])

  const preparedProducts = useMemo(
    () => prepareCatalogForPosSearch(effectiveProducts),
    [effectiveProducts]
  )

  const goodsRowsAll = useMemo(
    () => flattenCatalogToGoodsSearchRows(preparedProducts),
    [preparedProducts]
  )

  const filteredRows = useMemo(() => {
    const raw = modalSearchDebounced.trim()
    if (!raw) return goodsRowsAll
    return filterAndSortGoodsRowsSimpleWithFallback(goodsRowsAll, raw)
  }, [goodsRowsAll, modalSearchDebounced])

  useEffect(() => {
    if (!open) {
      setModalSearchQ('')
      setModalSearchDebounced('')
      setCatalogSnapshot(null)
      setCatalogLoading(false)
      return
    }
    if (preferParentCatalog && Array.isArray(products) && products.length > 0) {
      setCatalogSnapshot(products)
      setCatalogLoading(false)
      const t = window.setTimeout(() => modalSearchRef.current?.focus(), 80)
      return () => window.clearTimeout(t)
    }
    setCatalogLoading(true)
    void fetchProducts()
      .then((snap) => {
        const next = Array.isArray(snap?.products) ? snap.products : []
        setCatalogSnapshot(next)
      })
      .catch((e) => {
        console.warn('[CostAdjustQuickPickModal] fetchProducts', e)
        setCatalogSnapshot([])
      })
      .finally(() => setCatalogLoading(false))

    const t = window.setTimeout(() => modalSearchRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [open, preferParentCatalog, products])

  useLayoutEffect(() => {
    if (!open) return
    const el = listWrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 80) setListWidth(Math.floor(w))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.scrollToRow?.({ index: 0, align: 'start', behavior: 'instant' })
  }, [modalSearchDebounced, open, filteredRows.length])

  const rowProps = useMemo(
    () => ({
      rows: filteredRows,
      selectedIds,
      onToggleId,
    }),
    [filteredRows, selectedIds, onToggleId]
  )

  const onBackdropMouseDown = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onCancel()
    },
    [onCancel]
  )

  const rowByVariantId = useMemo(() => {
    const m = new Map()
    for (const r of goodsRowsAll) {
      const id = String(r?._variant?.id ?? '')
      if (id) m.set(id, r)
    }
    return m
  }, [goodsRowsAll])

  const handleConfirmClick = useCallback(() => {
    const picked = []
    for (const id of selectedIds) {
      const row = rowByVariantId.get(String(id))
      if (row) picked.push(row)
    }
    onConfirm(picked)
  }, [onConfirm, rowByVariantId, selectedIds])

  if (!open) return null

  const showEmptyMessage =
    !catalogLoading && goodsRowsAll.length === 0
      ? 'Chưa có danh mục trong kho lưu. Hãy nhập hàng ở tab Hàng hóa rồi thử lại.'
      : !catalogLoading && filteredRows.length === 0
        ? 'Không có dòng khớp.'
        : null

  return (
    <div className="cac-modal-backdrop" role="presentation" onMouseDown={onBackdropMouseDown}>
      <div className="cac-modal" role="dialog" aria-modal="true" aria-labelledby="cac-modal-title">
        <div className="cac-modal__head" id="cac-modal-title">
          Chọn nhanh sản phẩm
        </div>
        <div className="cac-modal__body cac-modal__body--virtual">
          <div className="cac-modal__search-row">
            <CostAdjustCatalogSearchInput
              inputRef={modalSearchRef}
              value={modalSearchQ}
              onChange={(e) => setModalSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setModalSearchQ('')
                  setModalSearchDebounced('')
                  modalSearchDebouncedRef.current?.cancel?.()
                }
              }}
              placeholder="Tìm theo tên, mã SKU, hoặc quét mã Barcode…"
              aria-label="Lọc danh sách trong modal Chọn nhanh"
            />
          </div>
          <p className="cac-modal__search-hint">
            Để trống = toàn bộ danh mục (đã đồng bộ từ kho). Lọc giống tab <strong>Hàng hóa</strong> + khớp tên/mã hiển thị nếu cần.
          </p>
          {catalogLoading ? (
            <div className="cac-modal__empty">Đang tải danh mục từ kho…</div>
          ) : (
            <div
              ref={listWrapRef}
              className="cac-modal__list cac-modal__list--virtual cac-modal__list--fixed"
              style={{ height: MODAL_LIST_HEIGHT_PX }}
            >
              {showEmptyMessage ? (
                <div className="cac-modal__empty">{showEmptyMessage}</div>
              ) : (
                <List
                  listRef={listRef}
                  rowCount={filteredRows.length}
                  rowHeight={ROW_H}
                  rowProps={rowProps}
                  rowComponent={QuickPickVirtualRow}
                  overscanCount={12}
                  style={{
                    height: MODAL_LIST_HEIGHT_PX,
                    width: listWidth,
                  }}
                />
              )}
            </div>
          )}
        </div>
        <div className="cac-modal__foot">
          <button type="button" className="cac-btn cac-btn--muted" onClick={onCancel}>
            Hủy
          </button>
          <button type="button" className="cac-btn cac-btn--primary" onClick={handleConfirmClick}>
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}
