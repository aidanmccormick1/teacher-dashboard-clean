import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

type FeedbackEntry = {
  type: string;
  text: string;
  page: string;
  user: string;
  createdAt: string;
};

const feedbackStorageKey = 'teacheros_feedback_notes';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

const links = [
  { path: '/', label: 'Dashboard' },
  { path: '/classroom', label: 'Classroom' },
  { path: '/management', label: 'Management' },
  { path: '/school', label: 'School' },
  { path: '/profile', label: 'Profile' }
];

function readFeedbackEntries(): FeedbackEntry[] {
  try {
    return JSON.parse(window.localStorage.getItem(feedbackStorageKey) ?? '[]') as FeedbackEntry[];
  } catch {
    return [];
  }
}

function formatFeedbackEntry(entry: FeedbackEntry): string {
  return [
    `Type: ${entry.type}`,
    `Page: ${entry.page}`,
    `User: ${entry.user}`,
    `Time: ${entry.createdAt}`,
    '',
    entry.text
  ].join('\n');
}

export function AppShell() {
  const auth = useAppAuth();
  const api = useApiClient();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState('Confusing');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackApiStatus, setFeedbackApiStatus] = useState<string | null>(null);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    let cancelled = false;

    const checkApi = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/health/liveness`, { cache: 'no-store' });
        if (!cancelled) setApiStatus(response.ok ? 'online' : 'offline');
      } catch {
        if (!cancelled) setApiStatus('offline');
      }
    };

    void checkApi();
    const timer = window.setInterval(() => void checkApi(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const openFeedback = () => {
    setFeedbackEntries(readFeedbackEntries());
    setIsFeedbackOpen(true);
  };

  const saveFeedback = async () => {
    const entry: FeedbackEntry = {
      type: feedbackType,
      text: feedbackText.trim(),
      page: window.location.pathname,
      user: auth.email ?? auth.userId ?? 'unknown',
      createdAt: new Date().toISOString()
    };
    const nextEntries = [entry, ...readFeedbackEntries()].slice(0, 25);
    window.localStorage.setItem(feedbackStorageKey, JSON.stringify(nextEntries));
    setFeedbackEntries(nextEntries);
    setFeedbackSaved(true);
    try {
      await api.submitFeedback({
        type: entry.type as 'Confusing' | 'Broken' | 'Missing feature' | 'Nice to have',
        page: entry.page,
        message: entry.text,
        userAgent: window.navigator.userAgent
      });
      setFeedbackApiStatus('Saved to backend and copied.');
    } catch (err) {
      setFeedbackApiStatus(
        err instanceof ApiError
          ? `Saved locally. Backend did not accept it yet: ${err.message}`
          : 'Saved locally. Backend feedback save failed.'
      );
    }
    await navigator.clipboard?.writeText(`TeacherOS feedback\n${formatFeedbackEntry(entry)}`).catch(() => undefined);
    setFeedbackText('');
  };

  const copyAllFeedback = async () => {
    const report = feedbackEntries.map((entry, index) => `#${index + 1}\n${formatFeedbackEntry(entry)}`).join('\n\n---\n\n');
    await navigator.clipboard?.writeText(report || 'No TeacherOS feedback yet.').catch(() => undefined);
    setFeedbackSaved(true);
  };

  const clearFeedback = () => {
    if (!window.confirm('Clear locally saved feedback notes?')) return;
    window.localStorage.removeItem(feedbackStorageKey);
    setFeedbackEntries([]);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>TeacherOS v2</h2>
        <p className="muted">{auth.email ?? auth.userId ?? 'Signed in'}</p>
        <div className={`api-status ${apiStatus}`}>
          <span />
          {apiStatus === 'checking' ? 'Checking backend' : apiStatus === 'online' ? 'Backend online' : 'Backend offline'}
        </div>
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
        <button className="feedback-button" type="button" onClick={openFeedback}>
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
                setFeedbackApiStatus(null);
              }}
              placeholder="What happened? What did you expect?"
            />
            <button type="button" disabled={!feedbackText.trim()} onClick={() => void saveFeedback()}>
              Save and copy
            </button>
            {feedbackSaved ? <p className="notice success">Feedback saved locally and copied.</p> : null}
            {feedbackApiStatus ? <p className="muted">{feedbackApiStatus}</p> : null}
            <div className="feedback-history">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Saved notes</p>
                  <h3>{feedbackEntries.length} local reports</h3>
                </div>
                <div className="profile-actions">
                  <button className="secondary" type="button" onClick={() => void copyAllFeedback()}>
                    Copy all
                  </button>
                  <button className="secondary danger" type="button" disabled={!feedbackEntries.length} onClick={clearFeedback}>
                    Clear
                  </button>
                </div>
              </div>
              {feedbackEntries.length ? (
                feedbackEntries.slice(0, 5).map((entry) => (
                  <article key={`${entry.createdAt}-${entry.page}`} className="feedback-history-card">
                    <strong>{entry.type}</strong>
                    <span>{entry.page}</span>
                    <p>{entry.text}</p>
                  </article>
                ))
              ) : (
                <p className="muted">No saved feedback yet.</p>
              )}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
