import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AppActionsContext, type ConfirmationRequest, useAppActions } from './context'
import { ConfirmDialog, Toast } from './components/ui'
import { ApiError, authApi, type AuthUser } from './services/api'
import { roleCanAccessPath, roleHomePath } from './permissions'

const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const DefectDetailsPage = lazy(() => import('./pages/RoadPages').then((module) => ({ default: module.DefectDetailsPage })))
const DefectMapPage = lazy(() => import('./pages/RoadPages').then((module) => ({ default: module.DefectMapPage })))
const RoadMonitoringPage = lazy(() => import('./pages/RoadPages').then((module) => ({ default: module.RoadMonitoringPage })))
const RepairTaskDetailsPage = lazy(() => import('./pages/RepairPages').then((module) => ({ default: module.RepairTaskDetailsPage })))
const RepairTrackingPage = lazy(() => import('./pages/RepairPages').then((module) => ({ default: module.RepairTrackingPage })))
const IncidentReviewPage = lazy(() => import('./pages/TrafficPages').then((module) => ({ default: module.IncidentReviewPage })))
const PoliceAlertsPage = lazy(() => import('./pages/TrafficPages').then((module) => ({ default: module.PoliceAlertsPage })))
const TrafficIncidentsPage = lazy(() => import('./pages/TrafficPages').then((module) => ({ default: module.TrafficIncidentsPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((module) => ({ default: module.UsersPage })))
const ResidentPublicPage = lazy(() => import('./pages/ResidentPublicPage').then((module) => ({ default: module.ResidentPublicPage })))

function ProtectedPage({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const location = useLocation()
  if (!roleCanAccessPath(user.role, location.pathname)) {
    return <AccessDeniedRedirect user={user} path={location.pathname} />
  }
  return children
}

function AccessDeniedRedirect({ user, path }: { user: AuthUser; path: string }) {
  const navigate = useNavigate()
  const { notify } = useAppActions()

  useEffect(() => {
    notify(`Access denied for ${path}. Redirected to your role workspace.`)
    navigate(roleHomePath(user.role), { replace: true })
  }, [navigate, notify, path, user.role])

  return <div className="route-loading">Access denied. Redirecting to your workspace…</div>
}

function AuthenticatedRoutes() {
  const navigate = useNavigate()
  const { notify } = useAppActions()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sessionChecking, setSessionChecking] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let active = true
    authApi.me().then((currentUser) => {
      if (active) setUser(currentUser)
    }).catch((error: unknown) => {
      if (!active) return
      if (error instanceof ApiError && error.status !== 401) setSessionError(error.message)
    }).finally(() => {
      if (active) setSessionChecking(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const expireSession = () => {
      setUser(null)
      setSessionError('Your session has expired. Sign in again to continue.')
    }
    window.addEventListener('citylens:session-expired', expireSession)
    return () => window.removeEventListener('citylens:session-expired', expireSession)
  }, [])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => {
      authApi.me().catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          setUser(null)
          setSessionError('Your session has expired. Sign in again to continue.')
        } else if (error instanceof Error) {
          notify(error.message)
        }
      })
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [notify, user])

  async function login(email: string, password: string) {
    const authenticatedUser = await authApi.login(email, password)
    setSessionError('')
    setUser(authenticatedUser)
    navigate(roleHomePath(authenticatedUser.role), { replace: true })
  }

  async function logout() {
    setLoggingOut(true)
    try {
      await authApi.logout()
      setUser(null)
      setSessionError('')
      navigate('/login', { replace: true })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign out. Try again.')
    } finally {
      setLoggingOut(false)
    }
  }

  if (sessionChecking) {
    return <div className="route-loading"><span className="loading-indicator" />Checking secure session…</div>
  }

  if (!user) return <LoginPage onLogin={login} initialError={sessionError} />

  return (
    <Routes>
      <Route element={<AppShell loggingOut={loggingOut} onLogout={logout} user={user} />}>
        <Route index element={<ProtectedPage user={user}>{user.role === 'Public User' ? <ResidentPublicPage /> : <DashboardPage isAdmin={user.role === 'Admin'} />}</ProtectedPage>} />
        <Route path="public" element={<ProtectedPage user={user}><ResidentPublicPage /></ProtectedPage>} />
        <Route path="roads" element={<ProtectedPage user={user}><RoadMonitoringPage /></ProtectedPage>} />
        <Route path="map" element={<ProtectedPage user={user}><DefectMapPage /></ProtectedPage>} />
        <Route path="defects/:defectId" element={<ProtectedPage user={user}><DefectDetailsPage /></ProtectedPage>} />
        <Route path="repairs" element={<ProtectedPage user={user}><RepairTrackingPage /></ProtectedPage>} />
        <Route path="repairs/:taskId" element={<ProtectedPage user={user}><RepairTaskDetailsPage userRole={user.role} /></ProtectedPage>} />
        <Route path="traffic" element={<ProtectedPage user={user}><TrafficIncidentsPage /></ProtectedPage>} />
        <Route path="traffic/review" element={<ProtectedPage user={user}><IncidentReviewPage /></ProtectedPage>} />
        <Route path="traffic/review/:incidentId" element={<ProtectedPage user={user}><IncidentReviewPage /></ProtectedPage>} />
        <Route path="alerts" element={<ProtectedPage user={user}><PoliceAlertsPage userRole={user.role} /></ProtectedPage>} />
        <Route path="analytics" element={<ProtectedPage user={user}><AnalyticsPage /></ProtectedPage>} />
        <Route path="users" element={<ProtectedPage user={user}><UsersPage currentUserId={user.id} /></ProtectedPage>} />
        <Route path="login" element={<Navigate replace to={roleHomePath(user.role)} />} />
        <Route path="*" element={<Navigate replace to={roleHomePath(user.role)} />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const [toastMessage, setToastMessage] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)

  const notify = useCallback((message: string) => {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage(''), 4200)
  }, [])

  const confirm = useCallback((request: ConfirmationRequest) => {
    setConfirmation({
      ...request,
      onConfirm: () => {
        request.onConfirm()
        setConfirmation(null)
      },
    })
  }, [])
  const actions = useMemo(() => ({ notify, confirm }), [confirm, notify])

  return (
    <AppActionsContext.Provider value={actions}>
      <BrowserRouter>
        <Suspense fallback={<div className="route-loading"><span className="loading-indicator" />Loading CityLens workspace…</div>}>
          <AuthenticatedRoutes />
        </Suspense>
        <ConfirmDialog onCancel={() => setConfirmation(null)} request={confirmation} />
        {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage('')} />}
      </BrowserRouter>
    </AppActionsContext.Provider>
  )
}