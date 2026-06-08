import { SignIn } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const PILOT_EMAIL = 'teacher.test@example.com';
const PILOT_PASSWORD = 'TeacherTest2026!';

export function LoginPage() {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const [devUserId, setDevUserId] = useState('teacher-dev-1');
  const [devEmail, setDevEmail] = useState('teacher@example.com');
  const [pilotEmail, setPilotEmail] = useState(PILOT_EMAIL);
  const [pilotPassword, setPilotPassword] = useState('');
  const [pilotError, setPilotError] = useState<string | null>(null);
  const [pilotStatus, setPilotStatus] = useState<string | null>(null);

  useEffect(() => {
    if (auth.isSignedIn) navigate('/dashboard');
  }, [auth.isSignedIn, navigate]);

  if (auth.mode === 'clerk') {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-intro">
            <p className="eyebrow">Teacher Dashboard</p>
            <h1>Plan the day, then teach from the right place.</h1>
            <p className="muted">
              Sign in to manage courses, schedules, year plans, and class progress in one workspace.
            </p>
          </div>
          <div className="login-card">
            <SignIn fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard" />
          </div>
          <form
            className="pilot-login-card"
            onSubmit={(event) => {
              event.preventDefault();
              if (pilotEmail.trim().toLowerCase() !== PILOT_EMAIL || pilotPassword !== PILOT_PASSWORD) {
                setPilotError('Use the temporary teacher test credentials.');
                setPilotStatus(null);
                return;
              }

              auth.signInPilot();
              navigate('/dashboard');
            }}
          >
            <div>
              <strong>Temporary teacher test login</strong>
              <p className="muted">Use this while Clerk email verification is being finalized.</p>
            </div>
            <div className="pilot-credential-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setPilotEmail(PILOT_EMAIL);
                  setPilotPassword(PILOT_PASSWORD);
                  setPilotError(null);
                  setPilotStatus('Test login filled.');
                }}
              >
                Fill test login
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`Email: ${PILOT_EMAIL}\nPassword: ${PILOT_PASSWORD}`)
                    .catch(() => undefined);
                  setPilotStatus('Test credentials copied.');
                }}
              >
                Copy credentials
              </button>
            </div>
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
            <button type="submit" className="secondary">
              Use temporary login
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-intro">
          <p className="eyebrow">Teacher Dashboard</p>
          <h1>Local test login</h1>
          <p className="muted">Use this only when Clerk is not configured for the local dev server.</p>
        </div>
        <div className="card stack login-dev-card">
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
            Sign in
          </button>
        </div>
      </section>
    </main>
  );
}
