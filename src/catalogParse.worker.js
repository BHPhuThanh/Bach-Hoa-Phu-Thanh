import { parseCsvTextToDisplayCatalog, parseExcelCatalogArrayBuffer } from './catalogCsv.js'

self.addEventListener('message', (e) => {
  const { id, fileName, buffer } = e.data || {}
  try {
    const name = String(fileName || '')
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase()
    let result
    if (ext === 'xlsx' || ext === 'xls') {
      result = parseExcelCatalogArrayBuffer(buffer, name)
    } else {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer)).replace(/^\uFEFF/, '')
      result = parseCsvTextToDisplayCatalog(text, name)
    }
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: String(err?.message || err),
    })
  }
})
