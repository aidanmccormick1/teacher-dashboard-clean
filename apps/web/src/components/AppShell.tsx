import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const links = [
  { path: '/', label: 'Dashboard' },
  { path: '/classroom', label: 'Classroom' },
  { path: '/management', label: 'Management' },
  { path: '/school', label: 'School' },
  { path: '/profile', label: 'Profile' }
];

export function AppShell() {
  const auth = useAppAuth();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState('Confusing');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  const saveFeedback = async () => {
    const entry = {
      type: feedbackType,
      text: feedbackText.trim(),
      page: window.location.pathname,
      user: auth.email ?? auth.userId ?? 'unknown',
      createdAt: new Date().toISOString()
    };
    const existing = JSON.parse(window.localStorage.getItem('teacheros_feedback_notes') ?? '[]') as typeof entry[];
    window.localStorage.setItem('teacheros_feedback_notes', JSON.stringify([entry, ...existing].slice(0, 25)));
    setFeedbackSaved(true);
    await navigator.clipboard?.writeText(
      `TeacherOS feedback\nType: ${entry.type}\nPage: ${entry.page}\nUser: ${entry.user}\n\n${entry.text}`
    ).catch(() => undefined);
    setFeedbackText('');
  };

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
        <button className="feedback-button" type="button" onClick={() => setIsFeedbackOpen(true)}>
          Send feedback
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
      {isFeedbackOpen ? (
        <aside className="feedback-drawer" aria-label="Teacher feedback">
          <div className="feedback-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Teacher feedback</p>
                <h2>What should we fix?</h2>
              </div>
              <button className="secondary" type="button" onClick={() => setIsFeedbackOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted">Saved locally and copied to your clipboard so you can send it during testing.</p>
            <select className="input" value={feedbackType} onChange={(event) => setFeedbackType(event.target.value)}>
              <option>Confusing</option>
              <option>Broken</option>
              <option>Missing feature</option>
              <option>Nice to have</option>
            </select>
            <textarea
              rows={7}
              value={feedbackText}
              onChange={(event) => {
                setFeedbackText(event.target.value);
                setFeedbackSaved(false);
              }}
              placeholder="What happened? What did you expect?"
            />
            <button type="button" disabled={!feedbackText.trim()} onClick={() => void saveFeedback()}>
              Save and copy
            </button>
            {feedbackSaved ? <p className="notice success">Feedback saved locally and copied.</p> : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
