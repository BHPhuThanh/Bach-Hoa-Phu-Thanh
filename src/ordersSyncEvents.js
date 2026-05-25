/** Báo hiệu cần tải lại đơn từ Supabase (tab Doanh thu độc lập, không nhận salesRefresh từ POS). */
export const ORDERS_SYNC_BUMP_EVENT = 'csv-preview-orders-sync-bump-v1'

export function bumpOrdersSync() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ORDERS_SYNC_BUMP_EVENT))
}
