import { openDB } from 'idb'

const DB_NAME = 'pos-offline-v1'
const STORE = 'pos_offline_orders'
const DB_VERSION = 1
// Khóa dự phòng khi IndexedDB không khả dụng (chế độ riêng tư, lỗi mở DB...).
const LS_KEY = 'pos_offline_orders'

let dbPromise = null

function getDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      },
    }).catch((e) => {
      console.warn('[posOfflineQueue] Không mở được IndexedDB, dùng localStorage:', e)
      return null
    })
  }
  return dbPromise
}

function lsRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function lsWrite(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
  } catch (e) {
    console.warn('[posOfflineQueue] localStorage write fail:', e)
  }
}

function buildEntry(entry) {
  const id =
    String(entry?.order?.id || entry?.id || '').trim() ||
    `off-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    id,
    order: entry?.order ?? null,
    tonKhoOnlyVariants: Array.isArray(entry?.tonKhoOnlyVariants) ? entry.tonKhoOnlyVariants : [],
    inventoryLogRows: Array.isArray(entry?.inventoryLogRows) ? entry.inventoryLogRows : [],
    fileName: entry?.fileName || '',
    timestamp: Date.now(),
    status: 'pending',
    // Số lần đồng bộ thất bại — quá 3 lần sẽ chuyển status:'error' (dead-letter) để giải phóng hàng đợi.
    retryCount: 0,
    // Cờ idempotent: bỏ qua bước đã hoàn tất khi retry để tránh ghi trùng (đặc biệt inventory_log dùng insert).
    salesDone: false,
    stockDone: false,
    logDone: false,
  }
}

export async function enqueueOfflineOrder(entry) {
  const item = buildEntry(entry)
  const db = await getDb()
  if (db) {
    try {
      await db.put(STORE, item)
      return item
    } catch (e) {
      console.warn('[posOfflineQueue] put idb fail, fallback localStorage:', e)
    }
  }
  const list = lsRead()
  list.push(item)
  lsWrite(list)
  return item
}

/** Cũ nhất trước (đẩy đơn theo thứ tự phát sinh). */
export async function getPendingOfflineOrders() {
  const db = await getDb()
  if (db) {
    try {
      const all = await db.getAll(STORE)
      return (all || []).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    } catch (e) {
      console.warn('[posOfflineQueue] getAll idb fail, fallback localStorage:', e)
    }
  }
  return lsRead().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

/** Chỉ đếm đơn còn cần đồng bộ (loại bỏ đơn đã dead-letter status:'error'). */
export async function countPendingOfflineOrders() {
  const db = await getDb()
  if (db) {
    try {
      const all = await db.getAll(STORE)
      return (all || []).filter((x) => x?.status !== 'error').length
    } catch (e) {
      console.warn('[posOfflineQueue] count idb fail, fallback localStorage:', e)
    }
  }
  return lsRead().filter((x) => x?.status !== 'error').length
}

export async function updateOfflineOrder(id, patch) {
  const orderId = String(id || '').trim()
  if (!orderId) return
  const db = await getDb()
  if (db) {
    try {
      const cur = await db.get(STORE, orderId)
      if (!cur) return
      await db.put(STORE, { ...cur, ...patch })
      return
    } catch (e) {
      console.warn('[posOfflineQueue] update idb fail, fallback localStorage:', e)
    }
  }
  const list = lsRead().map((x) => (x.id === orderId ? { ...x, ...patch } : x))
  lsWrite(list)
}

export async function removeOfflineOrder(id) {
  const orderId = String(id || '').trim()
  if (!orderId) return
  const db = await getDb()
  if (db) {
    try {
      await db.delete(STORE, orderId)
      return
    } catch (e) {
      console.warn('[posOfflineQueue] delete idb fail, fallback localStorage:', e)
    }
  }
  lsWrite(lsRead().filter((x) => x.id !== orderId))
}
