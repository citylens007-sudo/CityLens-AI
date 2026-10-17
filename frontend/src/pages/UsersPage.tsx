import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronDown, LoaderCircle, Mail, Pencil, Search, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useAppActions } from '../context'
import { usersApi, type AuthUser, type CreateUserPayload, type Page } from '../services/api'
import type { UserRole } from '../types'
import { Button, EmptyState, PageHeading, Panel, StatusBadge } from '../components/ui'

const roles: UserRole[] = [
  'Admin',
  'Municipal Engineer',
  'Traffic Controller',
  'Police Officer',
  'Maintenance Team',
  'Public User',
]
type AccountStatus = 'all' | 'active' | 'inactive' | 'deleted'
const pageSize = 20
const emptyUser: CreateUserPayload = {
  email: '',
  display_name: '',
  password: '',
  role: 'Municipal Engineer',
}

export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [page, setPage] = useState<Page<AuthUser> | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<AuthUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [newUser, setNewUser] = useState(emptyUser)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('')
  const [statusFilter, setStatusFilter] = useState<AccountStatus>('all')
  const [offset, setOffset] = useState(0)
  const { confirm, notify } = useAppActions()

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPage(await usersApi.list({
        limit: pageSize,
        offset,
        search: search.trim() || undefined,
        role: roleFilter || undefined,
        status: statusFilter,
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load user accounts.')
    } finally {
      setLoading(false)
    }
  }, [offset, roleFilter, search, statusFilter])

  useEffect(() => { void loadUsers() }, [loadUsers])

  async function updateUser(user: AuthUser, update: { email?: string; display_name?: string; role?: UserRole; is_active?: boolean }): Promise<boolean> {
    setSavingId(user.id)
    try {
      await usersApi.update(user.id, update)
      await loadUsers()
      return true
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update this account.')
      return false
    } finally {
      setSavingId('')
    }
  }

  function beginEdit(user: AuthUser) {
    setEditUser(user)
    setEditName(user.display_name)
    setEditEmail(user.email)
    setError('')
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editUser) return
    setSavingId(editUser.id)
    const updated = await updateUser(editUser, {
      display_name: editName.trim(),
      email: editEmail.trim(),
    })
    if (updated) {
      setEditUser(null)
      notify('User profile updated.')
    }
  }

  function requestRoleChange(user: AuthUser, role: UserRole) {
    if (user.role === role) return
    confirm({
      title: `Change ${user.display_name}'s role?`,
      description: `This changes backend access for ${user.email} to ${role}.`,
      confirmLabel: 'Update role',
      onConfirm: () => { void updateUser(user, { role }).then((updated) => { if (updated) notify('User role updated.') }) },
    })
  }

  function requestActiveChange(user: AuthUser) {
    const activate = !user.is_active
    confirm({
      title: `${activate ? 'Activate' : 'Deactivate'} ${user.display_name}?`,
      description: activate
        ? `The account ${user.email} will be allowed to sign in again.`
        : `The account ${user.email} will be blocked and its current sessions revoked.`,
      confirmLabel: activate ? 'Activate account' : 'Deactivate account',
      destructive: !activate,
      onConfirm: () => { void updateUser(user, { is_active: activate }).then((updated) => { if (updated) notify('User account status updated.') }) },
    })
  }

  function requestDelete(user: AuthUser) {
    confirm({
      title: 'Confirm account deletion',
      description: `Soft-delete ${user.display_name} (${user.email})? Their access will be revoked immediately. Existing reports and audit history will be preserved.`,
      confirmLabel: 'Delete this account',
      destructive: true,
      onConfirm: () => { void deleteUser(user) },
    })
  }

  async function deleteUser(user: AuthUser) {
    setSavingId(user.id)
    setError('')
    try {
      await usersApi.delete(user.id)
      notify(`Account ${user.email} was deleted and access revoked.`)
      if (page?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - pageSize))
      else await loadUsers()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this account.')
    } finally {
      setSavingId('')
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await usersApi.create({
        ...newUser,
        email: newUser.email.trim(),
        display_name: newUser.display_name.trim(),
      })
      setNewUser(emptyUser)
      setCreateOpen(false)
      setOffset(0)
      notify('User account created. Share the initial password through an approved secure channel.')
      await loadUsers()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create this account.')
    } finally {
      setSaving(false)
    }
  }

  const users = page?.items ?? []
  const end = Math.min(offset + pageSize, page?.total ?? 0)
  const activeOnPage = users.filter((user) => user.is_active && !user.deleted_at).length

  return (
    <>
      <PageHeading
        actions={<Button icon={UserPlus} onClick={() => setCreateOpen(true)} variant="primary">Create user</Button>}
        description="Search accounts, assign roles, manage access, or soft-delete an account while preserving linked reports and audit history."
        eyebrow="ADMINISTRATION / ACCESS DIRECTORY"
        title="User management"
      />
      <div className="notice-banner notice-banner-blue">
        <Shield size={17} />
        <p><strong>Administrator access.</strong> All account changes are checked by the API. Deletion revokes sessions and preserves report ownership and audit history.</p>
      </div>
      {error && <div className="users-error" role="alert"><span>{error}</span><Button onClick={() => void loadUsers()} variant="secondary">Retry</Button></div>}
      <div className="user-summary-row">
        <div><span className="user-summary-icon"><Users size={18} /></span><span><small>MATCHING ACCOUNTS</small><strong>{loading ? '—' : page?.total ?? 0}</strong></span></div>
        <div><span className="user-summary-icon user-summary-green"><Check size={18} /></span><span><small>ACTIVE ON THIS PAGE</small><strong>{loading ? '—' : activeOnPage}</strong></span></div>
        <div><span className="user-summary-icon user-summary-amber"><Shield size={18} /></span><span><small>AVAILABLE ROLES</small><strong>{roles.length}</strong></span></div>
      </div>
      <Panel
        className="table-panel user-list-panel"
        subtitle="Filterable account records from the authenticated admin API"
        title="Workspace users"
        action={<span className="table-count">{loading ? 'Loading…' : page?.total ? `${offset + 1}–${end} of ${page.total}` : '0 accounts'}</span>}
      >
        <div className="user-filters">
          <label className="user-search"><Search size={16} /><input aria-label="Search by name or email" onChange={(event) => { setOffset(0); setSearch(event.target.value) }} placeholder="Search name or email" value={search} /></label>
          <select aria-label="Filter by role" onChange={(event) => { setOffset(0); setRoleFilter(event.target.value as UserRole | '') }} value={roleFilter}>
            <option value="">All roles</option>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select aria-label="Filter by account status" onChange={(event) => { setOffset(0); setStatusFilter(event.target.value as AccountStatus) }} value={statusFilter}>
            <option value="all">All non-deleted accounts</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        {loading ? <div className="users-loading"><LoaderCircle className="loading-spinner" size={20} />Loading user accounts…</div>
          : users.length === 0 ? <EmptyState icon={Users} title="No matching accounts" description="Try another search or filter, or create a new account." action={<Button icon={UserPlus} onClick={() => setCreateOpen(true)} variant="primary">Create user</Button>} />
            : <div className="table-scroll"><table><thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th>LAST SIGN IN</th><th>ACCOUNT ACTIONS</th></tr></thead><tbody>
              {users.map((user) => {
                const deleted = user.deleted_at !== null
                const busy = savingId === user.id
                return <tr key={user.id}>
                  <td><div className="user-table-person"><span className={`user-initials user-avatar-${user.role.length % 5}`}>{user.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{user.display_name}</strong><small><Mail size={12} />{user.email}</small></span></div></td>
                  <td>{deleted ? user.role : <label className="role-select-wrap"><select aria-label={`Role for ${user.display_name}`} disabled={busy} onChange={(event) => requestRoleChange(user, event.target.value as UserRole)} value={user.role}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select><ChevronDown size={13} /></label>}</td>
                  <td><StatusBadge label={deleted ? 'Deleted' : user.is_active ? 'Active' : 'Inactive'} /></td>
                  <td className="muted-cell">{new Date(user.created_at).toLocaleDateString()}</td>
                  <td className="muted-cell">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}</td>
                  <td className="user-account-actions">
                    {!deleted && <Button className="table-action-button" disabled={busy || (user.id === currentUserId && user.is_active)} onClick={() => requestActiveChange(user)} variant="ghost">{user.is_active ? 'Deactivate' : 'Activate'}</Button>}
                    {!deleted && <Button aria-label={`Edit ${user.display_name}`} className="table-action-button" disabled={busy} icon={Pencil} onClick={() => beginEdit(user)} variant="ghost">Edit</Button>}
                    {!deleted && user.id !== currentUserId && <Button aria-label={`Delete ${user.display_name}`} className="table-action-button user-delete-button" disabled={busy} icon={Trash2} onClick={() => requestDelete(user)} variant="danger">Delete</Button>}
                  </td>
                </tr>
              })}
            </tbody></table></div>}
        <div className="user-pagination">
          <Button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
          <span>{page?.total ? `${offset + 1}–${end} of ${page.total}` : 'No accounts'}</span>
          <Button disabled={loading || end >= (page?.total ?? 0)} onClick={() => setOffset(offset + pageSize)}>Next</Button>
        </div>
      </Panel>
      <Panel className="roles-panel" subtitle="Enforced on backend API requests" title="Workspace roles">
        <div className="role-catalog">{roles.map((role, index) => <div className="role-catalog-item" key={role}><span className={`role-catalog-mark role-mark-${index}`}><Shield size={16} /></span><span><strong>{role}</strong><small>{roleDescriptions[role]}</small></span><span className="role-enforced-tag">ENFORCED</span></div>)}</div>
      </Panel>
      <p className="data-footnote">Application secrets and SMTP settings remain environment-managed; they are never exposed by this page.</p>
      {editUser && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditUser(null) }}><section aria-labelledby="edit-user-title" aria-modal="true" className="confirm-modal create-user-modal" role="dialog"><h2 id="edit-user-title">Edit user account</h2><p>Update the account profile for {editUser.email}.</p><form className="create-user-form" onSubmit={(event) => void saveProfile(event)}><label htmlFor="edit-user-name">Full name</label><input autoComplete="name" id="edit-user-name" maxLength={120} onChange={(event) => setEditName(event.target.value)} required value={editName} /><label htmlFor="edit-user-email">Email</label><input autoComplete="email" id="edit-user-email" onChange={(event) => setEditEmail(event.target.value)} required type="email" value={editEmail} />{error && <p className="form-error" role="alert">{error}</p>}<div className="confirm-actions"><Button disabled={savingId === editUser.id} onClick={() => setEditUser(null)} type="button">Cancel</Button><Button disabled={savingId === editUser.id} icon={savingId === editUser.id ? LoaderCircle : Pencil} type="submit" variant="primary">{savingId === editUser.id ? 'Saving…' : 'Save changes'}</Button></div></form></section></div>}
      {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreateOpen(false) }}><section aria-labelledby="create-user-title" aria-modal="true" className="confirm-modal create-user-modal" role="dialog"><div className="create-user-heading"><span className="confirm-icon"><UserPlus size={20} /></span><button aria-label="Close create user form" disabled={saving} onClick={() => setCreateOpen(false)} type="button">×</button></div><h2 id="create-user-title">Create a user account</h2><p>Public users can self-register with email verification. Create staff and administrator accounts here.</p><form className="create-user-form" onSubmit={(event) => void createUser(event)}><label htmlFor="new-name">Full name</label><input autoComplete="name" id="new-name" maxLength={120} onChange={(event) => setNewUser((current) => ({ ...current, display_name: event.target.value }))} required value={newUser.display_name} /><label htmlFor="new-email">Email</label><input autoComplete="email" id="new-email" onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} required type="email" value={newUser.email} /><label htmlFor="new-role">Role</label><select id="new-role" onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))} value={newUser.role}>{roles.filter((role) => role !== 'Public User').map((role) => <option key={role} value={role}>{role}</option>)}</select><label htmlFor="new-password">Temporary password</label><input autoComplete="new-password" id="new-password" minLength={12} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} required type="password" value={newUser.password} /><small>At least 12 characters. Share through an approved secure channel.</small>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirm-actions"><Button disabled={saving} onClick={() => setCreateOpen(false)} type="button">Cancel</Button><Button disabled={saving} icon={saving ? LoaderCircle : UserPlus} type="submit" variant="primary">{saving ? 'Creating…' : 'Create account'}</Button></div></form></section></div>}
    </>
  )
}

const roleDescriptions: Record<UserRole, string> = {
  Admin: 'Manage accounts, roles, application-wide statistics, and configuration access.',
  'Municipal Engineer': 'Review road damage, assign repairs, and approve repair closure.',
  'Traffic Controller': 'Review traffic incidents, record decisions, and authorize alerts.',
  'Police Officer': 'Access alerts assigned to them and update investigations.',
  'Maintenance Team': 'View assigned work, update repairs, and submit completion evidence.',
  'Public User': 'Submit and track personal road reports; no access to private reports or staff tools.',
}
