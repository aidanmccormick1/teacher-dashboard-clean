import { SignIn } from '@clerk/clerk-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

export function LoginPage() {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const [devUserId, setDevUserId] = useState('teacher-dev-1');
  const [devEmail, setDevEmail] = useState('teacher@example.com');

  useEffect(() => {
    if (auth.isSignedIn) navigate('/');
  }, [auth.isSignedIn, navigate]);

  if (auth.mode === 'clerk') {
    return (
      <div className="card">
        <SignIn fallbackRedirectUrl="/" />
      </div>
    );
  }

  return (
    <div className="card stack" style={{ maxWidth: 420 }}>
      <h1>Developer Login</h1>
      <p className="muted">Clerk publishable key is missing. Using local dev auth mode.</p>
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
          navigate('/');
        }}
      >
        Sign in
      </button>
    </div>
  );
}
