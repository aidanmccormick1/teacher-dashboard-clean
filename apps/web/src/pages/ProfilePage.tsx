import { useAppAuth } from '../lib/auth.js';

export function ProfilePage() {
  const auth = useAppAuth();

  return (
    <div className="stack">
      <h1>Profile</h1>
      <div className="card stack">
        <p>User ID: {auth.userId}</p>
        <p>Email: {auth.email ?? 'Not available'}</p>
        <p className="muted">
          Profile editing endpoints are intentionally deferred until the core workflow migration is
          complete.
        </p>
      </div>
    </div>
  );
}
