import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileImage,
  Filter,
  HardHat,
  Upload,
} from 'lucide-react'
import { demoDefects, demoRepairs } from '../data/demo'
import { useAppActions } from '../context'
import type { RepairStatus, UserRole } from '../types'
import { Button, DemoTag, EmptyState, PageHeading, Panel, StatusBadge } from '../components/ui'
import { operationsApi, type RepairAssignment as ApiRepairAssignment } from '../services/api'

const repairStatuses: RepairStatus[] = ['Reported', 'Verified', 'Assigned', 'In Progress', 'Awaiting Verification', 'Closed']

export function RepairTrackingPage() {
  const [status, setStatus] = useState('All statuses')
  const filteredTasks = useMemo(() => status === 'All statuses' ? demoRepairs : demoRepairs.filter((task) => task.status === status), [status])
  const [liveRepairs, setLiveRepairs] = useState<ApiRepairAssignment[] | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    operationsApi.repairs(100).then((response) => {
      if (active) setLiveRepairs(response.items)
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load repair assignments.')
    })
    return () => { active = false }
  }, [])
  const visibleRepairs = liveRepairs?.filter((repair) => status === 'All statuses' || repair.status === status) ?? []

  return (
    <>
      <PageHeading actions={<>{liveRepairs ? <span className="table-count">LIVE RECORDS</span> : <DemoTag />}<Button icon={Filter} onClick={() => setStatus((current) => current === 'All statuses' ? 'In Progress' : 'All statuses')} variant="secondary">{status}</Button></>} description="Track assignments, field progress, and repair verification across municipal teams." eyebrow="ROAD OPERATIONS / MAINTENANCE" title="Repair tracking" />
      {loadError && <div className="notice-banner notice-banner-amber" role="alert"><HardHat size={17} /><p><strong>Live assignments unavailable.</strong> {loadError} Sample tasks below are read-only.</p></div>}
      {!liveRepairs && <div className="demo-banner"><span className="demo-banner-mark"><HardHat size={16} /></span><p><strong>Sample task board.</strong> Sample task records are read-only; no assignments or progress are saved.</p><DemoTag /></div>}
      <div className="repair-summary-grid">
        {repairStatuses.map((repairStatus) => <div className="repair-summary-card" key={repairStatus}><span>{repairStatus}</span><strong>{(liveRepairs ? liveRepairs.filter((task) => task.status === repairStatus).length : demoRepairs.filter((task) => task.status === repairStatus).length).toString().padStart(2, '0')}</strong><small>{liveRepairs ? 'LIVE TASKS' : 'DEMO TASKS'}</small></div>)}
      </div>
      <Panel className="table-panel repair-task-panel" subtitle={liveRepairs ? 'Persisted assignments · select a task to update status or evidence' : 'Illustrative tasks · sample task changes are not saved'} title="Maintenance tasks" action={<span className="table-count">{liveRepairs ? visibleRepairs.length : filteredTasks.length} tasks</span>}>
        <div className="table-scroll"><table><thead><tr><th>TASK ID</th><th>DEFECT / REPORT</th><th>DISTRICT</th><th>TEAM</th><th>PROGRESS</th><th>DUE</th><th>STATUS</th></tr></thead><tbody>
          {liveRepairs ? visibleRepairs.map((task) => <tr key={task.id}><td><Link className="table-id" to={`/repairs/${task.id}`}>{task.id.slice(0, 8)}</Link></td><td><span className="table-primary">Road defect</span><span className="table-secondary">{task.defect_id}</span></td><td className="muted-cell">Not recorded</td><td className="table-primary">{task.assigned_team_id.slice(0, 8)}</td><td><div className="progress-cell"><span className="progress-track"><i style={{ width: `${task.status === 'Closed' || task.status === 'Awaiting Verification' ? 100 : task.status === 'In Progress' ? 50 : 0}%` }} /></span><strong>{task.status === 'Closed' || task.status === 'Awaiting Verification' ? 100 : task.status === 'In Progress' ? 50 : 0}%</strong></div></td><td className="muted-cell">—</td><td><StatusBadge label={task.status} /></td></tr>) : filteredTasks.map((task) => <tr key={task.id}><td><Link className="table-id" to={`/repairs/${task.id}`}>{task.id}<span className="inline-demo">DEMO</span></Link></td><td><span className="table-primary">{task.type}</span><span className="table-secondary">{task.defectId}</span></td><td className="muted-cell">{task.district}</td><td className="table-primary">{task.team}</td><td><div className="progress-cell"><span className="progress-track"><i style={{ width: `${task.progress}%` }} /></span><strong>{task.progress}%</strong></div></td><td className="muted-cell">{task.dueDate}</td><td><StatusBadge label={task.status} /></td></tr>)}
        </tbody></table></div>
        {liveRepairs && visibleRepairs.length === 0 && <EmptyState icon={Filter} title="No repair assignments" description="Assignments created by municipal engineers will appear here." />}
        {!liveRepairs && filteredTasks.length === 0 && <EmptyState icon={Filter} title="No tasks in this status" description="Choose another status to view the sample tasks." />}
      </Panel>
      <p className="data-footnote">{liveRepairs ? 'Live assignment records are stored in PostgreSQL. Work dates and team names are not included in the current API response.' : 'Demo repair records are not connected to municipal work orders, crews, or field evidence.'}</p>
    </>
  )
}

export function RepairTaskDetailsPage({ userRole }: { userRole: UserRole }) {
  const { taskId = '' } = useParams()
  const task = demoRepairs.find((item) => item.id === taskId)
  const isPersistedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
  const [liveRepair, setLiveRepair] = useState<ApiRepairAssignment | null>(null)
  const [liveError, setLiveError] = useState('')
  const [loading, setLoading] = useState(isPersistedId)
  const [currentStatus, setCurrentStatus] = useState<RepairStatus | null>(null)
  const [beforeFile, setBeforeFile] = useState('')
  const [afterFile, setAfterFile] = useState('')
  const { confirm, notify } = useAppActions()
  const defect = task ? demoDefects.find((report) => report.id === task.defectId) : undefined
  const status = currentStatus ?? task?.status ?? 'Reported'
  const nextIndex = repairStatuses.indexOf(status) + 1
  const nextStatus = repairStatuses[nextIndex]

  useEffect(() => {
    setLiveRepair(null)
    setLiveError('')
    setLoading(isPersistedId)
    if (!isPersistedId) return
    let active = true
    operationsApi.repair(taskId).then((repair) => {
      if (active) setLiveRepair(repair)
    }).catch((error: unknown) => {
      if (active) setLiveError(error instanceof Error ? error.message : 'Could not load this repair.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [isPersistedId, taskId])

  if (liveRepair) return <LiveRepairDetails repair={liveRepair} userRole={userRole} />
  if (loading) return <Panel><div className="users-loading"><span className="loading-indicator" />Loading repair assignment…</div></Panel>
  if (isPersistedId && liveError) return <Panel><EmptyState icon={HardHat} title="Could not load repair assignment" description={liveError} action={<Link className="button button-secondary" to="/repairs"><ArrowLeft size={15} /> Return to repairs</Link>} /></Panel>

  if (!task) return <Panel><EmptyState icon={HardHat} title="Repair task not found" description="This task is not part of the current demo records." action={<Link className="button button-secondary" to="/repairs"><ArrowLeft size={15} /> Return to repairs</Link>} /></Panel>

  function changeStatus() {
    if (!nextStatus) return
    confirm({
      title: `Move task to ${nextStatus}?`,
      description: 'This changes only the visible demo state in this browser session. It does not create or update a work order.',
      confirmLabel: `Set ${nextStatus}`,
      onConfirm: () => {
        setCurrentStatus(nextStatus)
        notify(`Demo task moved to ${nextStatus}. This was not saved to a backend.`)
      },
    })
  }

  function pickEvidence(which: 'before' | 'after', file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      notify('Choose an image or video file for evidence.')
      return
    }
    if (which === 'before') setBeforeFile(file.name)
    else setAfterFile(file.name)
  }

  return (
    <>
      <div className="back-link-row"><Link to="/repairs"><ArrowLeft size={15} /> Back to repair tracking</Link><DemoTag /></div>
      <PageHeading actions={nextStatus ? <Button icon={CheckCircle2} onClick={changeStatus} variant="primary">Advance to {nextStatus}</Button> : <StatusBadge label="Closed" />} description={`${task.team} · ${task.district} · due ${task.dueDate}`} eyebrow={`MAINTENANCE / ${task.id}`} title={`${task.type} repair`} />
      <div className="demo-banner"><span className="demo-banner-mark"><Clock3 size={16} /></span><p><strong>Demo workflow.</strong> Progress and status changes stay in this page session and are not persisted.</p><StatusBadge label={status} /></div>
      <div className="repair-detail-grid">
        <div className="detail-main-column">
          <Panel title="Repair status" subtitle="Required workflow for municipal repair reports">
            <div className="repair-stepper">{repairStatuses.map((step, index) => {
              const active = repairStatuses.indexOf(status) >= index
              return <div className={`repair-step${active ? ' repair-step-active' : ''}${status === step ? ' repair-step-current' : ''}`} key={step}><span>{active && repairStatuses.indexOf(status) > index ? <CheckCircle2 size={15} /> : String(index + 1).padStart(2, '0')}</span><small>{step}</small></div>
            })}</div>
          </Panel>
          <div className="evidence-grid">
            <EvidenceCard title="Before repair" fileName={beforeFile} onChoose={(file) => pickEvidence('before', file)} />
            <EvidenceCard title="After repair" fileName={afterFile} onChoose={(file) => pickEvidence('after', file)} />
          </div>
          <Panel title="Source defect" subtitle="Related road observation">
            {defect ? <div className="source-defect-row"><span className="source-defect-icon"><FileImage size={18} /></span><div><strong>{defect.id} · {defect.type}</strong><p>{defect.district} · GPS not provided</p></div><StatusBadge label={defect.priority} /><Link aria-label={`Open ${defect.id}`} className="icon-button" to={`/defects/${defect.id}`}><ArrowRight size={16} /></Link></div> : <EmptyState title="Source record unavailable" description="The linked defect is not in the sample set." />}
          </Panel>
        </div>
        <div className="detail-side-column">
          <Panel title="Assignment details" subtitle="DEMO WORK ORDER"><dl className="summary-list"><div><dt>Task ID</dt><dd>{task.id}</dd></div><div><dt>Source report</dt><dd>{task.defectId}</dd></div><div><dt>Assigned team</dt><dd>{task.team}</dd></div><div><dt>District</dt><dd>{task.district}</dd></div><div><dt>Due date</dt><dd>{task.dueDate}</dd></div><div><dt>Progress</dt><dd>{task.progress}% <span className="muted-cell">· demo</span></dd></div><div><dt>Current status</dt><dd><StatusBadge label={status} /></dd></div></dl></Panel>
          <Panel className="detail-note-panel"><div className="notice-inline"><Upload size={16} /><p>Evidence selection stays in your browser. Upload storage and engineer verification are not connected.</p></div></Panel>
        </div>
      </div>
    </>
  )
}

function LiveRepairDetails({ repair: initialRepair, userRole }: { repair: ApiRepairAssignment; userRole: UserRole }) {
  const [repair, setRepair] = useState(initialRepair)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadedEvidence, setUploadedEvidence] = useState('')
  const { notify } = useAppActions()
  const nextStatus = repair.status === 'Assigned'
    ? 'In Progress'
    : repair.status === 'In Progress'
      ? 'Awaiting Verification'
      : repair.status === 'Awaiting Verification' && userRole !== 'Maintenance Team'
        ? 'Closed'
        : null

  async function advanceRepair() {
    if (!nextStatus) return
    setSaving(true)
    setError('')
    try {
      setRepair(await operationsApi.updateRepair(repair.id, { status: nextStatus }))
      notify(`Repair status saved as ${nextStatus}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update the repair.')
    } finally {
      setSaving(false)
    }
  }

  async function uploadEvidence(file?: File) {
    if (!file) return
    setSaving(true)
    setError('')
    try {
      const evidence = await operationsApi.uploadEvidence(file, repair.defect_id)
      setUploadedEvidence(evidence.original_filename)
      notify('Completion evidence uploaded.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload evidence.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="back-link-row"><Link to="/repairs"><ArrowLeft size={15} /> Back to repair tracking</Link><span className="table-count">LIVE RECORD</span></div>
      <PageHeading actions={nextStatus ? <Button disabled={saving} icon={CheckCircle2} onClick={() => void advanceRepair()} variant="primary">Advance to {nextStatus}</Button> : <StatusBadge label={repair.status} />} description={`Assigned team ${repair.assigned_team_id}`} eyebrow={`MAINTENANCE / ${repair.id}`} title="Repair assignment" />
      {error && <div className="notice-banner notice-banner-amber" role="alert"><HardHat size={17} /><p>{error}</p></div>}
      <div className="repair-detail-grid">
        <div className="detail-main-column">
          <Panel title="Repair status" subtitle="Changes are saved by the CityLens API">
            <div className="repair-stepper">{(['Assigned', 'In Progress', 'Awaiting Verification', 'Closed'] as const).map((step, index) => {
              const active = ['Assigned', 'In Progress', 'Awaiting Verification', 'Closed'].indexOf(repair.status) >= index
              return <div className={`repair-step${active ? ' repair-step-active' : ''}${repair.status === step ? ' repair-step-current' : ''}`} key={step}><span>{active && repair.status !== step ? <CheckCircle2 size={15} /> : String(index + 1).padStart(2, '0')}</span><small>{step}</small></div>
            })}</div>
          </Panel>
          <Panel title="Completion evidence" subtitle="Upload an image, video, or PDF against the assigned road defect">
            <label className="button button-secondary" htmlFor="repair-evidence"><Upload size={15} /> Choose evidence<input accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,application/pdf" className="visually-hidden" disabled={saving} id="repair-evidence" onChange={(event) => { void uploadEvidence(event.target.files?.[0]); event.target.value = '' }} type="file" /></label>
            {uploadedEvidence && <p role="status">Saved: {uploadedEvidence}</p>}
          </Panel>
          <Panel title="Source defect" subtitle="Related persisted road-defect record">
            <div className="source-defect-row"><span className="source-defect-icon"><FileImage size={18} /></span><div><strong>{repair.defect_id}</strong><p>Linked defect record</p></div><Link aria-label="Open source defect" className="icon-button" to={`/defects/${repair.defect_id}`}><ArrowRight size={16} /></Link></div>
          </Panel>
        </div>
        <div className="detail-side-column">
          <Panel title="Assignment details" subtitle="LIVE WORK ORDER"><dl className="summary-list"><div><dt>Assignment ID</dt><dd>{repair.id}</dd></div><div><dt>Source defect</dt><dd>{repair.defect_id}</dd></div><div><dt>Assigned team</dt><dd>{repair.assigned_team_id}</dd></div><div><dt>Assigned by</dt><dd>{repair.assigned_by}</dd></div><div><dt>Assigned at</dt><dd>{new Date(repair.assigned_at).toLocaleString()}</dd></div><div><dt>Completed at</dt><dd>{repair.completed_at ? new Date(repair.completed_at).toLocaleString() : 'Not completed'}</dd></div><div><dt>Status</dt><dd><StatusBadge label={repair.status} /></dd></div></dl></Panel>
          {repair.notes && <Panel title="Assignment notes"><p>{repair.notes}</p></Panel>}
        </div>
      </div>
    </>
  )
}

function EvidenceCard({ title, fileName, onChoose }: { title: string; fileName: string; onChoose: (file: File | undefined) => void }) {
  const inputId = title.toLowerCase().replaceAll(' ', '-')
  return (
    <Panel className="evidence-card" title={title} subtitle={fileName ? 'Selected locally · not uploaded' : 'No evidence attached'}>
      <div className="evidence-picker"><FileImage size={23} /><strong>{fileName || 'Add field evidence'}</strong><p>Image or video · local selection only</p><label className="button button-secondary" htmlFor={inputId}><Upload size={15} /> Choose file<input accept="image/*,video/*" className="visually-hidden" id={inputId} onChange={(event) => onChoose(event.target.files?.[0])} type="file" /></label></div>
    </Panel>
  )
}