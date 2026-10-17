import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  FileVideo2,
  Filter,
  ShieldAlert,
  Siren,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { demoAlerts, demoIncidents } from '../data/demo'
import { useAppActions } from '../context'
import type { AlertStatus, UserRole } from '../types'
import { Button, DemoTag, EmptyState, PageHeading, Panel, StatusBadge } from '../components/ui'
import { operationsApi, type PoliceAlertStatus, type TrafficIncident as ApiTrafficIncident } from '../services/api'

export function TrafficIncidentsPage() {
  const [filter, setFilter] = useState('All statuses')
  const incidents = useMemo(() => filter === 'All statuses' ? demoIncidents : demoIncidents.filter((incident) => incident.reviewStatus === filter), [filter])
  const [liveIncidents, setLiveIncidents] = useState<ApiTrafficIncident[] | null>(null)
  const [liveAlertCount, setLiveAlertCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const [createError, setCreateError] = useState('')
  const [savingIncident, setSavingIncident] = useState(false)
  const [newIncidentType, setNewIncidentType] = useState('')
  const [newIncidentDescription, setNewIncidentDescription] = useState('')
  const [incidentTimestamp, setIncidentTimestamp] = useState(new Date().toISOString().slice(0, 16))
  useEffect(() => {
    let active = true
    Promise.all([operationsApi.incidents(100), operationsApi.alerts(100)]).then(([response, alerts]) => {
      if (active) {
        setLiveIncidents(response.items)
        setLiveAlertCount(alerts.total)
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load traffic incidents.')
    })
    return () => { active = false }
  }, [])
  const visibleIncidents = liveIncidents?.filter((incident) => filter === 'All statuses' || incident.review_status === filter) ?? []

  async function createIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingIncident(true)
    setCreateError('')
    try {
      const incident = await operationsApi.createIncident({
        incident_type: newIncidentType,
        description: newIncidentDescription || undefined,
        incident_timestamp: new Date(incidentTimestamp).toISOString(),
      })
      setLiveIncidents((current) => [incident, ...(current ?? [])])
      setNewIncidentType('')
      setNewIncidentDescription('')
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The incident could not be saved.')
    } finally {
      setSavingIncident(false)
    }
  }

  return (
    <>
      <PageHeading actions={liveIncidents ? <span className="table-count">LIVE RECORDS</span> : <DemoTag />} description="Review suspected traffic incidents before any incident is treated as verified." eyebrow="TRAFFIC SAFETY / INCIDENT INTAKE" title="Traffic incidents" />
      {loadError && <div className="notice-banner notice-banner-amber" role="alert"><AlertTriangle size={17} /><p><strong>Live incidents unavailable.</strong> {loadError} Demo rows below are read-only.</p></div>}
      <div className="notice-banner notice-banner-amber"><AlertTriangle size={17} /><p><strong>Suspected incidents only.</strong> Automated observations are not proof of guilt or confirmation that an incident occurred. Human review is required.</p></div>
      <div className="metric-grid traffic-metric-grid">
        <TrafficMetric demo={!liveIncidents} label="Awaiting review" value={liveIncidents ? String(liveIncidents.filter((incident) => ['Pending Review', 'Under Review'].includes(incident.review_status)).length).padStart(2, '0') : '03'} icon={CircleHelp} />
        <TrafficMetric demo={!liveIncidents} label={liveIncidents ? 'Severity not rated' : 'High priority'} value={liveIncidents ? '—' : '02'} icon={AlertTriangle} />
        <TrafficMetric demo={!liveIncidents} label="Evidence requested" value={liveIncidents ? String(liveIncidents.filter((incident) => incident.review_status === 'More Evidence Requested').length).padStart(2, '0') : '01'} icon={FileVideo2} />
        <TrafficMetric demo={!liveIncidents} label={liveIncidents ? 'Authorized alerts' : 'Alerts sent'} value={liveAlertCount === null ? '00' : String(liveAlertCount).padStart(2, '0')} icon={ShieldAlert} />
      </div>
      <Panel className="map-tools-panel"><details className="create-record-panel"><summary>Record a traffic incident</summary><form className="create-record-form" onSubmit={(event) => void createIncident(event)}>
        <label>Incident type<input required maxLength={120} onChange={(event) => setNewIncidentType(event.target.value)} value={newIncidentType} /></label>
        <label>Description<input maxLength={4000} onChange={(event) => setNewIncidentDescription(event.target.value)} value={newIncidentDescription} /></label>
        <label>Occurred at<input required onChange={(event) => setIncidentTimestamp(event.target.value)} type="datetime-local" value={incidentTimestamp} /></label>
        <Button disabled={savingIncident} type="submit" variant="primary">{savingIncident ? 'Saving…' : 'Save incident'}</Button>
        {createError && <p className="field-error" role="alert">{createError}</p>}
      </form></details></Panel>
      <Panel className="table-panel traffic-list-panel" subtitle={liveIncidents ? 'Persisted records · human review required' : 'Sample records · no incident is verified by this interface'} title="Suspected incident reports" action={<label className="compact-filter"><Filter size={14} /><select aria-label="Filter incident reviews" onChange={(event) => setFilter(event.target.value)} value={filter}><option>All statuses</option>{[...new Set((liveIncidents?.map((incident) => incident.review_status) ?? demoIncidents.map((incident) => incident.reviewStatus)))] .map((status) => <option key={status}>{status}</option>)}</select></label>}>
        <div className="table-scroll"><table><thead><tr><th>INCIDENT</th><th>SUSPECTED TYPE</th><th>PRIORITY</th><th>OCCURRED</th><th>DISTRICT</th><th>REVIEW STATUS</th><th>TEAM</th><th></th></tr></thead><tbody>
          {liveIncidents ? visibleIncidents.map((incident) => <tr key={incident.id}><td><Link className="table-id" to={`/traffic/review/${incident.id}`}>{incident.id.slice(0, 8)}</Link></td><td className="table-primary">{incident.incident_type}</td><td className="muted-cell">Not rated</td><td className="muted-cell">{new Date(incident.incident_timestamp).toLocaleString()}</td><td className="muted-cell">{incident.latitude === null ? 'Not recorded' : `${incident.latitude}, ${incident.longitude}`}</td><td><StatusBadge label={incident.review_status} /></td><td className="muted-cell">{incident.assigned_controller_id?.slice(0, 8) ?? 'Unassigned'}</td><td><Link aria-label={`Review ${incident.id}`} className="icon-button" to={`/traffic/review/${incident.id}`}><ArrowRight size={16} /></Link></td></tr>) : incidents.map((incident) => <tr key={incident.id}><td><Link className="table-id" to={`/traffic/review/${incident.id}`}>{incident.id}<span className="inline-demo">DEMO</span></Link></td><td className="table-primary">{incident.type}</td><td><StatusBadge label={incident.priority} /></td><td className="muted-cell">{incident.occurredAt}</td><td className="muted-cell">{incident.district}</td><td><span className="status-badge status-amber">{incident.reviewStatus}</span></td><td className="muted-cell">{incident.assignedTeam}</td><td><Link aria-label={`Review ${incident.id}`} className="icon-button" to={`/traffic/review/${incident.id}`}><ArrowRight size={16} /></Link></td></tr>)}
        </tbody></table></div>
        {liveIncidents && visibleIncidents.length === 0 && <EmptyState icon={Filter} title="No incidents match this filter" description="Persisted incidents will appear here after they are submitted." />}
        {!liveIncidents && incidents.length === 0 && <EmptyState icon={Filter} title="No incidents match this filter" description="Choose another review state to see demo incident reports." />}
      </Panel>
      <p className="data-footnote">{liveIncidents ? 'Records and review status are loaded from the authenticated API. Severity ratings are not inferred.' : 'These are illustrative suspected incidents. No police alert has been sent.'}</p>
    </>
  )
}

function TrafficMetric({ label, value, icon: Icon, demo = true }: { label: string; value: string; icon: typeof Siren; demo?: boolean }) {
  return <div className="metric-card traffic-metric-card"><div className="metric-card-top"><span>{label}</span><span className="metric-icon metric-icon-violet"><Icon size={18} /></span></div><div className="metric-card-value-row"><strong>{value}</strong><span className="metric-change metric-change-alert">{demo ? 'DEMO' : 'LIVE'}</span></div><span className="metric-card-note">{demo ? 'Not connected to live feeds' : 'Persisted API records'}</span></div>
}

export function IncidentReviewPage() {
  const { incidentId } = useParams()
  const demoIncident = demoIncidents.find((item) => item.id === incidentId)
  const isPersistedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incidentId ?? '')
  const [liveIncident, setLiveIncident] = useState<ApiTrafficIncident | null>(null)
  const [loading, setLoading] = useState(isPersistedId)
  const [error, setError] = useState('')
  const [reviewState, setReviewState] = useState(demoIncident?.reviewStatus ?? '')
  const [policeTeams, setPoliceTeams] = useState<{ id: string; display_name: string }[]>([])
  const [selectedPoliceUser, setSelectedPoliceUser] = useState('')
  const [showAlertForm, setShowAlertForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const { confirm, notify } = useAppActions()

  useEffect(() => {
    setLiveIncident(null)
    setError('')
    setLoading(isPersistedId)
    if (!isPersistedId || !incidentId) return
    let active = true
    operationsApi.incident(incidentId).then((incident) => {
      if (active) {
        setLiveIncident(incident)
        setReviewState(incident.review_status)
      }
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this incident.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [incidentId, isPersistedId])

  if (loading) return <Panel><div className="users-loading"><span className="loading-indicator" />Loading incident…</div></Panel>
  if (isPersistedId && !liveIncident) return <Panel><EmptyState icon={Siren} title="Could not load incident" description={error || 'The incident is unavailable.'} action={<Link className="button button-secondary" to="/traffic"><ArrowLeft size={15} /> Return to incidents</Link>} /></Panel>
  if (!isPersistedId && !demoIncident) return <Panel><EmptyState icon={Siren} title="Incident not found" description="This report is not part of the demo records." action={<Link className="button button-secondary" to="/traffic"><ArrowLeft size={15} /> Return to incidents</Link>} /></Panel>

  const title = liveIncident?.incident_type ?? demoIncident!.type
  const displayedId = liveIncident?.id ?? demoIncident!.id
  const displayedStatus = liveIncident?.review_status ?? reviewState

  async function requestLiveReview(status: 'Reviewed' | 'Rejected' | 'More Evidence Requested') {
    if (!liveIncident) return
    setSaving(true)
    setError('')
    try {
      const updated = await operationsApi.updateIncident(liveIncident.id, { review_status: status })
      setLiveIncident(updated)
      setReviewState(updated.review_status)
      notify(`Incident review saved as ${status}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not save the review.')
    } finally {
      setSaving(false)
    }
  }

  function requestDecision(action: 'approve' | 'reject' | 'evidence' | 'authorize') {
    if (action === 'authorize' && liveIncident) {
      setError('')
      setShowAlertForm(true)
      operationsApi.policeTeams().then((availableTeams) => {
        setPoliceTeams(availableTeams)
        if (availableTeams.length) setSelectedPoliceUser(availableTeams[0].id)
      }).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load police teams.'))
      return
    }
    const copy = {
      approve: ['Approve for further review?', 'The incident remains suspected and will not be sent to police.', 'Approve for review'],
      reject: ['Reject this suspected incident?', 'This is a frontend-only demo. No production incident record will change.', 'Reject demo report'],
      evidence: ['Request more evidence?', 'No message will be sent. The request will only update this demo screen.', 'Request evidence'],
      authorize: ['Authorize a demo police alert?', 'This creates no real alert. It does not contact police or transmit incident details.', 'Authorize demo only'],
    }[action]
    if (liveIncident) {
      if (action === 'authorize') return
      const nextStatus = action === 'approve'
        ? 'Reviewed'
        : action === 'reject'
          ? 'Rejected'
          : 'More Evidence Requested'
      confirm({
        title: `Set incident review to ${nextStatus}?`,
        description: 'The review outcome will be recorded in CityLens. This does not contact external services.',
        confirmLabel: 'Save review',
        destructive: action === 'reject',
        onConfirm: () => { void requestLiveReview(nextStatus) },
      })
      return
    }
    confirm({
      title: copy[0],
      description: copy[1],
      confirmLabel: copy[2],
      destructive: action === 'reject',
      onConfirm: () => {
        const nextState = { approve: 'Approved for further review', reject: 'Rejected (demo)', evidence: 'More evidence requested', authorize: 'Alert authorized (demo)' }[action]
        setReviewState(nextState)
        notify(`${nextState}. No external action was taken.`)
      },
    })
  }

  function authorizePoliceAlert() {
    if (!liveIncident || !selectedPoliceUser) return
    confirm({
      title: 'Authorize an internal CityLens alert?',
      description: 'This creates an audited alert assigned to the selected police user. It does not dispatch or transmit a message externally.',
      confirmLabel: 'Authorize alert',
      onConfirm: () => {
        setSaving(true)
        setError('')
        void operationsApi.createAlert(liveIncident.id, selectedPoliceUser).then(() => {
          setShowAlertForm(false)
          notify('CityLens alert authorized and assigned. No external dispatch was made.')
        }).catch((alertError: unknown) => {
          setError(alertError instanceof Error ? alertError.message : 'Could not authorize the alert.')
        }).finally(() => setSaving(false))
      },
    })
  }

  return (
    <>
      <div className="back-link-row"><Link to="/traffic"><ArrowLeft size={15} /> Back to traffic incidents</Link>{liveIncident ? <span className="table-count">LIVE RECORD</span> : <DemoTag />}</div>
      <PageHeading actions={<StatusBadge label={displayedStatus} />} description="Inspect available footage and metadata before deciding whether this suspected report requires further review." eyebrow={`TRAFFIC SAFETY / CONTROLLER REVIEW / ${displayedId}`} title="Incident evidence review" />
      {error && <div className="notice-banner notice-banner-amber" role="alert"><AlertTriangle size={17} /><p>{error}</p></div>}
      <div className="notice-banner notice-banner-amber"><AlertTriangle size={17} /><p><strong>Suspected incident, not proof of guilt.</strong> Confirm only what the available evidence supports. This demo has no connected video or location evidence.</p></div>
      <div className="incident-review-layout">
        <div className="incident-review-main">
          <Panel className="incident-video-panel" title="Source footage" subtitle="No source footage attached to this incident"><div className="incident-evidence-placeholder"><div className="evidence-gridline" /><span><FileVideo2 size={28} /></span><strong>Evidence unavailable</strong><p>Video processing and incident media linkage are not connected.</p><span className="media-frame-label">NO FRAME EXTRACTED</span></div></Panel>
          <Panel title="Review outcome" subtitle={liveIncident ? 'Persisted CityLens review status' : 'Current browser-session demo state'}><div className="review-outcome"><span className="review-outcome-mark"><ShieldAlert size={18} /></span><div><strong>{displayedStatus}</strong><p>{liveIncident ? 'This review was loaded from the API.' : 'This decision is local UI state only and has not been saved.'}</p></div>{!liveIncident && <DemoTag />}</div></Panel>
        </div>
        <div className="incident-review-side">
          <Panel title="Suspected report" subtitle={liveIncident ? 'LIVE RECORD' : 'DEMO RECORD'}><dl className="summary-list"><div><dt>Report ID</dt><dd>{displayedId}</dd></div><div><dt>Suspected type</dt><dd>{title}</dd></div>{liveIncident ? <><div><dt>Occurred</dt><dd>{new Date(liveIncident.incident_timestamp).toLocaleString()}</dd></div><div><dt>GPS location</dt><dd>{liveIncident.latitude === null ? 'Not provided' : `${liveIncident.latitude}, ${liveIncident.longitude}`}</dd></div></> : <><div><dt>Priority</dt><dd><StatusBadge label={demoIncident!.priority} /></dd></div><div><dt>Occurred</dt><dd>{demoIncident!.occurredAt}</dd></div><div><dt>District</dt><dd>{demoIncident!.district}</dd></div><div><dt>GPS location</dt><dd>Not provided</dd></div><div><dt>Assigned review team</dt><dd>{demoIncident!.assignedTeam}</dd></div></>}</dl></Panel>
          <Panel title="Controller actions" subtitle="Every consequential action requires confirmation"><div className="controller-actions"><Button disabled={saving} icon={ThumbsUp} onClick={() => requestDecision('approve')} variant="primary">Mark reviewed</Button><Button disabled={saving} icon={FileVideo2} onClick={() => requestDecision('evidence')}>Request more evidence</Button><Button disabled={saving} icon={ThumbsDown} onClick={() => requestDecision('reject')} variant="danger">Reject suspected report</Button><div className="action-separator" /><Button disabled={saving || displayedStatus !== 'Reviewed'} icon={ShieldAlert} onClick={() => requestDecision('authorize')} variant="secondary">Authorize police alert</Button><p>Authorization creates an internal audited assignment only; it does not dispatch externally.</p></div></Panel>
          {showAlertForm && <Panel title="Assign authorized alert" subtitle="Select an active Police Officer"><div className="create-record-form"><label>Police Officer<select onChange={(event) => setSelectedPoliceUser(event.target.value)} value={selectedPoliceUser}><option value="">Choose an officer</option>{policeTeams.map((team) => <option key={team.id} value={team.id}>{team.display_name}</option>)}</select></label><Button disabled={saving || !selectedPoliceUser} onClick={authorizePoliceAlert} variant="primary">{saving ? 'Saving…' : 'Authorize alert'}</Button>{policeTeams.length === 0 && <EmptyState title="No active Police Officers" description="An active Police Officer account is required to authorize an alert." />}</div></Panel>}
        </div>
      </div>
    </>
  )
}

const alertStatuses: AlertStatus[] = ['Pending Review', 'Authorized', 'Sent', 'Acknowledged', 'Investigating', 'Closed']

export function PoliceAlertsPage({ userRole }: { userRole: UserRole }) {
  const [localStatuses, setLocalStatuses] = useState<Record<string, AlertStatus>>({})
  const [liveAlerts, setLiveAlerts] = useState<Awaited<ReturnType<typeof operationsApi.alerts>>['items'] | null>(null)
  const [liveIncidents, setLiveIncidents] = useState<ApiTrafficIncident[]>([])
  const [notesByAlert, setNotesByAlert] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const { confirm, notify } = useAppActions()
  useEffect(() => {
    let active = true
    Promise.all([operationsApi.alerts(100), operationsApi.incidents(100)]).then(([alerts, incidents]) => {
      if (active) {
        setLiveAlerts(alerts.items)
        setLiveIncidents(incidents.items)
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load police alerts.')
    })
    return () => { active = false }
  }, [])

  function advanceAlert(alertId: string, status: AlertStatus) {
    const liveAlert = liveAlerts?.find((alert) => alert.id === alertId)
    if (liveAlert) {
      const next: Record<PoliceAlertStatus, PoliceAlertStatus | null> = {
        Authorized: 'Acknowledged',
        Acknowledged: 'Investigating',
        Investigating: 'Closed',
        Closed: null,
      }
      const nextStatus = next[liveAlert.alert_status]
      if (userRole !== 'Police Officer' || !nextStatus) return
      confirm({
        title: `Advance alert to ${nextStatus}?`,
        description: 'This saves the investigation status in CityLens. It does not send or dispatch an external alert.',
        confirmLabel: `Set ${nextStatus}`,
        onConfirm: () => {
          void operationsApi.updateAlert(alertId, {
            alert_status: nextStatus,
            investigation_notes: notesByAlert[alertId] ?? liveAlert.investigation_notes,
          }).then((updated) => {
            setLiveAlerts((current) => current?.map((alert) => alert.id === alertId ? updated : alert) ?? null)
            setNotesByAlert((current) => ({ ...current, [alertId]: updated.investigation_notes ?? '' }))
            notify(`Alert status saved as ${updated.alert_status}.`)
          }).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Could not update this alert.'))
        },
      })
      return
    }
    const next = alertStatuses[alertStatuses.indexOf(status) + 1]
    if (!next) return
    confirm({
      title: `Advance ${alertId} to ${next}?`,
      description: 'This changes the displayed demo status only. No alert will be sent, and no police system is connected.',
      confirmLabel: `Set ${next}`,
      onConfirm: () => {
        setLocalStatuses((current) => ({ ...current, [alertId]: next }))
        notify(`Demo alert status changed to ${next}. No alert was sent.`)
      },
    })
  }

  return (
    <>
      <PageHeading actions={liveAlerts ? <span className="table-count">LIVE RECORDS · NOT DISPATCHED</span> : <DemoTag>NOT SENT</DemoTag>} description="Track authorized alert records and investigation progress. No external police system is connected." eyebrow="TRAFFIC SAFETY / INVESTIGATIONS" title="Police alerts & investigations" />
      {loadError && <div className="notice-banner notice-banner-amber" role="alert"><ShieldAlert size={17} /><p><strong>Alerts unavailable.</strong> {loadError} Demo records are read-only.</p></div>}
      {!liveAlerts && <div className="notice-banner notice-banner-blue"><ShieldAlert size={17} /><p><strong>Demo alert register.</strong> Sample records are not connected to a police system; no real alert is sent.</p></div>}
      <div className="alert-summary-row"><div><span>Open investigations</span><strong>{liveAlerts ? liveAlerts.filter((alert) => ['Acknowledged', 'Investigating'].includes(alert.alert_status)).length.toString().padStart(2, '0') : '02'}</strong><small>{liveAlerts ? 'LIVE RECORDS' : 'DEMO RECORDS'}</small></div><div><span>Authorized, not sent</span><strong>{liveAlerts ? liveAlerts.filter((alert) => alert.alert_status === 'Authorized').length.toString().padStart(2, '0') : '01'}</strong><small>{liveAlerts ? 'LIVE RECORDS' : 'DEMO RECORDS'}</small></div><div><span>Actually sent</span><strong>00</strong><small>NO DISPATCH CONNECTED</small></div><div><span>Closed</span><strong>{liveAlerts ? liveAlerts.filter((alert) => alert.alert_status === 'Closed').length.toString().padStart(2, '0') : '01'}</strong><small>{liveAlerts ? 'LIVE RECORDS' : 'DEMO RECORDS'}</small></div></div>
      <Panel className="table-panel alert-list-panel" subtitle={liveAlerts ? 'Persisted alert assignments · status updates are authorized for the assigned police user' : 'Sample status transitions are illustrative and local only'} title="Alert register">
        <div className="table-scroll"><table><thead><tr><th>ALERT</th><th>INCIDENT</th><th>PRIORITY</th><th>ASSIGNED TEAM</th><th>INVESTIGATION</th><th>DELIVERY</th><th>UPDATED</th><th></th></tr></thead><tbody>
          {liveAlerts ? liveAlerts.map((alert) => { const incident = liveIncidents.find((item) => item.id === alert.incident_id); const notes = notesByAlert[alert.id] ?? alert.investigation_notes ?? ''; return <tr key={alert.id}><td><span className="table-id">{alert.id.slice(0, 8)}</span></td><td><span className="table-primary">{incident?.incident_type ?? 'Incident'}</span><span className="table-secondary">{alert.incident_id}</span></td><td className="muted-cell">Not rated</td><td className="muted-cell">{alert.assigned_police_user_id.slice(0, 8)}</td><td><StatusBadge label={alert.alert_status} /></td><td><span className="delivery-not-sent"><span />Not dispatched</span></td><td className="muted-cell">{new Date(alert.acknowledged_at ?? alert.authorized_at).toLocaleString()}</td><td>{userRole === 'Police Officer' && <div className="police-alert-actions"><textarea aria-label="Investigation notes" maxLength={4000} onChange={(event) => setNotesByAlert((current) => ({ ...current, [alert.id]: event.target.value }))} placeholder="Investigation notes" value={notes} /><Button className="table-action-button" onClick={() => void operationsApi.updateAlert(alert.id, { investigation_notes: notes }).then((updated) => { setLiveAlerts((current) => current?.map((item) => item.id === alert.id ? updated : item) ?? null); notify('Investigation notes saved.') }).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Could not save investigation notes.'))} variant="ghost">Save notes</Button><Button className="table-action-button" onClick={() => advanceAlert(alert.id, alert.alert_status)} variant="ghost">Advance</Button></div>}</td></tr> }) : demoAlerts.map((alert) => { const status = localStatuses[alert.id] ?? alert.status; return <tr key={alert.id}><td><span className="table-id">{alert.id}<span className="inline-demo">DEMO</span></span></td><td><span className="table-primary">{alert.type}</span><span className="table-secondary">{alert.incidentId}</span></td><td><StatusBadge label={alert.priority} /></td><td className="muted-cell">{alert.assignedTeam}</td><td><StatusBadge label={status} /></td><td><span className="delivery-not-sent"><span />Not sent</span></td><td className="muted-cell">{alert.updatedAt}</td><td><Button className="table-action-button" onClick={() => advanceAlert(alert.id, status)} variant="ghost">Advance</Button></td></tr> })}
        </tbody></table></div>
        {liveAlerts?.length === 0 && <EmptyState icon={ShieldAlert} title="No authorized alerts" description="Alerts authorized for this account will appear here." />}
      </Panel>
      <Panel className="police-safety-note"><div className="notice-inline"><Siren size={17} /><p>Police alert dispatch is intentionally disabled. CityLens records authorization and investigation status, but does not transmit alerts externally.</p></div></Panel>
      {!liveAlerts && <div className="alert-status-key">{alertStatuses.map((status) => <span key={status}><StatusBadge label={status} /></span>)}</div>}
    </>
  )
}