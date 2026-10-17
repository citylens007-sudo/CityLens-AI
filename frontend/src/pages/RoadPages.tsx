import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileVideo2,
  Filter,
  MapPin,
  MapPinned,
  Search,
  ShieldCheck,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { demoDefects } from '../data/demo'
import { useAppActions } from '../context'
import type { DefectPriority, DefectReport } from '../types'
import { Button, DemoTag, EmptyState, PageHeading, Panel, StatusBadge } from '../components/ui'
import { MapView } from '../components/MapView'
import {
  apiUrl,
  operationsApi,
  roadDetectionApi,
  type RoadDefect,
  type RoadDetection,
  type RoadDetectionAvailability,
  type RoadDetectionJob,
} from '../services/api'

const MAX_VIDEO_SIZE = 500 * 1024 * 1024
const MAX_SIDECAR_SIZE = 64 * 1024
const allowedExtensions = ['.mp4', '.mov']

function toDefectReport(defect: RoadDefect): DefectReport {
  return {
    id: defect.id,
    type: defect.defect_type,
    priority: defect.severity,
    confidence: defect.confidence,
    observedAt: new Date(defect.detected_at).toLocaleString(),
    district: defect.latitude === null ? 'Location not provided' : 'GPS location recorded',
    coordinates: defect.latitude === null || defect.longitude === null
      ? undefined
      : { latitude: defect.latitude, longitude: defect.longitude },
    status: defect.status,
    assignedTo: null,
    demo: false,
  }
}

export function RoadMonitoringPage() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')
  const [availability, setAvailability] = useState<RoadDetectionAvailability | null>(null)
  const [availabilityError, setAvailabilityError] = useState('')
  const [job, setJob] = useState<RoadDetectionJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<RoadDetectionJob[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationVerified, setLocationVerified] = useState(false)
  const [gpsSidecar, setGpsSidecar] = useState<File | null>(null)
  const [severity, setSeverity] = useState<RoadDefect['severity']>('Medium')
  const [reviewingId, setReviewingId] = useState('')
  const [reviewError, setReviewError] = useState('')
  const { notify } = useAppActions()

  useEffect(() => {
    let active = true
    roadDetectionApi.availability().then((result) => {
      if (active) setAvailability(result)
    }).catch((availabilityLoadError: unknown) => {
      if (active) {
        setAvailabilityError(
          availabilityLoadError instanceof Error
            ? availabilityLoadError.message
            : 'Could not check video detection availability.',
        )
      }
    })
    roadDetectionApi.jobs().then(async (result) => {
      if (!active || result.items.length === 0) return
      setRecentJobs(result.items)
      const latest = await roadDetectionApi.job(result.items[0].id)
      if (active) setJob(latest)
    }).catch((jobsLoadError: unknown) => {
      if (active) setError(jobsLoadError instanceof Error ? jobsLoadError.message : 'Could not load recent video jobs.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!job || (job.status !== 'Pending' && job.status !== 'Processing')) return
    let active = true
    let requestInFlight = false
    const timer = window.setInterval(() => {
      if (requestInFlight) return
      requestInFlight = true
      roadDetectionApi.job(job.id).then((updated) => {
        if (!active) return
        setError('')
        setJob(updated)
        setRecentJobs((current) => [updated, ...current.filter((item) => item.id !== updated.id)].slice(0, 10))
      }).catch((pollError: unknown) => {
        if (active) setError(pollError instanceof Error ? pollError.message : 'Could not refresh video status.')
      }).finally(() => {
        requestInFlight = false
      })
    }, 1500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [job?.id, job?.status])

  function selectVideo(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setError('')
    if (!selected) return

    const extension = `.${selected.name.split('.').pop()?.toLowerCase() ?? ''}`
    if (!allowedExtensions.includes(extension)) {
      setFile(null)
      setError('Choose an MP4 or MOV video file.')
      event.target.value = ''
      return
    }
    const expectedType = extension === '.mp4' ? 'video/mp4' : 'video/quicktime'
    if (selected.type && selected.type !== expectedType) {
      setFile(null)
      setError('The selected video file type does not match its extension.')
      event.target.value = ''
      return
    }
    if (selected.size > MAX_VIDEO_SIZE) {
      setFile(null)
      setError('This file exceeds the configured 500 MB upload limit.')
      event.target.value = ''
      return
    }
    setFile(selected)
  }

  function selectSidecar(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setError('')
    if (!selected) {
      setGpsSidecar(null)
      return
    }
    if (!selected.name.toLowerCase().endsWith('.json') || selected.size > MAX_SIDECAR_SIZE) {
      setGpsSidecar(null)
      setError('Choose a JSON GPS sidecar no larger than 64 KB.')
      event.target.value = ''
      return
    }
    if (latitude || longitude) {
      setGpsSidecar(null)
      setError('Use either verified coordinates or a GPS sidecar, not both.')
      event.target.value = ''
      return
    }
    setGpsSidecar(selected)
  }

  async function requestProcessing() {
    if (!file) return
    setError('')
    setReviewError('')
    if (Boolean(latitude.trim()) !== Boolean(longitude.trim())) {
      setError('Enter both coordinates, or leave both blank.')
      return
    }
    if (latitude.trim() && !locationVerified) {
      setError('Confirm that the entered coordinates are verified before uploading.')
      return
    }
    if (gpsSidecar && (latitude.trim() || longitude.trim())) {
      setError('Use either verified coordinates or a GPS sidecar, not both.')
      return
    }
    const parsedLatitude = latitude.trim() ? Number(latitude) : undefined
    const parsedLongitude = longitude.trim() ? Number(longitude) : undefined
    if (
      (parsedLatitude !== undefined && (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90))
      || (parsedLongitude !== undefined && (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180))
    ) {
      setError('Latitude must be between -90 and 90 and longitude between -180 and 180.')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    try {
      const created = await roadDetectionApi.upload(file, {
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        locationVerified,
        gpsSidecar: gpsSidecar ?? undefined,
      }, setUploadProgress)
      setJob(created)
      setRecentJobs((current) => [created, ...current.filter((item) => item.id !== created.id)].slice(0, 10))
      notify('Video upload accepted. Processing status is available below.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Video upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function reviewDetection(detection: RoadDetection, action: 'confirm' | 'reject') {
    setReviewingId(detection.id)
    setReviewError('')
    try {
      if (action === 'confirm') {
        await roadDetectionApi.confirm(detection.id, severity)
        notify('Detection confirmed and added to road defects.')
      } else {
        await roadDetectionApi.reject(detection.id)
        notify('Detection rejected.')
      }
      if (job) {
        const refreshed = await roadDetectionApi.job(job.id)
        setJob(refreshed)
        setRecentJobs((current) => [refreshed, ...current.filter((item) => item.id !== refreshed.id)].slice(0, 10))
      }
    } catch (reviewFailure) {
      setReviewError(reviewFailure instanceof Error ? reviewFailure.message : 'Could not save the review.')
    } finally {
      setReviewingId('')
    }
  }

  async function selectJob(id: string) {
    setError('')
    try {
      setJob(await roadDetectionApi.job(id))
    } catch (jobLoadError) {
      setError(jobLoadError instanceof Error ? jobLoadError.message : 'Could not load this video job.')
    }
  }

  const detections = job?.detections ?? []
  return (
    <>
      <PageHeading
        description="Upload authorized camera footage for evidence-backed road-surface analysis."
        eyebrow="ROAD OPERATIONS / VIDEO INTAKE"
        title="Road damage monitoring"
      />
      <div className={`notice-banner ${availability?.available ? 'notice-banner-blue' : 'notice-banner-amber'}`}>
        <Video size={17} />
        <p><strong>{availability?.available ? 'Road-damage model ready.' : 'AI detection unavailable.'}</strong>{' '}
          {availabilityError || availability?.message || 'Checking the configured road-damage model…'}</p>
      </div>

      <div className="road-upload-grid">
        <Panel className="upload-panel" subtitle="Bus and fleet camera footage" title="Video source">
          <label className={`upload-dropzone${error ? ' upload-dropzone-error' : ''}`} htmlFor="road-video">
            <input accept=".mp4,.mov,video/mp4,video/quicktime" className="visually-hidden" id="road-video" onChange={selectVideo} type="file" />
            <span className="upload-icon"><Upload size={21} /></span>
            <strong>Choose video footage</strong>
            <span>Browse a file from this device</span>
            <small>MP4 or MOV · Up to 500 MB</small>
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          {file && <div className="selected-file"><FileVideo2 size={18} /><span><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(1)} MB · selected for upload</small></span><button aria-label="Remove selected video" onClick={() => setFile(null)} type="button"><X size={17} /></button></div>}
          <label className="field-label" htmlFor="road-latitude">Verified latitude (optional)</label>
          <input className="form-input" id="road-latitude" inputMode="decimal" onChange={(event) => setLatitude(event.target.value)} placeholder="e.g. 45.5017" type="number" value={latitude} />
          <label className="field-label" htmlFor="road-longitude">Verified longitude (optional)</label>
          <input className="form-input" id="road-longitude" inputMode="decimal" onChange={(event) => setLongitude(event.target.value)} placeholder="e.g. -73.5673" type="number" value={longitude} />
          <label className="checkbox-label"><input checked={locationVerified} onChange={(event) => setLocationVerified(event.target.checked)} type="checkbox" /> I verified these coordinates for this footage</label>
          <label className="field-label" htmlFor="road-gps-sidecar">GPS sidecar (optional JSON)</label>
          <input accept=".json,application/json" disabled={Boolean(latitude || longitude)} id="road-gps-sidecar" onChange={selectSidecar} type="file" />
          {uploading && <div aria-label={`Upload progress ${uploadProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={uploadProgress} className="upload-progress" role="progressbar"><span style={{ width: `${uploadProgress}%` }} /></div>}
          <div className="upload-actions"><Button disabled={!file || !availability?.available || uploading} icon={Upload} onClick={() => void requestProcessing()} variant="primary">{uploading ? `Uploading ${uploadProgress}%` : 'Submit for analysis'}</Button><span>{availability?.available ? 'Requires engineer authorization' : 'Upload enabled when a compatible model is configured'}</span></div>
        </Panel>
        <Panel className="video-preview-panel" subtitle={file ? 'Local browser preview' : 'Preview appears after selecting a file'} title="Footage preview">
          {previewUrl ? <video className="road-video-preview" controls src={previewUrl}>Your browser does not support video preview.</video> : <div className="video-preview-empty"><span><FileVideo2 size={26} /></span><strong>No footage selected</strong><small>Choose a supported MP4 or MOV file to preview it.</small></div>}
        </Panel>
      </div>

      {recentJobs.length > 0 && <Panel subtitle="Your latest persisted processing jobs" title="Recent video jobs">
        <label className="field-label" htmlFor="recent-video-jobs">Select a job</label>
        <select className="form-input" id="recent-video-jobs" onChange={(event) => void selectJob(event.target.value)} value={job?.id ?? ''}>
          {recentJobs.map((item) => <option key={item.id} value={item.id}>{item.original_filename} · {item.status} · {new Date(item.created_at).toLocaleString()}</option>)}
        </select>
      </Panel>}

      {job && <Panel className="results-panel" subtitle={job.status_message ?? `Uploaded ${new Date(job.created_at).toLocaleString()}`} title={`Detection results · ${job.original_filename}`} action={<><StatusBadge label={job.status} /> <span className="table-count">{detections.length} results</span></>}>
        {(job.status === 'Pending' || job.status === 'Processing') && <div aria-label={`Processing progress ${job.progress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={job.progress} className="upload-progress" role="progressbar"><span style={{ width: `${job.progress}%` }} /></div>}
        {job.status === 'Failed' && <p className="field-error" role="alert">{job.status_message ?? 'Video processing failed.'}</p>}
        {reviewError && <p className="field-error" role="alert">{reviewError}</p>}
        {detections.length > 0 ? <div className="table-scroll"><table><thead><tr><th>EVIDENCE</th><th>DEFECT TYPE</th><th>CONFIDENCE</th><th>VIDEO TIME</th><th>LOCATION</th><th>REVIEW</th><th>ACTION</th></tr></thead><tbody>
          {detections.map((detection) => <tr key={detection.id}>
            <td>{detection.evidence_url ? <img alt={`${detection.class_name} detection at ${detection.video_timestamp_seconds.toFixed(1)} seconds`} height="80" loading="lazy" src={apiUrl(detection.evidence_url)} /> : 'Unavailable'}</td>
            <td>{detection.class_name}</td>
            <td>{(detection.confidence * 100).toFixed(1)}%</td>
            <td>{new Date(detection.video_timestamp_seconds * 1000).toISOString().slice(11, 19)}</td>
            <td>{job.latitude === null || job.longitude === null ? 'Location unavailable' : `${job.latitude.toFixed(5)}, ${job.longitude.toFixed(5)}`}</td>
            <td><StatusBadge label={detection.review_status} /></td>
            <td>{detection.review_status === 'Pending Review' ? <div className="detection-review-actions">
              <select aria-label={`Severity for ${detection.class_name}`} className="form-input" onChange={(event) => setSeverity(event.target.value as RoadDefect['severity'])} value={severity}><option>High</option><option>Medium</option><option>Low</option></select>
              <Button disabled={Boolean(reviewingId)} onClick={() => void reviewDetection(detection, 'confirm')} variant="primary">Confirm report</Button>
              <Button disabled={Boolean(reviewingId)} onClick={() => void reviewDetection(detection, 'reject')} variant="secondary">Reject</Button>
            </div> : detection.defect_id ? <Link to={`/defects/${detection.defect_id}`}>Report created</Link> : 'Reviewed'}</td>
          </tr>)}
        </tbody></table></div> : job.status === 'Completed' ? <EmptyState icon={FileVideo2} title="No supported road damage detected" description="The configured model completed this video without producing any supported road-damage detections." /> : job.status !== 'Failed' && <EmptyState icon={FileVideo2} title="Processing video" description={`Video processing is ${job.progress}% complete. Results will appear here when frame analysis finishes.`} />}
      </Panel>}
      {!job && !error && !availabilityError && <EmptyState icon={FileVideo2} title="No video jobs yet" description="Upload a supported video when a compatible road-damage model is available. Location stays unavailable unless verified coordinates or a valid sidecar are provided." />}
    </>
  )
}

export function DefectMapPage() {
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'All' | DefectPriority>('All')
  const [selected, setSelected] = useState<DefectReport | null>(null)
  const [liveReports, setLiveReports] = useState<DefectReport[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [newDefect, setNewDefect] = useState({ defect_type: '', description: '', severity: 'Medium' as DefectPriority, latitude: '', longitude: '' })
  useEffect(() => {
    let active = true
    operationsApi.defects(100).then((response) => {
      if (active) setLiveReports(response.items.map(toDefectReport))
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load road defects.')
    })
    return () => { active = false }
  }, [])
  const reports = liveReports ?? demoDefects
  const filteredReports = useMemo(() => reports.filter((report) => {
    const matchesText = `${report.id} ${report.type} ${report.district}`.toLowerCase().includes(search.toLowerCase())
    return matchesText && (priority === 'All' || report.priority === priority)
  }), [reports, search, priority])

  async function createDefect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setCreateError('')
    if (Boolean(newDefect.latitude) !== Boolean(newDefect.longitude)) {
      setCreateError('Enter both GPS coordinates, or leave both blank.')
      setSaving(false)
      return
    }
    try {
      const created = await operationsApi.createDefect({
        defect_type: newDefect.defect_type,
        description: newDefect.description || undefined,
        severity: newDefect.severity,
        confidence: 100,
        ...(newDefect.latitude ? { latitude: Number(newDefect.latitude), longitude: Number(newDefect.longitude) } : {}),
      })
      setLiveReports((current) => [toDefectReport(created), ...(current ?? [])])
      setLoadError('')
      setNewDefect({ defect_type: '', description: '', severity: 'Medium', latitude: '', longitude: '' })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'The defect could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeading actions={liveReports ? <span className="table-count">LIVE RECORDS</span> : <DemoTag>DEMO REPORTS</DemoTag>} description="Explore road-defect records and their recorded coordinates." eyebrow="ROAD OPERATIONS / GEOSPATIAL VIEW" title="Road defect map" />
      {loadError && <div className="notice-banner notice-banner-amber" role="alert"><MapPin size={17} /><p><strong>Live defect records unavailable.</strong> {loadError} The table below uses labelled demo records.</p></div>}
      <Panel className="map-tools-panel">
        <div className="map-filter-row">
          <label className="filter-search"><Search size={16} /><input aria-label="Search map reports" onChange={(event) => setSearch(event.target.value)} placeholder="Search report, defect or district" value={search} /></label>
          <label className="filter-select-wrap"><Filter size={15} /><span>Priority</span><select aria-label="Filter by priority" onChange={(event) => setPriority(event.target.value as 'All' | DefectPriority)} value={priority}><option>All</option><option>High</option><option>Medium</option><option>Low</option></select></label>
          <span className="map-result-count">{filteredReports.length} {liveReports ? 'live' : 'demo'} reports · {filteredReports.filter((report) => report.coordinates).length} with GPS</span>
        </div>
        <details className="create-record-panel"><summary>Report a road defect</summary><form className="create-record-form" onSubmit={(event) => void createDefect(event)}>
          <label>Defect type<input required maxLength={120} onChange={(event) => setNewDefect({ ...newDefect, defect_type: event.target.value })} value={newDefect.defect_type} /></label>
          <label>Severity<select onChange={(event) => setNewDefect({ ...newDefect, severity: event.target.value as DefectPriority })} value={newDefect.severity}><option>High</option><option>Medium</option><option>Low</option></select></label>
          <label>Description<input maxLength={4000} onChange={(event) => setNewDefect({ ...newDefect, description: event.target.value })} value={newDefect.description} /></label>
          <label>Latitude<input inputMode="decimal" onChange={(event) => setNewDefect({ ...newDefect, latitude: event.target.value })} value={newDefect.latitude} /></label>
          <label>Longitude<input inputMode="decimal" onChange={(event) => setNewDefect({ ...newDefect, longitude: event.target.value })} value={newDefect.longitude} /></label>
          <Button disabled={saving} type="submit" variant="primary">{saving ? 'Saving…' : 'Save report'}</Button>
          {createError && <p className="field-error" role="alert">{createError}</p>}
        </form></details>
      </Panel>
      <div className="defect-map-layout">
        <Panel className="interactive-map-panel" title="Global map view" subtitle="OpenStreetMap · neutral world view until geolocated reports are available">
          <MapView onSelect={setSelected} reports={filteredReports} />
          <div className="map-legend"><span><i className="legend-dot legend-red" />High priority</span><span><i className="legend-dot legend-amber" />Medium priority</span><span><i className="legend-dot legend-blue" />Low priority</span><span className="map-legend-note">Markers require report GPS</span></div>
        </Panel>
        <Panel className="map-detail-panel" title={selected ? selected.id : 'Report details'} subtitle={selected ? selected.demo ? 'DEMO RECORD' : 'LIVE RECORD' : 'Select a geolocated marker to inspect its report'}>
          {selected ? <div className="selected-map-detail"><div className="detail-title-row"><strong>{selected.type}</strong><StatusBadge label={selected.priority} /></div><p>{selected.district}</p><dl><div><dt>GPS coordinates</dt><dd>{selected.coordinates ? `${selected.coordinates.latitude}, ${selected.coordinates.longitude}` : 'Not provided'}</dd></div><div><dt>Observed</dt><dd>{selected.observedAt}</dd></div><div><dt>Status</dt><dd><StatusBadge label={selected.status} /></dd></div></dl><Link className="panel-link" to={`/defects/${selected.id}`}>Open report <ArrowRight size={14} /></Link></div> : <EmptyState icon={MapPinned} title="No geolocated reports" description="Reports without GPS remain visible in the records list, but are not placed on the map." />}
        </Panel>
      </div>
      <Panel className="table-panel map-reports-panel" subtitle={liveReports ? 'Persisted reports from the authenticated API' : 'Sample reports shown while the API is unavailable'} title="Filtered reports" action={liveReports ? undefined : <DemoTag />}>
        <div className="table-scroll"><table><thead><tr><th>REPORT</th><th>DEFECT</th><th>PRIORITY</th><th>LOCATION</th><th>GPS</th><th>STATUS</th></tr></thead><tbody>
          {filteredReports.map((report) => <tr key={report.id} onClick={() => setSelected(report)}><td><button className="table-id table-id-button" type="button">{report.id}{report.demo && <span className="inline-demo">DEMO</span>}</button></td><td className="table-primary">{report.type}</td><td><StatusBadge label={report.priority} /></td><td className="muted-cell">{report.district}</td><td className="muted-cell">{report.coordinates ? 'Available' : 'Not provided'}</td><td><StatusBadge label={report.status} /></td></tr>)}
        </tbody></table></div>
        {filteredReports.length === 0 && <EmptyState icon={Search} title="No matching reports" description="Try another report ID, defect type, district, or priority." />}
      </Panel>
    </>
  )
}

export function DefectDetailsPage() {
  const { defectId = '' } = useParams()
  const isPersistedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(defectId)
  const [liveDefect, setLiveDefect] = useState<RoadDefect | null>(null)
  const [loading, setLoading] = useState(isPersistedId)
  const [actionError, setActionError] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [teams, setTeams] = useState<{ id: string; display_name: string }[]>([])
  const [selectedTeam, setSelectedTeam] = useState('')
  const [saving, setSaving] = useState(false)
  const defect = liveDefect ? toDefectReport(liveDefect) : demoDefects.find((report) => report.id === defectId)
  const { confirm, notify } = useAppActions()

  useEffect(() => {
    setLiveDefect(null)
    setActionError('')
    setLoading(isPersistedId)
    if (!isPersistedId) return
    let active = true
    operationsApi.defect(defectId).then((record) => {
      if (active) setLiveDefect(record)
    }).catch((error: unknown) => {
      if (active) setActionError(error instanceof Error ? error.message : 'Could not load this defect.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [defectId, isPersistedId])

  if (loading) return <Panel><div className="users-loading"><span className="loading-indicator" />Loading defect report…</div></Panel>
  if (!defect) return <MissingReport title={isPersistedId ? 'Could not load defect report' : 'Defect report not found'} description={actionError || 'This report may have been removed or is not part of the demo records.'} />

  function askForAction(action: 'verify' | 'assign') {
    if (!liveDefect) {
      notify('Sample reports are read-only. Load a persisted report to use this action.')
      return
    }
    setActionError('')
    if (action === 'assign') {
      setAssigning(true)
      operationsApi.maintenanceTeams().then((availableTeams) => {
        setTeams(availableTeams)
        if (availableTeams.length) setSelectedTeam(availableTeams[0].id)
      }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Could not load maintenance teams.'))
      return
    }
    confirm({
      title: 'Verify this road defect?',
      description: 'This saves the review status to the CityLens API.',
      confirmLabel: 'Verify report',
      onConfirm: () => {
        setSaving(true)
        void operationsApi.updateDefect(defectId, { status: 'Verified' }).then((updated) => {
          setLiveDefect(updated)
          notify('Road defect marked verified.')
        }).catch((error: unknown) => {
          setActionError(error instanceof Error ? error.message : 'Could not update this defect.')
        }).finally(() => setSaving(false))
      },
    })
  }

  async function assignRepair() {
    if (!selectedTeam) return
    setSaving(true)
    setActionError('')
    try {
      await operationsApi.createRepair(defectId, selectedTeam)
      setLiveDefect(await operationsApi.defect(defectId))
      setAssigning(false)
      notify('Repair assignment saved.')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not assign this repair.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="back-link-row"><Link to="/map"><ArrowLeft size={15} /> Back to defect map</Link>{liveDefect ? <span className="table-count">LIVE RECORD</span> : <DemoTag />}</div>
      <PageHeading actions={<><Button disabled={saving || !liveDefect} icon={ShieldCheck} onClick={() => askForAction('verify')} variant="secondary">Review report</Button><Button disabled={saving || !liveDefect} icon={CheckCircle2} onClick={() => askForAction('assign')} variant="primary">Assign maintenance</Button></>} description="Road inspection record and available evidence." eyebrow={`ROAD DEFECTS / ${defect.id}`} title={defect.type} />
      {actionError && <div className="notice-banner notice-banner-amber" role="alert"><MapPin size={17} /><p>{actionError}</p></div>}
      {assigning && <Panel title="Assign a maintenance team" subtitle="Only active maintenance teams are listed"><div className="create-record-form"><label>Maintenance team<select onChange={(event) => setSelectedTeam(event.target.value)} value={selectedTeam}><option value="">Choose a team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.display_name}</option>)}</select></label><Button disabled={saving || !selectedTeam} onClick={() => void assignRepair()} variant="primary">{saving ? 'Saving…' : 'Create assignment'}</Button>{teams.length === 0 && <EmptyState title="No active teams" description="Create or activate a Maintenance Team user before assigning this repair." />}</div></Panel>}
      <div className="detail-grid">
        <div className="detail-main-column">
          <Panel title="Evidence" subtitle="Original media attached to this report">
            <div className="evidence-placeholder"><span><Video size={26} /></span><strong>No evidence media attached</strong><p>This demo record does not include an uploaded image or video.</p></div>
          </Panel>
          <Panel className="history-panel" title="Observation history" subtitle="Demo event log">
            <div className="timeline"><div className="timeline-entry"><span className="timeline-node timeline-node-blue" /><div><strong>Report created</strong><p>Camera footage observation · {defect.observedAt}</p></div><time>{defect.observedAt}</time></div><div className="timeline-entry"><span className="timeline-node timeline-node-slate" /><div><strong>GPS metadata unavailable</strong><p>No coordinates were attached to this demo report.</p></div><time>System</time></div></div>
          </Panel>
        </div>
        <div className="detail-side-column">
          <Panel title="Report summary" subtitle="DEMO RECORD">
            <dl className="summary-list"><div><dt>Report ID</dt><dd>{defect.id}</dd></div><div><dt>Defect type</dt><dd>{defect.type}</dd></div><div><dt>Priority</dt><dd><StatusBadge label={defect.priority} /></dd></div><div><dt>Model confidence</dt><dd>{defect.confidence}% <span className="muted-cell">· demo only</span></dd></div><div><dt>Observed</dt><dd>{defect.observedAt}</dd></div><div><dt>District</dt><dd>{defect.district}</dd></div><div><dt>GPS coordinates</dt><dd className="gps-unavailable"><MapPin size={14} /> Not provided</dd></div><div><dt>Verification</dt><dd><StatusBadge label={defect.status} /></dd></div><div><dt>Assigned team</dt><dd>{defect.assignedTo ?? 'Unassigned'}</dd></div></dl>
          </Panel>
          <Panel className="detail-note-panel"><div className="notice-inline"><MapPin size={16} /><p>Location is intentionally blank. CityLens never infers GPS from a district name.</p></div></Panel>
        </div>
      </div>
    </>
  )
}

function MissingReport({ title, description }: { title: string; description: string }) {
  return <Panel><EmptyState icon={X} title={title} description={description} action={<Link className="button button-secondary" to="/map"><ArrowLeft size={15} /> Return to map</Link>} /></Panel>
}