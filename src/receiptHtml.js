import { buildEInvoiceLookupCode, buildEInvoiceQrPayload } from './eInvoiceSettings.js'
import { normalizeCatalogUnitLabel } from './productUnits.js'

/** Thông tin cửa hàng — chỉnh tại đây. */
export const RECEIPT_STORE_NAME = 'Bách Hóa Phú Thành'
/** Ghép bằng dấu phẩy khi in (tối đa ~2 dòng nhờ CSS). */
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

function formatReceiptMoney(n) {
  const x = Math.round(Number(n) || 0)
  return x.toLocaleString('vi-VN')
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

const RECEIPT_PRINT_CSS = `
  @page { size: 80mm auto; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: #fff;
    height: auto; max-height: none; overflow: visible;
  }
  body {
    margin: 0 auto;
    padding: 1mm 2mm 1.5mm;
    width: 72mm; max-width: 72mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    font-weight: bold;
    line-height: 1.2;
    color: #000;
    -webkit-font-smoothing: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #root, .receipt {
    width: 100%;
    display: block;
    font-family: 'Courier New', Courier, monospace;
    color: #000;
    line-height: 1.2;
    -webkit-font-smoothing: none;
  }
  .receipt, .receipt * {
    font-family: 'Courier New', Courier, monospace !important;
    color: #000000 !important;
    font-weight: bold;
    -webkit-font-smoothing: none;
    line-height: 1.2;
  }
  .inv-head {
    margin: 0 0 4px;
    padding: 0 0 4px;
    border-bottom: 1px dashed #000;
    text-align: center;
  }
  .inv-head-logo { margin: 0 auto 2px; }
  .inv-head-logo img {
    display: block;
    margin: 0 auto;
    max-height: 36px;
    max-width: 55%;
    object-fit: contain;
    filter: grayscale(100%) contrast(200%);
  }
  .inv-store-name {
    margin: 0 0 3px;
    padding: 0;
    font-size: 18px;
    font-weight: bold;
    text-align: center;
    line-height: 1.15;
    word-wrap: break-word;
  }
  .inv-head-contact { text-align: left; }
  .inv-addr-block {
    margin: 0 0 1px;
    padding: 0;
    font-size: 11px;
    font-weight: bold;
    line-height: 1.15;
    text-align: left;
    max-width: 68mm;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .inv-phone {
    margin: 0;
    padding: 0;
    font-size: 11px;
    font-weight: bold;
    line-height: 1.15;
    text-align: left;
  }
  .inv-title-block {
    margin: 0 0 4px;
    padding: 0 0 4px;
    border-bottom: 1px dashed #000;
    text-align: center;
  }
  .inv-doc-title {
    margin: 0 0 2px;
    padding: 0;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 0.03em;
    text-align: center;
  }
  .inv-meta-compact {
    margin: 0 0 4px;
    padding: 0;
    font-size: 11px;
    line-height: 1.15;
    text-align: left;
  }
  .inv-meta-compact .line {
    margin: 0;
    padding: 0;
  }
  .inv-items {
    margin: 0 0 4px;
    padding: 0 0 4px;
    border-bottom: 1px dashed #000;
  }
  .inv-item {
    margin: 0 0 3px;
    padding: 0;
  }
  .inv-item:last-child { margin-bottom: 0; }
  .inv-item-name {
    margin: 0 0 1px;
    padding: 0;
    font-size: 13px;
    font-weight: bold;
    line-height: 1.2;
    text-align: left;
    word-wrap: break-word;
  }
  .inv-item-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.15;
  }
  .inv-item-left {
    flex: 1 1 auto;
    text-align: left;
    min-width: 0;
    word-wrap: break-word;
  }
  .inv-item-total {
    flex: 0 0 auto;
    text-align: right;
    font-size: 13px;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .inv-pay {
    margin: 0 0 3px;
    padding: 0;
    font-size: 12px;
    line-height: 1.2;
  }
  .inv-pay .pay-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    margin: 0;
    padding: 0;
  }
  .inv-pay .pay-row span:first-child {
    flex: 1 1 auto;
    text-align: left;
  }
  .inv-pay .pay-row span:last-child {
    flex: 0 0 auto;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .inv-pay .pay-grand span:last-child {
    font-size: 13px;
  }
  .amount-words {
    margin: 0 0 3px;
    padding: 0;
    font-size: 11px;
    font-weight: bold;
    line-height: 1.2;
    text-align: left;
    word-wrap: break-word;
  }
  .inv-footer {
    margin: 0;
    padding: 0;
    font-size: 12px;
    font-weight: bold;
    text-align: center;
    line-height: 1.2;
  }
  .inv-einv {
    margin: 4px 0 0;
    padding: 4px 0 0;
    text-align: center;
    border-top: 1px dashed #000;
  }
  .inv-einv-qr {
    display: block;
    margin: 0 auto;
    width: 100px;
    height: 100px;
    image-rendering: pixelated;
    filter: grayscale(100%) contrast(200%);
  }
  .inv-einv-code {
    margin: 2px 0 0;
    font-size: 11px;
    font-weight: bold;
    word-break: break-all;
  }
  .receipt-feed {
    width: 100%;
    height: 18px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  @media print {
    @page { size: 80mm auto; margin: 0; }
    html, body, #root, .receipt {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      font-family: 'Courier New', Courier, monospace !important;
      color: #000000 !important;
      line-height: 1.2 !important;
      -webkit-font-smoothing: none !important;
    }
    body {
      padding: 1mm 2mm 1.5mm !important;
      font-size: 12px !important;
      font-weight: bold !important;
      line-height: 1.2 !important;
    }
    .receipt, .receipt * {
      color: #000000 !important;
      font-family: 'Courier New', Courier, monospace !important;
      font-weight: bold !important;
      line-height: 1.2 !important;
      -webkit-font-smoothing: none !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .inv-store-name {
      font-size: 18px !important;
      text-align: center !important;
    }
    .inv-addr-block,
    .inv-phone,
    .inv-head-contact {
      text-align: left !important;
      font-size: 11px !important;
      line-height: 1.15 !important;
    }
    .inv-meta-compact {
      font-size: 11px !important;
      line-height: 1.15 !important;
    }
    .inv-item-name { font-size: 13px !important; }
    .inv-item-meta { font-size: 12px !important; }
    .inv-item-total { font-size: 13px !important; }
    .inv-pay { font-size: 12px !important; line-height: 1.2 !important; }
    .inv-footer {
      margin: 0 !important;
      padding: 0 !important;
      font-size: 12px !important;
    }
    .receipt-feed {
      height: 18px !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }
`

/**
 * @param {Array<{ name: string, unitLabel?: string, code?: string, price: number, qty: number }>} cart
 * @param {number} total — tổng sau chiết khấu (nếu opts.discount thì total nên = subtotal - discount)
 * @param {object} [opts]
 * @param {number} [opts.cashGiven] — tiền khách đưa (VND)
 * @param {string} [opts.cashierName] — thu ngân
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
  const cashierName = String(opts.cashierName ?? opts.staffName ?? '—').trim() || '—'

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)
  const payTotal =
    discount > 0 ? Math.max(0, subtotal - discount) : Math.round(Number(total)) || subtotal

  const cashGivenRaw = Number(opts.cashGiven)
  const cashGivenNum =
    Number.isFinite(cashGivenRaw) && cashGivenRaw > 0 ? Math.round(cashGivenRaw) : payTotal
  const changeNum = Math.max(0, cashGivenNum - payTotal)

  const now = opts.fixedAt ? new Date(opts.fixedAt) : new Date()
  const printDateStr =
    opts.printDateStr ??
    now.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
      <img class="inv-einv-qr" src="${escapeHtml(qrSrc)}" alt="QR tra cứu" width="100" height="100" />
    </div>
    <p class="inv-einv-code">Mã tra cứu: ${escapeHtml(lookupCode)}</p>
  </div>`
  }

  const amountWords = tienBangChu(payTotal)
  const addressText = addressLines.map((l) => String(l).trim()).filter(Boolean).join(', ')

  const itemBlocks = cart
    .map((l) => {
      const lineTotal = l.price * l.qty
      const { name, unit } = receiptProductNameAndUnit(l)
      const qtyStr = formatReceiptQty(l.qty)
      const unitLabel = unit && unit !== '—' ? unit : '—'
      const leftMeta = `${unitLabel} | ${formatReceiptMoney(l.price)} x ${qtyStr}`
      return `<article class="inv-item">
  <div class="inv-item-name">${escapeHtml(name)}</div>
  <div class="inv-item-meta">
    <span class="inv-item-left">${escapeHtml(leftMeta)}</span>
    <span class="inv-item-total">${formatReceiptMoney(lineTotal)}</span>
  </div>
</article>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hóa đơn bán hàng</title>
<style>${RECEIPT_PRINT_CSS}
</style>
</head>
<body>
<div id="root">
<div class="receipt">
  <header class="inv-head">
    <div class="inv-head-logo">
      <img src="${escapeHtml(logoUrl)}" alt="" />
    </div>
    <p class="inv-store-name">${escapeHtml(storeName)}</p>
    <div class="inv-head-contact">
      <p class="inv-addr-block">${escapeHtml(addressText)}</p>
      <p class="inv-phone">ĐT: ${escapeHtml(storePhone)}</p>
    </div>
  </header>
  <section class="inv-title-block">
    <h1 class="inv-doc-title">HÓA ĐƠN BÁN HÀNG</h1>
    <p class="inv-meta-compact line">Số HĐ: ${escapeHtml(invoiceNo)}</p>
  </section>
  <section class="inv-meta-compact">
    <p class="line">Ngày in: ${escapeHtml(printDateStr)}</p>
    <p class="line">Thu ngân: ${escapeHtml(cashierName)}</p>
    <p class="line">Khách hàng: ${escapeHtml(customerName)}</p>
    <p class="line">SĐT: ${escapeHtml(customerPhone)}</p>
    <p class="line">Địa chỉ: ${escapeHtml(customerAddress)}</p>
  </section>
  <section class="inv-items">
    ${itemBlocks}
  </section>
  <section class="inv-pay">
    <div class="pay-row"><span>Tổng tiền hàng:</span><span>${formatReceiptMoney(subtotal)} đ</span></div>
    <div class="pay-row"><span>Chiết khấu:</span><span>${discount > 0 ? `-${formatReceiptMoney(discount)}` : '0'} đ</span></div>
    <div class="pay-row pay-grand"><span>Khách cần trả:</span><span>${formatReceiptMoney(payTotal)} đ</span></div>
    <div class="pay-row"><span>Tiền khách đưa:</span><span>${formatReceiptMoney(cashGivenNum)} đ</span></div>
    <div class="pay-row"><span>Tiền thừa trả khách:</span><span>${formatReceiptMoney(changeNum)} đ</span></div>
  </section>
  <p class="amount-words">${escapeHtml(amountWords)}</p>
  <p class="inv-footer">Cảm ơn và hẹn gặp lại!</p>
  ${eInvHtml}
  <div class="receipt-feed" aria-hidden="true"></div>
</div>
</div>
</body>
</html>`
}
