import { parseCatalogBlobOnMainThread } from './catalogCsv.js'

let msgSeq = 1

/**
 * Đọc CSV / Excel catalog — ưu tiên Web Worker để không chặn main thread (xlsx lớn).
 * Fallback: {@link parseCatalogBlobOnMainThread}.
 * @param {File} file
 */
export async function parseCatalogBlobFile(file) {
  if (typeof Worker === 'undefined' || typeof ArrayBuffer === 'undefined') {
    return parseCatalogBlobOnMainThread(file)
  }
  const buf = await file.arrayBuffer()
  const id = msgSeq++
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(new URL('./catalogParse.worker.js', import.meta.url), { type: 'module' })
    } catch (e) {
      void parseCatalogBlobOnMainThread(file).then(resolve, reject)
      return
    }
    const onMsg = (ev) => {
      const d = ev.data
      if (!d || d.id !== id) return
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      worker.terminate()
      if (d.ok) resolve(d.result)
      else {
        console.warn('[catalogParse] worker reported error, fallback main thread', d.error)
        void parseCatalogBlobOnMainThread(file).then(resolve, reject)
      }
    }
    const onErr = (err) => {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      worker.terminate()
      console.warn('[catalogParse] worker error, fallback main thread', err)
      void parseCatalogBlobOnMainThread(file).then(resolve, reject)
    }
    worker.addEventListener('message', onMsg)
    worker.addEventListener('error', onErr)
    try {
      /* Không transfer buffer: tránh detach khi fallback main thread cần đọc lại file. */
      worker.postMessage({ id, fileName: file?.name || '', buffer: buf })
    } catch (e) {
      worker.removeEventListener('message', onMsg)
      worker.removeEventListener('error', onErr)
      worker.terminate()
      void parseCatalogBlobOnMainThread(file).then(resolve, reject)
    }
  })
}
