import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MapPin, RefreshCw, Upload } from 'lucide-react'
import { Button, EmptyState, PageHeading, Panel, StatusBadge } from '../components/ui'
import {
  apiUrl,
  operationsApi,
  residentApi,
  type Page,
  type PublicDefect,
  type PublicReport,
} from '../services/api'

const photoLimit = 10 * 1024 * 1024
type ReportSeverity = PublicReport['severity']

export function ResidentPublicPage() {
  const [defects, setDefects] = useState<Page<PublicDefect> | null>(null)
  const [reports, setReports] = useState<Page<PublicReport> | null>(null)
  const [defectError, setDefectError] = useState('')
  const [reportError, setReportError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [defectType, setDefectType] = useState('Pothole')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<ReportSeverity>('Medium')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [editingReport, setEditingReport] = useState<PublicReport | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setDefectError('')
    setReportError('')
    try {
      const [publicDefects, ownReports] = await Promise.all([
        residentApi.defects(),
        residentApi.reports(),
      ])
      setDefects(publicDefects)
      setReports(ownReports)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Could not load road reports.'
      setDefectError(message)
      setReportError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function choosePhotos(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files)
    if (selected.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > photoLimit)) {
      setReportError('Use JPEG, PNG, or WebP photos no larger than 10 MB each.')
      setPhotos([])
      return
    }
    setReportError('')
    setPhotos(selected)
  }

  function beginEdit(report: PublicReport) {
    setEditingReport(report)
    setDescription(report.description ?? '')
    setSeverity(report.severity)
    setLatitude(report.latitude === null ? '' : String(report.latitude))
    setLongitude(report.longitude === null ? '' : String(report.longitude))
    setDefectType(report.defect_type)
    setPhotos([])
    setNotice('')
    setReportError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingReport(null)
    setDefectType('Pothole')
    setDescription('')
    setSeverity('Medium')
    setLatitude('')
    setLongitude('')
    setPhotos([])
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setReportError('')
    setNotice('')
    const lat = latitude.trim() ? Number(latitude) : undefined
    const lon = longitude.trim() ? Number(longitude) : undefined
    if ((lat === undefined) !== (lon === undefined)) {
      setReportError('Enter both latitude and longitude, or leave both empty.')
      setSaving(false)
      return
    }
    if ((lat !== undefined && (lat < -90 || lat > 90)) || (lon !== undefined && (lon < -180 || lon > 180))) {
      setReportError('Enter valid coordinates (latitude −90 to 90, longitude −180 to 180).')
      setSaving(false)
      return
    }
    try {
      const payload = {
        description: description.trim(),
        severity,
        ...(lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : {}),
      }
      const report = editingReport
        ? await residentApi.updateReport(editingReport.id, payload)
        : await residentApi.createReport({
            defect_type: defectType,
            ...payload,
          })
      let attachmentFailure = false
      if (photos.length) {
        for (const photo of photos) {
          try {
            await operationsApi.uploadEvidence(photo, report.id)
          } catch {
            attachmentFailure = true
            break
          }
        }
      }
      if (attachmentFailure) {
        setNotice('Your report was saved, but at least one photo could not be uploaded. Edit this report to retry adding the photos while it awaits review.')
      } else {
        setNotice(editingReport ? 'Your report details were updated.' : 'Your report was submitted for municipal review.')
      }
      resetForm()
      await load()
    } catch (submitError) {
      setReportError(submitError instanceof Error ? submitError.message : 'Your report could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  async function withdraw(report: PublicReport) {
    if (!window.confirm(`Withdraw your "${report.defect_type}" report? This can only be done before municipal review.`)) return
    setReportError('')
    try {
      await residentApi.withdrawReport(report.id)
      setNotice('Your report was withdrawn.')
      await load()
    } catch (withdrawError) {
      setReportError(withdrawError instanceof Error ? withdrawError.message : 'Your report could not be withdrawn.')
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="PUBLIC USER WORKSPACE"
        title="Road reports"
        description="Submit damage reports and track your own reports. Only reviewed, public road information is shared with you."
      />
      <Panel title={editingReport ? 'Edit your report' : 'Submit road damage'} subtitle="Location is optional; provide coordinates only when known. Reports are reviewed by municipal staff.">
        <form className="resident-report-form" onSubmit={(event) => void submitReport(event)}>
          {!editingReport && <>
            <label htmlFor="public-defect-type">Damage type</label>
            <select id="public-defect-type" onChange={(event) => setDefectType(event.target.value)} value={defectType}>
              <option>Pothole</option><option>Cracking</option><option>Surface damage</option><option>Other road damage</option>
            </select>
          </>}
          <label htmlFor="public-report-description">Description</label>
          <textarea id="public-report-description" maxLength={4000} onChange={(event) => setDescription(event.target.value)} required rows={3} value={description} />
          <label htmlFor="public-report-severity">Severity</label>
          <select id="public-report-severity" onChange={(event) => setSeverity(event.target.value as ReportSeverity)} value={severity}>
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
          <div className="resident-coordinate-fields">
            <div><label htmlFor="public-latitude">Latitude (optional)</label><input id="public-latitude" inputMode="decimal" onChange={(event) => setLatitude(event.target.value)} placeholder="e.g. 45.5019" value={latitude} /></div>
            <div><label htmlFor="public-longitude">Longitude (optional)</label><input id="public-longitude" inputMode="decimal" onChange={(event) => setLongitude(event.target.value)} placeholder="e.g. -73.5674" value={longitude} /></div>
          </div>
          {(!editingReport || editingReport.status === 'Reported') && <><label htmlFor="public-report-photos">Photographs (optional)</label><input accept="image/jpeg,image/png,image/webp" id="public-report-photos" multiple onChange={(event) => choosePhotos(event.target.files)} type="file" /><small className="resident-form-help"><Upload size={13} /> JPEG, PNG, or WebP; 10 MB maximum each.</small></>}
          {reportError && <p className="form-error" role="alert">{reportError}</p>}
          {notice && <p className="form-success" role="status">{notice}</p>}
          <div className="resident-form-actions">
            {editingReport && <Button onClick={resetForm} type="button">Cancel edit</Button>}
            <Button disabled={saving} icon={saving ? undefined : Upload} type="submit" variant="primary">{saving ? 'Saving report…' : editingReport ? 'Save changes' : 'Submit report'}</Button>
          </div>
        </form>
      </Panel>

      <Panel title="Your reports" subtitle={reports ? `${reports.total} report${reports.total === 1 ? '' : 's'} submitted` : 'Your reports and status updates are private to your account.'} action={<button aria-label="Refresh reports and statuses" className="icon-button" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={16} /></button>}>
        {loading ? <div className="route-loading"><span className="loading-indicator" />Loading your reports…</div>
          : reportError ? <div className="resident-error" role="alert"><p>{reportError}</p><button className="text-link" onClick={() => void load()} type="button">Try again</button></div>
            : reports?.items.length ? <div className="resident-defect-list">
              {reports.items.map((report) => {
                const canEdit = report.status === 'Reported'
                return <article className="resident-defect-card" key={report.id}>
                  <div className="resident-defect-main"><div><h3>{report.defect_type}</h3><p>{new Date(report.created_at).toLocaleString()}</p></div><StatusBadge label={report.status} /></div>
                  <p className="resident-report-text">{report.description}</p>
                  <div className="resident-defect-meta">
                    <span className={`resident-severity resident-severity-${report.severity.toLowerCase()}`}>{report.severity} severity</span>
                    <span><MapPin size={14} />{report.latitude === null || report.longitude === null ? 'Location unavailable' : `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`}</span>
                  </div>
                  {report.evidence_ids.length > 0 && <div className="resident-photo-links">{report.evidence_ids.map((evidenceId) => <a href={apiUrl(`/evidence/${encodeURIComponent(evidenceId)}/download`)} key={evidenceId} rel="noreferrer" target="_blank">View submitted photo</a>)}</div>}
                  {canEdit && <div className="resident-report-actions"><Button onClick={() => beginEdit(report)} type="button">Edit details</Button><Button onClick={() => void withdraw(report)} type="button" variant="danger">Withdraw</Button></div>}
                </article>
              })}
            </div>
              : <EmptyState icon={MapPin} title="No reports submitted" description="Your reports will appear here after you submit them." />}
      </Panel>
      <Panel title="Reviewed public road records" subtitle={defects ? `${defects.total} records published after staff review` : 'Published records are separate from your private submissions.'}>
        {loading ? <div className="route-loading"><span className="loading-indicator" />Loading reviewed public records…</div>
          : defectError ? <div className="resident-error" role="alert"><p>{defectError}</p><button className="text-link" onClick={() => void load()} type="button">Try again</button></div>
            : defects?.items.length ? <div className="resident-defect-list">
              {defects.items.map((defect) => <article className="resident-defect-card" key={defect.id}>
                <div className="resident-defect-main"><div><h3>{defect.defect_type}</h3><p>{new Date(defect.detected_at).toLocaleString()}</p></div><StatusBadge label={defect.status} /></div>
                <div className="resident-defect-meta"><span className={`resident-severity resident-severity-${defect.severity.toLowerCase()}`}>{defect.severity} severity</span><span><MapPin size={14} />{defect.latitude === null || defect.longitude === null ? 'Location unavailable' : `${defect.latitude.toFixed(5)}, ${defect.longitude.toFixed(5)}`}</span></div>
              </article>)}
            </div>
              : <EmptyState icon={MapPin} title="No reviewed road records yet" description="Only defects reviewed by municipal staff appear here." />}
      </Panel>
      <p className="resident-readonly-note">Public accounts cannot view private reports or staff dashboards. Report updates appear when you refresh this page.</p>
    </>
  )
}
