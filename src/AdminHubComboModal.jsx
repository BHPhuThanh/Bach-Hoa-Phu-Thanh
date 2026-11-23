import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BarcodeScanModal from './BarcodeScanModal.jsx'
import { allocateAutoHhSkuIfEmpty } from './autoProductSku.js'
import { normalizeBarcodeValue } from './catalogCsv.js'
import { filterAndSortGoodsRowsSimple } from './catalogSearchSimple.js'
import {
  computeDefaultComboCost,
  getComboBom,
  isComboCatalogProduct,
} from './comboCatalog.js'
import { findVariantContext } from './inboundFormUnitHelpers.js'
import { formatMoneyThousandsTyping, parseMoneyDigitsOnlyInt } from './moneyInputFormat.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

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

const ComboPickList = memo(function ComboPickList({ hits, onPickRow }) {
  if (!hits.length) return <div className="ah-combo-pick-empty">Không có hàng khớp.</div>
  return (
    <ul className="ah-combo-pick-list" role="listbox">
      {hits.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            className="ah-combo-pick-row"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onPickRow(r)
            }}
          >
            <span className="ah-combo-pick-name">{r.name}</span>
            <span className="ah-combo-pick-meta">
              {r.code} · {normalizeCatalogUnitLabel(r.unitLabel)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
})

/**
 * Modal Tạo / Sửa combo — gợi ý chọn thành phần: onMouseDown + stopPropagation để không mất focus / nháy dropdown.
 */
export function AdminHubComboModal({
  open,
  onClose,
  catalogList,
  searchRowsExcludingCombos,
  mode,
  initialDisplayProduct,
  onSaveDisplayProduct,
  revenueReadOnly,
  /** Mở cửa sổ "Sửa nhanh sản phẩm" (giống tab Nhập hàng) — nhận `variant.id`. */
  onOpenProductQuickEdit,
}) {
  const [scanOpen, setScanOpen] = useState(false)
  /** Camera quét mã vạch cho chính combo (ô «Mã vạch / Barcode»). */
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [barcode, setBarcode] = useState('')
  const [unitLabel, setUnitLabel] = useState('Gói')
  const [weightRaw, setWeightRaw] = useState('')
  const [lines, setLines] = useState([])
  const [pickQ, setPickQ] = useState('')
  const pickSearchRef = useRef(null)
  const catalogListRef = useRef(catalogList)
  catalogListRef.current = catalogList
  const [comboPrice, setComboPrice] = useState('')
  const [comboWholesale, setComboWholesale] = useState('')
  const [comboCost, setComboCost] = useState('')
  const [costOverride, setCostOverride] = useState(false)
  /** Người dùng đã tự sửa «Giá bán lẻ» → ngừng tự điền theo tổng giá thành phần (kể cả khi xoá trống). */
  const comboPriceTouchedRef = useRef(false)

  /** Chỉ reset form khi mở/đổi mode hoặc đổi sản phẩm sửa — không phụ thuộc catalogList để tránh reset khi parent re-render. */
  useEffect(() => {
    if (!open) return
    const list = catalogListRef.current
    if (mode === 'edit' && initialDisplayProduct && isComboCatalogProduct(initialDisplayProduct)) {
      const v0 = initialDisplayProduct.groupVariants?.[0] || initialDisplayProduct
      setName(String(initialDisplayProduct.name || '').trim())
      setCode(String(v0.code || '').trim())
      setBarcode(String(normalizeBarcodeValue(v0.barcode || '')))
      setUnitLabel(normalizeCatalogUnitLabel(v0.unitLabel || 'Gói'))
      setWeightRaw(String(v0.weightRaw ?? initialDisplayProduct.weightRaw ?? ''))
      const bom = getComboBom(initialDisplayProduct)
      setLines(
        bom.map((row, i) => {
          const ctx = findVariantContext(list, row.variantId)
          const v = ctx?.clicked
          return {
            key: `ln-${i}-${row.variantId}`,
            variantId: row.variantId,
            name: String(v?.name || row.nameSnap || '').trim() || '—',
            code: String(v?.code || row.codeSnap || '').trim() || '—',
            unitLabel: normalizeCatalogUnitLabel(v?.unitLabel || row.unitLabelSnap || 'Cái'),
            qty: Math.max(0.001, Number(row.qty) || 1),
            linePrice: Number(v?.price) || 0,
            lineCost: Number(v?.cost) || 0,
          }
        })
      )
      setComboPrice(formatMoneyDraftVi(Number(v0.price) || 0))
      setComboWholesale(formatMoneyDraftVi(Number(v0.wholesalePrice) || 0))
      const oc = initialDisplayProduct.comboCostOverride ?? v0?.comboCostOverride
      const def = computeDefaultComboCost(list, bom)
      const eff = oc != null && Number.isFinite(Number(oc)) ? Number(oc) : def
      setCostOverride(oc != null && Number.isFinite(Number(oc)))
      setComboCost(formatMoneyDraftVi(eff))
      return
    }
    setName('')
    setCode('')
    setBarcode('')
    setUnitLabel('Gói')
    setWeightRaw('')
    setLines([])
    setPickQ('')
    setComboPrice('')
    setComboWholesale('')
    setComboCost('')
    setCostOverride(false)
    comboPriceTouchedRef.current = false
  }, [open, mode, initialDisplayProduct?.id])

  const bomForCost = useMemo(
    () =>
      lines.map((l) => ({
        variantId: l.variantId,
        qty: Number(l.qty) || 0,
      })),
    [lines]
  )

  const sumPartsRetail = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.linePrice) || 0) * (Number(l.qty) || 0), 0),
    [lines]
  )

  const sumPartsCost = useMemo(() => computeDefaultComboCost(catalogList, bomForCost), [catalogList, bomForCost])

  useEffect(() => {
    if (!open || costOverride) return
    setComboCost(formatMoneyDraftVi(sumPartsCost))
  }, [open, costOverride, sumPartsCost])

  useEffect(() => {
    if (!open || mode === 'edit') return
    if (comboPriceTouchedRef.current) return
    if (sumPartsRetail <= 0) return
    setComboPrice(formatMoneyDraftVi(sumPartsRetail))
  }, [open, mode, sumPartsRetail])

  const pickHits = useMemo(() => {
    const rows = searchRowsExcludingCombos || []
    const q = pickQ.trim()
    if (!q) return rows.slice(0, 25)
    return filterAndSortGoodsRowsSimple(rows, q, { surface: 'admin-combo-component-pick' }).slice(0, 25)
  }, [searchRowsExcludingCombos, pickQ])

  const addLineFromRow = useCallback((r) => {
    console.log('[COMBO-DEBUG] Đã chọn sản phẩm:', r.name)
    setLines((prev) => {
      const i = prev.findIndex((x) => x.variantId === r.id)
      if (i >= 0) {
        const cp = [...prev]
        cp[i] = { ...cp[i], qty: (Number(cp[i].qty) || 0) + 1 }
        return cp
      }
      return [
        ...prev,
        {
          key: `ln-${r.id}-${Date.now()}`,
          variantId: r.id,
          name: r.name,
          code: r.code,
          unitLabel: r.unitLabel,
          qty: 1,
          linePrice: Number(r.price) || 0,
          lineCost: Number(r.cost) || 0,
        },
      ]
    })
    setPickQ('')
    requestAnimationFrame(() => {
      pickSearchRef.current?.focus()
    })
  }, [])

  /**
   * Tìm biến thể (không phải combo) theo mã quét / gõ: khớp mã vạch trước, sau đó mã hàng.
   * @returns {object | null} — dạng dòng gợi ý `{ id, name, code, unitLabel, price, cost }`
   */
  const findComponentByExactCode = useCallback((raw) => {
    const q = String(raw ?? '').trim()
    if (!q) return null
    const needle = String(normalizeBarcodeValue(q))
    const qLc = q.toLowerCase()
    let byCode = null
    for (const p of catalogListRef.current || []) {
      if (isComboCatalogProduct(p)) continue
      for (const v of p.groupVariants || [p]) {
        if (needle && String(normalizeBarcodeValue(v.barcode ?? '')) === needle) return v
        if (!byCode && String(v.code ?? '').trim().toLowerCase() === qLc) byCode = v
      }
    }
    return byCode
  }, [])

  const addComponentFromScan = useCallback(
    (raw) => {
      const q = String(raw ?? '').trim()
      if (!q) return false
      const v = findComponentByExactCode(q)
      if (v) {
        addLineFromRow(v)
        setScanMsg(`Đã thêm: ${v.name || v.code} - ${normalizeCatalogUnitLabel(v.unitLabel)}`)
        return true
      }
      // Không khớp chính xác → đưa vào ô tìm để chọn tay trong gợi ý.
      setPickQ(q)
      setScanMsg(`Không thấy mã «${q}» — chọn trong danh sách gợi ý.`)
      return false
    },
    [findComponentByExactCode, addLineFromRow]
  )

  /** Đổi ĐVT của một thành phần — chuyển sang biến thể anh em (mã, giá, giá vốn theo ĐVT đó). */
  const changeLineUnit = useCallback((key, nextVariantId) => {
    const ctx = findVariantContext(catalogListRef.current, nextVariantId)
    const v = (ctx?.variants || []).find((x) => String(x.id) === String(nextVariantId)) || ctx?.clicked
    if (!v) return
    setLines((prev) => {
      // Đã có dòng cùng biến thể đó → gộp số lượng, bỏ dòng đang đổi.
      const cur = prev.find((x) => x.key === key)
      const dup = prev.find((x) => x.key !== key && String(x.variantId) === String(v.id))
      if (cur && dup) {
        return prev
          .filter((x) => x.key !== key)
          .map((x) =>
            x.key === dup.key ? { ...x, qty: (Number(x.qty) || 0) + (Number(cur.qty) || 0) } : x
          )
      }
      return prev.map((x) =>
        x.key === key
          ? {
              ...x,
              variantId: v.id,
              name: v.name || x.name,
              code: v.code || x.code,
              unitLabel: normalizeCatalogUnitLabel(v.unitLabel),
              linePrice: Number(v.price) || 0,
              lineCost: Number(v.cost) || 0,
            }
          : x
      )
    })
  }, [])

  const removeLine = (key) => setLines((prev) => prev.filter((x) => x.key !== key))

  const updateLine = (key, patch) => {
    setLines((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  }

  const handleSave = () => {
    if (revenueReadOnly) return
    const nameTrim = String(name || '').trim()
    if (!nameTrim) {
      window.alert('Vui lòng nhập tên combo.')
      return
    }
    if (!lines.length) {
      window.alert('Thêm ít nhất một thành phần trong combo.')
      return
    }
    // SL = 0 → bán combo sẽ không trừ tồn thành phần đó (bị bỏ qua khi trừ kho).
    const badQty = lines.find((l) => !(Number(l.qty) > 0))
    if (badQty) {
      window.alert(`Số lượng thành phần «${badQty.name || badQty.code || ''}» phải lớn hơn 0.`)
      return
    }
    const codeTrim = allocateAutoHhSkuIfEmpty(catalogList, String(code || '').trim())
    setCode(codeTrim)
    const price = parseMoneyDraftVi(comboPrice)
    const wholesale = parseMoneyDraftVi(comboWholesale)
    const costParsed = parseMoneyDraftVi(comboCost)
    const defCost = computeDefaultComboCost(
      catalogList,
      lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) || 0 }))
    )
    const costFinal = costOverride ? costParsed : defCost
    const v0 = initialDisplayProduct?.groupVariants?.[0]
    const variantId =
      mode === 'edit' && v0?.id
        ? String(v0.id)
        : typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `combo-${Date.now()}`
    const comboBom = lines.map((l) => ({
      variantId: l.variantId,
      qty: Number(l.qty) || 0,
      codeSnap: l.code,
      nameSnap: l.name,
      unitLabelSnap: l.unitLabel,
    }))

    const flatRow = {
      id: variantId,
      code: codeTrim,
      barcode: String(normalizeBarcodeValue(barcode)),
      name: nameTrim,
      nameRaw: nameTrim,
      price,
      wholesalePrice: wholesale,
      cost: Math.max(0, Math.round(costFinal)),
      stockQty: null,
      supplier: '',
      brand: '',
      linkedMasterCode: '',
      baseGroupCode: '',
      unitLabel: normalizeCatalogUnitLabel(unitLabel) || 'Gói',
      conversion: 1,
      conversionValue: 1,
      weightRaw: String(weightRaw || '').trim(),
      stockNormMin: null,
      stockNormMax: null,
      catalogProductType: 'combo',
      comboBom,
      comboCostOverride: costOverride ? Math.max(0, Math.round(costParsed)) : null,
      createdAtMs: mode === 'edit' && v0?.createdAtMs ? Number(v0.createdAtMs) : Date.now(),
      raw: [],
    }
    // Sửa: Supabase UPDATE theo ma_hang CŨ (cho phép đổi SKU) — thiếu là lỗi «Thiếu mã hàng cũ (old_ma_hang)».
    if (mode === 'edit') {
      const oldMa = String(v0?.persistMaHang ?? v0?.code ?? '').trim()
      if (oldMa) flatRow.persistMaHang = oldMa
    }

    onSaveDisplayProduct({
      mode,
      replaceCatalogId: mode === 'edit' ? String(initialDisplayProduct.id) : null,
      anchorVariantId:
        mode === 'edit' ? String(initialDisplayProduct?.groupVariants?.[0]?.id || '') : null,
      flatRow,
    })
    // KHÔNG tự đóng ở đây: nơi xử lý lưu tự đóng khi THÀNH CÔNG; lỗi (trùng mã, lỗi Supabase) thì
    // giữ cửa sổ mở để không mất dữ liệu vừa nhập.
  }

  if (!open) return null

  return (
    <div className="ah-combo-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="ah-combo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ah-combo-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ah-combo-head">
          <h2 id="ah-combo-title" className="ah-combo-title">
            {mode === 'edit' ? 'Chỉnh sửa combo — Đóng gói' : 'Tạo mới combo — Đóng gói'}
          </h2>
          <button type="button" className="ah-combo-close" aria-label="Đóng" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="ah-combo-body">
          <section className="ah-combo-card">
            <h3 className="ah-combo-card-title">Thông tin combo</h3>
            <div className="ah-combo-grid">
              <label className="ah-combo-field ah-combo-field--full">
                <span className="ah-combo-lbl">
                  Tên combo sản phẩm <span className="ah-combo-req">*</span>
                </span>
                <input
                  className="ah-combo-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tên hiển thị khi bán"
                />
              </label>
              <label className="ah-combo-field">
                <span className="ah-combo-lbl">Mã sản phẩm / SKU</span>
                <input className="ah-combo-input" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className="ah-combo-field">
                <span className="ah-combo-lbl">Khối lượng</span>
                <input
                  className="ah-combo-input"
                  value={weightRaw}
                  onChange={(e) => setWeightRaw(e.target.value)}
                  placeholder="VD: 500"
                />
              </label>
              <label className="ah-combo-field ah-combo-field--full">
                <span className="ah-combo-lbl">Mã vạch / Barcode</span>
                <div className="ah-combo-search-row">
                  <input
                    className="ah-combo-input ah-combo-input--mono"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Nhập tay hoặc quét mã"
                  />
                  <button
                    type="button"
                    className="ah-combo-scan-btn"
                    title="Quét mã vạch / QR bằng camera cho combo"
                    aria-label="Quét mã vạch hoặc QR cho combo"
                    onClick={(e) => {
                      e.preventDefault()
                      setBarcodeScanOpen(true)
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    Quét mã
                  </button>
                </div>
              </label>
              <label className="ah-combo-field">
                <span className="ah-combo-lbl">Đơn vị tính combo</span>
                <input
                  className="ah-combo-input"
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  placeholder="Gói, Set…"
                />
              </label>
            </div>
          </section>

          <section className="ah-combo-card">
            <h3 className="ah-combo-card-title">Thành phần trong combo</h3>
            <div
              className="ah-combo-search-block"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="ah-combo-search-row">
                <input
                  ref={pickSearchRef}
                  className="ah-combo-search"
                  type="search"
                  value={pickQ}
                  onChange={(e) => {
                    setPickQ(e.target.value)
                    if (scanMsg) setScanMsg('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    // Máy quét mã vạch (gõ + Enter) hoặc gõ đúng mã → thêm ngay; không thì lấy gợi ý đầu.
                    const q = pickQ.trim()
                    if (!q) return
                    if (findComponentByExactCode(q)) {
                      addComponentFromScan(q)
                    } else if (pickHits[0]) {
                      addLineFromRow(pickHits[0])
                    }
                  }}
                  placeholder="Tìm theo tên, mã — hoặc quét mã vạch thành phần"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="ah-combo-scan-btn"
                  title="Quét mã vạch / QR bằng camera để thêm thành phần"
                  aria-label="Quét mã vạch hoặc QR"
                  onClick={() => {
                    setScanMsg('')
                    setScanOpen(true)
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Quét mã
                </button>
              </div>
              {scanMsg ? <div className="ah-combo-cell-sub" role="status">{scanMsg}</div> : null}
              {pickQ.trim() ? (
                <div
                  className="ah-combo-pick-pop"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <ComboPickList hits={pickHits} onPickRow={addLineFromRow} />
                </div>
              ) : null}
            </div>
            <div className="ah-combo-table-wrap">
              <table className="ah-combo-table">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Tên sản phẩm</th>
                    <th>ĐƠN VỊ TÍNH</th>
                    <th className="ah-num">Số lượng</th>
                    <th className="ah-num">Giá bán lẻ</th>
                    <th className="ah-num">Giá vốn</th>
                    <th className="ah-num">Thành tiền</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="ah-combo-table-empty">
                        Chưa có thành phần — tìm kiếm phía trên để thêm hàng lẻ.
                      </td>
                    </tr>
                  ) : (
                    lines.map((ln, idx) => {
                      const qty = Number(ln.qty) || 0
                      const pr = Number(ln.linePrice) || 0
                      const cs = Number(ln.lineCost) || 0
                      const lineTotal = Math.round(pr * qty)
                      return (
                        <tr key={ln.key}>
                          <td>{idx + 1}</td>
                          <td>
                            {typeof onOpenProductQuickEdit === 'function' && ln.variantId ? (
                              <button
                                type="button"
                                className="ah-combo-cell-name ah-combo-cell-name-btn"
                                title="Xem / sửa nhanh sản phẩm"
                                onClick={() => onOpenProductQuickEdit(String(ln.variantId))}
                              >
                                {ln.name}
                              </button>
                            ) : (
                              <div className="ah-combo-cell-name">{ln.name}</div>
                            )}
                            <div className="ah-combo-cell-sub">{ln.code}</div>
                          </td>
                          <td>
                            {(() => {
                              const unitVariants =
                                findVariantContext(catalogList, ln.variantId)?.variants || []
                              if (unitVariants.length <= 1) return ln.unitLabel
                              return (
                                <select
                                  className="ah-combo-unit-select"
                                  aria-label={`Đơn vị tính — ${ln.name}`}
                                  value={String(ln.variantId)}
                                  onChange={(e) => changeLineUnit(ln.key, e.target.value)}
                                >
                                  {unitVariants.map((uv) => (
                                    <option key={uv.id} value={String(uv.id)}>
                                      {normalizeCatalogUnitLabel(uv.unitLabel) || uv.code}
                                    </option>
                                  ))}
                                </select>
                              )
                            })()}
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-combo-cell-input ah-num"
                              inputMode="decimal"
                              value={String(ln.qty)}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/,/g, '.')
                                const n = parseFloat(raw)
                                updateLine(ln.key, {
                                  qty: raw === '' || !Number.isFinite(n) ? '' : Math.max(0.0001, n),
                                })
                              }}
                            />
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-combo-cell-input ah-num"
                              inputMode="numeric"
                              value={formatMoneyDraftVi(Math.round(Number(ln.linePrice) || 0))}
                              onChange={(e) =>
                                updateLine(ln.key, {
                                  linePrice: parseMoneyDigitsOnlyInt(e.target.value) ?? 0,
                                })
                              }
                            />
                          </td>
                          <td className="ah-num">
                            <input
                              className="ah-combo-cell-input ah-num"
                              inputMode="numeric"
                              value={formatMoneyDraftVi(Math.round(Number(ln.lineCost) || 0))}
                              onChange={(e) =>
                                updateLine(ln.key, {
                                  lineCost: parseMoneyDigitsOnlyInt(e.target.value) ?? 0,
                                })
                              }
                            />
                          </td>
                          <td className="ah-num">{lineTotal.toLocaleString('vi-VN')}</td>
                          <td>
                            <button
                              type="button"
                              className="ah-combo-row-del"
                              aria-label="Xóa dòng"
                              onClick={() => removeLine(ln.key)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {lines.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={6} className="ah-combo-tfoot-lbl">
                        Tổng tiền thành phần
                      </td>
                      <td className="ah-num ah-combo-tfoot-sum">
                        {sumPartsRetail.toLocaleString('vi-VN')}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          <section className="ah-combo-card">
            <h3 className="ah-combo-card-title">Giá sản phẩm combo</h3>
            <div className="ah-combo-grid ah-combo-grid--prices">
              <label className="ah-combo-field">
                <span className="ah-combo-lbl">Giá bán lẻ</span>
                <input
                  className="ah-combo-input ah-num"
                  inputMode="numeric"
                  value={comboPrice}
                  onChange={(e) => {
                    comboPriceTouchedRef.current = true
                    setComboPrice(formatMoneyThousandsTyping(e.target.value))
                  }}
                />
              </label>
              <label className="ah-combo-field">
                <span className="ah-combo-lbl">Giá bán buôn</span>
                <input
                  className="ah-combo-input ah-num"
                  inputMode="numeric"
                  value={comboWholesale}
                  onChange={(e) => setComboWholesale(formatMoneyThousandsTyping(e.target.value))}
                />
              </label>
              <label className="ah-combo-field ah-combo-field--full ah-combo-cost-row">
                <span className="ah-combo-lbl">Giá nhập (giá vốn combo)</span>
                <div className="ah-combo-cost-inline">
                  <input
                    className="ah-combo-input ah-num"
                    inputMode="numeric"
                    value={comboCost}
                    onChange={(e) => setComboCost(formatMoneyThousandsTyping(e.target.value))}
                    disabled={!costOverride}
                  />
                  <label className="ah-combo-check">
                    <input
                      type="checkbox"
                      checked={costOverride}
                      onChange={(e) => {
                        setCostOverride(e.target.checked)
                        if (!e.target.checked) setComboCost(formatMoneyDraftVi(sumPartsCost))
                      }}
                    />
                    Ghi đè tay (mặc định = tổng vốn thành phần: {sumPartsCost.toLocaleString('vi-VN')} đ)
                  </label>
                </div>
              </label>
            </div>
          </section>
        </div>
        <footer className="ah-combo-foot">
          <button type="button" className="ah-combo-btn ah-combo-btn--ghost" onClick={onClose}>
            Đóng
          </button>
          <button
            type="button"
            className="ah-combo-btn ah-combo-btn--primary"
            disabled={revenueReadOnly}
            onClick={handleSave}
          >
            Lưu
          </button>
        </footer>
      </div>
      <BarcodeScanModal
        open={scanOpen}
        title="Quét mã — thêm thành phần combo"
        onClose={() => setScanOpen(false)}
        onScan={(t) => {
          // Khớp → thêm dòng & đóng camera; không khớp → đóng, đưa mã vào ô tìm để chọn tay.
          addComponentFromScan(t)
          setScanOpen(false)
        }}
      />
      <BarcodeScanModal
        open={barcodeScanOpen}
        title="Quét mã — mã vạch combo"
        onClose={() => setBarcodeScanOpen(false)}
        onScan={(t) => {
          const code = String(normalizeBarcodeValue(t ?? '')).trim()
          if (code) setBarcode(code)
          setBarcodeScanOpen(false)
        }}
      />
    </div>
  )
}
