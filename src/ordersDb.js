import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient.js'

const IDB_DB_NAME = 'csv-preview-sales-v1'
const IDB_STORE = 'orders'
const IDB_VERSION = 1
const SALES_TABLE = 'sales'

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * @param {{ id: string, invoiceNo: string, createdAt: string, items: object[], subtotal: number, discount: number, total: number }} order
 */
export async function saveOrder(order) {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const createdAt = order.createdAt || new Date().toISOString()
    const { error } = await sb.from(SALES_TABLE).upsert(
      {
        id: order.id,
        created_at: createdAt,
        payload: order,
      },
      { onConflict: 'id' }
    )
    if (error) throw error
    return
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).put(order)
  })
}

/** Mới nhất trước */
export async function getAllOrders() {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { data, error } = await sb
      .from(SALES_TABLE)
      .select('payload, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    const list = (data || [])
      .map((row) => {
        const p = row.payload
        return p && typeof p === 'object' ? p : null
      })
      .filter(Boolean)
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return list
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).getAll()
    req.onsuccess = () => {
      const list = req.result || []
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function clearAllOrders() {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')
    const { error } = await sb.from(SALES_TABLE).delete().neq('id', '')
    if (error) throw error
    return
  }
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).clear()
  })
}

export async function deleteOrderById(orderIdRaw) {
  const orderId = String(orderIdRaw || '').trim()
  if (!orderId) throw new Error('Thiếu orderId để xóa đơn hàng.')
  if (isSupabaseConfigured()) {
    const sb = getSupabaseClient()
    if (!sb) throw new Error('Supabase chưa khởi tạo')

    // Bảng đơn thực tế đang được GET/LOAD ở Doanh thu: sales.
    const { error: salesErr } = await sb.from(SALES_TABLE).delete().eq('id', orderId)
    if (salesErr) throw salesErr
    return
  }

  const db = await openIdb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(IDB_STORE).delete(orderId)
  })
}
