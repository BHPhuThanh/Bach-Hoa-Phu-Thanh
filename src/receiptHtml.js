import { buildEInvoiceLookupCode, buildEInvoiceQrPayload } from './eInvoiceSettings.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

/** Thông tin cửa hàng — chỉnh tại đây. */
export const RECEIPT_STORE_NAME = 'Bách Hóa Phú Thành'
/** Mỗi phần tử = một dòng địa chỉ (căn giữa). */
export const RECEIPT_STORE_ADDRESS_LINES = [
  '142 đường 8 tháng 3',
  'phường Thanh Đức',
  'tỉnh Vĩnh Long',
]
export const RECEIPT_STORE_PHONE = '0975322332'
export const RECEIPT_LOGO_URL = '/logo-kiotviet.png'

const DEFAULT_CUSTOMER_NAME = 'Người mua không lấy hóa đơn'
const DEFAULT_CUSTOMER_PHONE = '—'
const DEFAULT_CUSTOMER_ADDRESS = '—'

const CHU_SO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

/** Đọc số 0–999 (hỗ trợ ghép nghìn/triệu). */
function docBaSo(n, batBuocTram) {
  let s = ''
  const t = Math.floor(n / 100)
  const c = Math.floor((n % 100) / 10)
  const d = n % 10
  if (batBuocTram || t > 0) {
    if (t > 0) s += CHU_SO[t] + ' trăm'
    else if (n >= 100) s += 'không trăm'
  }
  if (c === 0) {
    if (d > 0 && t > 0) s += ' linh ' + CHU_SO[d]
    else if (d > 0 && t === 0) s += CHU_SO[d]
  } else if (c === 1) {
    s += ' mười'
    if (d === 1) s += ' một'
    else if (d === 5) s += ' lăm'
    else if (d > 0) s += ' ' + CHU_SO[d]
  } else {
    s += ' ' + CHU_SO[c] + ' mươi'
    if (d === 1) s += ' mốt'
    else if (d === 5) s += ' lăm'
    else if (d > 0) s += ' ' + CHU_SO[d]
  }
  return s.trim().replace(/\s+/g, ' ')
}

export function tienBangChu(soTien) {
  const n = Math.floor(Math.round(Number(soTien)))
  if (n < 0) return ''
  if (n === 0) return 'Không đồng chẵn'
  const scales = ['', 'nghìn', 'triệu', 'tỷ']
  const parts = []
  let rest = n
  for (let i = 0; i < scales.length && rest > 0; i++) {
    const chunk = rest % 1000
    rest = Math.floor(rest / 1000)
    if (chunk > 0) {
      const canThieuTram = chunk < 100 && rest > 0
      let t = docBaSo(chunk, canThieuTram)
      if (scales[i]) t += ' ' + scales[i]
      parts.push(t)
    }
  }
  let out = parts.reverse().join(' ').replace(/\s+/g, ' ').trim()
  out = out.charAt(0).toUpperCase() + out.slice(1)
  return out + ' đồng chẵn'
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Tách tên hàng / ĐƠN VỊ TÍNH (đơn mới có `unitLabel`; đơn cũ có thể gộp "Tên - ĐƠN VỊ TÍNH" trong `name`). */
function receiptProductNameAndUnit(line) {
  const rawName = String(line.name ?? '').trimEnd()
  const explicit = String(line.unitLabel ?? '').trim()
  if (explicit && explicit !== '—') {
    return { name: rawName || '—', unit: normalizeCatalogUnitLabel(explicit) }
  }
  const m = rawName.match(/^(.*?)\s+[-–—]\s+(.+)$/)
  if (m) {
    const nm = m[1].trim()
    const ut = m[2].trim()
    if (nm && ut) return { name: nm, unit: normalizeCatalogUnitLabel(ut) }
  }
  return { name: rawName || '—', unit: normalizeCatalogUnitLabel('') }
}

function formatReceiptQty(q) {
  const n = Number(q)
  if (!Number.isFinite(n)) return String(q ?? '')
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 6 })
}

function pad2(x) {
  return String(x).padStart(2, '0')
}

/** Mã hóa đơn cùng quy tắc với nội dung in (dùng khi lưu DB + in lại). */
export function formatInvoiceNo(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  return `HD${x.getFullYear().toString().slice(2)}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}-${pad2(x.getHours())}${pad2(x.getMinutes())}${pad2(x.getSeconds())}`
}

/**
 * @param {Array<{ name: string, unitLabel?: string, code?: string, price: number, qty: number }>} cart
 * @param {number} total — tổng sau chiết khấu (nếu opts.discount thì total nên = subtotal - discount)
 * @param {object} [opts]
 */
export function buildK80ReceiptHtml(cart, total, opts = {}) {
  const storeName = opts.storeName ?? RECEIPT_STORE_NAME
  const addressLines = Array.isArray(opts.storeAddressLines)
    ? opts.storeAddressLines
    : opts.storeAddress
      ? [opts.storeAddress]
      : RECEIPT_STORE_ADDRESS_LINES
  const storePhone = opts.storePhone ?? RECEIPT_STORE_PHONE
  const logoUrl = opts.logoUrl ?? RECEIPT_LOGO_URL
  const customerName = opts.customerName ?? DEFAULT_CUSTOMER_NAME
  const customerPhone = opts.customerPhone ?? DEFAULT_CUSTOMER_PHONE
  const customerAddress = opts.customerAddress ?? DEFAULT_CUSTOMER_ADDRESS
  const discount = Math.max(0, Number(opts.discount) || 0)

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)
  const payTotal =
    discount > 0 ? Math.max(0, subtotal - discount) : Math.round(Number(total)) || subtotal

  const now = opts.fixedAt ? new Date(opts.fixedAt) : new Date()
  const dateStr =
    opts.dateDisplayStr ??
    now.toLocaleString('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  const invoiceNo = opts.invoiceNo ?? formatInvoiceNo(now)

  const ein = opts.eInvoice
  let eInvHtml = ''
  if (ein?.showQrLookup) {
    const lookupCode = ein.lookupCode || buildEInvoiceLookupCode(invoiceNo)
    const qrPayload = ein.qrPayload || buildEInvoiceQrPayload(lookupCode)
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrPayload)}`
    eInvHtml = `
  <div class="inv-einv">
    <div class="inv-einv-qr-wrap">
      <img class="inv-einv-qr" src="${escapeHtml(qrSrc)}" alt="QR tra cứu" width="120" height="120" />
    </div>
    <p class="inv-einv-code">Mã tra cứu: ${escapeHtml(lookupCode)}</p>
  </div>`
  }

  const amountWords = tienBangChu(payTotal)

  const addressLinesHtml = addressLines
    .map((line) => `<p class="inv-addr-line">${escapeHtml(line)}</p>`)
    .join('')

  const tableRows = cart
    .map((l) => {
      const line = l.price * l.qty
      const { name, unit } = receiptProductNameAndUnit(l)
      const qtyStr = formatReceiptQty(l.qty)
      return `<tr>
    <td colspan="4" class="td-prod-name">${escapeHtml(name)}</td>
  </tr>
  <tr>
    <td class="td-dg">${l.price.toLocaleString('vi-VN')}</td>
    <td class="td-dvt">${escapeHtml(unit)}</td>
    <td class="td-sl">${escapeHtml(qtyStr)}</td>
    <td class="td-tt">${line.toLocaleString('vi-VN')}</td>
  </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hóa đơn bán hàng</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html {
    margin: 0; padding: 0; background: #fff; color: #000000;
    height: auto; max-height: none; overflow: visible;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body {
    margin: 0 auto; padding: 2mm 2.5mm 3mm; background: #fff; color: #000000 !important;
    font-family: 'Courier New', Courier, monospace !important;
    font-size: 13px; font-weight: bold; line-height: 1.35;
    width: 72mm; max-width: 72mm;
    height: auto; max-height: none; overflow: visible;
    -webkit-font-smoothing: none;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  #root, .receipt {
    width: 100%; height: auto; max-height: none; overflow: visible;
    display: block; position: relative;
    font-family: 'Courier New', Courier, monospace !important;
    color: #000000 !important;
    -webkit-font-smoothing: none;
  }
  .receipt, .receipt * {
    font-family: 'Courier New', Courier, monospace !important;
    color: #000000 !important;
    font-weight: bold;
    -webkit-font-smoothing: none;
  }
  .inv-head {
    text-align: center;
    margin: 0 0 0;
    padding-bottom: 0;
    border-bottom: 1px dashed #000 !important;
    margin-bottom: 8px;
  }
  .inv-head-logo {
    margin: 0 auto 4px;
  }
  .inv-head-logo img {
    display: block; margin: 0 auto; max-height: 42px; max-width: 58%;
    object-fit: contain;
    filter: grayscale(100%) contrast(200%);
  }
  .inv-store-name {
    font-weight: bold; font-size: 20px; margin: 0 0 4px;
    text-align: center; line-height: 1.2;
    color: #000000 !important;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .inv-addr-line {
    margin: 0 auto 2px; padding: 0; font-size: 12px; line-height: 1.3;
    text-align: center; color: #000000 !important;
    max-width: 68mm; word-wrap: break-word; overflow-wrap: break-word;
  }
  .inv-phone {
    margin: 4px 0 0; padding: 0; font-size: 13px; font-weight: bold;
    text-align: center; color: #000000 !important;
  }
  .inv-title-block {
    text-align: center; margin: 0 0 8px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #000 !important;
  }
  .inv-doc-title {
    margin: 0 0 4px; padding: 0; font-size: 14px; font-weight: bold;
    letter-spacing: 0.04em; text-align: center; color: #000000 !important;
  }
  .inv-meta-line {
    margin: 0 0 2px; padding: 0; font-size: 13px; line-height: 1.3;
    text-align: center; color: #000000 !important;
  }
  .rule {
    border: 0;
    border-bottom: 1px dashed #000 !important;
    margin: 8px 0;
    height: 0;
    background: transparent;
  }
  .inv-cust {
    text-align: left; font-size: 13px; line-height: 1.35;
    margin: 0 0 8px; color: #000000 !important;
  }
  .inv-cust .line { margin: 0 0 2px; }
  .inv-table-wrap {
    width: 100%; overflow: hidden; margin: 0 0 8px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #000 !important;
  }
  table.inv-table {
    width: 100%; border-collapse: collapse;
    font-size: 13px; table-layout: fixed;
    color: #000000 !important;
  }
  .inv-table th, .inv-table td {
    border: 0; padding: 3px 2px;
    vertical-align: top; word-wrap: break-word;
    color: #000000 !important;
  }
  .inv-table thead tr {
    border-bottom: 1px dashed #000 !important;
  }
  .inv-table thead th {
    font-weight: bold; text-align: center;
    font-size: 12px; padding-bottom: 6px;
    color: #000000 !important;
  }
  .inv-table .td-prod-name {
    text-align: left; font-weight: bold; font-size: 14px;
    padding: 4px 0 2px; color: #000000 !important;
  }
  .inv-table .td-dg { text-align: right; width: 26%; font-size: 13px; font-variant-numeric: tabular-nums; }
  .inv-table .td-dvt { text-align: center; width: 22%; font-size: 13px; font-weight: bold; }
  .inv-table .td-sl { text-align: center; width: 14%; font-size: 13px; font-variant-numeric: tabular-nums; }
  .inv-table .td-tt {
    text-align: right; width: 38%; font-weight: bold; font-size: 14px;
    font-variant-numeric: tabular-nums; color: #000000 !important;
  }
  .inv-pay {
    margin-top: 0; text-align: right; font-size: 13px;
    line-height: 1.35; color: #000000 !important;
    padding-bottom: 8px;
    border-bottom: 1px dashed #000 !important;
    margin-bottom: 8px;
  }
  .inv-pay .pay-row {
    display: flex; justify-content: space-between; gap: 6px;
    margin: 0 0 2px;
  }
  .inv-pay .pay-row span:first-child { flex: 1 1 auto; text-align: left; }
  .inv-pay .pay-row span:last-child {
    flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums;
  }
  .inv-pay .pay-grand {
    font-weight: bold; font-size: 14px; margin-top: 4px;
    padding-top: 0; border: 0;
  }
  .amount-words {
    margin: 0 0 8px; text-align: left; font-size: 13px;
    font-weight: bold; line-height: 1.35; word-wrap: break-word;
    color: #000000 !important;
  }
  .inv-footer {
    text-align: center; font-size: 14px; font-weight: bold;
    margin-top: 0; padding-top: 0; border: 0;
    color: #000000 !important;
  }
  .inv-einv {
    margin-top: 8px; padding-top: 8px; text-align: center;
    border-top: 1px dashed #000 !important;
  }
  .inv-einv-qr-wrap { margin: 4px 0; }
  .inv-einv-qr {
    display: block; margin: 0 auto; width: 120px; height: 120px;
    image-rendering: pixelated;
    filter: grayscale(100%) contrast(200%);
  }
  .inv-einv-code {
    margin: 4px 0 0; font-size: 13px; font-weight: bold;
    word-break: break-all; color: #000000 !important;
  }
  .receipt-feed { width: 100%; height: 50px; margin: 0; padding: 0; border: 0; }

  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body, #root, .receipt {
      height: auto !important; max-height: none !important;
      overflow: visible !important;
      font-family: 'Courier New', Courier, monospace !important;
      color: #000000 !important;
      -webkit-font-smoothing: none !important;
    }
    body {
      font-size: 13px !important; font-weight: bold !important;
      padding: 2mm 2.5mm 3mm !important; line-height: 1.35 !important;
    }
    .receipt, .receipt * {
      color: #000000 !important;
      font-family: 'Courier New', Courier, monospace !important;
      font-weight: bold !important;
      -webkit-font-smoothing: none !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .inv-head,
    .inv-head .inv-head-logo,
    .inv-head .inv-store-name,
    .inv-head .inv-addr-line,
    .inv-head .inv-phone {
      text-align: center !important;
    }
    .inv-title-block,
    .inv-title-block .inv-doc-title,
    .inv-title-block .inv-meta-line {
      text-align: center !important;
    }
    .inv-head-logo img {
      max-height: 42px !important;
      filter: grayscale(100%) contrast(200%) !important;
    }
    .inv-store-name { font-size: 20px !important; }
    .inv-addr-line { font-size: 12px !important; max-width: 68mm !important; }
    .inv-doc-title { font-size: 14px !important; }
    .inv-table .td-prod-name { font-size: 14px !important; text-align: left !important; }
    .inv-table .td-tt { font-size: 14px !important; }
    .rule,
    .inv-head,
    .inv-title-block,
    .inv-table-wrap,
    .inv-pay,
    .inv-einv {
      border-bottom-color: #000000 !important;
    }
    .receipt-feed {
      height: 50px !important; page-break-inside: avoid; break-inside: avoid;
    }
  }
</style>
</head>
<body>
<div id="root">
<div class="receipt">
  <header class="inv-head">
    <div class="inv-head-logo">
      <img src="${escapeHtml(logoUrl)}" alt="KiotViet" />
    </div>
    <p class="inv-store-name">${escapeHtml(storeName)}</p>
    ${addressLinesHtml}
    <p class="inv-phone">ĐT: ${escapeHtml(storePhone)}</p>
  </header>
  <hr class="rule" />
  <section class="inv-title-block">
    <h1 class="inv-doc-title">HÓA ĐƠN BÁN HÀNG</h1>
    <p class="inv-meta-line">Số HĐ: ${escapeHtml(invoiceNo)}</p>
    <p class="inv-meta-line">${escapeHtml(dateStr)}</p>
  </section>
  <hr class="rule" />
  <section class="inv-cust">
    <p class="line">Khách hàng: ${escapeHtml(customerName)}</p>
    <p class="line">SĐT: ${escapeHtml(customerPhone)}</p>
    <p class="line">Địa chỉ: ${escapeHtml(customerAddress)}</p>
  </section>
  <hr class="rule" />
  <div class="inv-table-wrap">
    <table class="inv-table">
      <thead>
        <tr>
          <th>Đơn giá</th>
          <th>ĐƠN VỊ TÍNH</th>
          <th>SL</th>
          <th>Thành tiền</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>
  <hr class="rule" />
  <div class="inv-pay">
    <div class="pay-row"><span>Tổng tiền hàng:</span><span>${subtotal.toLocaleString('vi-VN')} đ</span></div>
    <div class="pay-row"><span>Chiết khấu:</span><span>${discount > 0 ? `-${discount.toLocaleString('vi-VN')}` : '0'} đ</span></div>
    <div class="pay-row pay-grand"><span>Tổng thanh toán:</span><span>${payTotal.toLocaleString('vi-VN')} đ</span></div>
  </div>
  <p class="amount-words">${escapeHtml(amountWords)}</p>
  <hr class="rule" />
  <p class="inv-footer">Cảm ơn và hẹn gặp lại!</p>
  ${eInvHtml}
  <div class="receipt-feed" aria-hidden="true"></div>
</div>
</div>
</body>
</html>`
}
