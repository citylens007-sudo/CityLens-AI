import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
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
import { categoryChartData, repairChartData } from '../data/demo'
import { Panel } from './ui'

export function RepairProgressPanel() {
  return (
    <Panel className="repair-overview-panel" subtitle="Status distribution · demo data" title="Repair progress" action={<Link className="panel-link" to="/repairs">View tasks <ArrowRight size={14} /></Link>}>
      <div className="repair-chart-wrap">
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={repairChartData} margin={{ top: 12, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid stroke="#edf0f4" vertical={false} />
            <XAxis axisLine={false} dataKey="name" tick={{ fill: '#7e8998', fontSize: 10 }} tickLine={false} interval={0} angle={-25} textAnchor="end" height={48} />
            <YAxis axisLine={false} tick={{ fill: '#7e8998', fontSize: 11 }} tickLine={false} />
            <Tooltip cursor={{ fill: '#f4f7fb' }} />
            <Bar dataKey="value" fill="#3478f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="repair-chart-foot"><span><i className="legend-dot legend-blue" />Open tasks</span><span><strong>37</strong> closed this month</span></div>
    </Panel>
  )
}

export function DefectCategoryPanel() {
  return (
    <Panel className="category-panel" subtitle="Reported defect types · demo data" title="Defect categories" action={<Link className="panel-link" to="/analytics">Analytics <ArrowRight size={14} /></Link>}>
      <div className="category-chart-wrap">
        <ResponsiveContainer height="100%" width="100%"><PieChart><Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={53} outerRadius={76} paddingAngle={3} stroke="none">{categoryChartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        <div className="donut-center"><strong>118</strong><span>DEMO REPORTS</span></div>
      </div>
      <div className="category-legend">{categoryChartData.map((entry) => <div key={entry.name}><span><i style={{ background: entry.color }} />{entry.name}</span><strong>{entry.value}</strong></div>)}</div>
    </Panel>
  )
}