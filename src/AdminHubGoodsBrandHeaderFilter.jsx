import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Tiêu đề cột Thương hiệu + dropdown lọc. State ô tìm trong dropdown giữ trong component
 * để gõ tìm không làm re-render toàn bộ AdminHub / virtual list.
 */
export const AdminHubGoodsBrandHeaderFilter = memo(function AdminHubGoodsBrandHeaderFilter({
  brandOptions,
  selectedBrand,
  onSelectBrand,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)
  const searchRef = useRef(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return brandOptions
    return brandOptions.filter((b) => String(b).toLowerCase().includes(q))
  }, [brandOptions, search])

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = useCallback(
    (key) => {
      onSelectBrand(key)
      setOpen(false)
      setSearch('')
    },
    [onSelectBrand]
  )

  return (
    <div className="ah-goods-th-brand" ref={wrapRef}>
      <button
        type="button"
        className={`ah-goods-th-brand-trigger${selectedBrand ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Lọc theo thương hiệu"
        title="Lọc theo thương hiệu (cột D · file danh mục)"
        onClick={() => setOpen((was) => !was)}
      >
        <span className="ah-goods-th-brand-label">Thương hiệu</span>
        <span className="ah-goods-th-brand-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          className="ah-goods-filter-pop ah-goods-th-brand-pop"
          role="listbox"
          aria-label="Chọn thương hiệu"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="ah-goods-brand-search-wrap">
            <input
              ref={searchRef}
              className="ah-goods-brand-search"
              type="search"
              placeholder="Tìm nhanh tên thương hiệu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setOpen(false)
                  setSearch('')
                }
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="ah-goods-filter-pop-scroll ah-goods-th-brand-pop-scroll">
            <button
              type="button"
              role="option"
              className={!selectedBrand ? 'is-active' : ''}
              onClick={() => pick('')}
            >
              Tất cả thương hiệu
            </button>
            {brandOptions.length === 0 ? (
              <div className="ah-goods-filter-empty">Chưa có thương hiệu trong dữ liệu (cột D trống hoặc chưa nhập).</div>
            ) : filtered.length === 0 ? (
              <div className="ah-goods-filter-empty">Không có thương hiệu khớp.</div>
            ) : (
              filtered.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="option"
                  className={selectedBrand === b ? 'is-active' : ''}
                  onClick={() => pick(b)}
                >
                  {b}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
})
