import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

type FeedbackEntry = {
  type: string;
  text: string;
  page: string;
  user: string;
  createdAt: string;
  syncStatus?: 'pending' | 'synced' | 'failed';
  feedbackId?: string;
  lastSyncError?: string;
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

function writeFeedbackEntries(entries: FeedbackEntry[]) {
  window.localStorage.setItem(feedbackStorageKey, JSON.stringify(entries));
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
  const [isSyncingFeedback, setIsSyncingFeedback] = useState(false);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [apiCheckedAt, setApiCheckedAt] = useState<string | null>(null);
  const [apiStatusCopied, setApiStatusCopied] = useState(false);

  const checkApi = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setApiStatus('checking');
      try {
        const response = await fetch(`${apiBaseUrl}/health/liveness`, { cache: 'no-store' });
        setApiStatus(response.ok ? 'online' : 'offline');
      } catch {
        setApiStatus('offline');
      } finally {
        setApiCheckedAt(new Date().toLocaleTimeString());
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const guardedCheck = async (options?: { silent?: boolean }) => {
      if (cancelled) return;
      await checkApi(options);
    };

    void guardedCheck();
    const timer = window.setInterval(() => void guardedCheck({ silent: true }), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [checkApi]);

  const copyApiStatus = async () => {
    const report = [
      'TeacherOS backend status',
      `Status: ${apiStatus}`,
      `API base URL: ${apiBaseUrl}`,
      `Checked at: ${apiCheckedAt ?? 'Not checked yet'}`,
      `Page: ${window.location.pathname}`,
      `User: ${auth.email ?? auth.userId ?? 'unknown'}`
    ].join('\n');
    await navigator.clipboard?.writeText(report).catch(() => undefined);
    setApiStatusCopied(true);
    window.setTimeout(() => setApiStatusCopied(false), 1600);
  };

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
      createdAt: new Date().toISOString(),
      syncStatus: 'pending'
    };
    const nextEntries = [entry, ...readFeedbackEntries()].slice(0, 25);
    writeFeedbackEntries(nextEntries);
    setFeedbackEntries(nextEntries);
    setFeedbackSaved(true);
    try {
      const response = await api.submitFeedback({
        type: entry.type as 'Confusing' | 'Broken' | 'Missing feature' | 'Nice to have',
        page: entry.page,
        message: entry.text,
        userAgent: window.navigator.userAgent
      });
      const syncedEntries = nextEntries.map((item) =>
        item.createdAt === entry.createdAt
          ? { ...item, syncStatus: 'synced' as const, feedbackId: response.feedbackId, lastSyncError: undefined }
          : item
      );
      writeFeedbackEntries(syncedEntries);
      setFeedbackEntries(syncedEntries);
      setFeedbackApiStatus('Saved to backend and copied.');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `Backend did not accept it yet: ${err.message}`
          : 'Backend feedback save failed.';
      const failedEntries = nextEntries.map((item) =>
        item.createdAt === entry.createdAt ? { ...item, syncStatus: 'failed' as const, lastSyncError: message } : item
      );
      writeFeedbackEntries(failedEntries);
      setFeedbackEntries(failedEntries);
      setFeedbackApiStatus(
        err instanceof ApiError
          ? `Saved locally. Backend did not accept it yet: ${err.message}`
          : 'Saved locally. Backend feedback save failed.'
      );
    }
    await navigator.clipboard?.writeText(`TeacherOS feedback\n${formatFeedbackEntry(entry)}`).catch(() => undefined);
    setFeedbackText('');
  };

  const syncUnsentFeedback = async () => {
    const entries = readFeedbackEntries();
    const unsentEntries = entries.filter((entry) => entry.syncStatus !== 'synced');
    if (!unsentEntries.length) {
      setFeedbackApiStatus('All local feedback has already been sent.');
      return;
    }

    setIsSyncingFeedback(true);
    let sentCount = 0;
    const nextEntries = [...entries];

    for (const entry of unsentEntries) {
      const entryIndex = nextEntries.findIndex((item) => item.createdAt === entry.createdAt && item.page === entry.page);
      if (entryIndex === -1) continue;
      const currentEntry = nextEntries[entryIndex];
      if (!currentEntry) continue;

      try {
        const response = await api.submitFeedback({
          type: entry.type as 'Confusing' | 'Broken' | 'Missing feature' | 'Nice to have',
          page: entry.page,
          message: entry.text,
          userAgent: window.navigator.userAgent
        });
        nextEntries[entryIndex] = {
          ...currentEntry,
          syncStatus: 'synced',
          feedbackId: response.feedbackId,
          lastSyncError: undefined
        };
        sentCount += 1;
      } catch (err) {
        nextEntries[entryIndex] = {
          ...currentEntry,
          syncStatus: 'failed',
          lastSyncError: err instanceof ApiError ? err.message : 'Backend feedback save failed.'
        };
      }
    }

    writeFeedbackEntries(nextEntries);
    setFeedbackEntries(nextEntries);
    setIsSyncingFeedback(false);
    setFeedbackApiStatus(sentCount ? `Sent ${sentCount} saved report${sentCount === 1 ? '' : 's'} to the backend.` : 'Could not send saved reports yet.');
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
    setFeedbackApiStatus(null);
  };

  const unsentFeedbackCount = feedbackEntries.filter((entry) => entry.syncStatus !== 'synced').length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>TeacherOS v2</h2>
        <p className="muted">{auth.email ?? auth.userId ?? 'Signed in'}</p>
        <div className="api-status-card">
          <div className={`api-status ${apiStatus}`}>
            <span />
            {apiStatus === 'checking' ? 'Checking backend' : apiStatus === 'online' ? 'Backend online' : 'Backend offline'}
          </div>
          {apiCheckedAt ? <small>Checked {apiCheckedAt}</small> : null}
          <div className="api-status-actions">
            <button className="secondary" type="button" onClick={() => void checkApi()}>
              Recheck
            </button>
            <button className="secondary" type="button" onClick={() => void copyApiStatus()}>
              {apiStatusCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
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
                  <button className="secondary" type="button" disabled={!unsentFeedbackCount || isSyncingFeedback} onClick={() => void syncUnsentFeedback()}>
                    {isSyncingFeedback ? 'Sending...' : `Send unsent${unsentFeedbackCount ? ` (${unsentFeedbackCount})` : ''}`}
                  </button>
                  <button className="secondary danger" type="button" disabled={!feedbackEntries.length} onClick={clearFeedback}>
                    Clear
                  </button>
                </div>
              </div>
              {feedbackEntries.length ? (
                feedbackEntries.slice(0, 5).map((entry) => (
                  <article key={`${entry.createdAt}-${entry.page}`} className="feedback-history-card">
                    <div className="feedback-history-meta">
                      <strong>{entry.type}</strong>
                      <span className={`sync-pill ${entry.syncStatus ?? 'pending'}`}>
                        {entry.syncStatus === 'synced' ? 'Sent' : entry.syncStatus === 'failed' ? 'Needs send' : 'Pending'}
                      </span>
                    </div>
                    <span>{entry.page}</span>
                    <p>{entry.text}</p>
                    {entry.lastSyncError ? <small>{entry.lastSyncError}</small> : null}
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
