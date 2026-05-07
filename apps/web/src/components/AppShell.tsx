import { NavLink, Outlet } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const links = [
  { path: '/', label: 'Dashboard' },
  { path: '/classroom', label: 'Classroom' },
  { path: '/curriculum', label: 'Curriculum' },
  { path: '/schedule', label: 'Schedule' },
  { path: '/school', label: 'School' },
  { path: '/profile', label: 'Profile' }
];

export function AppShell() {
  const auth = useAppAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>TeacherOS v2</h2>
        <p className="muted">{auth.email ?? auth.userId ?? 'Signed in'}</p>
        <nav>
          {links.map((link) => (
            <NavLink key={link.path} to={link.path}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="secondary"
          type="button"
          onClick={() => {
            void auth.signOut();
          }}
          style={{ marginTop: 18 }}
        >
          Sign out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
