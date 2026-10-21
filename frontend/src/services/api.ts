import type { UserRole } from '../types'

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')

if (import.meta.env.PROD) {
  if (!configuredApiUrl) {
    throw new Error('VITE_API_URL must be set to the deployed HTTPS CityLens API.')
  }
  const configuredUrl = new URL(configuredApiUrl)
  if (
    configuredUrl.protocol !== 'https:'
    || configuredUrl.pathname.replace(/\/+$/, '') !== '/api/v1'
    || configuredUrl.username
    || configuredUrl.password
    || configuredUrl.search
    || configuredUrl.hash
  ) {
    throw new Error('VITE_API_URL must be an HTTPS backend URL ending exactly in /api/v1.')
  }
}

const API_ROOT = configuredApiUrl || '/api/v1'
const API_ORIGIN = configuredApiUrl ? new URL(configuredApiUrl).origin : ''

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (path.startsWith('/api/v1/')) return `${API_ORIGIN}${path}`
  return `${API_ROOT}${path}`
}

export interface AuthUser {
  id: string
  email: string
  display_name: string
  role: UserRole
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface PublicDefect {
  id: string
  defect_type: string
  severity: 'High' | 'Medium' | 'Low'
  latitude: number | null
  longitude: number | null
  detected_at: string
  status: DefectStatus
  created_at: string
}

export interface PublicReport {
  id: string
  defect_type: string
  description: string | null
  severity: 'High' | 'Medium' | 'Low'
  latitude: number | null
  longitude: number | null
  detected_at: string
  status: DefectStatus
  created_at: string
  evidence_ids: string[]
}

export interface CreateUserPayload {
  email: string
  display_name: string
  password: string
  role: UserRole
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type DefectStatus =
  | 'Reported'
  | 'Verified'
  | 'Assigned'
  | 'In Progress'
  | 'Awaiting Verification'
  | 'Closed'

export interface RoadDefect {
  id: string
  defect_type: string
  description: string | null
  severity: 'High' | 'Medium' | 'Low'
  confidence: number
  latitude: number | null
  longitude: number | null
  detected_at: string
  status: DefectStatus
  created_by: string
  created_at: string
}

export type RepairStatus = 'Assigned' | 'In Progress' | 'Awaiting Verification' | 'Closed'

export interface RepairAssignment {
  id: string
  defect_id: string
  assigned_team_id: string
  assigned_by: string
  status: RepairStatus
  notes: string | null
  assigned_at: string
  completed_at: string | null
}

export type IncidentReviewStatus =
  | 'Pending Review'
  | 'Under Review'
  | 'More Evidence Requested'
  | 'Reviewed'
  | 'Rejected'

export interface TrafficIncident {
  id: string
  incident_type: string
  description: string | null
  latitude: number | null
  longitude: number | null
  incident_timestamp: string
  review_status: IncidentReviewStatus
  assigned_controller_id: string | null
  created_at: string
}

export type PoliceAlertStatus = 'Authorized' | 'Acknowledged' | 'Investigating' | 'Closed'

export interface PoliceAlert {
  id: string
  incident_id: string
  authorized_by: string
  assigned_police_user_id: string
  alert_status: PoliceAlertStatus
  investigation_notes: string | null
  authorized_at: string
  acknowledged_at: string | null
}

export interface DashboardSummary {
  road_defects: number
  high_priority_defects: number
  pending_repairs: number
  open_incidents: number
}

export interface ActivityRecord {
  id: string
  actor_user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  created_at: string
}

export interface EvidenceRecord {
  id: string
  evidence_type: 'Image' | 'Video' | 'Document'
  original_filename: string
  content_type: string
  uploaded_by: string
  defect_id: string | null
  created_at: string
}

export interface RoadDetectionAvailability {
  available: boolean
  message: string
  classes: string[]
}

export interface RoadDetection {
  id: string
  job_id: string
  class_name: string
  confidence: number
  video_timestamp_seconds: number
  bounding_box: { x1: number; y1: number; x2: number; y2: number }
  evidence_id: string | null
  evidence_url: string | null
  review_status: 'Pending Review' | 'Confirmed' | 'Rejected'
  defect_id: string | null
  created_at: string
}

export interface RoadDetectionJob {
  id: string
  status: 'Pending' | 'Processing' | 'Completed' | 'Failed'
  progress: number
  status_message: string | null
  original_filename: string
  video_url: string
  latitude: number | null
  longitude: number | null
  location_source: 'sidecar' | 'user_verified' | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  detections?: RoadDetection[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null
  const messages = detail.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return []
    const record = issue as Record<string, unknown>
    if (typeof record.msg !== 'string') return []
    const location = Array.isArray(record.loc)
      ? record.loc.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').slice(1).join('.')
      : ''
    return [`${location ? `${location}: ` : ''}${record.msg}`]
  })
  return messages.length ? messages.join('; ') : null
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  expireOnUnauthorized = true,
): Promise<T> {
  let response: Response
  try {
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('The CityLens API could not be reached. Check that the backend is running.', 0)
  }

  if (response.status === 204) return undefined as T
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 401 && expireOnUnauthorized) {
      window.dispatchEvent(new Event('citylens:session-expired'))
    }
    const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? validationMessage(detail) ?? 'Please check the submitted fields and try again.'
        : `Request failed (${response.status}).`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

function xhrError(xhr: XMLHttpRequest): ApiError {
  const payload: unknown = xhr.response
  const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null
  const message = typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
      ? validationMessage(detail) ?? 'Please check the submitted fields and try again.'
      : `Request failed (${xhr.status}).`
  return new ApiError(message, xhr.status)
}

export const authApi = {
  login: (email: string, password: string) => apiRequest<AuthUser>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  ),
  me: () => apiRequest<AuthUser>('/auth/me', {}, false),
  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }, false),
  registerResident: (details: { email: string; display_name: string; password: string; confirm_password: string }) =>
    apiRequest<{ message: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(details),
    }, false),
  verifyResidentEmail: (token: string) =>
    apiRequest<{ message: string }>(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    }, false),
  requestPasswordReset: (email: string) =>
    apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }, false),
  resetPassword: (token: string, password: string, confirmPassword: string) =>
    apiRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
    }, false),
}

export const usersApi = {
  list: (filters: { limit?: number; offset?: number; search?: string; role?: UserRole; status?: 'all' | 'active' | 'inactive' | 'deleted' } = {}) => {
    const params = new URLSearchParams()
    params.set('limit', String(filters.limit ?? 20))
    params.set('offset', String(filters.offset ?? 0))
    if (filters.search) params.set('search', filters.search)
    if (filters.role) params.set('role', filters.role)
    if (filters.status) params.set('account_status', filters.status)
    return apiRequest<Page<AuthUser>>(`/auth/users?${params.toString()}`)
  },
  create: (user: CreateUserPayload) => apiRequest<AuthUser>('/auth/users', {
    method: 'POST',
    body: JSON.stringify(user),
  }),
  update: (userId: string, update: { email?: string; display_name?: string; role?: UserRole; is_active?: boolean }) => apiRequest<AuthUser>(
    `/auth/users/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(update) },
  ),
  delete: (userId: string) => apiRequest<void>(`/auth/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}

export const operationsApi = {
  dashboardSummary: () => apiRequest<DashboardSummary>('/dashboard/summary'),
  recentActivity: (limit = 10) => apiRequest<Page<ActivityRecord>>(`/dashboard/recent-activity?limit=${limit}`),
  defects: (limit = 100) => apiRequest<Page<RoadDefect>>(`/defects?limit=${limit}`),
  defectMap: () => apiRequest<RoadDefect[]>('/defects/map'),
  defect: (id: string) => apiRequest<RoadDefect>(`/defects/${encodeURIComponent(id)}`),
  createDefect: (defect: {
    defect_type: string
    description?: string
    severity: RoadDefect['severity']
    confidence: number
    latitude?: number
    longitude?: number
    detected_at?: string
  }) => apiRequest<RoadDefect>('/defects', { method: 'POST', body: JSON.stringify(defect) }),
  updateDefect: (id: string, update: Partial<Pick<RoadDefect, 'description' | 'severity' | 'confidence' | 'latitude' | 'longitude' | 'status'>>) =>
    apiRequest<RoadDefect>(`/defects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }),
  repairs: (limit = 100) => apiRequest<Page<RepairAssignment>>(`/repairs?limit=${limit}`),
  repair: (id: string) => apiRequest<RepairAssignment>(`/repairs/${encodeURIComponent(id)}`),
  maintenanceTeams: () => apiRequest<AuthUser[]>('/repairs/teams'),
  createRepair: (defect_id: string, assigned_team_id: string, notes?: string) =>
    apiRequest<RepairAssignment>('/repairs', { method: 'POST', body: JSON.stringify({ defect_id, assigned_team_id, notes }) }),
  updateRepair: (id: string, update: { status: RepairStatus; notes?: string }) =>
    apiRequest<RepairAssignment>(`/repairs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }),
  incidents: (limit = 100) => apiRequest<Page<TrafficIncident>>(`/incidents?limit=${limit}`),
  incident: (id: string) => apiRequest<TrafficIncident>(`/incidents/${encodeURIComponent(id)}`),
  createIncident: (incident: {
    incident_type: string
    description?: string
    latitude?: number
    longitude?: number
    incident_timestamp: string
  }) => apiRequest<TrafficIncident>('/incidents', { method: 'POST', body: JSON.stringify(incident) }),
  updateIncident: (id: string, update: { description?: string; review_status: IncidentReviewStatus }) =>
    apiRequest<TrafficIncident>(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }),
  alerts: (limit = 100) => apiRequest<Page<PoliceAlert>>(`/alerts?limit=${limit}`),
  policeTeams: () => apiRequest<AuthUser[]>('/alerts/police-teams'),
  createAlert: (incident_id: string, assigned_police_user_id: string) =>
    apiRequest<PoliceAlert>('/alerts', { method: 'POST', body: JSON.stringify({ incident_id, assigned_police_user_id }) }),
  updateAlert: (id: string, update: { alert_status?: PoliceAlertStatus; investigation_notes?: string | null }) =>
    apiRequest<PoliceAlert>(`/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) }),
  uploadEvidence: (file: File, defectId?: string, onProgress?: (progress: number) => void) => {
    const body = new FormData()
    body.append('file', file)
    if (defectId) body.append('defect_id', defectId)
    if (!onProgress) return apiRequest<EvidenceRecord>('/evidence/upload', { method: 'POST', body })
    return new Promise<EvidenceRecord>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', apiUrl('/evidence/upload'))
      xhr.withCredentials = true
      xhr.responseType = 'json'
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as EvidenceRecord)
          return
        }
        if (xhr.status === 401) window.dispatchEvent(new Event('citylens:session-expired'))
        reject(xhrError(xhr))
      }
      xhr.onerror = () => reject(new ApiError(
        'The CityLens API could not be reached. Check that the backend is running.',
        0,
      ))
      xhr.send(body)
    })
  },
  imageEvidence: (limit = 50, offset = 0) =>
    apiRequest<Page<EvidenceRecord>>(`/evidence/images?limit=${limit}&offset=${offset}`),
  evidence: (id: string) => apiRequest<EvidenceRecord>(`/evidence/${encodeURIComponent(id)}`),
}

export const residentApi = {
  defects: (limit = 50) => apiRequest<Page<PublicDefect>>(`/residents/defects?limit=${limit}`),
  reports: (limit = 20, offset = 0) => apiRequest<Page<PublicReport>>(`/residents/my/reports?limit=${limit}&offset=${offset}`),
  createReport: (report: {
    defect_type: string
    description: string
    severity: PublicReport['severity']
    latitude?: number
    longitude?: number
  }) => apiRequest<PublicReport>('/residents/my/reports', { method: 'POST', body: JSON.stringify(report) }),
  updateReport: (id: string, report: Partial<Pick<PublicReport, 'description' | 'severity' | 'latitude' | 'longitude'>>) =>
    apiRequest<PublicReport>(`/residents/my/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(report) }),
  withdrawReport: (id: string) =>
    apiRequest<PublicReport>(`/residents/my/reports/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),
}

export const roadDetectionApi = {
  availability: () => apiRequest<RoadDetectionAvailability>('/detection/availability'),
  jobs: (limit = 10) => apiRequest<Page<RoadDetectionJob>>(`/detection-jobs?limit=${limit}`),
  job: (id: string) => apiRequest<RoadDetectionJob>(`/detection-jobs/${encodeURIComponent(id)}`),
  upload: (
    file: File,
    options: {
      latitude?: number
      longitude?: number
      locationVerified: boolean
      gpsSidecar?: File
    },
    onProgress: (progress: number) => void,
  ) => new Promise<RoadDetectionJob>((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (options.latitude !== undefined && options.longitude !== undefined) {
      form.append('latitude', String(options.latitude))
      form.append('longitude', String(options.longitude))
      form.append('location_verified', String(options.locationVerified))
    }
    if (options.gpsSidecar) form.append('gps_sidecar', options.gpsSidecar)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl('/detection-jobs'))
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as RoadDetectionJob)
        return
      }
      if (xhr.status === 401) window.dispatchEvent(new Event('citylens:session-expired'))
      reject(xhrError(xhr))
    }
    xhr.onerror = () => reject(new ApiError(
      'The CityLens API could not be reached. Check that the backend is running.',
      0,
    ))
    xhr.send(form)
  }),
  confirm: (id: string, severity: RoadDefect['severity'], description?: string) =>
    apiRequest<{ detection: RoadDetection; defect: { id: string; defect_type: string; status: DefectStatus; confidence: number } }>(
      `/detections/${encodeURIComponent(id)}/confirm`,
      { method: 'POST', body: JSON.stringify({ severity, description }) },
    ),
  reject: (id: string) => apiRequest<RoadDetection>(
    `/detections/${encodeURIComponent(id)}/reject`,
    { method: 'POST' },
  ),
}