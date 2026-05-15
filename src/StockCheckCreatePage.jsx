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
} from './catalogRepository.js'
import {
  insertInventoryLogRows,
  buildStockAdjustInventoryLogRows,
} from './inventoryLogRepository.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import {
  collectSiblingVariantIds,
  resolveMaGocFromVariant,
  variantQuyDoiNumber,
} from './comboCatalog.js'
import {
  appendStockCheckVoucher,
  createHoanThanhStockCheckVoucher,
  loadStockCheckVouchers,
  peekNextStockCheckCode,
  saveStockCheckVouchers,
} from './stockCheckStorage.js'
import { readStoredSellerId } from './sellerRoleStorage.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'
import {
  displayTonKhoNumber,
  formatDisplayTonKhoVi,
  formatStockQtyDisplayVi,
} from './displayStockQty.js'
import CostAdjustQuickPickModal from './CostAdjustQuickPickModal.jsx'
import CostAdjustCatalogSearchInput from './CostAdjustCatalogSearchInput.jsx'
import './App.css'
import './dashboard-dark.css'
import './costAdjustCreatePage.css'
import './stockCheckCreatePage.css'

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

function stockCheckStaffNameForLog() {
  const c = creatorLabel()
  if (c === 'Admin') return 'Chủ cửa hàng'
  if (c === 'Nhân viên') return 'Nhân viên'
  return 'Chủ cửa hàng'
}

/** Giống Admin Hub — tồn chi nhánh / số đếm thực tế. */
function parseStockInput(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (s === '' || s === '-') return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function formatSignedQtyVi(n) {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const t = formatStockQtyDisplayVi(abs)
  if (t === '—') return '—'
  if (n < 0) return `−${t}`
  return t
}

function deltaLabelDisplay(branchTonKhoRaw, actualRaw, variant) {
  const actual = parseStockInput(actualRaw)
  if (actual === null) return '—'
  const b =
    branchTonKhoRaw != null &&
    branchTonKhoRaw !== '' &&
    Number.isFinite(Number(branchTonKhoRaw))
      ? Number(branchTonKhoRaw)
      : null
  if (b === null) return formatSignedQtyVi(actual)
  const branchDisp =
    variant && typeof variant === 'object' ? displayTonKhoNumber(b, variant) : null
  if (branchDisp == null || !Number.isFinite(branchDisp)) return formatSignedQtyVi(actual)
  return formatSignedQtyVi(actual - branchDisp)
}

function findCatalogVariantById(products, variantId) {
  const id = String(variantId ?? '').trim()
  if (!id) return null
  for (const p of products || []) {
    const vars = p.groupVariants || [p]
    for (const v of vars) {
      if (String(v.id) === id) return v
    }
  }
  return null
}

function buildRowFromVariant(product, variant) {
  const sq = variant.stockQty
  let branchQty = null
  if (sq != null && sq !== '') {
    const n = Number(sq)
    if (Number.isFinite(n)) branchQty = n
  }
  return {
    key: String(variant.id),
    variantId: String(variant.id),
    productCode: String(variant.code ?? '').trim(),
    productName: String(product.name ?? '').trim() || '—',
    unitLabel: normalizeCatalogUnitLabel(variant.unitLabel),
    branchQty,
    actualDraft: '',
    reasonDraft: '',
    noteDraft: '',
  }
}

export default function StockCheckCreatePage() {
  const searchRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState([])
  const [fileName, setFileName] = useState('')
  const [posScanList, setPosScanList] = useState([])
  const [voucherPreviewCode, setVoucherPreviewCode] = useState('PK001')
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
        const vouchers = loadStockCheckVouchers()
        setVoucherPreviewCode(peekNextStockCheckCode(vouchers))
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

  const updateActual = useCallback((key, raw) => {
    setRows((list) =>
      list.map((row) => (row.key === key ? { ...row, actualDraft: raw } : row))
    )
  }, [])

  const updateReason = useCallback((key, raw) => {
    setRows((list) =>
      list.map((row) => (row.key === key ? { ...row, reasonDraft: raw } : row))
    )
  }, [])

  const updateNoteRow = useCallback((key, raw) => {
    setRows((list) =>
      list.map((row) => (row.key === key ? { ...row, noteDraft: raw } : row))
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

  const handleBalance = useCallback(async () => {
    if (saving) return
    /** Tồn kho DB chuẩn (cơ bản) theo họ `ma_goc`: mỗi khóa một con số. */
    const baseTonByMaGoc = new Map()
    for (const row of rows) {
      const actualDisplay = parseStockInput(row.actualDraft)
      if (actualDisplay === null) continue
      const v = findCatalogVariantById(products, row.variantId)
      if (!v) continue
      const maGoc = resolveMaGocFromVariant(v)
      if (!maGoc) {
        window.alert(
          `Không xác định được họ sản phẩm cho «${String(row.productCode || '').trim() || '—'}». Kiểm tra ma_hàng / ma_hh_lien_quan.`
        )
        return
      }
      const qd = variantQuyDoiNumber(v)
      const baseTon = actualDisplay * qd
      if (!Number.isFinite(baseTon)) {
        window.alert(`Số lượng không hợp lệ (${row.productCode || ''}).`)
        return
      }
      if (baseTon < 0) {
        window.alert('Tồn thực tế không được âm.')
        return
      }
      if (baseTonByMaGoc.has(maGoc)) {
        const prev = baseTonByMaGoc.get(maGoc)
        if (Math.abs(prev - baseTon) > 1e-3) {
          window.alert(
            `Các dòng cùng nhóm ĐVT (cùng ma_hh_lien_quan / mã gốc «${maGoc}») đang không thống nhất một số đếm cơ bản. Hãy điều chỉnh cho khớp.`
          )
          return
        }
      } else baseTonByMaGoc.set(maGoc, baseTon)
    }
    if (baseTonByMaGoc.size === 0) {
      window.alert('Thêm ít nhất một dòng và nhập «Tồn thực tế» (số đếm được) cho dòng đó.')
      return
    }

    const lines = []
    const variantsToTouch = new Set()
    let nextProducts = products
    for (const row of rows) {
      const actualDisplay = parseStockInput(row.actualDraft)
      if (actualDisplay === null) continue
      const v = findCatalogVariantById(products, row.variantId)
      const branchTon =
        row.branchQty != null && Number.isFinite(Number(row.branchQty)) ? Number(row.branchQty) : null
      let deltaDisplay = actualDisplay
      if (branchTon !== null && v) {
        const branchDisp = displayTonKhoNumber(branchTon, v)
        if (branchDisp != null && Number.isFinite(branchDisp)) deltaDisplay = actualDisplay - branchDisp
      }
      lines.push({
        variantId: row.variantId,
        productName: row.productName || '—',
        productCode: row.productCode || '—',
        unitLabel: row.unitLabel || '—',
        branchQty: branchTon,
        actualQty: actualDisplay,
        deltaQty: deltaDisplay,
        reason: String(row.reasonDraft ?? '').trim() || '—',
        note: String(row.noteDraft ?? '').trim(),
      })
    }
    for (const [maGoc, baseTon] of baseTonByMaGoc) {
      const sibs = collectSiblingVariantIds(nextProducts, maGoc)
      if (sibs.length === 0) {
        window.alert(
          `Không tìm thấy mã anh em trong danh mục cho «${maGoc}». Kiểm tra ma_hàng / ma_hh_lien_quan.`
        )
        return
      }
      for (const sid of sibs) {
        const id = String(sid)
        variantsToTouch.add(id)
        nextProducts = applyProductDataToCatalog(nextProducts, {
          type: 'patch_variant',
          variantId: id,
          patch: { stockQty: baseTon },
        })
      }
    }

    setSaving(true)
    try {
      const flat = flattenDisplayCatalogToVariants(nextProducts)
      const tonKhoOnlyVariants = flat.filter((v) => variantsToTouch.has(String(v.id)))
      const persistResult = await persistCatalogSnapshotAndProducts(nextProducts, fileName, {
        tonKhoOnlyVariants,
      })
      if (!persistResult.ok) return
      if (isSupabaseConfigured() && variantsToTouch.size > 0) {
        const logRows = buildStockAdjustInventoryLogRows(products, nextProducts, variantsToTouch, {
          transactionType: 'Điều chỉnh',
          documentCode: 'Sửa thủ công',
          staffName: stockCheckStaffNameForLog(),
        })
        await insertInventoryLogRows(logRows)
      }
      const prev = loadStockCheckVouchers()
      const voucher = createHoanThanhStockCheckVoucher(prev, {
        createdBy: creatorLabel(),
        lines,
        note,
        branchLabel: branch,
      })
      const merged = appendStockCheckVoucher(prev, voucher)
      saveStockCheckVouchers(merged)
      window.alert(`Đã lưu phiếu ${voucher.code} và cập nhật tồn kho.`)
      window.close()
    } catch (err) {
      console.error(err)
      window.alert('Lưu thất bại. Thử lại hoặc kiểm tra quyền trình duyệt.')
    } finally {
      setSaving(false)
    }
  }, [rows, products, fileName, note, branch, saving])

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
          <h1 className="cac-page__title">Tạo phiếu kiểm hàng</h1>
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
        <h1 className="cac-page__title">Tạo phiếu kiểm hàng</h1>

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
            <div className="cac-field">
              <label>Ghi chú phiếu</label>
              <textarea
                placeholder="VD: Kiểm kê cuối ngày"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </div>

        <section className="cac-products" aria-labelledby="scc-prod-head">
          <h2 id="scc-prod-head" className="cac-products__head">
            Bảng nhập liệu kiểm kê
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
          <p className="cac-muted">
            Gõ tên hoặc quét mã vạch, Enter để thêm dòng đầu tiên trong gợi ý. Phím F3 đưa con trỏ vào ô tìm kiếm.
          </p>

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
                      {String(variant.code ?? '').trim() || '—'} · {normalizeCatalogUnitLabel(variant.unitLabel)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cac-table-wrap scc-table-wrap">
            <table className="cac-table scc-table">
              <colgroup>
                <col className="scc-col-stt" />
                <col className="scc-col-img" />
                <col className="scc-col-name" />
                <col className="scc-col-unit" />
                <col className="scc-col-br" />
                <col className="scc-col-act" />
                <col className="scc-col-delta" />
                <col className="scc-col-reason" />
                <col className="scc-col-note" />
                <col className="scc-col-x" />
              </colgroup>
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Ảnh</th>
                  <th>Tên sản phẩm</th>
                  <th>Đơn vị</th>
                  <th className="cac-num">Tồn chi nhánh</th>
                  <th className="cac-num">Tồn thực tế</th>
                  <th className="cac-num">Số lượng lệch</th>
                  <th>Lý do</th>
                  <th>Ghi chú</th>
                  <th aria-label="Xóa" />
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: 'rgba(148,163,184,0.85)', padding: '1.25rem' }}>
                      Chưa có dòng — dùng ô tìm kiếm hoặc Chọn nhanh.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, i) => {
                    const vDisp = findCatalogVariantById(products, row.variantId)
                    return (
                    <tr key={row.key}>
                      <td>{(pageSafe - 1) * pageSize + i + 1}</td>
                      <td>
                        <span className="scc-ph-img" aria-hidden />
                      </td>
                      <td>
                        <div className="cac-name-main">{row.productName}</div>
                        <div className="cac-name-code">{row.productCode || '—'}</div>
                      </td>
                      <td>{row.unitLabel || '—'}</td>
                      <td className="cac-num">{formatDisplayTonKhoVi(row.branchQty, vDisp ?? {})}</td>
                      <td className="cac-num">
                        <input
                          className="cac-in"
                          aria-label="Tồn thực tế"
                          value={row.actualDraft}
                          onChange={(e) => updateActual(row.key, e.target.value)}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="cac-num scc-delta-cell">
                        {deltaLabelDisplay(row.branchQty, row.actualDraft, vDisp ?? undefined)}
                      </td>
                      <td>
                        <input
                          className="cac-in scc-in-text"
                          aria-label="Lý do"
                          value={row.reasonDraft}
                          onChange={(e) => updateReason(row.key, e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="cac-in scc-in-text"
                          aria-label="Ghi chú dòng"
                          value={row.noteDraft}
                          onChange={(e) => updateNoteRow(row.key, e.target.value)}
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
                    )
                  })
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
              onClick={handleBalance}
            >
              {saving ? 'Đang lưu…' : 'Cân bằng kho'}
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
