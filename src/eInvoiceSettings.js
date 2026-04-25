/** Cài đặt Hóa đơn điện tử — lưu LocalStorage */

export const E_INVOICE_TEMPLATE_CODE = 'C26MPT'

const STORAGE_KEY = 'csv-preview-e-invoice-settings-v1'

/** URL gốc mã hóa trong QR tra cứu (có thể đặt VITE_EINVOICE_QR_URL trong .env). */
export function getEInvoiceQrLookupBaseUrl() {
  const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_EINVOICE_QR_URL
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim().replace(/\/$/, '')
  return 'https://tracuuhd.gdt.gov.vn'
}

export function loadEInvoiceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { autoPrint: true, qrLookup: false }
    const j = JSON.parse(raw)
    return {
      autoPrint: j.autoPrint !== false,
      qrLookup: j.qrLookup === true,
    }
  } catch {
    return { autoPrint: true, qrLookup: false }
  }
}

export function saveEInvoiceSettings(s) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        autoPrint: !!s.autoPrint,
        qrLookup: !!s.qrLookup,
      })
    )
  } catch {
    /* ignore */
  }
}

/** Mã tra cứu hiển thị trên hóa đơn (gắn với số HĐ). */
export function buildEInvoiceLookupCode(invoiceNo) {
  const raw = String(invoiceNo ?? '').replace(/[^\w-]/g, '')
  const tail = raw.slice(-12) || String(Date.now())
  return `${E_INVOICE_TEMPLATE_CODE}-${tail}`
}

/** Chuỗi URL đưa vào QR (tra cứu). */
export function buildEInvoiceQrPayload(lookupCode) {
  const base = getEInvoiceQrLookupBaseUrl()
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}ma=${encodeURIComponent(lookupCode)}`
}
