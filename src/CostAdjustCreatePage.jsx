import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import debounce from 'lodash/debounce'
import { normalizeBarcodeValue } from './catalogCsv.js'
import {
  buildPosTextSearchScanList,
  posQueryLooksLikeBarcodeKeyInput,
  resolvePosSuggestCatalog,
} from './catalogSearchSimple.js'
import {
  applyProductDataToCatalog,
  fetchProducts,
  flattenDisplayCatalogToVariants,
  persistCatalogSnapshotAndProducts,
  describeCatalogPersistError,
  revalidateCatalogFromStore,
} from './catalogRepository.js'
import {
  appendCostAdjustVoucher,
  createHoanThanhCostAdjustVoucher,
  loadCostAdjustVouchersFromStore,
  peekNextCostAdjustCode,
  saveCostAdjustVouchersToStore,
} from './costAdjustStorage.js'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import CostAdjustQuickPickModal from './CostAdjustQuickPickModal.jsx'
import CostAdjustCatalogSearchInput from './CostAdjustCatalogSearchInput.jsx'
import './App.css'
import './dashboard-dark.css'
import './costAdjustCreatePage.css'

function formatMoneyDraftVi(n) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function parseMoneyDraftVi(raw) {
  const d = String(raw ?? '').replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  return Number.isFinite(n) ? n : 0
}

/** Chênh lệch có thể âm — bỏ dấu phẩy/chấm phân tách hàng nghìn. */
function parseSignedMoneyDraftVi(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '')
  const neg = s.startsWith('-')
  const d = s.replace(/[^\d]/g, '')
  if (!d) return 0
  const n = parseInt(d, 10)
  const v = Number.isFinite(n) ? n : 0
  return neg ? -v : v
}

function formatSignedMoneyVi(n) {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n)
  const abs = Math.abs(r)
  const t = abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (r < 0) return `-${t}`
  return t
}

function formatNowVi() {
  return new Date().toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function creatorLabel() {
  const id = readStoredSellerId()
  if (id === 'admin') return 'Admin'
  if (id === 'staff') return 'Nhân viên'
  return 'Admin'
}

function buildRowFromVariant(product, variant) {
  const c0 = Number(variant.cost) || 0
  return {
    key: String(variant.id),
    variantId: String(variant.id),
    productCode: String(variant.code ?? '').trim(),
    productName: String(product.name ?? '').trim() || '—',
    unitLabel: normalizeCatalogUnitLabel(variant.unitLabel),
    currentCost: c0,
    deltaDraft: formatSignedMoneyVi(0),
    afterDraft: formatMoneyDraftVi(c0),
  }
}

export default function CostAdjustCreatePage() {
  const searchRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState([])
  const [fileName, setFileName] = useState('')
  const [posScanList, setPosScanList] = useState([])
  const [voucherPreviewCode, setVoucherPreviewCode] = useState('GV001')
  const [createdAtLabel] = useState(() => formatNowVi())
  const [searchQ, setSearchQ] = useState('')
  const [searchQDebounced, setSearchQDebounced] = useState('')
  const searchQDebRef = useRef(null)
  if (searchQDebRef.current == null) {
    searchQDebRef.current = debounce((q) => setSearchQDebounced(q), 300)
  }
  useEffect(() => {
    searchQDebRef.current(searchQ)
  }, [searchQ])
  useEffect(() => () => searchQDebRef.current?.cancel(), [])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalSelected, setModalSelected] = useState(() => new Set())
  const [branch, setBranch] = useState('Chi nhánh mặc định')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const snap = await fetchProducts()
        if (snap?.products?.length) {
          setProducts(snap.products)
          setFileName(snap.fileName || '')
          setPosScanList(buildPosTextSearchScanList(snap.products, {}))
        }
        const vouchers = await loadCostAdjustVouchersFromStore()
        setVoucherPreviewCode(peekNextCostAdjustCode(vouchers))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F3') {
        e.preventDefault()
        searchRef.current?.focus?.()
        searchRef.current?.select?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const suggestRows = useMemo(() => {
    const q = searchQDebounced.trim()
    if (!q || !products.length) return []
    const prods = resolvePosSuggestCatalog({
      products,
      posScanList,
      rawQuery: q,
      productsByBarcodeKey: null,
    })
    const out = []
    for (const p of prods) {
      const vars = p.groupVariants || [p]
      for (const v of vars) {
        out.push({ product: p, variant: v })
        if (out.length >= 15) return out
      }
    }
    return out
  }, [searchQDebounced, products, posScanList])

  const existingIds = useMemo(() => new Set(rows.map((r) => r.variantId)), [rows])

  const addVariant = useCallback(
    (product, variant) => {
      const id = String(variant.id)
      if (existingIds.has(id)) return
      setRows((r) => [...r, buildRowFromVariant(product, variant)])
      setSearchQ('')
      setSuggestOpen(false)
      setPage(1)
    },
    [existingIds]
  )

  const onSearchKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSuggestOpen(false)
        e.currentTarget.blur()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const q = searchQ.trim()
        if (!q || !products.length) return
        if (posQueryLooksLikeBarcodeKeyInput(q)) {
          const needle = String(normalizeBarcodeValue(q))
          for (const p of products) {
            const vars = p.groupVariants || [p]
            for (const v of vars) {
              if (needle && String(normalizeBarcodeValue(v.barcode ?? '')) === needle) {
                addVariant(p, v)
                return
              }
            }
          }
        }
        const first = suggestRows[0]
        if (first) addVariant(first.product, first.variant)
      }
    },
    [searchQ, products, suggestRows, addVariant]
  )

  const updateAfter = useCallback((key, raw) => {
    const newAfter = parseMoneyDraftVi(raw)
    setRows((list) =>
      list.map((row) => {
        if (row.key !== key) return row
        const delta = newAfter - row.currentCost
        return {
          ...row,
          afterDraft: formatMoneyDraftVi(newAfter),
          deltaDraft: formatSignedMoneyVi(delta),
        }
      })
    )
  }, [])

  const updateDelta = useCallback((key, raw) => {
    const delta = parseSignedMoneyDraftVi(raw)
    setRows((list) =>
      list.map((row) => {
        if (row.key !== key) return row
        const newAfter = row.currentCost + delta
        return {
          ...row,
          deltaDraft: formatSignedMoneyVi(delta),
          afterDraft: formatMoneyDraftVi(newAfter),
        }
      })
    )
  }, [])

  const removeRow = useCallback((key) => {
    setRows((list) => list.filter((r) => r.key !== key))
  }, [])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize) || 1)
  const pageSafe = Math.min(page, totalPages)
  const pageRows = useMemo(() => {
    const start = (pageSafe - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, pageSafe, pageSize])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const toggleModalSel = useCallback((vid) => {
    const id = String(vid)
    setModalSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const confirmModal = useCallback((pickedRows) => {
    const rows = Array.isArray(pickedRows) ? pickedRows : []
    setRows((cur) => {
      const have = new Set(cur.map((r) => r.variantId))
      const next = [...cur]
      for (const r of rows) {
        const vid = String(r?._variant?.id ?? '')
        if (!vid || have.has(vid)) continue
        have.add(vid)
        next.push(buildRowFromVariant(r._product, r._variant))
      }
      return next
    })
    setModalOpen(false)
    setModalSelected(new Set())
    setPage(1)
  }, [])

  const handleComplete = useCallback(async () => {
    if (saving) return
    const lines = []
    let nextProducts = products
    for (const row of rows) {
      const newCost = parseMoneyDraftVi(row.afterDraft)
      const oldCost = row.currentCost
      if (newCost === oldCost) continue
      lines.push({
        variantId: row.variantId,
        productCode: row.productCode || '—',
        productName: row.productName || '—',
        unitLabel: row.unitLabel || '—',
        oldCost,
        newCost,
      })
      nextProducts = applyProductDataToCatalog(nextProducts, {
        type: 'patch_variant',
        variantId: row.variantId,
        patch: { cost: newCost },
      })
    }
    if (lines.length === 0) {
      window.alert('Thêm ít nhất một dòng và nhập giá sau điều chỉnh khác giá vốn hiện tại.')
      return
    }
    setSaving(true)
    try {
      const flatNext = flattenDisplayCatalogToVariants(nextProducts)
      const changedIds = new Set(lines.map((l) => String(l.variantId)))
      const danh_sách_cập_nhật_giá_vốn = flatNext.filter((v) => changedIds.has(String(v?.id)))

      let persistResult
      if (isSupabaseConfigured()) {
        if (!danh_sách_cập_nhật_giá_vốn.length) {
          window.alert('Không tìm thấy biến thể trên danh mục để ghi giá vốn lên máy chủ.')
          return
        }
        persistResult = await persistCatalogSnapshotAndProducts(nextProducts, fileName, {
          upsertOnlyVariants: danh_sách_cập_nhật_giá_vốn,
        })
        if (!persistResult.ok) {
          window.alert(
            describeCatalogPersistError(persistResult.error) ||
              'Không lưu được danh mục / giá vốn lên máy chủ.'
          )
          return
        }
        /**
         * Đồng bộ `products`/`gia_von` thực hiện trong persistCatalogSnapshotAndProducts → saveProductsToSupabaseUpsertOnly,
         * tương đương: `await supabase.from('products').upsert(..., { onConflict: 'ma_hang' })` (PK của bảng trong dự án, không phải cột `id` UUID).
         */
        const fresh = await revalidateCatalogFromStore()
        if (fresh?.products?.length) {
          setProducts(fresh.products)
          setFileName(fresh.fileName || fileName)
        }
      } else {
        persistResult = await persistCatalogSnapshotAndProducts(nextProducts, fileName)
        if (!persistResult.ok) {
          window.alert(
            describeCatalogPersistError(persistResult.error) || 'Không lưu được danh mục cục bộ.'
          )
          return
        }
      }
      const prev = await loadCostAdjustVouchersFromStore()
      const voucher = createHoanThanhCostAdjustVoucher(prev, {
        createdBy: creatorLabel(),
        lines,
        note,
        branchLabel: branch,
        tags,
      })
      const merged = appendCostAdjustVoucher(prev, voucher)
      await saveCostAdjustVouchersToStore(merged)
      window.alert(`Đã lưu phiếu ${voucher.code} và cập nhật giá vốn.`)
      window.close()
    } catch (err) {
      console.error(err)
      window.alert('Lưu thất bại. Thử lại hoặc kiểm tra quyền trình duyệt.')
    } finally {
      setSaving(false)
    }
  }, [rows, products, fileName, note, branch, tags, saving])

  const exitPage = useCallback(() => {
    window.close()
  }, [])

  if (loading) {
    return (
      <div className="app app--dark">
        <div className="cac-loading">Đang tải danh mục…</div>
      </div>
    )
  }

  if (!products.length) {
    return (
      <div className="app app--dark">
        <div className="cac-page">
          <h1 className="cac-page__title">Tạo phiếu điều chỉnh giá vốn</h1>
          <p className="cac-muted" style={{ maxWidth: '32rem' }}>
            Chưa có danh mục hàng trong trình duyệt. Hãy nhập file sản phẩm từ ứng dụng chính (tab Hàng hóa), sau đó mở
            lại trang này.
          </p>
          <div className="cac-footer" style={{ border: 'none', paddingTop: '1rem' }}>
            <button type="button" className="cac-btn cac-btn--muted" onClick={exitPage}>
              Thoát
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app app--dark">
      <div className="cac-page">
        <h1 className="cac-page__title">Tạo phiếu điều chỉnh giá vốn</h1>

        <div className="cac-grid-top">
          <div className="cac-card">
            <h2 className="cac-card__head">Thông tin phiếu</h2>
            <div className="cac-field-grid">
              <div className="cac-field cac-field--readonly">
                <label>Mã phiếu</label>
                <input readOnly value={voucherPreviewCode} />
              </div>
              <div className="cac-field">
                <label className="cac-req">Chi nhánh</label>
                <select value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="Chi nhánh mặc định">Chi nhánh mặc định</option>
                </select>
              </div>
              <div className="cac-field cac-field--readonly">
                <label>Người tạo</label>
                <input readOnly value={creatorLabel()} />
              </div>
              <div className="cac-field cac-field--readonly">
                <label>Ngày tạo</label>
                <input readOnly value={createdAtLabel} />
              </div>
            </div>
          </div>

          <div className="cac-card">
            <h2 className="cac-card__head">Thông tin bổ sung</h2>
            <div className="cac-field" style={{ marginBottom: '0.65rem' }}>
              <label>Ghi chú</label>
              <textarea
                placeholder="VD: Điều chỉnh theo biên bản kiểm kê"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="cac-field">
              <label>Tags</label>
              <input
                placeholder="Nhập ký tự và ấn enter (lưu dạng text)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>
        </div>

        <section className="cac-products" aria-labelledby="cac-prod-head">
          <h2 id="cac-prod-head" className="cac-products__head">
            Thông tin sản phẩm
          </h2>
          <div className="cac-search-row">
            <CostAdjustCatalogSearchInput
              inputRef={searchRef}
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value)
                setSuggestOpen(true)
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setSuggestOpen(false), 180)
              }}
              onKeyDown={onSearchKeyDown}
            />
            <button
              type="button"
              className="cac-btn cac-btn--ghost"
              onClick={() => {
                setModalSelected(new Set())
                setModalOpen(true)
              }}
            >
              Chọn nhanh
            </button>
          </div>
          <p className="cac-muted">Gõ tên hoặc quét mã vạch, Enter để thêm dòng đầu tiên trong gợi ý. Phím F3 đưa con trỏ vào ô tìm kiếm.</p>

          {suggestOpen && searchQ.trim() && suggestRows.length > 0 ? (
            <div className="cac-suggest">
              <div className="cac-suggest__list" role="listbox">
                {suggestRows.map(({ product, variant }) => (
                  <button
                    key={variant.id}
                    type="button"
                    className="cac-suggest__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addVariant(product, variant)}
                  >
                    <div className="cac-suggest__name">{product.name || '—'}</div>
                    <div className="cac-suggest__sub">
                      {String(variant.code ?? '').trim() || '—'} ·{' '}
                      {normalizeCatalogUnitLabel(variant.unitLabel)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cac-table-wrap">
            <table className="cac-table">
              <colgroup>
                <col className="cac-col-stt" />
                <col className="cac-col-name" />
                <col className="cac-col-cur" />
                <col className="cac-col-delta" />
                <col className="cac-col-after" />
                <col className="cac-col-act" />
              </colgroup>
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Tên sản phẩm</th>
                  <th className="cac-num">Giá vốn hiện tại</th>
                  <th className="cac-num">Chênh lệch</th>
                  <th className="cac-num">Sau điều chỉnh</th>
                  <th aria-label="Xóa" />
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'rgba(148,163,184,0.85)', padding: '1.25rem' }}>
                      Chưa có dòng — dùng ô tìm kiếm hoặc Chọn nhanh.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, i) => (
                    <tr key={row.key}>
                      <td>{(pageSafe - 1) * pageSize + i + 1}</td>
                      <td>
                        <div className="cac-name-main">{row.productName}</div>
                        <div className="cac-name-code">{row.productCode || '—'}</div>
                      </td>
                      <td className="cac-num">{formatMoneyDraftVi(row.currentCost)}</td>
                      <td className="cac-num">
                        <input
                          className="cac-in"
                          aria-label="Chênh lệch"
                          value={row.deltaDraft}
                          onChange={(e) => updateDelta(row.key, e.target.value)}
                        />
                      </td>
                      <td className="cac-num">
                        <input
                          className="cac-in"
                          aria-label="Sau điều chỉnh"
                          value={row.afterDraft}
                          onChange={(e) => updateAfter(row.key, e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="cac-remove"
                          aria-label="Xóa dòng"
                          onClick={() => removeRow(row.key)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="cac-footer">
            <div className="cac-pager">
              <span>Hiển thị</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>
                dòng · Từ {rows.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1} đến{' '}
                {Math.min(pageSafe * pageSize, rows.length)} / {rows.length}
              </span>
            </div>
            <button type="button" className="cac-btn cac-btn--muted" onClick={exitPage}>
              Thoát
            </button>
            <button
              type="button"
              className="cac-btn cac-btn--primary"
              disabled={saving || rows.length === 0}
              onClick={handleComplete}
            >
              {saving ? 'Đang lưu…' : 'Hoàn thành'}
            </button>
          </div>
        </section>
      </div>

      <CostAdjustQuickPickModal
        open={modalOpen}
        products={products}
        selectedIds={modalSelected}
        onToggleId={toggleModalSel}
        onConfirm={confirmModal}
        onCancel={() => {
          setModalOpen(false)
          setModalSelected(new Set())
        }}
      />
    </div>
  )
}
