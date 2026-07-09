import { SignIn, SignUp } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const PILOT_EMAIL = 'teacher.test@example.com';
const PILOT_PASSWORD = 'TeacherTest2026!';
type LoginMode = 'signin' | 'signup' | 'pilot' | 'test';
type TestAuthMode = 'signup' | 'login';

function isLocalDevHost() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

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
  const [testAuthMode, setTestAuthMode] = useState<TestAuthMode>('signup');
  const [testUsername, setTestUsername] = useState('');
  const [testPassword, setTestPassword] = useState('');
  const [testError, setTestError] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    if (auth.isSignedIn) navigate('/dashboard');
  }, [auth.isSignedIn, navigate]);

  useEffect(() => {
    if (auth.mode === 'dev' && !isLocalDevHost()) {
      setLoginMode('test');
    }
  }, [auth.mode]);

  const signInPilotAccount = () => {
    if (pilotEmail.trim().toLowerCase() !== PILOT_EMAIL || pilotPassword !== PILOT_PASSWORD) {
      setPilotError('Use the pilot account email and password.');
      setPilotStatus(null);
      return;
    }

    auth.signInPilot();
    navigate('/dashboard');
  };

  const submitTestAccount = async () => {
    setTestLoading(true);
    setTestError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/v1/test-auth/${testAuthMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword })
      });
      const payload = (await response.json().catch(() => null)) as
        | { token?: string; user?: { username?: string; email?: string }; error?: string }
        | null;

      if (!response.ok || !payload?.token || !payload.user?.username) {
        setTestError(payload?.error ?? 'Could not sign in with that test account.');
        return;
      }

      auth.signInWithTestToken(payload.token, payload.user.username, payload.user.email ?? null);
      navigate('/dashboard');
    } catch {
      setTestError('Could not reach the backend. Try again in a moment.');
    } finally {
      setTestLoading(false);
    }
  };

  const testAccountForm = (
    <form
      className="pilot-login-card"
      onSubmit={(event) => {
        event.preventDefault();
        void submitTestAccount();
      }}
    >
      <div>
        <strong>{testAuthMode === 'signup' ? 'Create tester account' : 'Sign in as tester'}</strong>
        <p className="muted">A simple username and password keeps each tester's data in a separate workspace.</p>
      </div>
      <div className="login-mode-tabs" role="tablist" aria-label="Tester account mode">
        <button
          className={testAuthMode === 'signup' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={testAuthMode === 'signup'}
          onClick={() => {
            setTestAuthMode('signup');
            setTestError(null);
          }}
        >
          New tester
        </button>
        <button
          className={testAuthMode === 'login' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={testAuthMode === 'login'}
          onClick={() => {
            setTestAuthMode('login');
            setTestError(null);
          }}
        >
          Returning tester
        </button>
      </div>
      <label>
        Username
        <input
          className="input"
          autoComplete="username"
          value={testUsername}
          onChange={(event) => setTestUsername(event.target.value)}
          placeholder="your-name"
        />
      </label>
      <label>
        Password
        <input
          className="input"
          type="password"
          autoComplete={testAuthMode === 'signup' ? 'new-password' : 'current-password'}
          value={testPassword}
          onChange={(event) => setTestPassword(event.target.value)}
        />
      </label>
      {testError ? <p className="notice warning">{testError}</p> : null}
      <button type="submit" disabled={testLoading}>
        {testLoading ? 'Working...' : testAuthMode === 'signup' ? 'Create tester account' : 'Sign in'}
      </button>
    </form>
  );

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
              <button
                className={loginMode === 'test' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={loginMode === 'test'}
                onClick={() => setLoginMode('test')}
              >
                Tester account
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

            {loginMode === 'test' ? testAccountForm : null}

            <div className="login-account-note">
              <strong>For testers</strong>
              <p>
                Start with the pilot account if you want to see the dashboard right away. Use a tester account
                when you want a separate workspace.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const allowLocalDevLogin = isLocalDevHost();

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-intro">
          <p className="eyebrow">TeacherOS</p>
          <h1>{allowLocalDevLogin ? 'Local test mode' : 'Tester access'}</h1>
          <p className="muted">
            {allowLocalDevLogin
              ? 'Use this only when Clerk is not configured for this build.'
              : 'Create a simple tester account so your courses and plans stay separate.'}
          </p>
          <div className="login-proof-list">
            <span>{allowLocalDevLogin ? 'Local' : 'Tester'}</span>
            <span>Testing</span>
            <span>Backend token</span>
          </div>
        </div>
        <div className="login-workspace-card">
          <div className="login-mode-tabs" role="tablist" aria-label="Local login options">
            {allowLocalDevLogin ? (
              <>
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
              </>
            ) : null}
            <button
              className={loginMode === 'test' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={loginMode === 'test'}
              onClick={() => setLoginMode('test')}
            >
              Tester account
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

          {allowLocalDevLogin && (loginMode === 'signin' || loginMode === 'signup') ? (
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

          {loginMode === 'test' ? testAccountForm : null}

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
