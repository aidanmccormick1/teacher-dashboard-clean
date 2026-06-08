import { SignIn, SignUp } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const PILOT_EMAIL = 'teacher.test@example.com';
const PILOT_PASSWORD = 'TeacherTest2026!';
type LoginMode = 'signin' | 'signup' | 'pilot';

export function LoginPage() {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const [loginMode, setLoginMode] = useState<LoginMode>('signin');
  const [devUserId, setDevUserId] = useState('teacher-dev-1');
  const [devEmail, setDevEmail] = useState('teacher@example.com');
  const [pilotEmail, setPilotEmail] = useState(PILOT_EMAIL);
  const [pilotPassword, setPilotPassword] = useState('');
  const [pilotError, setPilotError] = useState<string | null>(null);
  const [pilotStatus, setPilotStatus] = useState<string | null>(null);

  useEffect(() => {
    if (auth.isSignedIn) navigate('/dashboard');
  }, [auth.isSignedIn, navigate]);

  const signInPilotAccount = () => {
    if (pilotEmail.trim().toLowerCase() !== PILOT_EMAIL || pilotPassword !== PILOT_PASSWORD) {
      setPilotError('Use the pilot account email and password.');
      setPilotStatus(null);
      return;
    }

    auth.signInPilot();
    navigate('/dashboard');
  };

  if (auth.mode === 'clerk') {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-intro">
            <p className="eyebrow">TeacherOS</p>
            <h1>Sign in, create an account, or use the pilot account.</h1>
            <p className="muted">
              Use a real account when you are ready. Use the pilot account when you want to test the app immediately.
            </p>
            <div className="login-proof-list">
              <span>Courses</span>
              <span>Periods</span>
              <span>Year Plan</span>
              <span>Progress</span>
            </div>
          </div>

          <div className="login-workspace-card">
            <div className="login-mode-tabs" role="tablist" aria-label="Login options">
              <button
                className={loginMode === 'signin' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={loginMode === 'signin'}
                onClick={() => setLoginMode('signin')}
              >
                Existing user
              </button>
              <button
                className={loginMode === 'signup' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={loginMode === 'signup'}
                onClick={() => setLoginMode('signup')}
              >
                Create account
              </button>
              <button
                className={loginMode === 'pilot' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={loginMode === 'pilot'}
                onClick={() => setLoginMode('pilot')}
              >
                Pilot account
              </button>
            </div>

            {loginMode === 'signin' ? (
              <div className="login-card">
                <SignIn
                  fallbackRedirectUrl="/dashboard"
                  signUpFallbackRedirectUrl="/dashboard"
                  signUpUrl="/login"
                />
              </div>
            ) : null}

            {loginMode === 'signup' ? (
              <div className="login-card">
                <SignUp fallbackRedirectUrl="/dashboard" signInUrl="/login" />
              </div>
            ) : null}

            {loginMode === 'pilot' ? (
              <form
                className="pilot-login-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  signInPilotAccount();
                }}
              >
                <div>
                  <strong>TeacherOS pilot account</strong>
                  <p className="muted">A working test account for trying the official app flow.</p>
                </div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setPilotEmail(PILOT_EMAIL);
                    setPilotPassword(PILOT_PASSWORD);
                    setPilotError(null);
                    setPilotStatus('Pilot account filled.');
                  }}
                >
                  Fill pilot account
                </button>
                <label>
                  Email
                  <input className="input" value={pilotEmail} onChange={(event) => setPilotEmail(event.target.value)} />
                </label>
                <label>
                  Password
                  <input
                    className="input"
                    type="password"
                    value={pilotPassword}
                    onChange={(event) => setPilotPassword(event.target.value)}
                  />
                </label>
                {pilotError ? <p className="notice warning">{pilotError}</p> : null}
                {pilotStatus ? <p className="notice success">{pilotStatus}</p> : null}
                <button type="submit">
                  Sign in with pilot account
                </button>
              </form>
            ) : null}

            <div className="login-account-note">
              <strong>For testers</strong>
              <p>
                Start with the pilot account if you want to see the dashboard right away. Create your own account
                when you want a separate login.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-intro">
          <p className="eyebrow">TeacherOS</p>
          <h1>Local test mode</h1>
          <p className="muted">Use this only when Clerk is not configured for this build.</p>
          <div className="login-proof-list">
            <span>Local</span>
            <span>Testing</span>
            <span>No email needed</span>
          </div>
        </div>
        <div className="login-workspace-card">
          <div className="login-mode-tabs" role="tablist" aria-label="Local login options">
            <button
              className={loginMode === 'signin' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={loginMode === 'signin'}
              onClick={() => setLoginMode('signin')}
            >
              Existing user
            </button>
            <button
              className={loginMode === 'signup' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={loginMode === 'signup'}
              onClick={() => setLoginMode('signup')}
            >
              Create account
            </button>
            <button
              className={loginMode === 'pilot' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={loginMode === 'pilot'}
              onClick={() => setLoginMode('pilot')}
            >
              Pilot account
            </button>
          </div>

          {loginMode === 'signin' || loginMode === 'signup' ? (
            <div className="card stack login-dev-card">
              <div>
                <strong>{loginMode === 'signup' ? 'Create local account' : 'Existing local user'}</strong>
                <p className="muted">
                  This creates a local browser session for development. Live account creation uses Clerk.
                </p>
              </div>
              <label>
                User ID
                <input className="input" value={devUserId} onChange={(e) => setDevUserId(e.target.value)} />
              </label>
              <label>
                Email
                <input className="input" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
              </label>
              <button
                type="button"
                onClick={() => {
                  auth.signInDev(devUserId, devEmail || null);
                  navigate('/dashboard');
                }}
              >
                {loginMode === 'signup' ? 'Create local account' : 'Sign in'}
              </button>
            </div>
          ) : null}

          {loginMode === 'pilot' ? (
            <form
              className="pilot-login-card"
              onSubmit={(event) => {
                event.preventDefault();
                signInPilotAccount();
              }}
            >
              <div>
                <strong>TeacherOS pilot account</strong>
                <p className="muted">Use this for the shared tester workspace.</p>
              </div>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setPilotEmail(PILOT_EMAIL);
                  setPilotPassword(PILOT_PASSWORD);
                  setPilotError(null);
                  setPilotStatus('Pilot account filled.');
                }}
              >
                Fill pilot account
              </button>
              <label>
                Email
                <input className="input" value={pilotEmail} onChange={(event) => setPilotEmail(event.target.value)} />
              </label>
              <label>
                Password
                <input
                  className="input"
                  type="password"
                  value={pilotPassword}
                  onChange={(event) => setPilotPassword(event.target.value)}
                />
              </label>
              {pilotError ? <p className="notice warning">{pilotError}</p> : null}
              {pilotStatus ? <p className="notice success">{pilotStatus}</p> : null}
              <button type="submit">
                Sign in with pilot account
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
