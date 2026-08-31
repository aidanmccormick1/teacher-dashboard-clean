import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';
import {
  primaryNavigationIdForPath,
  primaryNavigationItems,
  hasSidebarCollapsePreference,
  readSidebarCollapsed,
  saveSidebarCollapsed
} from '../lib/navigation.js';

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
  const location = useLocation();
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed);
  const [isSidebarHoverExpanded, setIsSidebarHoverExpanded] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState('Confusing');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [feedbackApiStatus, setFeedbackApiStatus] = useState<string | null>(null);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [isSyncingFeedback, setIsSyncingFeedback] = useState(false);
  const mobileNavigationRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const activePrimaryNavigationId = primaryNavigationIdForPath(location.pathname);
  const visuallyCollapsed = isSidebarCollapsed && !isSidebarHoverExpanded;

  useEffect(() => {
    if (location.pathname === '/year-plan' && !hasSidebarCollapsePreference()) {
      setIsSidebarCollapsed(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileNavigationOpen || !window.matchMedia('(max-width: 920px)').matches) return;
    mobileNavigationRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [isMobileNavigationOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isMobileNavigationOpen) return;
      setIsMobileNavigationOpen(false);
      mobileToggleRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isMobileNavigationOpen]);

  const closeMobileNavigation = () => setIsMobileNavigationOpen(false);
  const toggleSidebar = () => {
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    setIsSidebarHoverExpanded(false);
    saveSidebarCollapsed(next);
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
          ? {
              ...item,
              syncStatus: 'synced' as const,
              feedbackId: response.feedbackId,
              lastSyncError: undefined
            }
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
        item.createdAt === entry.createdAt
          ? { ...item, syncStatus: 'failed' as const, lastSyncError: message }
          : item
      );
      writeFeedbackEntries(failedEntries);
      setFeedbackEntries(failedEntries);
      setFeedbackApiStatus(
        err instanceof ApiError
          ? `Saved locally. Backend did not accept it yet: ${err.message}`
          : 'Saved locally. Backend feedback save failed.'
      );
    }
    await navigator.clipboard
      ?.writeText(`TeacherDesk feedback\n${formatFeedbackEntry(entry)}`)
      .catch(() => undefined);
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
      const entryIndex = nextEntries.findIndex(
        (item) => item.createdAt === entry.createdAt && item.page === entry.page
      );
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
    setFeedbackApiStatus(
      sentCount
        ? `Sent ${sentCount} saved report${sentCount === 1 ? '' : 's'} to the backend.`
        : 'Could not send saved reports yet.'
    );
  };

  const copyAllFeedback = async () => {
    const report = feedbackEntries
      .map((entry, index) => `#${index + 1}\n${formatFeedbackEntry(entry)}`)
      .join('\n\n---\n\n');
    await navigator.clipboard
      ?.writeText(report || 'No TeacherDesk feedback yet.')
      .catch(() => undefined);
    setFeedbackSaved(true);
  };

  const clearFeedback = () => {
    if (!window.confirm('Clear locally saved feedback notes?')) return;
    window.localStorage.removeItem(feedbackStorageKey);
    setFeedbackEntries([]);
    setFeedbackApiStatus(null);
  };

  const unsentFeedbackCount = feedbackEntries.filter(
    (entry) => entry.syncStatus !== 'synced'
  ).length;

  return (
    <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside
        className={`sidebar${isSidebarCollapsed ? ' sidebar-collapsed' : ''}${
          isSidebarHoverExpanded ? ' sidebar-hover-expanded' : ''
        }`}
        onMouseEnter={() => {
          if (isSidebarCollapsed) setIsSidebarHoverExpanded(true);
        }}
        onMouseLeave={() => setIsSidebarHoverExpanded(false)}
        onFocusCapture={() => {
          if (isSidebarCollapsed) setIsSidebarHoverExpanded(true);
        }}
        onBlurCapture={(event) => {
          if (isSidebarCollapsed && !event.currentTarget.contains(event.relatedTarget)) {
            setIsSidebarHoverExpanded(false);
          }
        }}
      >
        <div className="sidebar-topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              TD
            </span>
            <div className="brand-copy">
              <h2>TeacherDesk</h2>
              <span>Calico EDU</span>
            </div>
          </div>
          <button
            className="sidebar-collapse-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            onClick={toggleSidebar}
          >
            <span aria-hidden="true">{isSidebarCollapsed ? '›' : '‹'}</span>
          </button>
          <button
            ref={mobileToggleRef}
            className="sidebar-mobile-toggle secondary"
            type="button"
            aria-expanded={isMobileNavigationOpen}
            aria-controls="primary-navigation"
            onClick={() => setIsMobileNavigationOpen((open) => !open)}
          >
            Menu
          </button>
        </div>
        <div
          className="sidebar-navigation"
          data-mobile-open={isMobileNavigationOpen}
          ref={mobileNavigationRef}
        >
          <p className="sidebar-account muted">{auth.email ?? auth.userId ?? 'Signed in'}</p>
          <nav id="primary-navigation" aria-label="Primary navigation">
            {primaryNavigationItems.map((item) => (
              <NavLink
                key={item.id}
                to={item.href}
                className={activePrimaryNavigationId === item.id ? 'active' : ''}
                aria-label={item.label}
                title={visuallyCollapsed ? item.label : undefined}
                onClick={closeMobileNavigation}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="sidebar-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <nav className="sidebar-secondary" aria-label="Secondary navigation">
            <div className="sidebar-import">
              <button
                className="sidebar-secondary-action secondary"
                type="button"
                aria-expanded={isImportOpen}
                onClick={() => setIsImportOpen((open) => !open)}
                title={visuallyCollapsed ? 'Import' : undefined}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  ⇧
                </span>
                <span className="sidebar-nav-label">Import</span>
              </button>
              {isImportOpen ? (
                <div className="sidebar-import-menu">
                  <Link
                    to="/management"
                    onClick={() => {
                      setIsImportOpen(false);
                      closeMobileNavigation();
                    }}
                  >
                    Class Schedule
                  </Link>
                  <Link
                    to="/school"
                    onClick={() => {
                      setIsImportOpen(false);
                      closeMobileNavigation();
                    }}
                  >
                    School Calendar
                  </Link>
                </div>
              ) : null}
            </div>
            <NavLink
              to="/profile"
              className="sidebar-secondary-link"
              aria-label="Profile"
              title={visuallyCollapsed ? 'Profile' : undefined}
              onClick={closeMobileNavigation}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                ○
              </span>
              <span className="sidebar-nav-label">Profile</span>
            </NavLink>
            <button
              className="sidebar-secondary-action feedback-button"
              type="button"
              title={visuallyCollapsed ? 'Feedback' : undefined}
              onClick={() => {
                openFeedback();
                closeMobileNavigation();
              }}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                ?
              </span>
              <span className="sidebar-nav-label">Feedback</span>
            </button>
            <button
              className="sidebar-secondary-action secondary"
              type="button"
              title={visuallyCollapsed ? 'Sign out' : undefined}
              onClick={() => {
                closeMobileNavigation();
                void auth.signOut();
              }}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                ↪
              </span>
              <span className="sidebar-nav-label">Sign out</span>
            </button>
          </nav>
        </div>
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
            <p className="muted">
              Saved locally and copied to your clipboard so you can send it during testing.
            </p>
            <select
              className="input"
              value={feedbackType}
              onChange={(event) => setFeedbackType(event.target.value)}
            >
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
            <button
              type="button"
              disabled={!feedbackText.trim()}
              onClick={() => void saveFeedback()}
            >
              Save and copy
            </button>
            {feedbackSaved ? (
              <p className="notice success">Feedback saved locally and copied.</p>
            ) : null}
            {feedbackApiStatus ? <p className="muted">{feedbackApiStatus}</p> : null}
            <div className="feedback-history">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Saved notes</p>
                  <h3>{feedbackEntries.length} local reports</h3>
                </div>
                <div className="profile-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => void copyAllFeedback()}
                  >
                    Copy all
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={!unsentFeedbackCount || isSyncingFeedback}
                    onClick={() => void syncUnsentFeedback()}
                  >
                    {isSyncingFeedback
                      ? 'Sending...'
                      : `Send unsent${unsentFeedbackCount ? ` (${unsentFeedbackCount})` : ''}`}
                  </button>
                  <button
                    className="secondary danger"
                    type="button"
                    disabled={!feedbackEntries.length}
                    onClick={clearFeedback}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {feedbackEntries.length ? (
                feedbackEntries.slice(0, 5).map((entry) => (
                  <article
                    key={`${entry.createdAt}-${entry.page}`}
                    className="feedback-history-card"
                  >
                    <div className="feedback-history-meta">
                      <strong>{entry.type}</strong>
                      <span className={`sync-pill ${entry.syncStatus ?? 'pending'}`}>
                        {entry.syncStatus === 'synced'
                          ? 'Sent'
                          : entry.syncStatus === 'failed'
                            ? 'Needs send'
                            : 'Pending'}
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
