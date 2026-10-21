import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileImage,
  FileVideo2,
  Filter,
  Image as ImageIcon,
  Images,
  MapPin,
  MapPinned,
  RefreshCw,
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
  ApiError,
  apiUrl,
  operationsApi,
  roadDetectionApi,
  type RoadDefect,
  type RoadDetection,
  type RoadDetectionAvailability,
  type RoadDetectionJob,
  type EvidenceRecord,
} from '../services/api'
import { geolocationErrorMessage, parseCoordinatePair, parseGpsSidecar } from '../services/location'

const MAX_VIDEO_SIZE = 500 * 1024 * 1024
const MAX_IMAGE_SIZE = 25 * 1024 * 1024
const MAX_SIDECAR_SIZE = 64 * 1024
const allowedExtensions = ['.mp4', '.mov']
const allowedImageTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
type GalleryFilter = 'All' | 'Videos' | 'Road Damage Photos' | 'AI Analysis'

interface GalleryPhotoItem {
  id: string
  title: string
  src: string
  description: string
  demo: boolean
  credit?: string
  sourceUrl?: string
}

const demoRoadPhotos: GalleryPhotoItem[] = [
  {
    id: 'demo-pothole',
    title: 'Pothole road surface',
    src: '/assets/demo/pothole-photo.jpg',
    description: 'Licensed public sample · not a CityLens upload',
    demo: true,
    credit: 'Роман Рябенко · CC0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:A_pothole_in_Dilova_Street_in_Kyiv.jpg',
  },
  {
    id: 'demo-cracked-asphalt',
    title: 'Cracked asphalt road',
    src: '/assets/demo/cracked-road-photo.jpg',
    description: 'Licensed public sample · not a CityLens upload',
    demo: true,
    credit: 'Mnalis · CC BY-SA 4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Old_cracked_asphalt_road,_Mu%C5%BEilov%C4%8Dica.jpg',
  },
  {
    id: 'demo-surface-wear',
    title: 'Damaged road surface',
    src: '/assets/demo/surface-damage-photo.jpg',
    description: 'Licensed public sample · not a CityLens upload',
    demo: true,
    credit: 'Goestratal! · CC BY-SA 4.0',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Stra%C3%9Fensch%C3%A4den_viele_Schlagl%C3%B6cher,_katastrophaler_Asphaltbelag_(2024-08-11)_05.jpg',
  },
]

const demoVideo = {
  title: 'Vehicles crossing a pothole · demo clip',
  src: '/assets/demo/road-monitoring-demo.webm',
  poster: '/assets/demo/road-monitoring-poster.jpg',
  description: 'Publicly licensed example footage. It is not your city’s camera footage and has no CityLens AI analysis.',
  credit: 'Amuzujoe · CC BY-SA 4.0',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cars_Moving_into_pothole.webm',
}

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
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [job, setJob] = useState<RoadDetectionJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<RoadDetectionJob[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [locationVerified, setLocationVerified] = useState(false)
  const [gpsSidecar, setGpsSidecar] = useState<File | null>(null)
  const [sidecarCoordinates, setSidecarCoordinates] = useState<{ latitude: number; longitude: number } | null>(null)
  const [sidecarError, setSidecarError] = useState('')
  const [sidecarLoading, setSidecarLoading] = useState(false)
  const [locationOrigin, setLocationOrigin] = useState<'device' | 'manual' | null>(null)
  const [locationMessage, setLocationMessage] = useState('')
  const [locationError, setLocationError] = useState('')
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)
  const [detectingLocation, setDetectingLocation] = useState(false)
  const locationEditVersion = useRef(0)
  const [severity, setSeverity] = useState<RoadDefect['severity']>('Medium')
  const [reviewingId, setReviewingId] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [galleryFilter, setGalleryFilter] = useState<GalleryFilter>('All')
  const [photos, setPhotos] = useState<EvidenceRecord[]>([])
  const [photosLoading, setPhotosLoading] = useState(true)
  const [photosError, setPhotosError] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [photoSuccess, setPhotoSuccess] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoProgress, setPhotoProgress] = useState(0)
  const [previewPhoto, setPreviewPhoto] = useState<GalleryPhotoItem | null>(null)
  const [demoVideoError, setDemoVideoError] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const sidecarInput = useRef<HTMLInputElement>(null)
  const { notify } = useAppActions()

  async function loadGalleryImages() {
    setPhotosLoading(true)
    setPhotosError('')
    try {
      const result = await operationsApi.imageEvidence()
      setPhotos(result.items)
    } catch (loadError) {
      setPhotosError(loadError instanceof Error ? loadError.message : 'Could not load saved road photos.')
    } finally {
      setPhotosLoading(false)
    }
  }

  async function loadDetectionAvailability() {
    setAvailabilityLoading(true)
    setAvailabilityError('')
    try {
      setAvailability(await roadDetectionApi.availability())
    } catch (availabilityLoadError) {
      setAvailability(null)
      setAvailabilityError(
        availabilityLoadError instanceof Error
          ? availabilityLoadError.message
          : 'Could not check video detection availability.',
      )
    } finally {
      setAvailabilityLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadDetectionAvailability()
    roadDetectionApi.jobs().then(async (result) => {
      if (!active || result.items.length === 0) return
      setRecentJobs(result.items)
      const latest = await roadDetectionApi.job(result.items[0].id)
      if (active) setJob(latest)
    }).catch((jobsLoadError: unknown) => {
      if (active) setError(jobsLoadError instanceof Error ? jobsLoadError.message : 'Could not load recent video jobs.')
    })
    void loadGalleryImages()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!previewPhoto) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewPhoto(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [previewPhoto])

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
    setSidecarError('')
    setLocationVerified(false)
    setLocationMessage('')
    setLocationError('')
    setLocationAccuracy(null)
    setLocationOrigin(null)
    const sidecarVersion = ++locationEditVersion.current
    setGpsSidecar(null)
    setSidecarCoordinates(null)
    setSidecarLoading(false)
    if (!selected) {
      return
    }
    if (!selected.name.toLowerCase().endsWith('.json') || selected.size > MAX_SIDECAR_SIZE) {
      setGpsSidecar(null)
      setSidecarCoordinates(null)
      setSidecarError('Choose a JSON GPS sidecar no larger than 64 KB.')
      event.target.value = ''
      return
    }
    if (!['application/json', 'text/json'].includes(selected.type)) {
      setGpsSidecar(null)
      setSidecarCoordinates(null)
      setSidecarError('The backend requires the GPS sidecar to use the JSON file type.')
      event.target.value = ''
      return
    }
    if (latitude.trim() || longitude.trim()) {
      setGpsSidecar(null)
      setSidecarCoordinates(null)
      setSidecarError('Use either footage coordinates or a GPS sidecar, not both.')
      event.target.value = ''
      return
    }
    setSidecarLoading(true)
    void selected.text().then((contents) => {
      const coordinates = parseGpsSidecar(contents)
      if (sidecarVersion !== locationEditVersion.current) return
      setGpsSidecar(selected)
      setSidecarCoordinates(coordinates)
    }).catch((sidecarLoadError: unknown) => {
      if (sidecarVersion !== locationEditVersion.current) return
      setGpsSidecar(null)
      setSidecarCoordinates(null)
      setSidecarError(sidecarLoadError instanceof Error ? sidecarLoadError.message : 'Could not read the GPS sidecar.')
      event.target.value = ''
    }).finally(() => {
      if (sidecarVersion === locationEditVersion.current) setSidecarLoading(false)
    })
  }

  function clearSidecar() {
    locationEditVersion.current += 1
    setGpsSidecar(null)
    setSidecarCoordinates(null)
    setSidecarError('')
    setSidecarLoading(false)
    setLocationVerified(false)
    if (sidecarInput.current) sidecarInput.current.value = ''
  }

  function updateFootageCoordinate(field: 'latitude' | 'longitude', value: string) {
    locationEditVersion.current += 1
    if (field === 'latitude') setLatitude(value)
    else setLongitude(value)
    const otherCoordinate = field === 'latitude' ? longitude.trim() : latitude.trim()
    setLocationOrigin(value.trim() || otherCoordinate ? 'manual' : null)
    setLocationVerified(false)
    setLocationAccuracy(null)
    setLocationMessage('')
    setLocationError('')
  }

  function detectDeviceLocation() {
    setLocationError('')
    setLocationMessage('')
    setLocationAccuracy(null)
    if (gpsSidecar) {
      setLocationError('Remove the GPS sidecar before detecting or entering coordinates.')
      return
    }
    if (locationOrigin === 'device') {
      setLatitude('')
      setLongitude('')
      setLocationOrigin(null)
      setLocationVerified(false)
    }
    if (!window.isSecureContext) {
      setLocationError('Browser location requires a secure HTTPS connection. Use HTTPS or localhost, then retry.')
      return
    }
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location detection. Enter the footage coordinates manually.')
      return
    }

    const requestVersion = ++locationEditVersion.current
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDetectingLocation(false)
        if (requestVersion !== locationEditVersion.current) {
          setLocationMessage('Manual edits made during detection were kept. Retry if you want to use the device location.')
          return
        }
        setLatitude(position.coords.latitude.toFixed(6))
        setLongitude(position.coords.longitude.toFixed(6))
        setLocationOrigin('device')
        setLocationVerified(false)
        setLocationAccuracy(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null)
        setLocationMessage('Location detected successfully. This is your device’s current location, not necessarily where the video was recorded.')
      },
      (geolocationError) => {
        setDetectingLocation(false)
        if (requestVersion !== locationEditVersion.current) {
          setLocationMessage('Manual edits made during detection were kept.')
          return
        }
        if (locationOrigin === 'device') {
          setLatitude('')
          setLongitude('')
          setLocationOrigin(null)
          setLocationVerified(false)
        }
        setLocationError(geolocationErrorMessage(geolocationError.code))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    setPhotoError('')
    setPhotoSuccess('')
    if (!selected) return
    const extension = `.${selected.name.split('.').pop()?.toLowerCase() ?? ''}`
    const expectedType = allowedImageTypes[extension]
    if (!expectedType || selected.type !== expectedType) {
      setPhotoError('Choose a JPEG, PNG, or WebP photo with a matching file type.')
      return
    }
    if (selected.size > MAX_IMAGE_SIZE) {
      setPhotoError('This photo exceeds the configured 25 MB upload limit.')
      return
    }
    setPhotoUploading(true)
    setPhotoProgress(0)
    try {
      const saved = await operationsApi.uploadEvidence(selected, undefined, setPhotoProgress)
      setPhotos((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      setPhotoSuccess(`${saved.original_filename} was saved to private road evidence storage.`)
      notify('Road photo uploaded successfully.')
    } catch (uploadError) {
      setPhotoError(uploadError instanceof Error ? uploadError.message : 'The road photo could not be uploaded.')
    } finally {
      setPhotoUploading(false)
    }
  }

  async function requestProcessing() {
    if (!file) return
    setError('')
    setReviewError('')
    const coordinateResult = parseCoordinatePair(latitude, longitude)
    if ('error' in coordinateResult) {
      setError(coordinateResult.error)
      return
    }
    if (gpsSidecar && coordinateResult.coordinates) {
      setError('Use either footage coordinates or a GPS sidecar, not both.')
      return
    }
    if ((coordinateResult.coordinates || gpsSidecar) && !locationVerified) {
      setError('Confirm that the coordinates match where this footage was captured before uploading.')
      return
    }
    if (!coordinateResult.coordinates && !gpsSidecar && locationVerified) {
      setError('Enter footage coordinates or select a GPS sidecar before confirming the location.')
      return
    }
    setUploading(true)
    setUploadProgress(0)
    try {
      const created = await roadDetectionApi.upload(file, {
        latitude: coordinateResult.coordinates?.latitude,
        longitude: coordinateResult.coordinates?.longitude,
        locationVerified,
        gpsSidecar: gpsSidecar ?? undefined,
      }, setUploadProgress)
      setJob(created)
      setRecentJobs((current) => [created, ...current.filter((item) => item.id !== created.id)].slice(0, 10))
      notify('Video upload accepted. Processing status is available below.')
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Video upload failed.'
      setError(message)
      if (uploadError instanceof ApiError && uploadError.status === 503) {
        setAvailability({
          available: false,
          message,
          classes: [],
        })
      }
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
  const manualCoordinates = parseCoordinatePair(latitude, longitude)
  const locationCoordinatesReady = 'coordinates' in manualCoordinates && manualCoordinates.coordinates !== null
  const footageLocationNeedsConfirmation = Boolean(locationCoordinatesReady || gpsSidecar)
  const locationValidationError = 'error' in manualCoordinates ? manualCoordinates.error : ''
  const canSubmitVideo = Boolean(
    file
    && availability?.available
    && !availabilityLoading
    && !uploading
    && !sidecarLoading
    && !sidecarError
    && !locationValidationError
    && (!footageLocationNeedsConfirmation || locationVerified),
  )
  return (
    <>
      <PageHeading
        description="Upload authorized camera footage for evidence-backed road-surface analysis."
        eyebrow="ROAD OPERATIONS / VIDEO INTAKE"
        title="Road damage monitoring"
      />
      <div className={`notice-banner ${availability?.available ? 'notice-banner-blue' : 'notice-banner-amber'}`}>
        <Video size={17} />
        <p><strong>{availabilityLoading ? 'Checking AI model availability.' : availability?.available ? 'Road-damage model ready.' : availabilityError ? 'Could not check AI model availability.' : 'AI detection unavailable.'}</strong>{' '}
          {availabilityLoading
            ? 'Checking the configured road-damage model…'
            : availabilityError || availability?.message || 'Configure the backend model before uploading video.'}</p>
        {!availabilityLoading && !availability?.available && (
          <Button disabled={availabilityLoading} icon={RefreshCw} onClick={() => void loadDetectionAvailability()} type="button" variant="secondary">
            Retry model check
          </Button>
        )}
      </div>
      {!availabilityLoading && !availability?.available && !availabilityError && (
        <Panel className="model-configuration-panel" subtitle="Video uploads are rejected by the API with HTTP 503 until this check succeeds. The application will not accept the video or create an analysis job without a compatible model." title="Enable real road-damage analysis">
          <ol>
            <li>Install the backend optional AI dependencies: <code>python -m pip install -e ".[ai]"</code> from the backend folder.</li>
            <li>Obtain and evaluate a road-damage model whose class names include a supported label: pothole, crack, longitudinal crack, transverse crack, alligator crack, rutting, D00, D10, D20, or D40.</li>
            <li>Set <code>ROAD_DAMAGE_MODEL_PATH</code> in the backend environment to the absolute path of that model file. Do not commit model weights to Git.</li>
            <li>Restart or redeploy the backend, then choose <strong>Retry model check</strong>. Submission enables only after the API confirms a compatible model is ready.</li>
          </ol>
          <p>For local setup, put <code>ROAD_DAMAGE_MODEL_PATH=absolute/path/to/your/model.pt</code> in the backend’s private <code>.env</code>. For Render, configure the variable on the backend service and ensure the model file is available at that path after every deploy. See the Road-damage video detection section in the project README for details.</p>
        </Panel>
      )}

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
          <div className="location-entry-heading">
            <div><strong>Video footage location</strong><span>Optional · choose device detection or enter the capture location manually</span></div>
            <Button disabled={detectingLocation || Boolean(gpsSidecar) || sidecarLoading} icon={MapPin} onClick={detectDeviceLocation} type="button" variant="primary">
              {detectingLocation ? 'Detecting location…' : 'Detect My Location'}
            </Button>
          </div>
          <p className="location-privacy-note">Location permission is requested by your browser. Device detection reports where this device is now—it may not be where the video was recorded. For earlier or remote footage, enter its verified capture coordinates instead. HTTPS or localhost is required.</p>
          <label className="field-label" htmlFor="road-latitude">Footage latitude (optional)</label>
          <input className="form-input" disabled={Boolean(gpsSidecar) || sidecarLoading} id="road-latitude" inputMode="decimal" max="90" min="-90" onChange={(event) => updateFootageCoordinate('latitude', event.target.value)} placeholder="Enter footage latitude" step="any" type="number" value={latitude} />
          <label className="field-label" htmlFor="road-longitude">Footage longitude (optional)</label>
          <input className="form-input" disabled={Boolean(gpsSidecar) || sidecarLoading} id="road-longitude" inputMode="decimal" max="180" min="-180" onChange={(event) => updateFootageCoordinate('longitude', event.target.value)} placeholder="Enter footage longitude" step="any" type="number" value={longitude} />
          {locationMessage && <p className="location-status" role="status"><CheckCircle2 size={16} />{locationMessage}{locationAccuracy !== null && <> Accuracy: about {Math.round(locationAccuracy)} m.</>}</p>}
          {locationError && <div className="location-error" role="alert"><p>{locationError}</p><Button disabled={detectingLocation || Boolean(gpsSidecar)} icon={RefreshCw} onClick={detectDeviceLocation} type="button" variant="secondary">Retry</Button></div>}
          <label className={`checkbox-label location-confirmation${locationOrigin === 'device' ? ' location-confirmation-device' : ''}`}>
            <input checked={locationVerified} disabled={!sidecarCoordinates && !locationCoordinatesReady} onChange={(event) => setLocationVerified(event.target.checked)} type="checkbox" />
            {gpsSidecar ? 'I confirm the GPS sidecar coordinates match where this footage was captured' : 'I confirm these coordinates match where this footage was captured'}
          </label>
          <label className="field-label" htmlFor="road-gps-sidecar">GPS sidecar (optional JSON)</label>
          <input accept=".json,application/json" disabled={Boolean(latitude.trim() || longitude.trim()) || sidecarLoading} id="road-gps-sidecar" onChange={selectSidecar} ref={sidecarInput} type="file" />
          <p className="location-help">Sidecar JSON must contain numeric <code>latitude</code> and <code>longitude</code> values. It is validated here and again by the backend (JSON file, maximum 64 KB).</p>
          {sidecarLoading && <div className="location-loading" role="status">Validating GPS sidecar…</div>}
          {sidecarCoordinates && gpsSidecar && <div className="sidecar-selected"><span><strong>{gpsSidecar.name}</strong><small>Coordinates: {sidecarCoordinates.latitude}, {sidecarCoordinates.longitude}</small></span><button onClick={clearSidecar} type="button">Remove</button></div>}
          {sidecarError && <p className="field-error" role="alert">{sidecarError}</p>}
          {uploading && <div aria-label={`Upload progress ${uploadProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={uploadProgress} className="upload-progress" role="progressbar"><span style={{ width: `${uploadProgress}%` }} /></div>}
          <div className="upload-actions"><Button disabled={!canSubmitVideo} icon={Upload} onClick={() => void requestProcessing()} variant="primary">{uploading ? `Uploading ${uploadProgress}%` : 'Submit for analysis'}</Button><span>{availabilityLoading ? 'Checking model availability…' : !availability?.available ? 'Configure a compatible model to enable upload' : !file ? 'Choose a video to continue' : locationValidationError || (footageLocationNeedsConfirmation && !locationVerified) ? 'Confirm valid footage coordinates or remove them' : 'Requires engineer authorization'}</span></div>
        </Panel>
        <Panel className="video-preview-panel" subtitle={file ? 'Local browser preview' : 'Preview appears after selecting a file'} title="Footage preview">
          {previewUrl ? <video className="road-video-preview" controls src={previewUrl}>Your browser does not support video preview.</video> : <div className="video-preview-empty"><span><FileVideo2 size={26} /></span><strong>No footage selected</strong><small>Choose a supported MP4 or MOV file to preview it.</small></div>}
        </Panel>
      </div>

      <Panel
        className="media-gallery-panel"
        subtitle="Licensed samples are clearly labeled and kept separate from CityLens uploads, saved evidence, and AI results."
        title="Demo Videos & Photos"
        action={<span className="gallery-count">{recentJobs.length} uploaded videos · {photos.length} uploaded photos · {demoRoadPhotos.length + 1} demo samples</span>}
      >
        <div aria-label="Filter road media" className="gallery-tabs" role="group">
          {(['All', 'Videos', 'Road Damage Photos', 'AI Analysis'] as const).map((filter) => (
            <button
              aria-pressed={galleryFilter === filter}
              className={galleryFilter === filter ? 'gallery-tab gallery-tab-active' : 'gallery-tab'}
              key={filter}
              onClick={() => setGalleryFilter(filter)}
              type="button"
            >
              {filter}
            </button>
          ))}
        </div>
        <input
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="visually-hidden"
          onChange={(event) => void uploadPhoto(event)}
          ref={photoInput}
          type="file"
        />
        {(galleryFilter === 'All' || galleryFilter === 'Road Damage Photos') && (
          <section aria-label="Road damage photos" className="gallery-section">
            <div className="gallery-section-heading">
              <div><h3>Road damage photos</h3><p>Uploaded photos stay separate from the licensed demo samples below.</p></div>
              <Button disabled={photoUploading} icon={Images} onClick={() => photoInput.current?.click()} variant="secondary">
                {photoUploading ? `Uploading ${photoProgress}%` : 'Upload Photos'}
              </Button>
            </div>
            {photoUploading && <div aria-label={`Photo upload progress ${photoProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={photoProgress} className="upload-progress gallery-progress" role="progressbar"><span style={{ width: `${photoProgress}%` }} /></div>}
            {photoError && <p className="field-error gallery-message" role="alert">{photoError}</p>}
            {photoSuccess && <p className="gallery-success" role="status"><CheckCircle2 size={15} />{photoSuccess}</p>}
            {photosError && <div className="gallery-load-error" role="alert"><p>{photosError}</p><Button icon={RefreshCw} onClick={() => void loadGalleryImages()} variant="secondary">Retry</Button></div>}
            {photosLoading ? <div className="gallery-loading" role="status">Loading saved photos…</div> : photos.length > 0 ? (
              <div className="photo-card-grid">
                {photos.map((photo) => (
                  <article className="photo-card" key={photo.id}>
                    <button aria-label={`Enlarge ${photo.original_filename}`} className="photo-preview-button" onClick={() => setPreviewPhoto({
                      id: photo.id,
                      title: photo.original_filename,
                      src: apiUrl(`/evidence/${photo.id}/preview`),
                      description: 'Private road evidence uploaded to CityLens',
                      demo: false,
                    })} type="button">
                      <img alt={photo.original_filename} crossOrigin="use-credentials" loading="lazy" src={apiUrl(`/evidence/${photo.id}/preview`)} />
                      <span className="photo-zoom-label"><ImageIcon size={15} /> Enlarge</span>
                    </button>
                    <div className="photo-card-copy"><strong title={photo.original_filename}>{photo.original_filename}</strong><span>{new Date(photo.created_at).toLocaleDateString()}</span></div>
                  </article>
                ))}
              </div>
            ) : !photosError && <EmptyState icon={FileImage} title="No road photos uploaded" description="Your uploaded road photos will appear here. Demo samples are shown separately below." />}
            <div className="gallery-sample-heading"><DemoTag>DEMO SAMPLE</DemoTag><p>Publicly licensed road photos; not uploaded CityLens evidence.</p></div>
            <div className="photo-card-grid">
              {demoRoadPhotos.map((photo) => (
                <article className="photo-card" key={photo.id}>
                  <button aria-label={`Enlarge demo sample: ${photo.title}`} className="photo-preview-button" onClick={() => setPreviewPhoto(photo)} type="button">
                    <img alt={`Demo sample photo: ${photo.title}`} loading="lazy" src={photo.src} />
                    <span className="photo-zoom-label"><ImageIcon size={15} /> Enlarge</span>
                  </button>
                  <div className="photo-card-copy photo-card-copy-demo">
                    <strong title={photo.title}>{photo.title}</strong>
                    <DemoTag>Demo Sample</DemoTag>
                    <a className="gallery-credit" href={photo.sourceUrl} rel="noreferrer" target="_blank">{photo.credit} · Wikimedia Commons</a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {(galleryFilter === 'All' || galleryFilter === 'Videos') && (
          <section aria-label="Uploaded road videos" className="gallery-section">
            <div className="gallery-section-heading"><div><h3>Demo video</h3><p>A publicly licensed road clip to preview the video player. It is not your city's footage or AI analysis.</p></div></div>
            <div className="video-card-grid video-card-grid-samples">
              <article className="media-video-card">
                <video controls playsInline preload="metadata" poster={demoVideo.poster} src={demoVideo.src} onCanPlay={() => setDemoVideoError(false)} onError={() => setDemoVideoError(true)}>
                  Your browser does not support WebM video playback.
                </video>
                <div className="media-video-copy">
                  <div className="media-video-title-row"><h4 title={demoVideo.title}>{demoVideo.title}</h4><DemoTag>Demo Sample</DemoTag></div>
                  <p>{demoVideo.description}</p>
                  {demoVideoError && <p className="gallery-media-error" role="alert">This browser could not play the WebM clip. <a download href={demoVideo.src}>Download the demo video</a>.</p>}
                  <div className="media-video-meta"><a className="gallery-credit" href={demoVideo.sourceUrl} rel="noreferrer" target="_blank">{demoVideo.credit} · Wikimedia Commons</a><span>360p WebM</span></div>
                </div>
              </article>
            </div>
            <div className="gallery-section-heading gallery-uploaded-heading"><div><h3>Uploaded videos</h3><p>Playback uses the authenticated video saved for each processing job.</p></div></div>
            {recentJobs.length > 0 ? (
              <div className="video-card-grid">
                {recentJobs.map((item) => (
                  <article className="media-video-card" key={item.id}>
                    <video controls crossOrigin="use-credentials" preload="metadata" src={apiUrl(item.video_url)}>
                      Your browser does not support this video format.
                    </video>
                    <div className="media-video-copy">
                      <div className="media-video-title-row"><h4 title={item.original_filename}>{item.original_filename}</h4><StatusBadge label={item.status} /></div>
                      <p>{item.status_message || 'Uploaded for processing by the configured road-damage model.'}</p>
                      <div className="media-video-meta"><span>Duration unavailable</span><span>{new Date(item.created_at).toLocaleString()}</span></div>
                      <Button onClick={() => { setGalleryFilter('AI Analysis'); void selectJob(item.id) }} variant="secondary">View AI analysis</Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <EmptyState icon={FileVideo2} title="No uploaded videos" description="Real videos appear here only after an authenticated upload creates a processing job. The demo clip is not your own upload." />}
          </section>
        )}
        {galleryFilter === 'AI Analysis' && (
          <section aria-label="Actual AI analysis" className="gallery-section">
            <div className="gallery-section-heading"><div><h3>AI analysis</h3><p>Detection data and frame evidence returned by the configured model.</p></div>
              {recentJobs.length > 0 && <label className="gallery-job-select">Video job<select className="form-input" onChange={(event) => void selectJob(event.target.value)} value={job?.id ?? ''}>{recentJobs.map((item) => <option key={item.id} value={item.id}>{item.original_filename} · {item.status}</option>)}</select></label>}
            </div>
            {job ? (
              <div className="analysis-layout">
                <article className="analysis-source">
                  <video controls crossOrigin="use-credentials" preload="metadata" src={apiUrl(job.video_url)}>Your browser does not support this video format.</video>
                  <div className="analysis-source-copy"><strong>{job.original_filename}</strong><StatusBadge label={job.status} />{job.latitude !== null && job.longitude !== null && <span>Verified location: {job.latitude}, {job.longitude}</span>}</div>
                  {(job.status === 'Pending' || job.status === 'Processing') && <div aria-label={`Processing progress ${job.progress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={job.progress} className="upload-progress" role="progressbar"><span style={{ width: `${job.progress}%` }} /></div>}
                  {job.status === 'Failed' && <p className="field-error" role="alert">{job.status_message || 'Video processing failed.'}</p>}
                </article>
                <div className="analysis-detections">
                  {detections.length > 0 ? detections.map((detection) => (
                    <article className="analysis-detection-card" key={detection.id}>
                      {detection.evidence_url ? <img alt={`${detection.class_name} detected at ${detection.video_timestamp_seconds.toFixed(1)} seconds`} crossOrigin="use-credentials" loading="lazy" src={apiUrl(detection.evidence_url)} /> : <div className="analysis-frame-unavailable">Frame unavailable</div>}
                      <div><h4>{detection.class_name}</h4><p>{(detection.confidence * 100).toFixed(1)}% confidence · {new Date(detection.video_timestamp_seconds * 1000).toISOString().slice(11, 19)}</p><StatusBadge label={detection.review_status} /></div>
                    </article>
                  )) : job.status === 'Completed' ? <EmptyState icon={ImageIcon} title="No supported damage detections" description="The model completed this uploaded video and returned no supported road-damage detections." /> : <EmptyState icon={FileVideo2} title="Analysis not ready" description={job.status_message || 'Actual model results will appear here when processing completes.'} />}
                </div>
              </div>
            ) : <EmptyState icon={ImageIcon} title="No analysis available" description="Upload a video and let the configured model process it to see actual detections." />}
          </section>
        )}
      </Panel>

      {previewPhoto && <div className="gallery-modal-backdrop" onClick={() => setPreviewPhoto(null)}>
        <section aria-labelledby="gallery-preview-title" aria-modal="true" className="gallery-photo-modal" onClick={(event) => event.stopPropagation()} role="dialog">
          <div className="gallery-modal-heading"><h2 id="gallery-preview-title">{previewPhoto.title}</h2><button aria-label="Close photo preview" onClick={() => setPreviewPhoto(null)} type="button"><X size={18} /></button></div>
          {previewPhoto.demo && <p className="gallery-preview-note"><DemoTag>DEMO SAMPLE</DemoTag>{previewPhoto.description}<a className="gallery-credit" href={previewPhoto.sourceUrl} rel="noreferrer" target="_blank">{previewPhoto.credit} · Wikimedia Commons</a></p>}
          <img alt={previewPhoto.title} crossOrigin={previewPhoto.demo ? undefined : 'use-credentials'} src={previewPhoto.src} />
        </section>
      </div>}

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