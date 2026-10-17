import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, Check, Info, X } from 'lucide-react'
import type { ConfirmationRequest } from '../context'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: LucideIcon
  iconAfter?: LucideIcon
}

export function Button({ variant = 'secondary', icon: Icon, iconAfter: IconAfter, children, className = '', ...props }: ButtonProps) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} strokeWidth={1.8} aria-hidden="true" />}
      <span>{children}</span>
      {IconAfter && <IconAfter size={16} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  )
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  )
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || subtitle || action) && (
        <div className="panel-heading">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function DemoTag({ children = 'DEMO DATA' }: { children?: ReactNode }) {
  return <span className="demo-tag"><Info size={12} aria-hidden="true" />{children}</span>
}

const statusClasses: Record<string, string> = {
  High: 'status-red',
  Medium: 'status-amber',
  Low: 'status-blue',
  Reported: 'status-slate',
  Verified: 'status-green',
  Assigned: 'status-blue',
  'In Progress': 'status-blue',
  'Awaiting Verification': 'status-amber',
  Closed: 'status-green',
  'Pending Review': 'status-amber',
  Authorized: 'status-blue',
  Sent: 'status-violet',
  Acknowledged: 'status-green',
  Investigating: 'status-blue',
  Active: 'status-green',
  Inactive: 'status-slate',
  Deleted: 'status-slate',
  Withdrawn: 'status-slate',
}

export function StatusBadge({ label }: { label: string }) {
  return <span className={`status-badge ${statusClasses[label] ?? 'status-slate'}`}>{label}</span>
}

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={20} strokeWidth={1.8} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="status">
      <span className="toast-icon"><Check size={16} /></span>
      <p>{message}</p>
      <button aria-label="Dismiss notification" onClick={onDismiss} type="button"><X size={16} /></button>
    </div>
  )
}

export function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmationRequest | null
  onCancel: () => void
}) {
  if (!request) return null
  const Icon = request.destructive ? AlertCircle : Info

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section aria-labelledby="confirm-title" aria-modal="true" className="confirm-modal" role="dialog">
        <span className={`confirm-icon ${request.destructive ? 'confirm-icon-danger' : ''}`}><Icon size={21} /></span>
        <h2 id="confirm-title">{request.title}</h2>
        <p>{request.description}</p>
        <div className="confirm-actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={request.destructive ? 'danger' : 'primary'} onClick={request.onConfirm}>
            {request.confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}