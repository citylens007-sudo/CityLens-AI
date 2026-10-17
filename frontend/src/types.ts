export type UserRole =
  | 'Admin'
  | 'Municipal Engineer'
  | 'Maintenance Team'
  | 'Traffic Controller'
  | 'Police Officer'
  | 'Public User'

export type DefectPriority = 'High' | 'Medium' | 'Low'
export type RepairStatus =
  | 'Reported'
  | 'Verified'
  | 'Assigned'
  | 'In Progress'
  | 'Awaiting Verification'
  | 'Closed'
  | 'Withdrawn'

export type AlertStatus =
  | 'Pending Review'
  | 'Authorized'
  | 'Sent'
  | 'Acknowledged'
  | 'Investigating'
  | 'Closed'

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface DefectReport {
  id: string
  type: string
  priority: DefectPriority
  confidence: number
  observedAt: string
  district: string
  coordinates?: Coordinates
  status: RepairStatus
  assignedTo: string | null
  demo?: boolean
}

export interface RepairTask {
  id: string
  defectId: string
  type: string
  district: string
  team: string
  status: RepairStatus
  progress: number
  dueDate: string
  demo: true
}

export interface TrafficIncident {
  id: string
  type: string
  priority: DefectPriority
  occurredAt: string
  district: string
  reviewStatus: string
  assignedTeam: string
  demo: true
}

export interface PoliceAlert {
  id: string
  incidentId: string
  type: string
  priority: DefectPriority
  status: AlertStatus
  assignedTeam: string
  updatedAt: string
  sent: boolean
  demo: true
}

export interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  active: boolean
  lastActive: string
  demo: true
}