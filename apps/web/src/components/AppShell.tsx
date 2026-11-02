import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { NotificationListResponse } from '@teacheros/contracts';

import { useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';
import { primaryNavigationIdForPath, primaryNavigationItems } from '../lib/navigation.js';
import { HobieHelper, type HobieContext } from './HobieHelper.js';
import { useOpenFeedback } from './FeedbackProvider.js';

const profileStorageKey = 'teacheros_profile_draft_v1';
const sidebarWidthStorageKey = 'teacheros_sidebar_width_v1';
const sidebarMinWidth = 232;
const sidebarMaxWidth = 380;
const sidebarDefaultWidth = 286;

function readSidebarWidth(): number {
  const saved = Number(window.localStorage.getItem(sidebarWidthStorageKey));
  return Number.isFinite(saved)
    ? Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, saved))
    : sidebarDefaultWidth;
}

function saveSidebarWidth(width: number): void {
  window.localStorage.setItem(sidebarWidthStorageKey, String(width));
}

function readProfileDisplayName(): string | null {
  try {
    const draft = JSON.parse(window.localStorage.getItem(profileStorageKey) ?? '{}') as {
      preferredName?: string;
      fullName?: string;
    };
    return draft.preferredName?.trim() || draft.fullName?.trim() || null;
  } catch {
    return null;
  }
}

export function AppShell() {
  const openFeedback = useOpenFeedback();
  const auth = useAppAuth();
  const api = useApiClient();
  const location = useLocation();
  const [profileDisplayName, setProfileDisplayName] = useState(readProfileDisplayName);
  const [profileRole, setProfileRole] = useState<'teacher' | 'admin' | null>(null);
  const [isFeedbackSupport, setIsFeedbackSupport] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationListResponse>({
    notifications: [],
    unreadCount: 0
  });
  const mobileNavigationRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const activePrimaryNavigationId = primaryNavigationIdForPath(location.pathname);
  const sidebarResizePointerId = useRef<number | null>(null);

  useEffect(() => {
    void api
      .feedbackRequest<{ isSupport: boolean }>('/v1/feedback/access')
      .then((result) => setIsFeedbackSupport(result.isSupport))
      .catch(() => setIsFeedbackSupport(false));
    void api
      .getProfile()
      .then((profile) => {
        setProfileDisplayName(readProfileDisplayName() ?? profile.user.fullName);
        setProfileRole(profile.profile?.role ?? null);
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void api
        .getNotifications()
        .then((result) => {
          if (!cancelled) setNotifications(result);
        })
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, location.pathname]);

  useEffect(() => {
    if (!isMobileNavigationOpen || !window.matchMedia('(max-width: 920px)').matches) return;
    mobileNavigationRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [isMobileNavigationOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isImportOpen) {
        setIsImportOpen(false);
        return;
      }
      if (isNotificationsOpen) {
        setIsNotificationsOpen(false);
        return;
      }
      if (isMobileNavigationOpen) {
        setIsMobileNavigationOpen(false);
        mobileToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isImportOpen, isMobileNavigationOpen, isNotificationsOpen]);

  const closeMobileNavigation = () => setIsMobileNavigationOpen(false);
  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextWidth = Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, event.clientX));
    setSidebarWidth(nextWidth);
  };
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingSidebar(true);
  };
  const finishSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarResizePointerId.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    sidebarResizePointerId.current = null;
    setIsResizingSidebar(false);
    setSidebarWidth((currentWidth) => {
      saveSidebarWidth(currentWidth);
      return currentWidth;
    });
  };
  const hobieContext: HobieContext =
    location.pathname === '/courses'
      ? 'import'
      : location.pathname === '/school'
        ? 'calendar'
        : location.pathname === '/year-plan'
          ? 'unit'
          : location.pathname.includes('/lessons/')
            ? 'lesson'
            : location.pathname === '/guide' || location.pathname === '/welcome'
              ? 'import'
              : 'default';

  const markNotificationRead = async (notificationId: string) => {
    const notification = notifications.notifications.find((item) => item.id === notificationId);
    if (!notification || notification.status === 'read') return;
    try {
      setNotifications(await api.markNotificationRead(notificationId));
    } catch {
      // Opening the destination is more important than blocking navigation on
      // a transient read-status request. The next refresh will retry visually.
    }
  };

  return (
    <div
      className={`app-shell${isResizingSidebar ? ' sidebar-resizing' : ''}`}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="sidebar-topbar">
          <div className="brand-lockup animated-brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              TD
            </span>
            <div className="brand-copy">
              <h2>TeacherDesk</h2>
              <span>Calico EDU</span>
            </div>
          </div>
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
          <div className="sidebar-account-row">
            <p className="sidebar-account muted">
              {profileDisplayName ?? auth.email ?? auth.userId ?? 'Signed in'}
            </p>
            <button
              className="notification-trigger secondary"
              type="button"
              aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ''}`}
              aria-expanded={isNotificationsOpen}
              onClick={() => setIsNotificationsOpen((open) => !open)}
            >
              <span aria-hidden="true">◌</span>
              {notifications.unreadCount ? <strong>{notifications.unreadCount}</strong> : null}
            </button>
          </div>
          {isNotificationsOpen ? (
            <section className="notification-panel" aria-label="Notifications">
              <header>
                <div>
                  <strong>Notifications</strong>
                  <span>{notifications.unreadCount} unread</span>
                </div>
                {notifications.unreadCount ? (
                  <button
                    className="button-link"
                    type="button"
                    onClick={async () => {
                      setNotifications(await api.markAllNotificationsRead());
                    }}
                  >
                    Mark all read
                  </button>
                ) : null}
              </header>
              <div className="notification-list">
                {notifications.notifications.length ? (
                  notifications.notifications.map((notification) => {
                    const content = (
                      <>
                        <span className="notification-status" aria-hidden="true" />
                        <span>
                          <strong>{notification.title}</strong>
                          <span>
                            {notification.actor?.fullName ??
                              notification.actor?.email ??
                              'TeacherDesk'}{' '}
                            {notification.message}
                          </span>
                          <time dateTime={notification.createdAt}>
                            {new Intl.DateTimeFormat(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit'
                            }).format(new Date(notification.createdAt))}
                          </time>
                        </span>
                      </>
                    );
                    return notification.actionUrl ? (
                      <Link
                        key={notification.id}
                        className={notification.status}
                        to={notification.actionUrl}
                        onClick={() => {
                          void markNotificationRead(notification.id);
                          setIsNotificationsOpen(false);
                          closeMobileNavigation();
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        key={notification.id}
                        className={notification.status}
                        type="button"
                        onClick={() => void markNotificationRead(notification.id)}
                      >
                        {content}
                      </button>
                    );
                  })
                ) : (
                  <p>You’re caught up. New activity from other teachers will appear here.</p>
                )}
              </div>
            </section>
          ) : null}
          <nav id="primary-navigation" aria-label="Primary navigation">
            {primaryNavigationItems.map((item) => (
              <NavLink
                key={item.id}
                to={item.href}
                className={activePrimaryNavigationId === item.id ? 'active' : ''}
                aria-label={item.label}
                onClick={closeMobileNavigation}
              >
                <span className="sidebar-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <nav className="sidebar-secondary" aria-label="Secondary navigation">
            <button
              className="sidebar-secondary-action secondary"
              type="button"
              aria-label="Feedback"
              title="Feedback"
              data-feedback-id="global-feedback"
              onClick={() => {
                closeMobileNavigation();
                openFeedback();
              }}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M4 4h16v12H9l-5 4V4Z" />
              </svg>
              <span className="sidebar-nav-label">Feedback</span>
            </button>
            {isFeedbackSupport && (
              <NavLink
                to="/management/feedback"
                className="sidebar-secondary-link"
                onClick={closeMobileNavigation}
              >
                Feedback Inbox
              </NavLink>
            )}
            {profileRole === 'admin' ? (
              <NavLink
                to="/admin"
                className="sidebar-secondary-link admin-workspace-link"
                onClick={closeMobileNavigation}
              >
                <span className="sidebar-nav-label">Admin workspace</span>
              </NavLink>
            ) : null}
            <div className="sidebar-import">
              <button
                className="sidebar-secondary-action secondary"
                type="button"
                aria-expanded={isImportOpen}
                onClick={() => setIsImportOpen((open) => !open)}
              >
                <span className="sidebar-nav-label">Import</span>
              </button>
              {isImportOpen ? (
                <div className="sidebar-import-menu">
                  <Link
                    to="/courses?import=schedule"
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
              onClick={closeMobileNavigation}
            >
              <span className="sidebar-nav-label">Profile</span>
            </NavLink>
          </nav>
        </div>
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={sidebarMinWidth}
          aria-valuemax={sidebarMaxWidth}
          aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={0}
          onPointerDown={startSidebarResize}
          onPointerMove={resizeSidebar}
          onPointerUp={finishSidebarResize}
          onPointerCancel={finishSidebarResize}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSidebarWidth((currentWidth) => {
              const nextWidth = Math.min(
                sidebarMaxWidth,
                Math.max(sidebarMinWidth, currentWidth + (event.key === 'ArrowRight' ? 8 : -8))
              );
              saveSidebarWidth(nextWidth);
              return nextWidth;
            });
          }}
        />
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <HobieHelper context={hobieContext} />
    </div>
  );
}
