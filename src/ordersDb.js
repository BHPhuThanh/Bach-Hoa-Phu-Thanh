const DB_NAME = 'csv-preview-sales-v1'
const STORE = 'orders'
const VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * @param {{ id: string, invoiceNo: string, createdAt: string, items: object[], subtotal: number, discount: number, total: number }} order
 */
export async function saveOrder(order) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(order)
  })
}

/** Mới nhất trước */
export async function getAllOrders() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      const list = req.result || []
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      resolve(list)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function clearAllOrders() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).clear()
  })
}
