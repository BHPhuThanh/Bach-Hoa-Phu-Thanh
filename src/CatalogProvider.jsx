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
    () => !catalogBoot.products?.length
  )
  const [catalogStoreHydrated, setCatalogStoreHydrated] = useState(false)
  const [catalogLoadError, setCatalogLoadError] = useState('')

  const productsRef = useRef(products)
  productsRef.current = products
  const catalogStoreHydratedRef = useRef(false)
  const initialCatalogLoadPendingRef = useRef(initialCatalogLoadPending)
  /** Chỉ true sau khi fetchProducts boot trả về có products — cho phép retry khi lỗi. */
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    catalogStoreHydratedRef.current = catalogStoreHydrated
  }, [catalogStoreHydrated])

  useEffect(() => {
    initialCatalogLoadPendingRef.current = initialCatalogLoadPending
  }, [initialCatalogLoadPending])

  /** Tải catalog đầy đủ khi mở web — không refetch khi đổi tab; retry được nếu boot lỗi. */
  useEffect(() => {
    if (hasFetchedRef.current) return

    let cancelled = false
    void (async () => {
      try {
        const snap = await fetchProducts()
        if (cancelled) return

        if (snap?.products?.length) {
          hasFetchedRef.current = true
          setProducts((prev) => {
            if (!isSupabaseConfigured() && prev.length > 0) return prev
            queueMicrotask(() => {
              setFileName(snap.fileName)
              setCsvRowCount(snap.csvRowCount)
            })
            return prepareCatalogForPosSearch(snap.products)
          })
        } else if (isSupabaseConfigured()) {
          setCatalogLoadError(
            (prev) =>
              prev ||
              'Danh mục trên Supabase đang trống. Đẩy dữ liệu từ file CSV trong repo một lần (máy dev): `npm run push-catalog` với SUPABASE_URL và khóa ghi — ví dụ đẩy `public/bhphuthanh.csv` lên Supabase.'
          )
        } else {
          setCatalogLoadError(
            (prev) =>
              prev ||
              'Chưa cấu hình Supabase (VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY). Ứng dụng không còn tự tải file CSV mặc định; hãy cấu hình env và tải lại — hoặc dùng «Nhập CSV» để nạp thủ công (offline).'
          )
        }
      } catch (err) {
        hasFetchedRef.current = false
        console.error('[CatalogProvider] boot fetchProducts', err)
        setCatalogLoadError(
          (prev) =>
            prev ||
            'Không tải được danh mục từ máy chủ. Kiểm tra mạng / Supabase rồi tải lại trang.'
        )
      } finally {
        if (!cancelled) {
          setInitialCatalogLoadPending(false)
          setCatalogStoreHydrated(true)
        }
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
          const variantCount = flattenDisplayCatalogToVariants(next).length
          if (variantCount > 0) {
            queueMicrotask(() => {
              setInitialCatalogLoadPending(false)
              setCatalogStoreHydrated(true)
            })
          }
          queueMicrotask(() => {
            setCsvRowCount(variantCount)
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
