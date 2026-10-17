import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui'
import { authApi } from '../services/api'

export function LoginPage({
  onLogin,
  initialError = '',
}: {
  onLogin: (email: string, password: string) => Promise<void>
  initialError?: string
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [searchParams] = useSearchParams()
  const mode = location.pathname === '/register'
    ? 'register'
    : location.pathname === '/forgot-password'
      ? 'forgot'
      : location.pathname === '/reset-password'
        ? 'reset'
        : 'login'

  useEffect(() => {
    const token = searchParams.get('token')
    if (location.pathname !== '/verify-email' || !token) return
    let active = true
    setSubmitting(true)
    authApi.verifyResidentEmail(token).then((result) => {
      if (!active) return
      setMessage(result.message)
      setError('')
      navigate('/login', { replace: true })
    }).catch((verificationError: unknown) => {
      if (active) setError(verificationError instanceof Error ? verificationError.message : 'Could not verify your email.')
    }).finally(() => {
      if (active) setSubmitting(false)
    })
    return () => { active = false }
  }, [location.pathname, navigate, searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (mode === 'register' && !displayName.trim()) {
      setError('Enter your name to create an account.')
      return
    }
    if (mode !== 'reset') {
      if (!email.trim()) {
        setError('Enter your email address to continue.')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Enter a valid email address.')
        return
      }
    }
    if (mode === 'register' || mode === 'reset') {
      if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        setError('Use at least 12 characters with uppercase, lowercase, a number, and a special character.')
        return
      }
      if (password !== confirmPassword) {
        setError('The passwords do not match.')
        return
      }
    } else if (mode === 'login' && !password) {
      setError('Enter your password to continue.')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'register') {
        const result = await authApi.registerResident({
          email: email.trim(),
          display_name: displayName.trim(),
          password,
          confirm_password: confirmPassword,
        })
        setMessage(result.message)
        navigate('/login', { replace: true })
        setPassword('')
        setConfirmPassword('')
      } else if (mode === 'forgot') {
        const result = await authApi.requestPasswordReset(email.trim())
        setMessage(result.message)
      } else if (mode === 'reset') {
        const token = searchParams.get('token')
        if (!token) {
          setError('This password reset link is invalid or expired. Request a new one.')
          return
        }
        const result = await authApi.resetPassword(token, password, confirmPassword)
        setMessage(result.message)
        setPassword('')
        setConfirmPassword('')
        navigate('/login', { replace: true })
      } else {
        await onLogin(email.trim(), password)
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const heading = mode === 'register'
    ? ['RESIDENT ACCESS', 'Create your account', 'Register for verified access to public road information.']
    : mode === 'forgot'
      ? ['ACCOUNT RECOVERY', 'Forgot password?', 'Enter the email address associated with your account.']
      : mode === 'reset'
        ? ['ACCOUNT RECOVERY', 'Set a new password', 'Choose a strong password for your account.']
        : ['CITYLENS ACCESS', 'Welcome back', 'Sign in to your CityLens workspace.']

  return (
    <main className="login-layout">
      <section className="login-brand-panel">
        <div className="login-brand-top">
          <span className="login-logo"><Activity size={22} strokeWidth={2.5} /></span>
          <span><strong>CityLens AI</strong><small>URBAN OPERATIONS PLATFORM</small></span>
        </div>
        <div className="login-brand-copy">
          <p className="login-eyebrow"><span /> MUNICIPAL INTELLIGENCE</p>
          <h1>See your city<br />from the ground up.</h1>
          <p>One operational view for safer streets, responsive maintenance, and informed city teams.</p>
        </div>
        <div className="login-brand-meta"><span>PUBLIC WORKS <i /> TRAFFIC SAFETY <i /> CITY SERVICES</span><span>© 2026 CITYLENS AI</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-card-wrap">
          <div className="login-card-heading">
            <span className="login-lock"><ShieldCheck size={20} /></span>
            <p className="eyebrow">{heading[0]}</p>
            <h2>{heading[1]}</h2>
            <p>{heading[2]}</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {mode === 'register' && <>
              <label className="field-label" htmlFor="display-name">Full name</label>
              <input autoComplete="name" className="text-input" id="display-name" onChange={(event) => setDisplayName(event.target.value)} placeholder="Your full name" required value={displayName} />
            </>}
            {mode !== 'reset' && <>
              <label className="field-label" htmlFor="email">Email</label>
              <input autoComplete="email" className="text-input" id="email" onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required type="email" value={email} />
            </>}
            {(mode === 'login' || mode === 'register' || mode === 'reset') && <>
              <div className="password-label-row"><label className="field-label" htmlFor="password">Password</label>{mode === 'login' && <Link className="text-link" to="/forgot-password">Forgot password?</Link>}</div>
              <div className="password-input-wrap">
                <input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="text-input" id="password" onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 12 characters'} required type={showPassword ? 'text' : 'password'} value={password} />
                <button aria-label={showPassword ? 'Hide password' : 'Show password'} className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </div>
            </>}
            {(mode === 'register' || mode === 'reset') && <>
              <label className="field-label" htmlFor="confirm-password">Confirm password</label>
              <input autoComplete="new-password" className="text-input" id="confirm-password" onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
              <small className="password-guidance">Use at least 12 characters, including uppercase, lowercase, a number, and a special character.</small>
            </>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {message && <p className="form-success" role="status">{message}</p>}
            <Button className="login-submit" disabled={submitting} icon={submitting ? LoaderCircle : undefined} iconAfter={submitting ? undefined : ArrowRight} type="submit" variant="primary">{submitting ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}</Button>
          </form>
          {mode === 'login' && <p className="resident-signup-switch">New to CityLens?{' '}<Link className="text-link" to="/register">Create Account</Link></p>}
          {mode === 'register' && <p className="resident-signup-switch">Already have an account?{' '}<Link className="text-link" to="/login">Sign in</Link></p>}
          {mode === 'forgot' && <p className="resident-signup-switch"><Link className="text-link" to="/login">Back to sign in</Link></p>}
          {mode === 'reset' && <p className="resident-signup-switch"><Link className="text-link" to="/login">Back to sign in</Link></p>}
          <div className="login-divider" />
          <div className="demo-login-box auth-login-note">
            <div className="demo-login-top"><span className="auth-session-dot" /><strong>Protected account</strong><span className="demo-only-tag">VERIFIED EMAIL</span></div>
            <p>Public accounts require email verification. Staff roles and permissions remain managed by CityLens administrators.</p>
          </div>
          <p className="login-notice">Your session is held in a secure, HTTP-only cookie. Sign out when you finish.</p>
        </div>
        <span className="login-bottom-note">CITYLENS AI <i /> DEVELOPMENT ENVIRONMENT</span>
      </section>
    </main>
  )
}