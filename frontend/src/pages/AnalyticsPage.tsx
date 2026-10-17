import { useState } from 'react'
import { Activity, ArrowDownToLine, CalendarDays, CircleAlert, Road, ShieldAlert, Wrench } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { categoryChartData, demoAlerts, demoDefects, demoIncidents, demoRepairs, repairChartData, trend30ChartData, trend90ChartData, trendChartData } from '../data/demo'
import { Button, DemoTag, PageHeading, Panel, StatusBadge } from '../components/ui'

const rangeOptions = [7, 30, 90] as const
type RangeDays = (typeof rangeOptions)[number]

export function AnalyticsPage() {
  const [range, setRange] = useState<RangeDays>(30)
  const trendData = range === 7 ? trendChartData : range === 30 ? trend30ChartData : trend90ChartData

  function exportDemoCsv() {
    const rows = [
      ['record_type', 'record_id', 'category', 'priority_or_status', 'date_window', 'data_label'],
      ...demoDefects.map((record) => ['road defect', record.id, record.type, record.priority, record.observedAt, 'DEMO DATA']),
      ...demoRepairs.map((record) => ['repair task', record.id, record.type, record.status, record.dueDate, 'DEMO DATA']),
      ...demoIncidents.map((record) => ['suspected traffic incident', record.id, record.type, record.priority, record.occurredAt, 'DEMO DATA']),
      ...demoAlerts.map((record) => ['police alert', record.id, record.type, record.status, record.updatedAt, 'DEMO DATA - NOT SENT']),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'citylens-demo-analytics.csv'
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      link.remove()
    }, 1000)
  }

  return (
    <>
      <PageHeading actions={<><DemoTag /><Button icon={ArrowDownToLine} onClick={exportDemoCsv} variant="secondary">Export demo CSV</Button></>} description="Operational trends across road conditions, maintenance, and suspected traffic incidents." eyebrow="CITY OPERATIONS / PERFORMANCE" title="Analytics" />
      <div className="analytics-filter-row"><div className="date-filter-label"><CalendarDays size={16} /><span>Date range</span></div><div aria-label="Analytics date range" className="segmented-control">{rangeOptions.map((days) => <button aria-pressed={range === days} className={range === days ? 'segment-active' : ''} key={days} onClick={() => setRange(days)} type="button">{days} days</button>)}</div><span className="range-caption">Showing illustrative {range}-day window</span><DemoTag /></div>
      <div className="demo-banner"><span className="demo-banner-mark"><CircleAlert size={16} /></span><p><strong>Sample analytics only.</strong> Charts are illustrative and are not calculated from connected municipal records.</p><DemoTag /></div>
      <div className="analytics-kpi-grid">
        <AnalyticsKpi label="Defects recorded" value="248" delta="+12.4%" icon={Road} tone="blue" />
        <AnalyticsKpi label="Repairs completed" value="37" delta="+8.2%" icon={Wrench} tone="green" />
        <AnalyticsKpi label="Avg. repair time" value="4.6 days" delta="−0.8 days" icon={Activity} tone="amber" />
        <AnalyticsKpi label="Suspected incidents" value="42" delta="7 open" icon={ShieldAlert} tone="violet" />
      </div>
      <div className="analytics-chart-grid">
        <Panel className="trend-panel" title="Defects and repairs over time" subtitle={`Daily counts · illustrative ${range}-day range`}><div className="trend-chart-wrap"><ResponsiveContainer height="100%" width="100%"><AreaChart data={trendData} margin={{ top: 10, right: 14, left: -18, bottom: 0 }}><defs><linearGradient id="defectFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3478f6" stopOpacity={0.16} /><stop offset="100%" stopColor="#3478f6" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#edf0f4" vertical={false} /><XAxis axisLine={false} dataKey="day" tick={{ fill: '#7e8998', fontSize: 11 }} tickLine={false} /><YAxis axisLine={false} tick={{ fill: '#7e8998', fontSize: 11 }} tickLine={false} /><Tooltip /><Area dataKey="defects" fill="url(#defectFill)" name="Defects" stroke="#3478f6" strokeWidth={2.5} type="monotone" /><Area dataKey="repairs" fill="none" name="Repairs" stroke="#27a77a" strokeWidth={2.5} type="monotone" /></AreaChart></ResponsiveContainer></div><div className="chart-legend-row"><span><i className="legend-dot legend-blue" />Defects</span><span><i className="legend-dot legend-green" />Repairs</span><DemoTag /></div></Panel>
        <Panel className="analytics-category-panel" title="Defects by category" subtitle="Illustrative distribution"><div className="analytics-donut-wrap"><ResponsiveContainer height="100%" width="100%"><PieChart><Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={83} paddingAngle={3} stroke="none">{categoryChartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="donut-center"><strong>118</strong><span>DEMO</span></div></div><div className="analytics-category-legend">{categoryChartData.map((entry) => <div key={entry.name}><span><i style={{ background: entry.color }} />{entry.name}</span><strong>{entry.value}</strong></div>)}</div></Panel>
      </div>
      <div className="analytics-chart-grid analytics-lower-grid">
        <Panel className="analytics-repair-panel" title="Repair status" subtitle="Current sample task distribution"><div className="repair-horizontal-chart"><ResponsiveContainer height="100%" width="100%"><BarChart data={repairChartData} layout="vertical" margin={{ top: 2, right: 26, left: 10, bottom: 0 }}><CartesianGrid stroke="#edf0f4" horizontal={false} /><XAxis axisLine={false} tick={{ fill: '#7e8998', fontSize: 11 }} tickLine={false} type="number" /><YAxis axisLine={false} dataKey="name" tick={{ fill: '#66758a', fontSize: 11 }} tickLine={false} type="category" width={98} /><Tooltip /><Bar dataKey="value" fill="#3478f6" radius={[0, 4, 4, 0]} maxBarSize={18} /></BarChart></ResponsiveContainer></div></Panel>
        <Panel className="incident-stats-panel" title="Traffic incident summary" subtitle="Suspected detections · demo data"><div className="incident-summary-total"><div><strong>42</strong><span>observations</span></div><span className="incident-summary-warning"><CircleAlert size={15} />Not verified</span></div><div className="incident-type-list"><div><span>Vehicle collision</span><strong>18</strong><span className="incident-mini-track"><i style={{ width: '44%' }} /></span></div><div><span>Road obstruction</span><strong>15</strong><span className="incident-mini-track"><i style={{ width: '36%' }} /></span></div><div><span>Traffic congestion</span><strong>9</strong><span className="incident-mini-track"><i style={{ width: '22%' }} /></span></div></div><div className="incident-stats-foot"><span>Open review queue</span><StatusBadge label="7 demo" /></div></Panel>
      </div>
      <p className="data-footnote">Export includes only sample records in this browser bundle. Live date filtering and analytics require the API integration.</p>
    </>
  )
}

function AnalyticsKpi({ label, value, delta, icon: Icon, tone }: { label: string; value: string; delta: string; icon: typeof Road; tone: string }) {
  return <div className="analytics-kpi"><div className="analytics-kpi-head"><span>{label}</span><span className={`metric-icon metric-icon-${tone}`}><Icon size={17} /></span></div><strong>{value}</strong><div className="analytics-kpi-foot"><span>{delta}</span><small>DEMO</small></div></div>
}