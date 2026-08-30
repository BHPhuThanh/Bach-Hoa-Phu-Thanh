import { useEffect, useState } from 'react'
import { fetchEgressDailySummary } from './egressMonitor.js'

const BYTES_IN_KB = 1024
const BYTES_IN_MB = 1024 * 1024
const BYTES_IN_GB = 1024 * 1024 * 1024

function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= BYTES_IN_GB) return `${(n / BYTES_IN_GB).toFixed(2)} GB`
  if (n >= BYTES_IN_MB) return `${(n / BYTES_IN_MB).toFixed(1)} MB`
  return `${Math.round(n / BYTES_IN_KB)} KB`
}

/** Gộp danh sách dòng {day, table_name, bytes, request_count} theo ngày. */
function groupByDay(rows) {
  const byDay = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const day = String(r?.day ?? '').slice(0, 10)
    if (!day) continue
    const cur = byDay.get(day) || { day, bytes: 0, byTable: [] }
    const bytes = Number(r.bytes) || 0
    cur.bytes += bytes
    cur.byTable.push({ table: String(r.table_name ?? ''), bytes })
    byDay.set(day, cur)
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1))
}

/**
 * Egress đo TRONG APP (client) — bù chỗ thiếu của báo cáo Supabase (chỉ có theo ngày, phải đợi hôm
 * sau mới thấy). Xem egressMonitor.js. Chỉ hiện cho Admin (gọi từ AdminHubRevenuePanel với
 * `!revenueReadOnly`) — đây là số liệu vận hành/kỹ thuật, không phải số liệu bán hàng cho nhân viên.
 */
export default function EgressStatsPanel() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [loadedOnce, setLoadedOnce] = useState(false)

  const load = () => {
    setLoading(true)
    setError('')
    fetchEgressDailySummary(14)
      .then((data) => {
        setRows(Array.isArray(data) ? data : [])
        setLoadedOnce(true)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open && !loadedOnce && !loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const days = groupByDay(rows)

  return (
    <section className="ah-egress-panel">
      <button
        type="button"
        className="ah-egress-panel__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`ah-egress-panel__caret${open ? ' is-open' : ''}`} aria-hidden>
          ▸
        </span>
        Egress đo trong app (không qua báo cáo Supabase)
      </button>
      {open && (
        <div className="ah-egress-panel__body">
          <p className="ah-egress-panel__hint">
            Ước lượng từ dung lượng phản hồi thực đo ngay trên trình duyệt, gộp mỗi ~5 phút/tab rồi
            lưu — thấy được NGAY hôm nay, không cần đợi báo cáo Supabase qua ngày hôm sau. Không
            tính kênh Realtime (WebSocket, thường chỉ ~1-2% tổng egress) nên số ở đây thường thấp
            hơn đôi chút so với Supabase.
          </p>
          {loading && <p className="dash-muted">Đang tải…</p>}
          {!loading && error && (
            <p className="ah-egress-panel__error">
              Lỗi tải dữ liệu: {error}. Nếu lỗi nói bảng/view không tồn tại, cần chạy migration{' '}
              <code>supabase/migrations/20260830160000_egress_log.sql</code> trên Supabase SQL
              Editor trước.
            </p>
          )}
          {!loading && !error && days.length === 0 && (
            <p className="dash-muted">
              Chưa có dữ liệu — cần mở app một lúc (đợt ghi đầu sau ~5 phút, hoặc lúc chuyển tab đi
              nơi khác) để bắt đầu ghi nhận.
            </p>
          )}
          {!loading && !error && days.length > 0 && (
            <div className="admin-hub-table-wrap ah-responsive-table-wrap">
              <table className="admin-hub-table ah-egress-panel__table">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th className="ah-num">Tổng</th>
                    <th>Theo bảng (top 5)</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td className="ah-num">{formatBytes(d.bytes)}</td>
                      <td className="ah-egress-panel__by-table">
                        {d.byTable
                          .sort((a, b) => b.bytes - a.bytes)
                          .slice(0, 5)
                          .map((t) => `${t.table} ${formatBytes(t.bytes)}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className="ah-egress-panel__refresh"
            onClick={load}
            disabled={loading}
          >
            Làm mới
          </button>
        </div>
      )}
    </section>
  )
}
