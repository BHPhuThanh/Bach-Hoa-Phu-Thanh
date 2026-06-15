import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyRealtimeProductChangeToCatalog,
  fetchProducts,
  flattenDisplayCatalogToVariants,
  readCatalogSnapshotSync,
} from './catalogRepository.js'
import { prepareCatalogForPosSearch } from './catalogSearchSimple.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import { subscribeProductsRealtime } from './productsRealtime.js'

const CatalogContext = createContext(null)

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) {
    throw new Error('useCatalog phải nằm trong <CatalogProvider>.')
  }
  return ctx
}

/** Khóa module — chỉ 1 lần fetch boot / phiên (sống qua StrictMode remount). */
let catalogBootEffectRan = false

/**
 * Provider gốc: danh mục + fetch lần đầu + Realtime singleton.
 * Bọc ngoài Router để chuyển tab/route không unmount WebSocket.
 */
export function CatalogProvider({ children }) {
  const catalogBootRef = useRef(null)
  if (catalogBootRef.current === null) {
    catalogBootRef.current =
      readCatalogSnapshotSync() ?? { products: [], fileName: '', csvRowCount: 0 }
  }
  const catalogBoot = catalogBootRef.current

  const [products, setProducts] = useState(() =>
    prepareCatalogForPosSearch(catalogBoot.products)
  )
  const [fileName, setFileName] = useState(catalogBoot.fileName)
  const [csvRowCount, setCsvRowCount] = useState(catalogBoot.csvRowCount)
  const [initialCatalogLoadPending, setInitialCatalogLoadPending] = useState(
    !catalogBoot.products?.length
  )
  const [catalogStoreHydrated, setCatalogStoreHydrated] = useState(false)
  const [catalogLoadError, setCatalogLoadError] = useState('')

  const productsRef = useRef(products)
  productsRef.current = products
  const catalogStoreHydratedRef = useRef(false)
  const initialCatalogLoadPendingRef = useRef(initialCatalogLoadPending)
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    catalogStoreHydratedRef.current = catalogStoreHydrated
  }, [catalogStoreHydrated])

  useEffect(() => {
    initialCatalogLoadPendingRef.current = initialCatalogLoadPending
  }, [initialCatalogLoadPending])

  /** Tải catalog đầy đủ ĐÚNG 1 LẦN khi mở web — không refetch khi đổi tab / remount. */
  useEffect(() => {
    if (catalogBootEffectRan || hasFetchedRef.current) return
    catalogBootEffectRan = true
    hasFetchedRef.current = true

    let cancelled = false
    void (async () => {
      try {
        const snap = await fetchProducts()
        if (cancelled) return
        if (snap?.products?.length) {
          setInitialCatalogLoadPending(false)
          setProducts((prev) => {
            if (!isSupabaseConfigured() && prev.length > 0) return prev
            queueMicrotask(() => {
              setFileName(snap.fileName)
              setCsvRowCount(snap.csvRowCount)
            })
            return prepareCatalogForPosSearch(snap.products)
          })
        } else if (isSupabaseConfigured()) {
          setInitialCatalogLoadPending(false)
          setCatalogLoadError(
            (prev) =>
              prev ||
              'Danh mục trên Supabase đang trống. Đẩy dữ liệu từ file CSV trong repo một lần (máy dev): `npm run push-catalog` với SUPABASE_URL và khóa ghi — ví dụ đẩy `public/bhphuthanh.csv` lên Supabase.'
          )
        } else {
          setInitialCatalogLoadPending(false)
          setCatalogLoadError(
            (prev) =>
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

  /** Realtime — listener gắn vào kênh singleton; unmount tab con không đóng WebSocket. */
  useEffect(() => {
    if (!isSupabaseConfigured()) return undefined
    const onPayload = (payload) => {
      try {
        const code = String(payload?.new?.ma_hang ?? payload?.old?.ma_hang ?? '').trim()
        setProducts((prev) => {
          const next = applyRealtimeProductChangeToCatalog(prev, payload)
          if (next === prev) return prev
          productsRef.current = next
          queueMicrotask(() => {
            setCsvRowCount(flattenDisplayCatalogToVariants(next).length)
          })
          return next
        })
        if (code) {
          console.log(`[Realtime products] ${payload?.eventType || '?'} → ${code}`)
        }
      } catch (err) {
        console.warn('[Realtime products] lỗi xử lý payload:', err)
      }
    }
    return subscribeProductsRealtime(onPayload)
  }, [])

  const value = useMemo(
    () => ({
      products,
      setProducts,
      productsRef,
      fileName,
      setFileName,
      csvRowCount,
      setCsvRowCount,
      initialCatalogLoadPending,
      setInitialCatalogLoadPending,
      catalogStoreHydrated,
      setCatalogStoreHydrated,
      catalogStoreHydratedRef,
      initialCatalogLoadPendingRef,
      catalogLoadError,
      setCatalogLoadError,
    }),
    [
      products,
      fileName,
      csvRowCount,
      initialCatalogLoadPending,
      catalogStoreHydrated,
      catalogLoadError,
    ]
  )

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}
