/**
 * Đồng bộ phiếu nhập + tồn kho lên Supabase — chạy từ App (không unmount).
 * Gộp request song song (Promise.all) để tránh kẹt Auth Lock do gọi tuần tự lồng nhau.
 */

import {
  updateProductDisplayVariantsSequential,
  describeCatalogPersistError,
} from './catalogRepository.js'
import { insertInboundHistoryEntry } from './supabaseInboundHistory.js'
import { isSupabaseConfigured } from './supabaseClient.js'
import {
  buildInboundInventoryLogRows,
  insertInventoryLogRows,
  staffNameForInventoryLog,
} from './inventoryLogRepository.js'

/**
 * @param {{
 *   catalogProductsNext: Array,
 *   catalogFileName: string,
 *   upsertOnlyVariants: Array<object>,
 *   orderRow: object,
 * }} params
 * @returns {Promise<{ ok: boolean, skipped?: boolean, row: object, returnedDisplayVariants?: Array }>}
 */
export async function runInboundSupabaseSync({
  catalogProductsNext,
  catalogFileName,
  upsertOnlyVariants,
  orderRow,
}) {
  if (!isSupabaseConfigured()) {
    return { ok: true, skipped: true, row: orderRow }
  }

  const productsResult = await updateProductDisplayVariantsSequential(upsertOnlyVariants || [])

  if (!productsResult?.ok) {
    throw new Error(
      describeCatalogPersistError(productsResult?.error) ||
        'Không ghi được tồn kho / giá vốn lên bảng products (Supabase).'
    )
  }

  const historyResult = await insertInboundHistoryEntry(orderRow)

  if (!historyResult?.ok) {
    const err = historyResult?.error
    const msg =
      err instanceof Error
        ? err.message
        : String(err?.message || err || 'Không ghi được phiếu vào «inbound_history».')
    throw new Error(msg)
  }

  return {
    ok: true,
    row: historyResult.order || orderRow,
    returnedDisplayVariants: productsResult.returnedDisplayVariants,
  }
}

/**
 * Sau khi products + inbound_history thành công — ghi `inventory_log` (một lần, không lồng Promise.all).
 * @param {object} params
 * @param {Array} params.snapshotPrev — catalog trước patch
 * @param {Array} params.catalogProductsNext
 * @param {Array<{ variantId: string, patch: object }>} params.validPatches
 * @param {{ documentCode?: string, inboundOrderId?: string }} params.inventoryMeta
 */
export async function runInboundInventoryLogAfterSync({
  snapshotPrev,
  catalogProductsNext,
  validPatches,
  inventoryMeta,
}) {
  if (!isSupabaseConfigured()) return
  if (!inventoryMeta?.documentCode || !validPatches?.length) return
  const logRows = buildInboundInventoryLogRows(snapshotPrev, catalogProductsNext, validPatches, {
    documentCode: inventoryMeta.documentCode,
    inboundOrderId: inventoryMeta.inboundOrderId ?? '',
    staffName: staffNameForInventoryLog(),
  })
  await insertInventoryLogRows(logRows)
}
