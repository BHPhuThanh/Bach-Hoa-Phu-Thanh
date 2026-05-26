import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { List, useListRef } from 'react-window'

/**
 * Thu thập giá trị duy nhất của thương hiệu (CSV `thuong_hieu` → field `brand`/`thuong_hieu` trên biến thể và nhóm).
 */
export function collectUniqueThuongHieuFromCatalog(catalogList) {
  const s = new Set()
  for (const p of catalogList || []) {
    for (const t of [String(p?.brand ?? '').trim(), String(p?.thuong_hieu ?? '').trim()]) {
      if (t) s.add(t)
    }
    for (const v of p.groupVariants || [p]) {
      for (const t of [String(v?.brand ?? '').trim(), String(v?.thuong_hieu ?? '').trim()]) {
        if (t) s.add(t)
      }
    }
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'vi'))
}

const ROW_H = 36
const MAX_VISIBLE = 50
const DROPDOWN_Z_INDEX = 100000
/** Chiều cao tối đa vùng cuộn danh sách gợi ý (px) — modal Tạo HH / chi tiết dùng ~220–240. */
const DEFAULT_LIST_MAX_H = 228

const NccSuggestRow = memo(function NccSuggestRow({ index, style, items, onPick }) {
  const label = items[index]
  if (!label) return null
  return (
    <div className="ah-inbound-ncc-vrow" style={style}>
      <button
        type="button"
        className="ah-inbound-ncc-vrow-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(label)}
      >
        <span className="ah-inbound-ncc-vrow-txt">{label}</span>
      </button>
    </div>
  )
})

function useDebouncedFilterQuery(raw, debounceMs) {
  const [out, setOut] = useState(raw)
  useEffect(() => {
    if (debounceMs <= 0) {
      setOut(raw)
      return undefined
    }
    const t = window.setTimeout(() => setOut(raw), debounceMs)
    return () => window.clearTimeout(t)
  }, [raw, debounceMs])
  return debounceMs <= 0 ? raw : out
}

/**
 * Ô Nhà cung cấp / thương hiệu phiếu nhập: nhập + lọc + tối đa 50 gợi ý (virtual list).
 * Dropdown render qua Portal → không bị cắt bởi overflow của Modal.
 */
export default function InboundThuongHieuAutocomplete({
  value,
  onValueChange,
  options,
  placeholder = 'Chọn hoặc gõ thương hiệu…',
  id = 'ah-inbound-ncc-combo',
  filterDebounceMs = 0,
  listMaxHeight = DEFAULT_LIST_MAX_H,
  showAddSupplierEntry = false,
  onRequestAddSupplier,
}) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useListRef()
  const [open, setOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState(null)

  const all = useMemo(() => (Array.isArray(options) ? options : []).filter(Boolean), [options])
  const filterQ = useDebouncedFilterQuery(value, filterDebounceMs)

  const filtered = useMemo(() => {
    const q = String(filterQ ?? '').trim().toLowerCase()
    if (!q) return all.slice(0, MAX_VISIBLE)
    const out = []
    for (const n of all) {
      if (String(n).toLowerCase().includes(q)) {
        out.push(n)
        if (out.length >= MAX_VISIBLE) break
      }
    }
    return out
  }, [all, filterQ])

  const listCap = Math.max(120, Math.min(280, Number(listMaxHeight) || DEFAULT_LIST_MAX_H))
  const listHeight = Math.min(filtered.length * ROW_H, listCap)
  const showAddRow = Boolean(showAddSupplierEntry && typeof onRequestAddSupplier === 'function')

  const measureAnchor = useCallback(() => {
    const el = inputRef.current || wrapRef.current
    if (!el) {
      setAnchorRect(null)
      return
    }
    setAnchorRect(el.getBoundingClientRect())
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 40 && open) measureAnchor()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, measureAnchor])

  const onPick = useCallback(
    (label) => {
      onValueChange(String(label ?? ''))
      setOpen(false)
      inputRef.current?.focus()
    },
    [onValueChange]
  )

  const rowProps = useMemo(() => ({ items: filtered, onPick }), [filtered, onPick])

  useLayoutEffect(() => {
    if (!open) return
    listRef.current?.scrollToRow?.({ index: 0, align: 'start', behavior: 'instant' })
  }, [open, filterQ, filtered.length, listRef])

  const showList = filtered.length > 0
  const showEmptyHint =
    filtered.length === 0 && all.length > 0 && String(filterQ ?? '').trim().length > 0
  const showNoCatalogHint = all.length === 0
  const showDropdownPanel = open && (showAddRow || showList || showEmptyHint || showNoCatalogHint)

  useLayoutEffect(() => {
    if (!showDropdownPanel) {
      setAnchorRect(null)
      return undefined
    }
    measureAnchor()
    const onScrollOrResize = () => measureAnchor()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [showDropdownPanel, measureAnchor])

  const dropdownLayout = useMemo(() => {
    if (!anchorRect) return null
    const extraH =
      (showAddRow ? 44 : 0) + (showEmptyHint || showNoCatalogHint ? 56 : 0)
    const panelH = Math.min(listHeight + extraH, 320)
    const spaceBelow = window.innerHeight - anchorRect.bottom - 8
    const spaceAbove = anchorRect.top - 8
    const dropUp = spaceBelow < panelH && spaceAbove > spaceBelow
    const width = Math.max(anchorRect.width, 160)
    const left = Math.min(
      Math.max(8, anchorRect.left),
      Math.max(8, window.innerWidth - width - 8)
    )
    if (dropUp) {
      return {
        left,
        width,
        bottom: window.innerHeight - anchorRect.top + 4,
        maxHeight: Math.min(panelH, anchorRect.top - 12),
        dropUp: true,
      }
    }
    return {
      left,
      width,
      top: anchorRect.bottom + 4,
      maxHeight: Math.min(panelH, spaceBelow),
      dropUp: false,
    }
  }, [
    anchorRect,
    listHeight,
    showAddRow,
    showEmptyHint,
    showNoCatalogHint,
  ])

  const fireAddSupplier = useCallback(() => {
    setOpen(false)
    onRequestAddSupplier?.()
  }, [onRequestAddSupplier])

  const dropdownPanel =
    showDropdownPanel && dropdownLayout && typeof document !== 'undefined' ? (
      <div
        id={`${id}-listbox`}
        role="listbox"
        aria-label="Gợi ý"
        className={`ah-inbound-ncc-combo-dropdown ah-inbound-ncc-combo-dropdown--portal${showList ? ' is-open' : ''}${dropdownLayout.dropUp ? ' is-drop-up' : ''}`}
        style={{
          position: 'fixed',
          zIndex: DROPDOWN_Z_INDEX,
          left: dropdownLayout.left,
          width: dropdownLayout.width,
          maxHeight: dropdownLayout.maxHeight,
          ...(dropdownLayout.dropUp
            ? { bottom: dropdownLayout.bottom, top: 'auto' }
            : { top: dropdownLayout.top, bottom: 'auto' }),
        }}
      >
        {showAddRow ? (
          <div className="ah-inbound-ncc-combo-add-supplier">
            <button
              type="button"
              className="ah-inbound-ncc-combo-add-supplier-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fireAddSupplier()}
            >
              <span className="ah-inbound-ncc-combo-add-supplier-plus" aria-hidden>
                +
              </span>
              Thêm NCC
            </button>
          </div>
        ) : null}
        {showNoCatalogHint ? (
          <div className="ah-inbound-ncc-combo-hint">
            Chưa có thương hiệu trong danh mục — nhập tay hoặc tải CSV có cột <strong>thuong_hieu</strong>.
          </div>
        ) : showEmptyHint ? (
          <div className="ah-inbound-ncc-combo-hint">Không khớp danh sách — giữ nội dung đã gõ (nhà cung cấp tùy chọn).</div>
        ) : showList ? (
          <div className="ah-inbound-ncc-combo-list-inner" style={{ height: listHeight }}>
            <List
              listRef={listRef}
              rowCount={filtered.length}
              rowHeight={ROW_H}
              rowProps={rowProps}
              rowComponent={NccSuggestRow}
              overscanCount={8}
              style={{
                height: listHeight,
                width: dropdownLayout.width,
              }}
            />
          </div>
        ) : null}
      </div>
    ) : null

  return (
    <div className="ah-inbound-ncc-combo-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        className="ah-inbound-form-input ah-inbound-ncc-combo-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-listbox`}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 200)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {dropdownPanel ? createPortal(dropdownPanel, document.body) : null}
    </div>
  )
}
