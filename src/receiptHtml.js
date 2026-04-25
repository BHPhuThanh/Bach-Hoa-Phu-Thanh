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

/** Tách tên hàng / ĐVT (đơn mới có `unitLabel`; đơn cũ có thể gộp "Tên - ĐVT" trong `name`). */
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
    margin: 0; padding: 0; background: #fff; color: #000;
    height: auto; max-height: none; overflow: visible;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body {
    margin: 0 auto; padding: 1.5mm 2.5mm 2.5mm; background: #fff; color: #000;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 10px; line-height: 1.28;
    width: 72mm; max-width: 72mm;
    height: auto; max-height: none; overflow: visible;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  #root, .receipt {
    width: 100%; height: auto; max-height: none; overflow: visible;
    display: block; position: relative;
  }
  .inv-head {
    text-align: center;
    margin: 0 0 3px;
  }
  .inv-head-logo {
    margin: 0 auto 2px;
  }
  .inv-head-logo img {
    display: block; margin: 0 auto; max-height: 38px; max-width: 55%;
    object-fit: contain;
  }
  .inv-store-name {
    font-weight: 700; font-size: 12px; margin: 0 0 2px;
    text-align: center; line-height: 1.2;
    word-wrap: break-word;
  }
  .inv-addr-line {
    margin: 0 0 1px; padding: 0; font-size: 9px; line-height: 1.25;
    text-align: center; color: #000;
  }
  .inv-phone {
    margin: 2px 0 0; padding: 0; font-size: 9px; font-weight: 600;
    text-align: center;
  }
  .inv-title-block {
    text-align: center; margin: 0 0 2px;
  }
  .inv-doc-title {
    margin: 0 0 2px; padding: 0; font-size: 10.5px; font-weight: 700;
    letter-spacing: 0.06em; text-align: center;
  }
  .inv-meta-line {
    margin: 0 0 1px; padding: 0; font-size: 8.5px; line-height: 1.25;
    text-align: center;
  }
  .rule {
    border: 0; border-top: 1px solid #000; margin: 3px 0;
  }
  .inv-cust {
    text-align: left; font-size: 9px; line-height: 1.32;
    margin: 2px 0;
  }
  .inv-cust .line { margin: 0 0 1px; }
  .inv-table-wrap { width: 100%; overflow: hidden; margin: 2px 0; }
  table.inv-table {
    width: 100%; border-collapse: collapse;
    font-size: 8.5px; table-layout: fixed;
  }
  .inv-table th, .inv-table td {
    border-bottom: 1px solid #000; padding: 2px 2px;
    vertical-align: top; word-wrap: break-word;
  }
  .inv-table thead th {
    font-weight: 700; text-align: center;
    border-top: 1px solid #000;
  }
  .inv-table .td-prod-name {
    text-align: center; font-weight: 600; font-size: 8.5px;
    border-bottom: 1px solid #000; padding: 2px 1px 1px;
  }
  .inv-table .td-dg { text-align: right; width: 28%; font-variant-numeric: tabular-nums; }
  .inv-table .td-dvt { text-align: center; width: 22%; font-weight: 600; }
  .inv-table .td-sl { text-align: center; width: 16%; font-variant-numeric: tabular-nums; }
  .inv-table .td-tt { text-align: right; width: 34%; font-weight: 600; font-variant-numeric: tabular-nums; }
  .inv-pay {
    margin-top: 3px; text-align: right; font-size: 9.5px;
    line-height: 1.32;
  }
  .inv-pay .pay-row {
    display: flex; justify-content: flex-end; gap: 8px;
    margin: 0 0 1px;
  }
  .inv-pay .pay-row span:first-child { flex: 0 0 auto; }
  .inv-pay .pay-row span:last-child {
    min-width: 4.2em; text-align: right; font-variant-numeric: tabular-nums;
  }
  .inv-pay .pay-grand {
    font-weight: 700; font-size: 11px; margin-top: 2px;
    padding-top: 2px; border-top: 1px solid #000;
  }
  .amount-words {
    margin: 3px 0 2px; text-align: right; font-size: 8.5px;
    font-weight: 700; line-height: 1.28; word-wrap: break-word;
  }
  .inv-footer {
    text-align: center; font-size: 9.5px; font-weight: 600;
    margin-top: 3px; padding-top: 3px;
    border-top: 1px solid #000;
  }
  .inv-einv {
    margin-top: 4px; padding-top: 4px; text-align: center;
    border-top: 1px dashed #333;
  }
  .inv-einv-qr-wrap { margin: 2px 0; }
  .inv-einv-qr {
    display: block; margin: 0 auto; width: 120px; height: 120px;
    image-rendering: pixelated;
  }
  .inv-einv-code {
    margin: 2px 0 0; font-size: 8.5px; font-weight: 600;
    word-break: break-all;
  }
  .receipt-feed { width: 100%; height: 50px; margin: 0; padding: 0; border: 0; }

  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body, #root, .receipt {
      height: auto !important; max-height: none !important;
      overflow: visible !important; color: #000 !important;
    }
    body { font-size: 10px !important; padding: 1.5mm 2.5mm 2.5mm !important; line-height: 1.28 !important; }
    .receipt, .receipt * {
      color: #000 !important;
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
    .inv-head-logo img { max-height: 40px !important; margin-left: auto !important; margin-right: auto !important; }
    .inv-store-name { font-size: 12px !important; }
    .inv-doc-title { font-size: 10.5px !important; }
    .inv-table th, .inv-table td { border-color: #000 !important; }
    .rule, .inv-pay .pay-grand, .inv-footer { border-color: #000 !important; }
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
          <th>ĐVT</th>
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
