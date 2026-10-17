import type {
  DefectReport,
  PoliceAlert,
  RepairTask,
  TrafficIncident,
  UserRecord,
} from '../types'

export const demoDefects: DefectReport[] = [
  {
    id: 'RD-2048',
    type: 'Pothole',
    priority: 'High',
    confidence: 94,
    observedAt: 'Today, 09:42',
    district: 'North District',
    status: 'Verified',
    assignedTo: 'Roads Team A',
    demo: true,
  },
  {
    id: 'RD-2047',
    type: 'Surface cracking',
    priority: 'Medium',
    confidence: 87,
    observedAt: 'Today, 09:18',
    district: 'Central District',
    status: 'In Progress',
    assignedTo: 'Roads Team C',
    demo: true,
  },
  {
    id: 'RD-2046',
    type: 'Uneven surface',
    priority: 'Low',
    confidence: 91,
    observedAt: 'Today, 08:56',
    district: 'West District',
    status: 'Reported',
    assignedTo: null,
    demo: true,
  },
  {
    id: 'RD-2045',
    type: 'Pothole',
    priority: 'High',
    confidence: 96,
    observedAt: 'Yesterday, 16:31',
    district: 'South District',
    status: 'Awaiting Verification',
    assignedTo: 'Roads Team B',
    demo: true,
  },
  {
    id: 'RD-2044',
    type: 'Road-edge damage',
    priority: 'Medium',
    confidence: 82,
    observedAt: 'Yesterday, 15:07',
    district: 'East District',
    status: 'Assigned',
    assignedTo: 'Roads Team A',
    demo: true,
  },
]

export const demoRepairs: RepairTask[] = [
  { id: 'MT-0816', defectId: 'RD-2047', type: 'Surface cracking', district: 'Central District', team: 'Roads Team C', status: 'In Progress', progress: 64, dueDate: 'Today', demo: true },
  { id: 'MT-0815', defectId: 'RD-2045', type: 'Pothole', district: 'South District', team: 'Roads Team B', status: 'Awaiting Verification', progress: 100, dueDate: 'Today', demo: true },
  { id: 'MT-0814', defectId: 'RD-2044', type: 'Road-edge damage', district: 'East District', team: 'Roads Team A', status: 'Assigned', progress: 0, dueDate: 'Oct 18', demo: true },
  { id: 'MT-0813', defectId: 'RD-2042', type: 'Pothole', district: 'North District', team: 'Roads Team A', status: 'Verified', progress: 0, dueDate: 'Oct 19', demo: true },
  { id: 'MT-0812', defectId: 'RD-2039', type: 'Uneven surface', district: 'West District', team: 'Roads Team D', status: 'Closed', progress: 100, dueDate: 'Oct 15', demo: true },
]

export const demoIncidents: TrafficIncident[] = [
  { id: 'TI-0318', type: 'Road obstruction', priority: 'High', occurredAt: 'Today, 10:06', district: 'Central District', reviewStatus: 'Awaiting controller review', assignedTeam: 'Traffic Desk 1', demo: true },
  { id: 'TI-0317', type: 'Vehicle collision', priority: 'High', occurredAt: 'Today, 09:51', district: 'East District', reviewStatus: 'Under review', assignedTeam: 'Traffic Desk 2', demo: true },
  { id: 'TI-0316', type: 'Traffic congestion', priority: 'Medium', occurredAt: 'Today, 09:24', district: 'North District', reviewStatus: 'More evidence requested', assignedTeam: 'Traffic Desk 1', demo: true },
  { id: 'TI-0315', type: 'Road obstruction', priority: 'Low', occurredAt: 'Yesterday, 17:43', district: 'West District', reviewStatus: 'Reviewed', assignedTeam: 'Traffic Desk 3', demo: true },
]

export const demoAlerts: PoliceAlert[] = [
  { id: 'PA-0108', incidentId: 'TI-0317', type: 'Vehicle collision', priority: 'High', status: 'Acknowledged', assignedTeam: 'Central Response', updatedAt: 'Today, 10:11', sent: false, demo: true },
  { id: 'PA-0107', incidentId: 'TI-0314', type: 'Road obstruction', priority: 'Medium', status: 'Authorized', assignedTeam: 'East Response', updatedAt: 'Today, 09:37', sent: false, demo: true },
  { id: 'PA-0106', incidentId: 'TI-0311', type: 'Vehicle collision', priority: 'High', status: 'Investigating', assignedTeam: 'North Response', updatedAt: 'Yesterday, 16:20', sent: false, demo: true },
  { id: 'PA-0105', incidentId: 'TI-0308', type: 'Road obstruction', priority: 'Low', status: 'Closed', assignedTeam: 'West Response', updatedAt: 'Yesterday, 13:06', sent: false, demo: true },
]

export const demoUsers: UserRecord[] = [
  { id: 'USR-001', name: 'Avery Johnson', email: 'avery.johnson@city.gov', role: 'Admin', active: true, lastActive: 'Now', demo: true },
  { id: 'USR-002', name: 'Morgan Lee', email: 'morgan.lee@city.gov', role: 'Municipal Engineer', active: true, lastActive: '12 min ago', demo: true },
  { id: 'USR-003', name: 'Jordan Patel', email: 'jordan.patel@city.gov', role: 'Maintenance Team', active: true, lastActive: '38 min ago', demo: true },
  { id: 'USR-004', name: 'Riley Chen', email: 'riley.chen@city.gov', role: 'Traffic Controller', active: true, lastActive: '1 hr ago', demo: true },
  { id: 'USR-005', name: 'Taylor Brooks', email: 'taylor.brooks@city.gov', role: 'Police Officer', active: false, lastActive: 'Oct 14, 2026', demo: true },
]

export const categoryChartData = [
  { name: 'Potholes', value: 48, color: '#3478f6' },
  { name: 'Cracking', value: 31, color: '#55b5db' },
  { name: 'Uneven surface', value: 22, color: '#f5a64a' },
  { name: 'Road edge', value: 17, color: '#8a78db' },
]

export const repairChartData = [
  { name: 'Reported', value: 14 },
  { name: 'Verified', value: 21 },
  { name: 'Assigned', value: 16 },
  { name: 'In progress', value: 28 },
  { name: 'Awaiting review', value: 11 },
  { name: 'Closed', value: 37 },
]

export const trendChartData = [
  { day: 'Oct 10', defects: 18, repairs: 11 },
  { day: 'Oct 11', defects: 24, repairs: 16 },
  { day: 'Oct 12', defects: 20, repairs: 18 },
  { day: 'Oct 13', defects: 31, repairs: 21 },
  { day: 'Oct 14', defects: 26, repairs: 23 },
  { day: 'Oct 15', defects: 35, repairs: 29 },
  { day: 'Oct 16', defects: 29, repairs: 26 },
]

export const trend30ChartData = [
  { day: 'Sep 17-23', defects: 136, repairs: 91 },
  { day: 'Sep 24-30', defects: 149, repairs: 108 },
  { day: 'Oct 1-7', defects: 158, repairs: 127 },
  { day: 'Oct 8-14', defects: 174, repairs: 143 },
  { day: 'Oct 15-16', defects: 29, repairs: 26 },
]

export const trend90ChartData = [
  { day: 'Jul 2026', defects: 524, repairs: 391 },
  { day: 'Aug 2026', defects: 598, repairs: 456 },
  { day: 'Sep 2026', defects: 666, repairs: 527 },
  { day: 'Oct 2026', defects: 403, repairs: 296 },
]