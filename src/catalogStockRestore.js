/**
 * Hoàn tồn kho catalog (đối xứng trừ khi bán) — dùng xóa đơn, trả hàng POS, hủy đơn.
 */
import {
  applyRestoredQtyToCatalog,
  buildComboCartSaleDeltaByVariantId,
  buildNonComboDeductionByMaGoc,
  collectRestoreStockTouchedVariantIds,
  findProductContainingVariantId,
  isComboCatalogProduct,
} from './comboCatalog.js'
import {
  describeCatalogPersistError,
  flattenDisplayCatalogToVariants,
  persistCatalogSnapshotAndProducts,
  revalidateCatalogFromStore,
} from './catalogRepository.js'
import { refreshCatalogSearchTexts } from './productUnits.js'
import { isSupabaseConfigured } from './supabaseClient.js'

/**
 * @param {{
 *   catalog: Array
 *   cartLines: Array<{ variantId: string, qty: number }>
 *   catalogFileName?: string
 *   onBulkPatchCatalogVariants?: (patches: Array, opts?: object) => Promise<{ ok?: boolean, error?: string }>
 *   setStandaloneCatalog?: (v: { products: Array, fileName: string } | null) => void
 *   bulkPatchOpts?: object
 * }} ctx
 */
export async function persistCatalogStockRestoreFromCartLines(ctx) {
  const {
    catalog,
    cartLines,
    catalogFileName = '',
    onBulkPatchCatalogVariants,
    setStandaloneCatalog,
    bulkPatchOpts,
  } = ctx

  if (!Array.isArray(catalog) || !catalog.length || !cartLines?.length) {
    return { ok: true, skipped: true, prevProducts: catalog, nextProducts: catalog, touchedIds: new Set() }
  }

  const componentLines = (cartLines || []).filter((l) => {
    const p = findProductContainingVariantId(catalog, l?.variantId)
    return !(p && isComboCatalogProduct(p))
  })
  if (componentLines.length === 0) {
    return { ok: false, error: 'Không có thành phần lẻ để hoàn tồn (combo phải rã BOM).' }
  }

  const deductByMaGoc = buildNonComboDeductionByMaGoc(catalog, componentLines)
  const comboDelta = buildComboCartSaleDeltaByVariantId(catalog, componentLines)
  const touchedIds = collectRestoreStockTouchedVariantIds(catalog, componentLines)
  const nextProducts = applyRestoredQtyToCatalog(catalog, componentLines, {
    precomputedDeductByMaGoc: deductByMaGoc,
    precomputedComboDelta: comboDelta,
  })

  if (deductByMaGoc.size === 0 && comboDelta.size === 0 && touchedIds.size === 0) {
    return { ok: false, error: 'Không tính được lượng hoàn tồn cho các dòng.' }
  }

  const flatNext = flattenDisplayCatalogToVariants(nextProducts)
  const tonKhoOnlyVariants = flatNext.filter((v) => touchedIds.has(String(v.id)))

  if (typeof onBulkPatchCatalogVariants === 'function') {
    const flatPrev = flattenDisplayCatalogToVariants(catalog)
    const patches = []
    for (const id of touchedIds) {
      const prev = flatPrev.find((v) => String(v.id) === String(id))
      const next = flatNext.find((v) => String(v.id) === String(id))
      if (!next) continue
      const prevStock =
        prev?.stockQty != null && Number.isFinite(Number(prev.stockQty)) ? Number(prev.stockQty) : 0
      const nextStock =
        next.stockQty != null && Number.isFinite(Number(next.stockQty)) ? Number(next.stockQty) : 0
      if (prevStock === nextStock) continue
      patches.push({
        variantId: String(id),
        patch: { stockQty: nextStock, stockBatches: next.stockBatches },
      })
    }
    if (patches.length === 0) {
      return { ok: false, error: 'Không có thay đổi tồn kho để ghi lên máy chủ.' }
    }
    const stockRes = await onBulkPatchCatalogVariants(patches, bulkPatchOpts)
    if (stockRes?.ok === false) {
      return { ok: false, error: String(stockRes.error || 'Không thể hoàn tồn kho.') }
    }
    return { ok: true, prevProducts: catalog, nextProducts, touchedIds }
  }

  if (!tonKhoOnlyVariants.length) {
    return { ok: false, error: 'Không tìm thấy biến thể để cập nhật tồn kho.' }
  }

  const persistResult = await persistCatalogSnapshotAndProducts(nextProducts, catalogFileName, {
    tonKhoOnlyVariants,
  })
  if (!persistResult.ok) {
    return {
      ok: false,
      error: describeCatalogPersistError(persistResult.error) || 'Không ghi được tồn kho lên máy chủ.',
    }
  }

  if (typeof setStandaloneCatalog === 'function') {
    if (isSupabaseConfigured()) {
      const fresh = await revalidateCatalogFromStore()
      if (fresh?.products?.length) {
        setStandaloneCatalog({
          products: refreshCatalogSearchTexts(fresh.products),
          fileName: fresh.fileName || catalogFileName,
        })
      } else {
        setStandaloneCatalog({ products: nextProducts, fileName: catalogFileName })
      }
    } else {
      setStandaloneCatalog({ products: nextProducts, fileName: catalogFileName })
    }
  }

  return { ok: true, prevProducts: catalog, nextProducts, touchedIds }
}
