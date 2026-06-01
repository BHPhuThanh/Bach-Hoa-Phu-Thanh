import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mergeFlatCatalogRowsBySmartUomGroups, normalizeBarcodeValue } from './catalogCsv.js'
import { suggestNextProductCodeFromCatalog, allocateAutoHhSkuIfEmpty } from './autoProductSku.js'
import { formatMoneyThousandsTyping } from './moneyInputFormat.js'
import { posQueryLooksLikeBarcodeKeyInput, prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import { buildDisplayCatalog, normalizeCatalogUnitLabel } from './productUnits.js'
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
import InboundThuongHieuAutocomplete from './InboundThuongHieuAutocomplete.jsx'
import BarcodeScanModal from './BarcodeScanModal.jsx'
import { formatPostgrestErrorForUser } from './entityContactsRepository.js'
import AdminHubGoodsCreateBatchRow from './AdminHubGoodsCreateBatchRow.jsx'
import {
  addGoodsCreateBatchExtraUnit,
  batchBarcodeFieldKey,
  buildCatalogVariantsFromGoodsCreateBatchRows,
  initialGoodsCreateBatchRows,
  newGoodsCreateBatchRow,
  syncGoodsCreateBatchBarcodeErrors,
  patchGoodsCreateBatchExtraUnit,
  patchGoodsCreateBatchRow,
  removeGoodsCreateBatchExtraUnit,
  validateGoodsCreateBatchBarcodes,
} from './goodsCreateBatch.js'
import './adminHub.css'
import './barcodeScan.css'

/** Giá trong ô chỉnh sửa: phân tách hàng nghìn bằng dấu phẩy (vd. 132,000). */
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

function catalogHasNormalizedBarcode(catalogProducts, needleNorm) {
  const n = String(needleNorm ?? '').trim()
  if (!n) return false
  const flat = (Array.isArray(catalogProducts) ? catalogProducts : []).flatMap(
    (p) => p.groupVariants || [p]
  )
  return flat.some((v) => String(normalizeBarcodeValue(v.barcode ?? '')) === n)
}

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

/**
 * Modal tạo hàng hóa — dùng chung tab Hàng hóa (AdminHub) và thanh tìm POS (App).
 * Giữ nguyên logic giá vốn / tồn / đa ĐVT như AdminHub.jsx trước khi tách.
 */
export default function AdminHubGoodsCreateModal({
  open,
  onClose,
  catalogList,
  /** Gợi ý thương hiệu: nên trùng nguồn phiếu nhập (suppliers + thuong_hieu trong danh mục). */
  brandAutocompleteOptions = [],
  onRequestAddSupplier,
  revenueReadOnly,
  onAppendCatalogVariants,
  persistStandaloneProducts,
  fileNameHint = 'hang-hoa-thu-cong',
  onSaved,
  /**
   * Khi modal con (vd. «Thêm NCC» — EntityPersonModal) đang mở: tắt auto-focus mã vạch và
   * tạm dừng bắt phím quét ở capture để không xung đột modal lồng nhau.
   */
  disableEnforceFocus = false,
}) {
  const catalogListRef = useRef(catalogList)
  catalogListRef.current = catalogList

  const modalOpenRef = useRef(false)
  modalOpenRef.current = open

  const goodsNewBarcodeRef = useRef(null)
  const goodsNewCodeRef = useRef(null)
  const goodsNewNameRef = useRef(null)
  const goodsCreateScanBufferRef = useRef({ buf: '', times: [] })
  const [goodsCreateFieldsKey, setGoodsCreateFieldsKey] = useState(0)
  const [goodsNewUnit, setGoodsNewUnit] = useState('Cái')
  const [goodsNewBrand, setGoodsNewBrand] = useState('')
  const [goodsNewPrice, setGoodsNewPrice] = useState('')
  const [goodsNewWholesale, setGoodsNewWholesale] = useState('')
  const [goodsNewCost, setGoodsNewCost] = useState('')
  const [goodsNewStock, setGoodsNewStock] = useState('0')
  const [goodsNewUseExpiry, setGoodsNewUseExpiry] = useState('no')
  const [goodsNewExpiryYmd, setGoodsNewExpiryYmd] = useState('')
  const [goodsNewMultiVariants, setGoodsNewMultiVariants] = useState(null)
  const [goodsNewBarcodeDupMsg, setGoodsNewBarcodeDupMsg] = useState('')
  const [goodsCreateBarcodeScanOpen, setGoodsCreateBarcodeScanOpen] = useState(false)
  const [goodsCreateSaving, setGoodsCreateSaving] = useState(false)
  const [goodsCreateSaveError, setGoodsCreateSaveError] = useState('')
  /** `single` = một SP; `batch` = nhiều dòng, mỗi dòng state độc lập (tên/mã/giá riêng). */
  const [goodsCreateEntryMode, setGoodsCreateEntryMode] = useState('single')
  const [goodsCreateBatchRows, setGoodsCreateBatchRows] = useState(initialGoodsCreateBatchRows)
  const goodsCreateBatchRowsRef = useRef(goodsCreateBatchRows)
  goodsCreateBatchRowsRef.current = goodsCreateBatchRows
  const goodsCreateEntryModeRef = useRef(goodsCreateEntryMode)
  goodsCreateEntryModeRef.current = goodsCreateEntryMode
  /** rowId hoặc rowId:unitId → thông báo lỗi mã vạch. */
  const [goodsCreateBatchBarcodeErrors, setGoodsCreateBatchBarcodeErrors] = useState({})
  const [goodsCreateBatchToast, setGoodsCreateBatchToast] = useState(null)
  const goodsCreateBatchToastTimerRef = useRef(null)
  const batchBarcodeDebounceRef = useRef({})
  const [batchFormEpoch, setBatchFormEpoch] = useState(0)
  const [gcUnitModal, setGcUnitModal] = useState(null)

  const resetFormFields = useCallback(() => {
    goodsCreateScanBufferRef.current = { buf: '', times: [] }
    setGoodsCreateFieldsKey((k) => k + 1)
    setGoodsNewUnit('Cái')
    setGoodsNewBrand('')
    setGoodsNewPrice('')
    setGoodsNewWholesale('')
    setGoodsNewCost('')
    setGoodsNewStock('0')
    setGoodsNewUseExpiry('no')
    setGoodsNewExpiryYmd('')
    setGoodsNewMultiVariants(null)
    setGoodsNewBarcodeDupMsg('')
    setGoodsCreateSaveError('')
    setGoodsCreateEntryMode('single')
    setGoodsCreateBatchRows(initialGoodsCreateBatchRows())
    setGoodsCreateBatchBarcodeErrors({})
    setGoodsCreateBatchToast(null)
    setBatchFormEpoch((n) => n + 1)
    setGcUnitModal(null)
  }, [])

  const resetBatchRowsState = useCallback(() => {
    setGoodsCreateBatchRows(initialGoodsCreateBatchRows())
    setGoodsCreateBatchBarcodeErrors({})
    setGoodsCreateBatchToast(null)
    setBatchFormEpoch((n) => n + 1)
    Object.values(batchBarcodeDebounceRef.current).forEach((t) => window.clearTimeout(t))
    batchBarcodeDebounceRef.current = {}
  }, [])

  const showGoodsCreateBatchToast = useCallback((message) => {
    const t = String(message ?? '').trim()
    if (!t) return
    if (goodsCreateBatchToastTimerRef.current != null) {
      window.clearTimeout(goodsCreateBatchToastTimerRef.current)
      goodsCreateBatchToastTimerRef.current = null
    }
    setGoodsCreateBatchToast(t)
    goodsCreateBatchToastTimerRef.current = window.setTimeout(() => {
      setGoodsCreateBatchToast(null)
      goodsCreateBatchToastTimerRef.current = null
    }, 5500)
  }, [])

  useEffect(
    () => () => {
      if (goodsCreateBatchToastTimerRef.current != null) {
        window.clearTimeout(goodsCreateBatchToastTimerRef.current)
      }
    },
    []
  )

  const recomputeBatchBarcodeErrors = useCallback((rows) => {
    const synced = syncGoodsCreateBatchBarcodeErrors(
      rows ?? goodsCreateBatchRowsRef.current,
      catalogListRef.current
    )
    setGoodsCreateBatchBarcodeErrors(synced)
  }, [])

  const runBatchBarcodeCheck = useCallback(
    (rowIndex, unitId = null) => {
      recomputeBatchBarcodeErrors(goodsCreateBatchRowsRef.current)
    },
    [recomputeBatchBarcodeErrors]
  )

  const scheduleBatchBarcodeCheck = useCallback(
    (rowIndex, unitId = null) => {
      const rows = goodsCreateBatchRowsRef.current
      const row = rows[rowIndex]
      if (!row) return
      const debKey = `deb-${batchBarcodeFieldKey(row.rowId, unitId)}`
      if (batchBarcodeDebounceRef.current[debKey]) {
        window.clearTimeout(batchBarcodeDebounceRef.current[debKey])
      }
      batchBarcodeDebounceRef.current[debKey] = window.setTimeout(() => {
        delete batchBarcodeDebounceRef.current[debKey]
        recomputeBatchBarcodeErrors(goodsCreateBatchRowsRef.current)
      }, 400)
    },
    [recomputeBatchBarcodeErrors]
  )

  const patchGoodsCreateBatchRowField = useCallback(
    (index, field, value) => {
      const nextRows = patchGoodsCreateBatchRow(goodsCreateBatchRowsRef.current, index, field, value)
      goodsCreateBatchRowsRef.current = nextRows
      setGoodsCreateBatchRows(nextRows)
      if (field === 'barcode') {
        const row = nextRows[index]
        const debKey = row ? `deb-${batchBarcodeFieldKey(row.rowId, null)}` : ''
        if (debKey && batchBarcodeDebounceRef.current[debKey]) {
          window.clearTimeout(batchBarcodeDebounceRef.current[debKey])
          delete batchBarcodeDebounceRef.current[debKey]
        }
        recomputeBatchBarcodeErrors(nextRows)
      }
    },
    [recomputeBatchBarcodeErrors]
  )

  const patchGoodsCreateBatchExtraField = useCallback(
    (rowIndex, unitIndex, field, value) => {
      setGoodsCreateBatchRows((prev) => {
        const nextRows = patchGoodsCreateBatchExtraUnit(prev, rowIndex, unitIndex, field, value)
        goodsCreateBatchRowsRef.current = nextRows
        if (field === 'barcode') {
          const row = nextRows[rowIndex]
          const unit = row?.donViTinh?.[unitIndex]
          if (row && unit?.unitId) {
            const debKey = `deb-${batchBarcodeFieldKey(row.rowId, unit.unitId)}`
            if (batchBarcodeDebounceRef.current[debKey]) {
              window.clearTimeout(batchBarcodeDebounceRef.current[debKey])
              delete batchBarcodeDebounceRef.current[debKey]
            }
          }
          recomputeBatchBarcodeErrors(nextRows)
        }
        return nextRows
      })
    },
    [recomputeBatchBarcodeErrors]
  )

  const addGoodsCreateBatchExtraUnitRow = useCallback((rowIndex) => {
    setGoodsCreateBatchRows((prev) => addGoodsCreateBatchExtraUnit(prev, rowIndex))
  }, [])

  const removeGoodsCreateBatchExtraUnitRow = useCallback(
    (rowIndex, unitIndex) => {
      setGoodsCreateBatchRows((prev) => {
        const nextRows = removeGoodsCreateBatchExtraUnit(prev, rowIndex, unitIndex)
        goodsCreateBatchRowsRef.current = nextRows
        recomputeBatchBarcodeErrors(nextRows)
        return nextRows
      })
    },
    [recomputeBatchBarcodeErrors]
  )

  const removeGoodsCreateBatchRow = useCallback((index) => {
    setGoodsCreateBatchRows((prev) => {
      if (prev.length <= 1) return prev
      const row = prev[index]
      if (row?.rowId) {
        setGoodsCreateBatchBarcodeErrors((errs) => {
          const next = { ...errs }
          for (const k of Object.keys(next)) {
            if (k === row.rowId || k.startsWith(`${row.rowId}:`)) delete next[k]
          }
          return next
        })
      }
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const batchHasBarcodeErrors = useMemo(
    () => Object.keys(goodsCreateBatchBarcodeErrors).length > 0,
    [goodsCreateBatchBarcodeErrors]
  )

  const batchBrandOptions = useMemo(() => {
    const brands = new Set()
    for (const o of brandAutocompleteOptions || []) {
      const b =
        typeof o === 'string'
          ? o
          : String(o?.label ?? o?.value ?? o?.name ?? '')
      const t = b.replace(/\s+/g, ' ').trim()
      if (t) brands.add(t)
    }
    return [...brands].sort((a, b) => a.localeCompare(b, 'vi'))
  }, [brandAutocompleteOptions])

  useEffect(() => {
    if (!open) return
    resetFormFields()
    return () => {
      setGoodsCreateBatchRows(initialGoodsCreateBatchRows())
      setGoodsCreateBatchBarcodeErrors({})
    }
  }, [open, resetFormFields])

  useEffect(() => {
    if (!open) resetBatchRowsState()
  }, [open, resetBatchRowsState])

  const handleClose = useCallback(() => {
    if (goodsCreateSaving) return
    resetFormFields()
    resetBatchRowsState()
    goodsCreateScanBufferRef.current = { buf: '', times: [] }
    onClose()
  }, [goodsCreateSaving, onClose, resetFormFields, resetBatchRowsState])

  const revalidateGoodsNewBarcode = useCallback(() => {
    const raw = goodsNewBarcodeRef.current?.value ?? ''
    const n = String(normalizeBarcodeValue(raw)).trim()
    const list = catalogListRef.current
    const nextMsg = !n ? '' : catalogHasNormalizedBarcode(list, n) ? 'Mã QR đã có sẵn' : ''
    setGoodsNewBarcodeDupMsg((prev) => (prev === nextMsg ? prev : nextMsg))
  }, [])

  const applyGoodsCreateScannedBarcode = useCallback(
    (raw) => {
      const code = String(normalizeBarcodeValue(raw ?? '')).trim()
      if (!code || !goodsNewBarcodeRef.current) return
      goodsNewBarcodeRef.current.value = code
      revalidateGoodsNewBarcode()
      goodsNewBarcodeRef.current.focus()
      goodsNewBarcodeRef.current.select?.()
      setGoodsCreateBarcodeScanOpen(false)
    },
    [revalidateGoodsNewBarcode]
  )

  useLayoutEffect(() => {
    if (!open) return
    revalidateGoodsNewBarcode()
  }, [open, goodsCreateFieldsKey, revalidateGoodsNewBarcode])

  const applyExpiryToVariants = useCallback(
    (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return rows
      if (goodsNewUseExpiry === 'yes' && String(goodsNewExpiryYmd || '').trim()) {
        const ymd = String(goodsNewExpiryYmd).trim()
        const ymdDigits = ymd.replace(/\D/g, '')
        return rows.map((r) => {
          const codePart = String(r.code ?? '')
            .replace(/\s/g, '')
            .slice(-6)
          const batchId = `LOT${ymdDigits || '00000000'}-${codePart || r.id || '0'}`
          const q0 = Math.max(0, Number(r.stockQty) || 0)
          return {
            ...r,
            lotExpiryYmd: ymd,
            manageBatchExpiry: true,
            stockBatches: [{ batchId, expiryYmd: ymd, qty: q0 }],
          }
        })
      }
      return rows.map((r) => {
        const { lotExpiryYmd: _e, manageBatchExpiry: _m, stockBatches: _sb, ...rest } = r
        return rest
      })
    },
    [goodsNewUseExpiry, goodsNewExpiryYmd]
  )

  const submitGoodsCreateModal = useCallback(async () => {
    if (revenueReadOnly || goodsCreateSaving) return

    const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])

    const flushRows = async (rowsForUpsert) => {
      if (!Array.isArray(rowsForUpsert) || rowsForUpsert.length === 0) return false
      // eslint-disable-next-line no-console
      console.log('Dữ liệu gửi đi:', rowsForUpsert)

      /** Chỉ ghi Supabase trước — không merge mã form vào state (tránh ghost HHxxxx). */
      if (persistStandaloneProducts) {
        try {
          const res = await persistStandaloneProducts(null, fileNameHint, rowsForUpsert)
          if (!res || res.ok === false) {
            console.error('Lỗi Insert Supabase:', res?.error)
            setGoodsCreateSaveError(
              String(res?.error || 'Không lưu được lên máy chủ (Supabase / snapshot).')
            )
            return false
          }
          return true
        } catch (e) {
          console.error('Lỗi Insert Supabase:', e)
          setGoodsCreateSaveError(formatPostgrestErrorForUser(e))
          return false
        }
      }

      if (onAppendCatalogVariants) {
        try {
          const res = await onAppendCatalogVariants(rowsForUpsert)
          if (!res || res.ok === false) {
            console.error('Lỗi Insert Supabase:', res?.error ?? res)
            setGoodsCreateSaveError(
              String(res?.error || 'Không lưu được lên máy chủ (Supabase / snapshot).')
            )
            return false
          }
          return true
        } catch (e) {
          console.error('Lỗi Insert Supabase:', e)
          setGoodsCreateSaveError(formatPostgrestErrorForUser(e))
          return false
        }
      }

      setGoodsCreateSaveError('Thiếu cấu hình lưu danh mục (Supabase / đồng bộ).')
      return false
    }

    const finish = async (rowsForUpsert) => {
      setGoodsCreateSaveError('')
      setGoodsCreateSaving(true)
      let saved = false
      try {
        saved = await flushRows(rowsForUpsert)
        if (!saved) return
        resetFormFields()
        resetBatchRowsState()
        goodsCreateScanBufferRef.current = { buf: '', times: [] }
        onSaved?.()
      } finally {
        setGoodsCreateSaving(false)
        if (saved) onClose()
      }
    }

    if (goodsCreateEntryModeRef.current === 'batch') {
      const batchRows = goodsCreateBatchRowsRef.current
      const catalogNow = catalogListRef.current
      const barcodeCheck = validateGoodsCreateBatchBarcodes(batchRows, catalogNow)
      if (!barcodeCheck.ok) {
        setGoodsCreateBatchBarcodeErrors(barcodeCheck.errors || {})
        showGoodsCreateBatchToast(barcodeCheck.message)
        return
      }
      setGoodsCreateBatchBarcodeErrors({})
      const built = buildCatalogVariantsFromGoodsCreateBatchRows(batchRows, catalogNow)
      if (built.length === 0) {
        window.alert('Vui lòng nhập tên hàng cho ít nhất một dòng.')
        return
      }
      await finish(applyExpiryToVariants(built))
      return
    }

    const codeSetExisting = new Set(flat.map((v) => String(v.code ?? '').trim().toLowerCase()).filter(Boolean))
    const barcodeSetExisting = new Set(
      flat.map((v) => String(normalizeBarcodeValue(v.barcode ?? ''))).filter(Boolean)
    )

    const primaryBc = String(normalizeBarcodeValue(goodsNewBarcodeRef.current?.value ?? '')).trim()
    if (primaryBc && catalogHasNormalizedBarcode(catalogListRef.current, primaryBc)) {
      setGoodsNewBarcodeDupMsg((p) => (p === 'Mã QR đã có sẵn' ? p : 'Mã QR đã có sẵn'))
      return
    }

    const name = String(goodsNewNameRef.current?.value ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) {
      window.alert('Vui lòng nhập tên hàng.')
      return
    }
    if (goodsNewUseExpiry === 'yes' && !String(goodsNewExpiryYmd || '').trim()) {
      window.alert('Vui lòng chọn hạn sử dụng hoặc đổi «Quản lý theo hạn sử dụng» sang Không.')
      return
    }

    if (goodsNewMultiVariants?.length) {
      const batchCodes = new Set()
      const batchBarcodes = new Set()
      for (const v of goodsNewMultiVariants) {
        const c = String(v.code ?? '').trim().toLowerCase()
        if (c) {
          if (codeSetExisting.has(c) || batchCodes.has(c)) {
            window.alert(`Mã hàng «${v.code}» bị trùng. Vui lòng chỉnh lại trong thiết lập ĐVT.`)
            return
          }
          batchCodes.add(c)
        }
        const b = String(normalizeBarcodeValue(v.barcode ?? '')).trim()
        if (b) {
          if (barcodeSetExisting.has(b) || batchBarcodes.has(b)) {
            window.alert(`Mã vạch/QR «${b}» bị trùng. Vui lòng chỉnh trong thiết lập ĐVT.`)
            return
          }
          batchBarcodes.add(b)
        }
      }
      const brandTrim = String(goodsNewBrand ?? '').trim()
      const rows = applyExpiryToVariants(
        goodsNewMultiVariants.map((v) => {
          const rowName =
            String(v.name ?? v.nameRaw ?? '')
              .replace(/\u00A0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim() || name
          return {
            ...v,
            name: rowName,
            nameRaw: rowName,
            brand: brandTrim || String(v.brand ?? '').trim(),
          }
        })
      )
      await finish(rows)
      return
    }

    const code = allocateAutoHhSkuIfEmpty(
      catalogList,
      String(goodsNewCodeRef.current?.value ?? '').trim()
    )
    const unitLabel = normalizeCatalogUnitLabel(goodsNewUnit) || 'Cái'
    const codeLc = code.toLowerCase()
    if (codeSetExisting.has(codeLc)) {
      window.alert('Mã hàng đã tồn tại. Vui lòng đổi mã khác.')
      return
    }
    const price = parseMoneyDraftVi(goodsNewPrice)
    const wholesalePrice = parseMoneyDraftVi(goodsNewWholesale)
    const cost = parseMoneyDraftVi(goodsNewCost)
    const stockQty = parseMoneyDraftVi(goodsNewStock)
    if (stockQty < 0) {
      window.alert('Tồn kho không được âm.')
      return
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const row = {
      id,
      code,
      barcode: String(normalizeBarcodeValue(goodsNewBarcodeRef.current?.value ?? '')),
      name,
      nameRaw: name,
      price,
      wholesalePrice,
      cost,
      stockQty,
      supplier: '',
      brand: String(goodsNewBrand ?? '').trim(),
      linkedMasterCode: '',
      baseGroupCode: '',
      unitLabel,
      conversion: null,
      weightRaw: '',
      stockNormMin: null,
      stockNormMax: null,
      createdAtMs: Date.now(),
      raw: [],
      ...(goodsNewUseExpiry === 'yes' && String(goodsNewExpiryYmd || '').trim()
        ? (() => {
            const ymd = String(goodsNewExpiryYmd).trim()
            const ymdDigits = ymd.replace(/\D/g, '')
            const batchId = `LOT${ymdDigits || '00000000'}-${String(code).replace(/\s/g, '').slice(-6) || id}`
            return {
              lotExpiryYmd: ymd,
              manageBatchExpiry: true,
              stockBatches: [{ batchId, expiryYmd: ymd, qty: Math.max(0, stockQty) }],
            }
          })()
        : {}),
    }
    await finish([row])
  }, [
    revenueReadOnly,
    goodsCreateSaving,
    goodsCreateEntryMode,
    goodsCreateBatchRows,
    goodsNewUnit,
    goodsNewBrand,
    goodsNewPrice,
    goodsNewWholesale,
    goodsNewCost,
    goodsNewStock,
    goodsNewUseExpiry,
    goodsNewExpiryYmd,
    goodsNewMultiVariants,
    catalogList,
    onAppendCatalogVariants,
    persistStandaloneProducts,
    fileNameHint,
    onSaved,
    applyExpiryToVariants,
    onClose,
    resetFormFields,
    resetBatchRowsState,
    showGoodsCreateBatchToast,
  ])

  const openGoodsCreateUnitModal = useCallback(() => {
    if (revenueReadOnly) return
    const nameTrim = String(goodsNewNameRef.current?.value ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!nameTrim) {
      window.alert('Vui lòng nhập tên hàng trước khi thiết lập đơn vị tính.')
      return
    }
    const tid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `gc-${Date.now()}`
    const root =
      String(goodsNewCodeRef.current?.value ?? '').trim() ||
      suggestNextProductCodeFromCatalog(catalogList)
    const templateRow = {
      id: tid,
      code: root,
      barcode: String(normalizeBarcodeValue(goodsNewBarcodeRef.current?.value ?? '')),
      name: nameTrim,
      nameRaw: nameTrim,
      price: parseMoneyDraftVi(goodsNewPrice),
      cost: parseMoneyDraftVi(goodsNewCost),
      stockQty: parseMoneyDraftVi(goodsNewStock),
      wholesalePrice: parseMoneyDraftVi(goodsNewWholesale),
      unitLabel: normalizeCatalogUnitLabel(goodsNewUnit) || 'Cái',
      conversion: 1,
      conversionValue: 1,
      linkedMasterCode: '',
      brand: String(goodsNewBrand ?? '').trim(),
      supplier: '',
      stockNormMin: null,
      stockNormMax: null,
      weightRaw: '',
      createdAtMs: Date.now(),
      raw: [],
    }
    const seedVariants = goodsNewMultiVariants?.length
      ? sortVariantsSmallestUnitFirst(goodsNewMultiVariants)
      : [templateRow]
    const anchorId = String(seedVariants[0]?.id || tid)
    setGcUnitModal({
      anchorVariantId: anchorId,
      lines: createUnitModalLinesFromVariants(seedVariants),
      source: 'goods_create',
    })
  }, [
    revenueReadOnly,
    goodsNewPrice,
    goodsNewWholesale,
    goodsNewCost,
    goodsNewStock,
    goodsNewUnit,
    goodsNewBrand,
    goodsNewMultiVariants,
    catalogList,
  ])

  const closeGcUnitModal = useCallback(() => setGcUnitModal(null), [])

  const commitGcUnitModal = useCallback(() => {
    if (!gcUnitModal) return

    const nameTrim = String(goodsNewNameRef.current?.value ?? '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!nameTrim) {
      window.alert('Vui lòng nhập tên sản phẩm trước khi lưu đơn vị.')
      return
    }
    const sortedLines = sortUnitModalLinesByConversion(gcUnitModal.lines)
    const root =
      String(sortedLines[0]?.code ?? goodsNewCodeRef.current?.value ?? '').trim() ||
      suggestNextProductCodeFromCatalog(catalogList)
    const err = validateUnitModalLines(sortedLines, root)
    if (err) {
      window.alert(err)
      return
    }
    const flat = (Array.isArray(catalogList) ? catalogList : []).flatMap((p) => p.groupVariants || [p])
    const templateVariant = {
      id: gcUnitModal.anchorVariantId,
      code: root,
      barcode: String(normalizeBarcodeValue(goodsNewBarcodeRef.current?.value ?? '')),
      name: nameTrim,
      nameRaw: nameTrim,
      price: parseMoneyDigitsVi(sortedLines[0]?.price ?? '0'),
      cost: parseMoneyDigitsVi(sortedLines[0]?.cost ?? '0'),
      stockQty: parseMoneyDraftVi(goodsNewStock),
      wholesalePrice: parseMoneyDraftVi(goodsNewWholesale),
      unitLabel: normalizeCatalogUnitLabel(sortedLines[0]?.unitLabel ?? goodsNewUnit),
      conversion: parsePositiveConversion(sortedLines[0]?.conversion) ?? 1,
      conversionValue: parsePositiveConversion(sortedLines[0]?.conversion) ?? 1,
      linkedMasterCode: '',
      brand: String(goodsNewBrand ?? '').trim(),
      supplier: '',
      stockNormMin: null,
      stockNormMax: null,
      weightRaw: '',
      createdAtMs: Date.now(),
      raw: [],
    }
    const replacements = buildCatalogVariantsFromUnitModal({
      templateVariant,
      linesSorted: sortedLines,
      nameTrim,
      prevByVariantId: new Map(),
    })
    for (const r of replacements) {
      const c = String(r.code ?? '').trim().toLowerCase()
      if (c && flat.some((v) => String(v.code ?? '').trim().toLowerCase() === c)) {
        window.alert(`Mã hàng «${r.code}» đã tồn tại trong danh mục.`)
        return
      }
    }
    setGoodsNewMultiVariants(replacements)
    const first = replacements[0]
    if (first) {
      if (goodsNewCodeRef.current) goodsNewCodeRef.current.value = String(first.code ?? '').trim()
      setGoodsNewUnit(normalizeCatalogUnitLabel(first.unitLabel ?? goodsNewUnit))
      setGoodsNewPrice(formatMoneyDraftVi(Number(first.price) || 0))
      setGoodsNewWholesale(formatMoneyDraftVi(Number(first.wholesalePrice) || 0))
      setGoodsNewCost(formatMoneyDraftVi(Number(first.cost) || 0))
      if (goodsNewBarcodeRef.current) {
        goodsNewBarcodeRef.current.value = String(
          normalizeBarcodeValue(first.barcode ?? goodsNewBarcodeRef.current.value ?? '')
        )
      }
    }
    setGcUnitModal(null)
    onSaved?.()
  }, [
    gcUnitModal,
    catalogList,
    goodsNewUnit,
    goodsNewBrand,
    goodsNewStock,
    goodsNewWholesale,
    onSaved,
  ])

  const updateUnitModalConversionAtKey = useCallback((key, raw) => {
    setGcUnitModal((m) => {
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
    setGcUnitModal((m) => {
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
    setGcUnitModal((m) => {
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
    setGcUnitModal((m) => {
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
          costManual: true,
          priceManual: true,
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
    setGcUnitModal((m) => {
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

  const gcUnitModalSortedRows = useMemo(
    () => (gcUnitModal ? sortUnitModalLinesByConversion(gcUnitModal.lines) : []),
    [gcUnitModal]
  )

  useLayoutEffect(() => {
    if (!open || disableEnforceFocus) return
    const id = window.requestAnimationFrame(() => {
      goodsNewBarcodeRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, disableEnforceFocus])

  useEffect(() => {
    if (!open) return
    const flush = () => {
      goodsCreateScanBufferRef.current = { buf: '', times: [] }
    }
    const shouldPauseWedge = () => {
      if (disableEnforceFocus) return true
      if (gcUnitModal) return true
      const ae = document.activeElement
      if (!ae) return false
      /* EntityPersonModal (Thêm NCC / KH / NV): dialog không nằm trong `.ah-goods-create-dialog` */
      if (ae.closest?.('.ah-inbound-sup-modal')) return true
      if (ae === goodsNewBarcodeRef.current) return true
      if (ae.closest?.('.ah-goods-create-dialog') && ahIsEditableFieldElement(ae)) return true
      return false
    }
    const onKeyDownCapture = (e) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!modalOpenRef.current) return
      if (shouldPauseWedge()) {
        flush()
        return
      }
      const st = goodsCreateScanBufferRef.current
      if (e.key === 'Enter') {
        const { buf, times } = st
        flush()
        if (buf.length < AH_SCAN_MIN_CHARS) return
        if (!ahScanTimingLooksLikeWedge(times)) return
        if (!posQueryLooksLikeBarcodeKeyInput(buf)) return
        e.preventDefault()
        e.stopPropagation()
        if (goodsNewBarcodeRef.current) goodsNewBarcodeRef.current.value = buf
        queueMicrotask(() => {
          goodsNewBarcodeRef.current?.focus()
          goodsNewBarcodeRef.current?.select?.()
          revalidateGoodsNewBarcode()
        })
        return
      }
      if (ahIsPrintableBarcodeKey(e.key)) {
        const now = performance.now()
        if (st.times.length > 0 && now - st.times[st.times.length - 1] > AH_SCAN_MAX_INTER_KEY_MS) {
          st.buf = ''
          st.times = []
        }
        st.buf += e.key
        st.times.push(now)
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDownCapture, true)
    return () => {
      window.removeEventListener('keydown', onKeyDownCapture, true)
      flush()
    }
  }, [open, gcUnitModal, disableEnforceFocus, revalidateGoodsNewBarcode])

  if (!open) return null

  return (
    <>
        <div
          className={`ah-goods-create-overlay${gcUnitModal ? ' ah-goods-create-overlay--dim' : ''}`}
          role="presentation"
        >
          <div
            className={`ah-goods-create-dialog${
              goodsCreateEntryMode === 'batch' ? ' ah-goods-create-dialog--batch' : ''
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ah-goods-create-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ah-goods-create-head">
              <h2 id="ah-goods-create-title" className="ah-goods-create-title">
                Tạo hàng hóa
              </h2>
              <button
                type="button"
                className="ah-goods-create-close"
                aria-label="Đóng"
                onClick={handleClose}
              >
                ×
              </button>
            </header>
            <div className="ah-goods-create-body">
              <div className="ah-goods-create-mode-tabs" role="tablist" aria-label="Kiểu tạo hàng">
                <button
                  type="button"
                  role="tab"
                  aria-selected={goodsCreateEntryMode === 'single'}
                  className={`ah-goods-create-mode-tab${goodsCreateEntryMode === 'single' ? ' is-active' : ''}`}
                  onClick={() => {
                    setGoodsCreateEntryMode('single')
                    setGoodsCreateBatchBarcodeErrors({})
                    setGoodsCreateBatchToast(null)
                  }}
                >
                  Một sản phẩm
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={goodsCreateEntryMode === 'batch'}
                  className={`ah-goods-create-mode-tab${goodsCreateEntryMode === 'batch' ? ' is-active' : ''}`}
                  onClick={() => {
                    setGoodsCreateEntryMode('batch')
                    resetBatchRowsState()
                  }}
                >
                  Nhiều sản phẩm
                </button>
              </div>

              {goodsCreateEntryMode === 'batch' ? (
                <div className="ah-goods-create-batch" key={`batch-form-${batchFormEpoch}`}>
                  <p className="ah-goods-create-batch-hint">
                    Mỗi dòng là một sản phẩm riêng — tên, mã, thương hiệu và giá không dùng chung. Có thể thêm
                    đơn vị quy đổi ngay trong từng dòng.
                  </p>
                  <div className="ah-goods-create-batch-desktop">
                    <div className="ah-goods-create-batch-table-wrap">
                      <table className="ah-goods-create-batch-table">
                        <thead>
                          <tr>
                            <th className="ah-goods-create-batch-th-name">Tên hàng *</th>
                            <th className="ah-goods-create-batch-th-brand">Thương hiệu</th>
                            <th className="ah-goods-create-batch-th-code">Mã hàng</th>
                            <th className="ah-goods-create-batch-th-barcode">Mã vạch</th>
                            <th>ĐVT</th>
                            <th>Giá bán</th>
                            <th>Giá vốn</th>
                            <th>Tồn</th>
                            <th aria-label="Xóa dòng" />
                          </tr>
                        </thead>
                        <tbody>
                          {goodsCreateBatchRows.map((row, index) => (
                            <AdminHubGoodsCreateBatchRow
                              key={row.rowId}
                              row={row}
                              index={index}
                              layout="table"
                              brandOptions={batchBrandOptions}
                              barcodeErrors={goodsCreateBatchBarcodeErrors}
                              onPatch={patchGoodsCreateBatchRowField}
                              onPatchExtra={patchGoodsCreateBatchExtraField}
                              onAddExtra={addGoodsCreateBatchExtraUnitRow}
                              onRemoveExtra={removeGoodsCreateBatchExtraUnitRow}
                              onBarcodeBlur={runBatchBarcodeCheck}
                              onRemove={removeGoodsCreateBatchRow}
                              canRemove={goodsCreateBatchRows.length > 1}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="ah-goods-create-batch-mobile" aria-label="Danh sách sản phẩm">
                    {goodsCreateBatchRows.map((row, index) => (
                      <AdminHubGoodsCreateBatchRow
                        key={row.rowId}
                        row={row}
                        index={index}
                        layout="card"
                        rowLabel={`Sản phẩm ${index + 1}`}
                        brandOptions={batchBrandOptions}
                        barcodeErrors={goodsCreateBatchBarcodeErrors}
                        onPatch={patchGoodsCreateBatchRowField}
                        onPatchExtra={patchGoodsCreateBatchExtraField}
                        onAddExtra={addGoodsCreateBatchExtraUnitRow}
                        onRemoveExtra={removeGoodsCreateBatchExtraUnitRow}
                        onBarcodeBlur={runBatchBarcodeCheck}
                        onRemove={removeGoodsCreateBatchRow}
                        canRemove={goodsCreateBatchRows.length > 1}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="ah-goods-create-batch-add"
                    onClick={() => {
                      setGoodsCreateBatchRows((prev) => [...prev, newGoodsCreateBatchRow()])
                    }}
                  >
                    + Thêm sản phẩm
                  </button>
                </div>
              ) : (
              <div className="ah-goods-create-grid">
                <label className="ah-goods-create-field ah-goods-create-field--full">
                  <span className="ah-goods-create-label">
                    Mã vạch <span className="ah-goods-create-hint">(ưu tiên quét; có thể gõ)</span>
                  </span>
                  <div className="ah-goods-create-barcode-row">
                    <input
                      key={`gnew-bc-${goodsCreateFieldsKey}`}
                      ref={goodsNewBarcodeRef}
                      className="ah-goods-create-input ah-goods-create-input--barcode"
                      type="text"
                      defaultValue=""
                      placeholder="Quét hoặc nhập mã vạch"
                      autoComplete="off"
                      spellCheck={false}
                      inputMode="text"
                      onInput={revalidateGoodsNewBarcode}
                    />
                    <button
                      type="button"
                      className="barcode-scan-trigger ah-goods-create-barcode-scan"
                      aria-label="Quét mã vạch bằng camera"
                      title="Quét mã vạch"
                      onClick={() => setGoodsCreateBarcodeScanOpen(true)}
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
                  {goodsNewBarcodeDupMsg ? (
                    <p className="ah-goods-create-barcode-err" role="alert">
                      {goodsNewBarcodeDupMsg}
                    </p>
                  ) : null}
                </label>
                <label className="ah-goods-create-field ah-goods-create-field--full">
                  <span className="ah-goods-create-label">
                    Mã hàng <span className="ah-goods-create-hint">(gợi ý tự động, có thể sửa)</span>
                  </span>
                  <input
                    key={`gnew-code-${goodsCreateFieldsKey}`}
                    ref={goodsNewCodeRef}
                    className="ah-goods-create-input"
                    type="text"
                    defaultValue=""
                    placeholder={suggestNextProductCodeFromCatalog(catalogList)}
                    title="Để trống: khi Lưu hệ thống gán đúng mã gợi ý (kiểm tra trùng trước khi gán)"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="ah-goods-create-field ah-goods-create-field--full">
                  <span className="ah-goods-create-label">
                    Tên hàng <span className="ah-goods-create-req">*</span>
                  </span>
                  <input
                    key={`gnew-name-${goodsCreateFieldsKey}`}
                    ref={goodsNewNameRef}
                    className="ah-goods-create-input"
                    type="text"
                    defaultValue=""
                    placeholder="Nhập tên sản phẩm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="ah-goods-create-field ah-goods-create-field--full">
                  <span className="ah-goods-create-label">Thương hiệu</span>
                  <div className="ah-goods-create-brand-autocomplete">
                    <InboundThuongHieuAutocomplete
                      id={`ah-goods-create-brand-${goodsCreateFieldsKey}`}
                      value={goodsNewBrand}
                      onValueChange={setGoodsNewBrand}
                      options={brandAutocompleteOptions}
                      placeholder="Chọn hoặc gõ thương hiệu (gợi ý từ NCC + danh mục)…"
                      filterDebounceMs={280}
                      listMaxHeight={228}
                      showAddSupplierEntry={Boolean(onRequestAddSupplier)}
                      onRequestAddSupplier={async () => {
                        const createdName = await Promise.resolve(onRequestAddSupplier?.())
                        const normalizedName = String(createdName || '').trim()
                        if (normalizedName) setGoodsNewBrand(normalizedName)
                      }}
                    />
                  </div>
                </label>
                <label className="ah-goods-create-field">
                  <span className="ah-goods-create-label">ĐVT (Đơn vị tính cơ bản)</span>
                  <input
                    className="ah-goods-create-input"
                    type="text"
                    value={goodsNewUnit}
                    onChange={(e) => setGoodsNewUnit(e.target.value)}
                    placeholder="cái, chai, thùng…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="ah-goods-create-field">
                  <span className="ah-goods-create-label">Giá bán lẻ</span>
                  <input
                    className="ah-goods-create-input ah-goods-create-input--num"
                    type="text"
                    inputMode="numeric"
                    value={goodsNewPrice}
                    onChange={(e) => setGoodsNewPrice(formatMoneyThousandsTyping(e.target.value))}
                    placeholder="0"
                    autoComplete="off"
                  />
                </label>
                <label className="ah-goods-create-field">
                  <span className="ah-goods-create-label">Giá sỉ</span>
                  <input
                    className="ah-goods-create-input ah-goods-create-input--num"
                    type="text"
                    inputMode="numeric"
                    value={goodsNewWholesale}
                    onChange={(e) => setGoodsNewWholesale(formatMoneyThousandsTyping(e.target.value))}
                    placeholder="0"
                    autoComplete="off"
                  />
                </label>
                <label className="ah-goods-create-field">
                  <span className="ah-goods-create-label">Giá vốn</span>
                  <input
                    className="ah-goods-create-input ah-goods-create-input--num"
                    type="text"
                    inputMode="numeric"
                    value={goodsNewCost}
                    onChange={(e) => setGoodsNewCost(formatMoneyThousandsTyping(e.target.value))}
                    placeholder="0"
                    autoComplete="off"
                  />
                </label>
                <label className="ah-goods-create-field">
                  <span className="ah-goods-create-label">Tồn kho</span>
                  <input
                    className="ah-goods-create-input ah-goods-create-input--num"
                    type="text"
                    inputMode="numeric"
                    value={goodsNewStock}
                    onChange={(e) => setGoodsNewStock(e.target.value)}
                    onBlur={() =>
                      setGoodsNewStock((v) =>
                        String(v ?? '').trim() === '' ? '0' : formatMoneyDraftVi(parseMoneyDraftVi(v))
                      )
                    }
                    placeholder="0"
                    autoComplete="off"
                  />
                </label>
                <div className="ah-goods-create-field ah-goods-create-field--full ah-goods-create-expiry-row">
                  <span className="ah-goods-create-label">Quản lý theo hạn sử dụng</span>
                  <div className="ah-goods-create-expiry-inner">
                    <select
                      className="ah-goods-create-select"
                      value={goodsNewUseExpiry}
                      onChange={(e) => {
                        const v = e.target.value
                        setGoodsNewUseExpiry(v)
                        if (v === 'no') setGoodsNewExpiryYmd('')
                      }}
                      aria-label="Quản lý theo hạn sử dụng"
                    >
                      <option value="no">Không</option>
                      <option value="yes">Có</option>
                    </select>
                    {goodsNewUseExpiry === 'yes' ? (
                      <input
                        className="ah-goods-create-input ah-goods-create-input--date"
                        type="date"
                        value={goodsNewExpiryYmd}
                        onChange={(e) => setGoodsNewExpiryYmd(e.target.value)}
                        aria-label="Hạn sử dụng"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="ah-goods-create-field ah-goods-create-field--full">
                  <div className="ah-goods-create-uom-row">
                    <div className="ah-goods-create-uom-text">
                      <div className="ah-goods-create-uom-title">Quản lý theo đơn vị tính và thuộc tính</div>
                      <p className="ah-goods-create-uom-desc">
                        Tạo nhiều đơn vị bán hoặc nhập (chai, lốc, thùng). Đặt công thức quy đổi (ví dụ: 1 thùng = 24
                        lon). Mỗi đơn vị có thể có mã hàng riêng.
                      </p>
                      {goodsNewMultiVariants?.length > 1 ? (
                        <p className="ah-goods-create-uom-status">
                          Đã thiết lập {goodsNewMultiVariants.length} đơn vị — bấm Thiết lập để chỉnh lại.
                        </p>
                      ) : null}
                    </div>
                    <button type="button" className="ah-goods-create-uom-btn" onClick={openGoodsCreateUnitModal}>
                      Thiết lập
                    </button>
                  </div>
                </div>
              </div>
              )}
            </div>
            <footer className="ah-goods-create-foot">
              {goodsCreateSaveError ? (
                <p className="ah-goods-create-save-err" role="alert">
                  {goodsCreateSaveError}
                </p>
              ) : null}
              <button type="button" className="ah-goods-create-btn ah-goods-create-btn--ghost" onClick={handleClose}>
                Bỏ qua
              </button>
              <button
                type="button"
                className="ah-goods-create-btn ah-goods-create-btn--primary"
                disabled={
                  revenueReadOnly ||
                  !!goodsNewBarcodeDupMsg ||
                  goodsCreateSaving ||
                  (goodsCreateEntryMode === 'batch' && batchHasBarcodeErrors)
                }
                onClick={submitGoodsCreateModal}
              >
                {goodsCreateSaving ? 'Đang lưu…' : 'Lưu'}
              </button>
            </footer>
          </div>
        </div>

      {goodsCreateBatchToast ? (
        <div className="ah-goods-create-toast ah-goods-create-toast--error" role="alert">
          {goodsCreateBatchToast}
        </div>
      ) : null}

      {gcUnitModal && (
        <div
          className="ah-unit-modal-overlay"
          role="presentation"
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
              <button type="button" className="ah-unit-modal__close" aria-label="Đóng" onClick={closeGcUnitModal}>
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
                  {gcUnitModalSortedRows.map((row, idx) => {
                    const baseLbl =
                      normalizeCatalogUnitLabel(gcUnitModalSortedRows[0]?.unitLabel || '').trim() ||
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
                              setGcUnitModal((m) =>
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
                <div
                  className="ah-unit-modal__dvt-cards-mobile"
                  aria-label="Đơn vị tính: nhập liệu dạng thẻ (mobile)"
                >
                  {gcUnitModalSortedRows.map((row, idx) => {
                    const baseLbl =
                      normalizeCatalogUnitLabel(gcUnitModalSortedRows[0]?.unitLabel || '').trim() ||
                      'đơn vị cơ bản'
                    const conv = parsePositiveConversion(row.conversion) ?? 1
                    const sub =
                      idx === 0
                        ? 'Đơn vị cơ bản'
                        : `1 ${normalizeCatalogUnitLabel(row.unitLabel) || '…'} = ${conv} ${baseLbl}`
                    return (
                      <div
                        key={`gc-mob-${row.key}`}
                        className={`ah-unit-modal__dvt-card${idx === 0 ? ' ah-unit-modal__dvt-card--base' : ''}`}
                      >
                        <p className="ah-unit-modal__dvt-card-meta">{sub}</p>
                        <div className="ah-unit-modal__dvt-card-field">
                          <label htmlFor={`gc-mob-u-${row.key}`}>Tên ĐVT</label>
                          <input
                            id={`gc-mob-u-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                            value={row.unitLabel}
                            onChange={(e) =>
                              setGcUnitModal((m) =>
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
                          <label htmlFor={`gc-mob-c-${row.key}`}>Quy đổi</label>
                          <input
                            id={`gc-mob-c-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                            inputMode="decimal"
                            value={row.conversion}
                            onChange={(e) => updateUnitModalConversionAtKey(row.key, e.target.value)}
                          />
                        </div>
                        <div className="ah-unit-modal__dvt-card-field">
                          <label htmlFor={`gc-mob-code-${row.key}`}>Mã hàng</label>
                          <input
                            id={`gc-mob-code-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                            value={row.code}
                            onChange={(e) =>
                              setGcUnitModal((m) =>
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
                          <label htmlFor={`gc-mob-bc-${row.key}`}>Mã vạch</label>
                          <input
                            id={`gc-mob-bc-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__touch-input"
                            value={row.barcode}
                            onChange={(e) =>
                              setGcUnitModal((m) =>
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
                          <label htmlFor={`gc-mob-cost-${row.key}`}>Giá vốn</label>
                          <input
                            id={`gc-mob-cost-${row.key}`}
                            className="ah-goods-card-input ah-unit-modal__cell-input ah-unit-modal__cell-input--money ah-unit-modal__touch-input"
                            inputMode="numeric"
                            value={row.cost}
                            onChange={(e) =>
                              updateUnitModalCostAtKey(row.key, e.target.value.replace(/\D/g, ''))
                            }
                          />
                        </div>
                        <div className="ah-unit-modal__dvt-card-field">
                          <label htmlFor={`gc-mob-p-${row.key}`}>Giá bán</label>
                          <input
                            id={`gc-mob-p-${row.key}`}
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
                      {gcUnitModalSortedRows.map((row, idx) => (
                        <tr key={`tbl-${row.key}`}>
                          <td>
                            <input
                              className="ah-goods-card-input ah-unit-modal__cell-input"
                              value={row.unitLabel}
                              onChange={(e) =>
                                setGcUnitModal((m) =>
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
                                setGcUnitModal((m) =>
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
                                setGcUnitModal((m) =>
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
                </div>
              </section>
            </div>
            </div>
            <footer className="ah-unit-modal__foot">
              <button type="button" className="ah-iv-btn ah-iv-btn--ghost" onClick={closeGcUnitModal}>
                Bỏ qua
              </button>
              <button type="button" className="ah-iv-btn ah-iv-btn--primary" onClick={commitGcUnitModal}>
                Xong
              </button>
            </footer>
          </div>
        </div>
      )}

      <BarcodeScanModal
        open={goodsCreateBarcodeScanOpen}
        onClose={() => setGoodsCreateBarcodeScanOpen(false)}
        title="Quét mã — mã vạch sản phẩm mới"
        onScan={applyGoodsCreateScannedBarcode}
      />
    </>
  )
}
