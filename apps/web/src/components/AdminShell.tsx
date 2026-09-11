import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { AdminOverviewResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

const adminNavigation = [
  { label: 'Overview', href: '/admin', end: true },
  { label: 'Teachers', href: '/admin/teachers', end: false },
  { label: 'Courses', href: '/admin/courses', end: false },
  { label: 'Schedule', href: '/admin/schedule', end: true },
  { label: 'Curriculum', href: '/admin/curriculum', end: true },
  { label: 'Calendar', href: '/admin/calendar', end: true },
  { label: 'School', href: '/admin/school', end: true }
] as const;

type AdminAccessContextValue = {
  overview: AdminOverviewResponse;
};

import { createContext, useContext } from 'react';

const AdminAccessContext = createContext<AdminAccessContextValue | null>(null);

export function useAdminAccessOverview() {
  const context = useContext(AdminAccessContext);
  if (!context) throw new Error('useAdminAccessOverview must be used inside AdminAccessGate');
  return context.overview;
}

export function AdminAccessGate() {
  const api = useApiClient();
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);

  const load = useCallback(() => {
    setState('loading');
    setError(null);
    void api
      .getAdminOverview()
      .then((result) => {
        setOverview(result);
        setState('ready');
      })
      .catch((err) => {
        setStatus(err instanceof ApiError ? err.status : null);
        setError(err instanceof ApiError ? err.message : 'Could not verify administrator access.');
        setState('error');
      });
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === 'loading') {
    return (
      <main
        className="admin-route-gate page-entry"
        aria-busy="true"
        aria-label="Checking administrator access"
      >
        <section className="card admin-route-gate-card">
          <p className="eyebrow">Admin workspace</p>
          <h1>Checking school access</h1>
          <p className="muted">We are verifying the administrator role for this school.</p>
        </section>
      </main>
    );
  }

  if (state === 'error' || !overview) {
    const accessDenied = status === 403 || status === 404;
    return (
      <main className="admin-route-gate page-entry">
        <section className="card admin-route-gate-card">
          <p className="eyebrow">Admin workspace</p>
          <h1>
            {accessDenied ? 'Administrator access is not enabled' : 'We could not check access'}
          </h1>
          <p className="muted">
            {accessDenied
              ? 'This school is still teacher-led, or your claim has not been approved. You can request access after joining the school.'
              : (error ?? 'Try again to continue.')}
          </p>
          <div className="admin-actions">
            {accessDenied ? (
              <Link className="button-link" to="/admin/request-access">
                Request school access
              </Link>
            ) : (
              <button type="button" onClick={load}>
                Check again
              </button>
            )}
            <Link className="button-link secondary" to="/today?workspace=teaching">
              Return to teaching
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <AdminAccessContext.Provider value={{ overview }}>
      <Outlet />
    </AdminAccessContext.Provider>
  );
}

export function AdminShell() {
  const auth = useAppAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-topbar">
          <Link className="admin-brand" to="/admin" aria-label="TeacherDesk admin overview">
            <span className="admin-brand-mark" aria-hidden="true">
              TD
            </span>
            <span>
              <strong>TeacherDesk</strong>
              <small>School operations</small>
            </span>
          </Link>
          <button
            className="admin-menu-toggle secondary"
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="admin-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            Menu
          </button>
        </div>
        <div className="admin-sidebar-content" data-mobile-open={mobileOpen}>
          <div className="admin-sidebar-account">
            <span className="eyebrow">Administrator workspace</span>
            <span className="muted">{auth.email ?? 'Signed in'}</span>
          </div>
          <nav
            id="admin-navigation"
            className="admin-navigation"
            aria-label="Administrator navigation"
          >
            {adminNavigation.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="admin-sidebar-secondary">
            <Link to="/today?workspace=teaching">Teaching workspace</Link>
            <Link to="/profile">Profile</Link>
            <button
              className="admin-sidebar-signout secondary"
              type="button"
              onClick={() => void auth.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
