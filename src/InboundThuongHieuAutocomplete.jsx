import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
const DROPDOWN_MAX_H = 280

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

/**
 * Ô Nhà cung cấp / thương hiệu phiếu nhập: nhập + lọc + tối đa 50 gợi ý (virtual list).
 * @param {{ value: string, onValueChange: (s: string) => void, options: string[], placeholder?: string, id?: string }} props
 */
export default function InboundThuongHieuAutocomplete({
  value,
  onValueChange,
  options,
  placeholder = 'Chọn hoặc gõ thương hiệu…',
  id = 'ah-inbound-ncc-combo',
}) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useListRef()
  const [open, setOpen] = useState(false)
  const [listW, setListW] = useState(280)

  const all = useMemo(() => (Array.isArray(options) ? options : []).filter(Boolean), [options])

  const filtered = useMemo(() => {
    const q = String(value ?? '').trim().toLowerCase()
    if (!q) return all.slice(0, MAX_VISIBLE)
    const out = []
    for (const n of all) {
      if (String(n).toLowerCase().includes(q)) {
        out.push(n)
        if (out.length >= MAX_VISIBLE) break
      }
    }
    return out
  }, [all, value])

  const listHeight = Math.min(filtered.length * ROW_H, DROPDOWN_MAX_H)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (w > 40) setListW(w)
    })
    ro.observe(el)
    const w0 = el.clientWidth
    if (w0 > 40) setListW(w0)
    return () => ro.disconnect()
  }, [])

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
  }, [open, value, filtered.length, listRef])

  const showList = filtered.length > 0
  const showEmptyHint =
    filtered.length === 0 && all.length > 0 && String(value ?? '').trim().length > 0
  const showNoCatalogHint = all.length === 0
  const showDropdownPanel = open && (showList || showEmptyHint || showNoCatalogHint)

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
      {showDropdownPanel && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className={`ah-inbound-ncc-combo-dropdown${showList ? ' is-open' : ''}`}
        >
          {showNoCatalogHint ? (
            <div className="ah-inbound-ncc-combo-hint">
              Chưa có thương hiệu trong danh mục — nhập tay hoặc tải CSV có cột <strong>thuong_hieu</strong>.
            </div>
          ) : showEmptyHint ? (
            <div className="ah-inbound-ncc-combo-hint">Không khớp danh sách — giữ nội dung đã gõ (nhà cung cấp tùy chọn).</div>
          ) : (
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
                  width: listW,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
