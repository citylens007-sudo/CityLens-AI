import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MapPin,
  Road,
  Siren,
  Wrench,
} from 'lucide-react'
import { demoDefects, demoIncidents } from '../data/demo'
import { useAppActions } from '../context'
import { Button, DemoTag, PageHeading, Panel, StatusBadge } from '../components/ui'
import {
  operationsApi,
  type ActivityRecord,
  type DashboardSummary,
  type RoadDefect,
  type TrafficIncident,
} from '../services/api'

const DashboardMapPanel = lazy(() => import('../components/DashboardMapPanel'))
const RepairProgressPanel = lazy(() => import('../components/DashboardCharts').then((module) => ({ default: module.RepairProgressPanel })))
const DefectCategoryPanel = lazy(() => import('../components/DashboardCharts').then((module) => ({ default: module.DefectCategoryPanel })))

const metrics = [
  { label: 'Road defects', key: 'road_defects', icon: Road, tone: 'blue', to: '/map' },
  { label: 'High priority', key: 'high_priority_defects', icon: AlertTriangle, tone: 'red', to: '/map' },
  { label: 'Pending repairs', key: 'pending_repairs', icon: Wrench, tone: 'amber', to: '/repairs' },
  { label: 'Open incidents', key: 'open_incidents', icon: Siren, tone: 'violet', to: '/traffic' },
] as const

export function DashboardPage({ isAdmin = false }: { isAdmin?: boolean }) {
  const { notify } = useAppActions()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [defects, setDefects] = useState<RoadDefect[] | null>(null)
  const [incidents, setIncidents] = useState<TrafficIncident[] | null>(null)
  const [activity, setActivity] = useState<ActivityRecord[] | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      operationsApi.dashboardSummary(),
      operationsApi.defects(5),
      operationsApi.incidents(5),
      isAdmin ? operationsApi.recentActivity(5) : Promise.resolve(null),
    ]).then(([nextSummary, nextDefects, nextIncidents, nextActivity]) => {
      if (!active) return
      setSummary(nextSummary)
      setDefects(nextDefects.items)
      setIncidents(nextIncidents.items)
      setActivity(nextActivity?.items ?? null)
    }).catch((error: unknown) => {
      if (!active) return
      setLoadError(error instanceof Error ? error.message : 'Could not load CityLens records.')
    })
    return () => { active = false }
  }, [isAdmin])

  return (
    <>
      <PageHeading
        actions={<><DemoTag /><Button icon={Clock3} onClick={() => notify('Dashboard date filtering will be available when analytics are connected.')} variant="secondary">Last 30 days <span className="button-caret">⌄</span></Button></>}
        description="A city operations overview. Persisted records appear when the CityLens API is available."
        eyebrow="FRIDAY, OCTOBER 16, 2026 · METRO CITY"
        title="City operations overview"
      />
      {loadError ? <div className="notice-banner notice-banner-amber" role="alert"><CircleAlert size={17} /><p><strong>Live data unavailable.</strong> {loadError} Sample tables and charts remain clearly labelled as demo data.</p><DemoTag>DEMO DATA</DemoTag></div> : summary && <div className="notice-banner notice-banner-blue"><CircleAlert size={17} /><p><strong>Live records connected.</strong> Summary counts and recent tables come from the authenticated API. Charts and map preview remain illustrative.</p><DemoTag>LIVE + DEMO</DemoTag></div>}

      <div className="metric-grid">
        {metrics.map(({ label, key, icon: Icon, tone, to }) => (
          <Link className="metric-card" key={label} to={to}>
            <div className="metric-card-top"><span>{label}</span><span className={`metric-icon metric-icon-${tone}`}><Icon size={18} /></span></div>
            <div className="metric-card-value-row"><strong>{summary ? summary[key].toString().padStart(2, '0') : '—'}</strong><span className="metric-change metric-change-alert">{summary ? 'LIVE' : 'API'}</span></div>
            <span className="metric-card-note">{summary ? 'Current persisted records' : 'Waiting for API data'}</span>
          </Link>
        ))}
      </div>

      <div className="dashboard-main-grid">
        <Suspense fallback={<Panel title="Road health map" subtitle="Loading map view"><div className="map-loading-placeholder">Loading map…</div></Panel>}><DashboardMapPanel /></Suspense>
        <Suspense fallback={<Panel title="Repair progress" subtitle="Loading demo chart"><div className="chart-loading-placeholder">Loading chart…</div></Panel>}><RepairProgressPanel /></Suspense>
      </div>

      <div className="dashboard-bottom-grid">
        <Panel className="table-panel" subtitle={defects ? 'Most recent persisted reports' : 'Sample records · API data unavailable'} title="Recent road defects" action={<Link className="panel-link" to="/map">All reports <ArrowRight size={14} /></Link>}>
          <div className="table-scroll"><table><thead><tr><th>REPORT</th><th>DEFECT</th><th>PRIORITY</th><th>OBSERVED</th><th>STATUS</th></tr></thead><tbody>
            {defects ? defects.map((defect) => <tr key={defect.id}><td><Link className="table-id" to={`/defects/${defect.id}`}>{defect.id}</Link></td><td><span className="table-primary">{defect.defect_type}</span></td><td><StatusBadge label={defect.severity} /></td><td className="muted-cell">{new Date(defect.detected_at).toLocaleString()}</td><td><StatusBadge label={defect.status} /></td></tr>) : demoDefects.slice(0, 4).map((defect) => <tr key={defect.id}><td><span className="table-id">{defect.id}<span className="inline-demo">DEMO</span></span></td><td><span className="table-primary">{defect.type}</span><span className="table-secondary">{defect.district}</span></td><td><StatusBadge label={defect.priority} /></td><td className="muted-cell">{defect.observedAt}</td><td><StatusBadge label={defect.status} /></td></tr>)}
          </tbody></table></div>
        </Panel>
        <Suspense fallback={<Panel title="Defect categories" subtitle="Loading demo chart"><div className="chart-loading-placeholder">Loading chart…</div></Panel>}><DefectCategoryPanel /></Suspense>
      </div>

      <div className="dashboard-bottom-grid dashboard-last-row">
        <Panel className="table-panel" subtitle={incidents ? 'Persisted reports · human review required' : 'Suspected demo reports · require controller review'} title="Recent traffic incidents" action={<Link className="panel-link" to="/traffic">All incidents <ArrowRight size={14} /></Link>}>
          <div className="table-scroll"><table><thead><tr><th>INCIDENT</th><th>TYPE</th><th>PRIORITY</th><th>REPORTED</th><th>REVIEW</th></tr></thead><tbody>
            {incidents ? incidents.map((incident) => <tr key={incident.id}><td><Link className="table-id" to={`/traffic/review/${incident.id}`}>{incident.id}</Link></td><td><span className="table-primary">{incident.incident_type}</span></td><td><StatusBadge label="Medium" /></td><td className="muted-cell">{new Date(incident.incident_timestamp).toLocaleString()}</td><td><StatusBadge label={incident.review_status} /></td></tr>) : demoIncidents.slice(0, 3).map((incident) => <tr key={incident.id}><td><span className="table-id">{incident.id}<span className="inline-demo">DEMO</span></span></td><td><span className="table-primary">{incident.type}</span><span className="table-secondary">{incident.district}</span></td><td><StatusBadge label={incident.priority} /></td><td className="muted-cell">{incident.occurredAt}</td><td><StatusBadge label="Pending Review" /></td></tr>)}
          </tbody></table></div>
        </Panel>
        <Panel className="activity-panel" subtitle="Sample municipal workflow" title="Operations snapshot">
          <div className="activity-list">{activity ? activity.length ? activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-dot activity-dot-blue"><MapPin size={15} /></span><div><strong>{item.action} {item.entity_type.replaceAll('_', ' ')}</strong><p>{item.actor_user_id ? `User ${item.actor_user_id}` : 'System activity'}</p></div><time>{new Date(item.created_at).toLocaleTimeString()}</time></div>) : <p className="muted-cell">No recorded activity yet.</p> : <><div className="activity-item"><span className="activity-dot activity-dot-green"><CheckCircle2 size={15} /></span><div><strong>12 repairs closed</strong><p>Maintenance teams · demo activity</p></div><time>10:32</time></div><div className="activity-item"><span className="activity-dot activity-dot-blue"><MapPin size={15} /></span><div><strong>8 new reports reviewed</strong><p>Municipal engineering · demo activity</p></div><time>09:58</time></div><div className="activity-item"><span className="activity-dot activity-dot-amber"><Siren size={15} /></span><div><strong>3 incidents need review</strong><p>Traffic control · suspected incidents</p></div><time>09:41</time></div></>}</div>
          <Link className="activity-footer-link" to="/traffic/review">Open incident review queue <ArrowRight size={14} /></Link>
        </Panel>
      </div>
      <p className="data-footnote">{summary ? 'Summary counts and recent records are live. Charts, map preview, and demo fallbacks are illustrative and are not municipal records.' : 'Live records are unavailable until the authenticated API is running. Any visible sample charts and fallback rows are labelled demo data.'}</p>
    </>
  )
}