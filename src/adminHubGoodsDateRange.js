/** Lọc «Ngày tạo» tab Hàng hóa — so khớp `createdAtMs` biến thể (ms epoch, giờ địa phương). */

export const GOODS_DATE_PRESET_ALL = ''

export const GOODS_DATE_PRESET_OPTIONS = [
  { id: GOODS_DATE_PRESET_ALL, label: 'Mọi ngày' },
  { id: 'today', label: 'Hôm nay' },
  { id: 'yesterday', label: 'Hôm qua' },
  { id: 'this_week', label: 'Tuần này' },
  { id: 'last_week', label: 'Tuần trước' },
  { id: 'this_month', label: 'Tháng này' },
  { id: 'last_month', label: 'Tháng trước' },
  { id: 'custom', label: 'Tùy chọn' },
]

function startOfDayMs(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

function endOfDayMs(d) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

/** Thứ Hai đầu tuần chứa `d` (địa phương). */
function mondayOfWeekContaining(d) {
  const x = new Date(d)
  const dow = x.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + diff)
  return x
}

/** `dd/mm/yyyy` → Date đầu ngày hợp lệ hoặc null. */
export function parseDdMmYyyyVi(s) {
  const t = String(s ?? '').trim()
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  const yyyy = Number(m[3])
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null
  const d = new Date(yyyy, mm - 1, dd)
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
  return d
}

/**
 * @param {string} preset — id từ GOODS_DATE_PRESET_OPTIONS
 * @param {string} customFromStr — dd/mm/yyyy
 * @param {string} customToStr — dd/mm/yyyy
 * @returns {{ startMs: number, endMs: number } | null} — null = không lọc theo ngày
 */
export function resolveGoodsCreatedAtRangeMs(preset, customFromStr, customToStr) {
  const p = String(preset ?? '').trim()
  if (!p || p === GOODS_DATE_PRESET_ALL) return null

  const now = new Date()

  if (p === 'custom') {
    const a = parseDdMmYyyyVi(customFromStr)
    const b = parseDdMmYyyyVi(customToStr)
    if (!a || !b) return null
    const lo = Math.min(startOfDayMs(a), startOfDayMs(b))
    const hi = Math.max(endOfDayMs(a), endOfDayMs(b))
    return { startMs: lo, endMs: hi }
  }

  if (p === 'today') {
    return { startMs: startOfDayMs(now), endMs: endOfDayMs(now) }
  }

  if (p === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return { startMs: startOfDayMs(y), endMs: endOfDayMs(y) }
  }

  if (p === 'this_week') {
    const mon = mondayOfWeekContaining(now)
    const sun = new Date(mon)
    sun.setDate(sun.getDate() + 6)
    return { startMs: startOfDayMs(mon), endMs: endOfDayMs(sun) }
  }

  if (p === 'last_week') {
    const thisMon = mondayOfWeekContaining(now)
    const lastMon = new Date(thisMon)
    lastMon.setDate(lastMon.getDate() - 7)
    const lastSun = new Date(lastMon)
    lastSun.setDate(lastSun.getDate() + 6)
    return { startMs: startOfDayMs(lastMon), endMs: endOfDayMs(lastSun) }
  }

  if (p === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { startMs: startOfDayMs(start), endMs: endOfDayMs(end) }
  }

  if (p === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    return { startMs: startOfDayMs(start), endMs: endOfDayMs(end) }
  }

  return null
}
