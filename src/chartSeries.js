import { orderTotalProfit } from './reportUtils.js'

/** Trục Y: 1tr, 2tr, 500k… */
export function formatAxisMoneyShort(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x === 0) return '0'
  const abs = Math.abs(x)
  if (abs >= 1e9) {
    const t = x / 1e9
    return `${Number.isInteger(t) ? t : t.toFixed(1)} tỷ`
  }
  if (abs >= 1e6) {
    const t = x / 1e6
    return `${Number.isInteger(t) ? t : t.toFixed(1)}tr`
  }
  if (abs >= 1e3) return `${Math.round(x / 1e3)}k`
  return String(Math.round(x))
}

/**
 * Cột theo giờ 06:00–23:00 (bucket theo getHours).
 * @param {Array<{ createdAt: string, total: number }>} orders
 */
export function buildSeriesByHour(orders, hourFrom = 6, hourTo = 23) {
  const buckets = []
  for (let h = hourFrom; h <= hourTo; h++) {
    buckets.push({
      key: `h${h}`,
      label: `${String(h).padStart(2, '0')}:00`,
      revenue: 0,
      profit: 0,
      orderCount: 0,
    })
  }
  for (const o of orders) {
    const hr = new Date(o.createdAt).getHours()
    if (hr < hourFrom || hr > hourTo) continue
    const b = buckets[hr - hourFrom]
    b.revenue += Number(o.total) || 0
    b.profit += orderTotalProfit(o)
    b.orderCount += 1
  }
  return buckets
}

/**
 * Cột theo từng ngày trong tháng hiện tại (theo ref).
 */
export function buildSeriesByDayInMonth(orders, ref = new Date()) {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const buckets = []
  for (let day = 1; day <= last; day++) {
    buckets.push({
      key: `d${day}`,
      label: `${day}/${m + 1}`,
      revenue: 0,
      profit: 0,
      orderCount: 0,
    })
  }
  for (const o of orders) {
    const d = new Date(o.createdAt)
    if (d.getFullYear() !== y || d.getMonth() !== m) continue
    const dom = d.getDate()
    const b = buckets[dom - 1]
    if (!b) continue
    b.revenue += Number(o.total) || 0
    b.profit += orderTotalProfit(o)
    b.orderCount += 1
  }
  return buckets
}

/** Thứ 2 → Chủ nhật (getDay: 1..6,0) */
const WEEKDAY_SLOTS = [
  { getDay: 1, label: 'Thứ 2' },
  { getDay: 2, label: 'Thứ 3' },
  { getDay: 3, label: 'Thứ 4' },
  { getDay: 4, label: 'Thứ 5' },
  { getDay: 5, label: 'Thứ 6' },
  { getDay: 6, label: 'Thứ 7' },
  { getDay: 0, label: 'Chủ nhật' },
]

export function buildSeriesByWeekday(orders) {
  const buckets = WEEKDAY_SLOTS.map((s) => ({
    key: `wd${s.getDay}`,
    label: s.label,
    revenue: 0,
    profit: 0,
    orderCount: 0,
  }))
  const indexByDay = {}
  WEEKDAY_SLOTS.forEach((s, i) => {
    indexByDay[s.getDay] = i
  })
  for (const o of orders) {
    const wd = new Date(o.createdAt).getDay()
    const i = indexByDay[wd]
    if (i === undefined) continue
    const b = buckets[i]
    b.revenue += Number(o.total) || 0
    b.profit += orderTotalProfit(o)
    b.orderCount += 1
  }
  return buckets
}

export const CHART_MODE_HOUR = 'hour'
export const CHART_MODE_DAY = 'day'
export const CHART_MODE_WEEKDAY = 'weekday'

export const CHART_MODE_LABELS = {
  [CHART_MODE_HOUR]: 'Theo giờ',
  [CHART_MODE_DAY]: 'Theo ngày',
  [CHART_MODE_WEEKDAY]: 'Theo thứ',
}
