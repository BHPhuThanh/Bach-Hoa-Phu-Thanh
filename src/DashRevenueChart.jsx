import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CHART_MODE_DAY,
  CHART_MODE_HOUR,
  formatAxisMoneyShort,
} from './chartSeries.js'

const REV_BAR = '#1890ff'
const PROFIT_LINE = '#52c41a'

function ChartTooltip({ active, label, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="dash-chart-tooltip">
      <div className="dash-chart-tooltip-title">{label}</div>
      <div className="dash-chart-tooltip-row">
        <span>Doanh thu</span>
        <strong>{Number(row.revenue).toLocaleString('vi-VN')} đ</strong>
      </div>
      <div className="dash-chart-tooltip-row">
        <span>Lợi nhuận</span>
        <strong>{Number(row.profit).toLocaleString('vi-VN')} đ</strong>
      </div>
      <div className="dash-chart-tooltip-row">
        <span>Số đơn</span>
        <strong>{row.orderCount}</strong>
      </div>
    </div>
  )
}

/**
 * @param {Array<{ label: string, revenue: number, profit: number, orderCount: number }>} data
 * @param {string} chartMode CHART_MODE_*
 */
export default function DashRevenueChart({ data, chartMode }) {
  const isHour = chartMode === CHART_MODE_HOUR
  const isDay = chartMode === CHART_MODE_DAY

  const tickMuted = { fill: '#94a3b8' }
  const xAxisProps =
    isDay
      ? {
          angle: -40,
          textAnchor: 'end',
          height: 56,
          interval: 0,
          tick: { fontSize: 10, ...tickMuted },
        }
      : {
          interval: isHour ? 1 : 0,
          tick: { fontSize: 11, ...tickMuted },
        }

  return (
    <div className="dash-chart-wrap">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3240" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#475569' }} {...xAxisProps} />
          <YAxis
            tickFormatter={formatAxisMoneyShort}
            width={44}
            tickLine={false}
            axisLine={{ stroke: '#475569' }}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(56, 189, 248, 0.08)' }} />
          <Legend
            wrapperStyle={{ fontSize: '0.8rem', paddingTop: 8 }}
            formatter={(value) => <span style={{ color: '#cbd5e1' }}>{value}</span>}
          />
          <Bar
            dataKey="revenue"
            name="Doanh thu"
            fill={REV_BAR}
            radius={[3, 3, 0, 0]}
            maxBarSize={isHour ? 14 : isDay ? 22 : 36}
          />
          <Line
            type="monotone"
            dataKey="profit"
            name="Lợi nhuận"
            stroke={PROFIT_LINE}
            strokeWidth={2}
            dot={{ r: isHour ? 2 : 3, fill: PROFIT_LINE, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
