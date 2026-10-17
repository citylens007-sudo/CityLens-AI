import type { UserRole } from './types'

const allRoles: readonly UserRole[] = [
  'Admin',
  'Municipal Engineer',
  'Maintenance Team',
  'Traffic Controller',
  'Police Officer',
  'Public User',
]

const adminAndEngineer: readonly UserRole[] = ['Admin', 'Municipal Engineer']
const adminEngineerMaintenance: readonly UserRole[] = ['Admin', 'Municipal Engineer', 'Maintenance Team']
const adminAndTrafficController: readonly UserRole[] = ['Admin', 'Traffic Controller']
const adminAndPolice: readonly UserRole[] = ['Admin', 'Police Officer']
const adminOnly: readonly UserRole[] = ['Admin']
const residentOnly: readonly UserRole[] = ['Public User']

export function roleCanAccessPath(role: UserRole, path: string): boolean {
  if (path === '/') return adminAndEngineer.includes(role) || residentOnly.includes(role)
  if (path === '/public' || path.startsWith('/public/')) return residentOnly.includes(role)
  if (path.startsWith('/roads') || path.startsWith('/map') || path.startsWith('/defects/')) {
    return adminAndEngineer.includes(role)
  }
  if (path.startsWith('/repairs')) return adminEngineerMaintenance.includes(role)
  if (path.startsWith('/traffic')) return adminAndTrafficController.includes(role)
  if (path.startsWith('/alerts')) return adminAndPolice.includes(role)
  if (path.startsWith('/analytics') || path.startsWith('/users')) return adminOnly.includes(role)
  return false
}

export function roleHomePath(role: UserRole): string {
  if (role === 'Public User') return '/public'
  if (role === 'Maintenance Team') return '/repairs'
  if (role === 'Traffic Controller') return '/traffic'
  if (role === 'Police Officer') return '/alerts'
  return '/'
}

export function roleNavigationAccess(role: UserRole): readonly UserRole[] {
  return allRoles.filter((allowedRole) => roleCanAccessPath(allowedRole, roleHomePath(role)))
}