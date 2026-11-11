import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, useApiClient } from '../lib/api.js';
import { useOpenFeedback } from '../components/FeedbackProvider.js';
import {
  debugReport,
  diagnosticExport,
  feedbackCategories,
  feedbackPriorities,
  feedbackStatuses,
  type FeedbackDetail,
  type FeedbackReport
} from '../lib/feedbackTypes.js';

type Inbox = {
  reports: FeedbackReport[];
  total: number;
  pageSize: number;
  metrics: Record<string, number>;
};
type FullDetail = FeedbackDetail & {
  supportUsers?: { id: string; name: string; email: string }[];
  groups?: { id: string; title: string; teacherCount: number }[];
};
const date = (value: string) => new Date(value).toLocaleString();
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function PrivateScreenshot({ reportId, attachmentId }: { reportId: string; attachmentId: string }) {
  const api = useApiClient();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void api
      .feedbackAttachment(reportId, attachmentId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError('Screenshot could not be loaded.');
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, reportId, attachmentId]);
  return error ? (
    <p role="alert">{error}</p>
  ) : url ? (
    <a href={url} target="_blank" rel="noreferrer" aria-label="Open screenshot at full size">
      <img
        className="feedback-preview"
        src={url}
        alt="Screenshot submitted with teacher feedback"
      />
    </a>
  ) : (
    <p role="status">Loading private screenshot…</p>
  );
}

export function FeedbackPage({ management = false }: { management?: boolean }) {
  const api = useApiClient();
  const openFeedback = useOpenFeedback();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [detail, setDetail] = useState<FullDetail | null>(null);
  const [isSupport, setIsSupport] = useState(false);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [searchDraft, setSearchDraft] = useState(searchParams.get('search') ?? '');
  const base = management ? '/management/feedback' : '/feedback';
  const endpoint = management ? '/v1/management/feedback' : '/v1/feedback';
  const query = searchParams.toString();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (id) setDetail(await api.feedbackRequest<FullDetail>(`${endpoint}/${id}`));
      else {
        const result = await api.feedbackRequest<Inbox>(
          management ? `${endpoint}?${query}` : `${endpoint}/my`
        );
        setInbox(result);
      }
      setLocked(false);
      setIsSupport(true);
      setPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLocked(true);
        setIsSupport(false);
        setInbox(null);
        setDetail(null);
      }
      setError(err instanceof Error ? err.message : 'Could not load feedback.');
    } finally {
      setLoading(false);
    }
  }, [api, management, id, endpoint, query]);
  useEffect(() => {
    setDetail(null);
    setReply('');
    setGroupIds([]);
    setNotice('');
    void load();
  }, [load]);
  const mutate = async (path: string, method: string, body?: unknown) => {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api.feedbackRequest(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      await load();
      setNotice('Changes saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setPending(false);
    }
  };
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next);
  };
  const r = detail?.report;
  const diagnostics = r?.diagnostics ?? {};
  const network = Array.isArray(diagnostics.network)
    ? (diagnostics.network as Record<string, unknown>[])
    : [];
  return (
    <main className="feedback-inbox">
      <header className="feedback-heading">
        <div>
          <h1>
            {id
              ? (r?.referenceNumber ?? 'Feedback report')
              : management
                ? 'Feedback Inbox'
                : 'My feedback'}
          </h1>
          <p className="muted">
            {management
              ? 'Review teacher feedback, investigate problems, and manage feature requests.'
              : 'Follow your reports and replies from TeacherOS support.'}
          </p>
        </div>
      </header>
      <div className="feedback-actions">
        <button type="button" onClick={() => openFeedback()}>
          Send Feedback
        </button>
        <Link to="/today?workspace=teaching">Teaching workspace</Link>
        {id && <Link to={base}>Back to feedback</Link>}
        {isSupport && !management && <Link to="/management/feedback">Owner Feedback Inbox</Link>}
        {management && isSupport && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              window.sessionStorage.removeItem('teacheros_feedback_inbox_password');
              setPassword('');
              setDetail(null);
              setInbox(null);
              setIsSupport(false);
              setLocked(true);
            }}
          >
            Lock inbox
          </button>
        )}
        <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {loading && <p role="status">Loading feedback…</p>}
      {!loading && locked && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            window.sessionStorage.setItem('teacheros_feedback_inbox_password', password);
            void load();
          }}
        >
          <label>
            Inbox password
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit">Unlock inbox</button>
        </form>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {!loading && !id && inbox && (!management || isSupport) && (
        <>
          {management && (
            <>
              <div className="feedback-metrics">
                {Object.entries({
                  total: 'Total reports',
                  new: 'New',
                  openBugs: 'Open bugs',
                  investigating: 'Investigating',
                  resolved: 'Resolved',
                  lastSevenDays: 'Last seven days'
                }).map(([key, label]) => (
                  <div key={key}>
                    <strong>{inbox.metrics?.[key] ?? 0}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <form
                className="feedback-filters"
                onSubmit={(event) => {
                  event.preventDefault();
                  filter('search', searchDraft);
                }}
              >
                <label>
                  Search reports
                  <input
                    maxLength={200}
                    placeholder="Reference, teacher, page, description, or ID"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                  />
                </label>
                <label>
                  Category
                  <select
                    value={searchParams.get('category') ?? ''}
                    onChange={(event) => filter('category', event.target.value)}
                  >
                    <option value="">All categories</option>
                    {Object.entries(feedbackCategories).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={searchParams.get('status') ?? ''}
                    onChange={(event) => filter('status', event.target.value)}
                  >
                    <option value="">All statuses</option>
                    {feedbackStatuses.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={searchParams.get('priority') ?? ''}
                    onChange={(event) => filter('priority', event.target.value)}
                  >
                    <option value="">All priorities</option>
                    {feedbackPriorities.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <button type="submit">Search</button>
              </form>
            </>
          )}
          <div className="feedback-report-list">
            {inbox.reports.length ? (
              inbox.reports.map((report) => (
                <Link key={report.id} to={`${base}/${report.id}`} className="feedback-report-row">
                  <strong>
                    {report.referenceNumber} · {feedbackCategories[report.category]}
                  </strong>
                  <span>
                    {report.status} · {report.priority}
                  </span>
                  <p>
                    {report.description.length > 180
                      ? `${report.description.slice(0, 180)}…`
                      : report.description || 'No description'}
                  </p>
                  <div className="feedback-row-meta">
                    <span>{report.reporterName ?? report.reporterEmail}</span>
                    <span>{report.pageName ?? report.pagePath}</span>
                    <time dateTime={report.createdAt}>{date(report.createdAt)}</time>
                    {!!report.attachmentCount && <span>Screenshot included</span>}
                    {report.errorFingerprint && <span>Error captured</span>}
                  </div>
                </Link>
              ))
            ) : (
              <p>No feedback reports match this view.</p>
            )}
          </div>
          {management && (
            <div className="feedback-actions">
              <button
                className="secondary"
                type="button"
                disabled={Number(searchParams.get('page') ?? 1) <= 1}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('page', String(Number(searchParams.get('page') ?? 1) - 1));
                  setSearchParams(next);
                }}
              >
                Previous
              </button>
              <span>
                Page {searchParams.get('page') ?? 1} · {inbox.total} reports
              </span>
              <button
                className="secondary"
                type="button"
                disabled={Number(searchParams.get('page') ?? 1) * inbox.pageSize >= inbox.total}
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set('page', String(Number(searchParams.get('page') ?? 1) + 1));
                  setSearchParams(next);
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {!loading && detail && r && (!management || isSupport) && (
        <article className="feedback-detail">
          {management && (
            <div className="feedback-actions">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(debugReport(detail))
                    .then(() => setNotice('Debug report copied.'))
                    .catch(() =>
                      setError('Clipboard unavailable. Use Download Sanitized JSON instead.')
                    );
                }}
              >
                Copy Debug Report
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([pretty(diagnosticExport(detail))], { type: 'application/json' })
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${r.referenceNumber}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Download Sanitized JSON
              </button>
            </div>
          )}
          <section>
            <h2>Overview</h2>
            <p>
              {feedbackCategories[r.category]} · {date(r.createdAt)}
            </p>
            {management && (
              <p>
                {r.reporterName} · {r.reporterEmail} · {r.schoolName ?? 'School not available'}
              </p>
            )}
            <h3>What happened?</h3>
            <blockquote>{r.description || 'No description'}</blockquote>
            {r.expectedBehavior && (
              <>
                <h3>Expected behavior</h3>
                <blockquote>{r.expectedBehavior}</blockquote>
              </>
            )}
            {r.reproductionSteps && (
              <>
                <h3>Steps to reproduce</h3>
                <blockquote>{r.reproductionSteps}</blockquote>
              </>
            )}
            {management ? (
              <div className="feedback-filters">
                <label>
                  Status
                  <select
                    disabled={pending}
                    value={r.status}
                    onChange={(event) =>
                      void mutate(`${endpoint}/${r.id}`, 'PATCH', { status: event.target.value })
                    }
                  >
                    {feedbackStatuses.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    disabled={pending}
                    value={r.priority}
                    onChange={(event) =>
                      void mutate(`${endpoint}/${r.id}`, 'PATCH', { priority: event.target.value })
                    }
                  >
                    {feedbackPriorities.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Assigned support user
                  <select
                    disabled={pending}
                    value={(r as FeedbackReport & { assignedTo?: string }).assignedTo ?? ''}
                    onChange={(event) =>
                      void mutate(`${endpoint}/${r.id}`, 'PATCH', {
                        assignedTo: event.target.value || null
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {detail.supportUsers?.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name ?? user.email}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <p>Status: {r.status}</p>
            )}
          </section>
          <section>
            <h2>Page context</h2>
            <p>
              {r.pageName ?? r.pagePath} · {r.pagePath}
            </p>
            {management && (
              <>
                <p>{r.sanitizedUrl}</p>
                <dl>
                  {Object.entries(r.context ?? {})
                    .filter(([, v]) => typeof v !== 'object')
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                </dl>
                <details>
                  <summary>Sanitized page metadata</summary>
                  <pre>{pretty(r.context)}</pre>
                </details>
              </>
            )}
          </section>
          {!!detail.attachments.length && (
            <section>
              <h2>Screenshot</h2>
              {detail.attachments.map((attachment) => (
                <PrivateScreenshot
                  key={attachment.id}
                  reportId={r.id}
                  attachmentId={attachment.id}
                />
              ))}
            </section>
          )}
          {management && (
            <>
              <section>
                <h2>Recent activity</h2>
                {detail.events.length ? (
                  <ol>
                    {detail.events.map((event) => (
                      <li key={event.id}>
                        <time>{date(event.eventTimestamp)}</time> ·{' '}
                        {event.eventType.replaceAll('_', ' ')}
                        <details>
                          <summary>Event details</summary>
                          <pre>{pretty(event.metadata)}</pre>
                        </details>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No optional activity was submitted.</p>
                )}
              </section>
              <section>
                <h2>Errors</h2>
                {Array.isArray(diagnostics.errors) && diagnostics.errors.length ? (
                  diagnostics.errors.map((error, index) => <pre key={index}>{pretty(error)}</pre>)
                ) : (
                  <p>No recent errors were submitted.</p>
                )}
              </section>
              <section>
                <h2>Network diagnostics</h2>
                {network.length ? (
                  <div className="feedback-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {['Method', 'Endpoint', 'Status', 'Duration', 'Request ID', 'Time'].map(
                            (label) => (
                              <th key={label}>{label}</th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {network.map((entry, index) => (
                          <tr key={index}>
                            {[
                              'method',
                              'endpoint',
                              'status',
                              'duration',
                              'requestId',
                              'timestamp'
                            ].map((key) => (
                              <td key={key}>
                                {typeof entry[key] === 'string' || typeof entry[key] === 'number'
                                  ? entry[key]
                                  : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No failed requests were submitted.</p>
                )}
              </section>
              <section>
                <h2>Environment</h2>
                <p>
                  App version: {r.appVersion ?? 'Unavailable'} · Commit:{' '}
                  {r.commitSha ?? 'Unavailable'}
                </p>
                <pre>{pretty(diagnostics.browser ?? {})}</pre>
                <details>
                  <summary>Raw sanitized diagnostics</summary>
                  <pre>{pretty(diagnostics)}</pre>
                </details>
              </section>
              <section>
                <h2>Related issues</h2>
                <label>
                  Issue group
                  <select
                    disabled={pending}
                    value={r.issueGroupId ?? ''}
                    onChange={(event) =>
                      void mutate(`${endpoint}/${r.id}`, 'PATCH', {
                        issueGroupId: event.target.value || null
                      })
                    }
                  >
                    <option value="">Ungrouped</option>
                    {detail.groups?.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.title} ({group.teacherCount} teachers)
                      </option>
                    ))}
                  </select>
                </label>
                {detail.relatedReports.map((report) => (
                  <label className="feedback-checkbox" key={report.id}>
                    <input
                      type="checkbox"
                      checked={groupIds.includes(report.id)}
                      onChange={(event) =>
                        setGroupIds(
                          event.target.checked
                            ? [...groupIds, report.id]
                            : groupIds.filter((value) => value !== report.id)
                        )
                      }
                    />
                    <Link to={`${base}/${report.id}`}>
                      {report.referenceNumber}: {report.description.slice(0, 100)}
                    </Link>
                  </label>
                ))}
                <form
                  className="feedback-actions"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('/v1/management/feedback/groups', 'POST', {
                      title: groupTitle,
                      reportIds: [r.id, ...groupIds]
                    });
                  }}
                >
                  <label>
                    New group title
                    <input
                      required
                      maxLength={200}
                      value={groupTitle}
                      onChange={(event) => setGroupTitle(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={pending || !groupTitle.trim()}>
                    Group selected reports
                  </button>
                </form>
              </section>
            </>
          )}
          <section>
            <h2>Developer notes</h2>
            {detail.replies.length ? (
              detail.replies.map((message) => (
                <div className="feedback-reply" key={message.id}>
                  <strong>
                    {message.visibility === 'internal' ? 'Private support note' : 'Reply'} ·{' '}
                    {date(message.createdAt)}
                  </strong>
                  <p>{message.message}</p>
                </div>
              ))
            ) : (
              <p>No notes yet.</p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (reply.trim()) {
                  setPending(true);
                  setError('');
                  void api
                    .feedbackRequest(`${endpoint}/${r.id}/replies`, {
                      method: 'POST',
                      body: JSON.stringify({
                        message: reply,
                        visibility: 'internal'
                      })
                    })
                    .then(() => {
                      setReply('');
                      setNotice('Private note saved.');
                      return load();
                    })
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : 'Reply could not be sent.')
                    )
                    .finally(() => setPending(false));
                }
              }}
            >
              <label>
                Private note
                <textarea
                  required
                  maxLength={10000}
                  rows={4}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
              </label>
              <button type="submit" disabled={pending || !reply.trim()}>
                {pending ? 'Saving…' : 'Save private note'}
              </button>
            </form>
          </section>
          {management && (
            <>
              <section>
                <h2>Administrative history</h2>
                {detail.history.length ? (
                  detail.history.map((entry) => (
                    <div key={entry.id}>
                      <time>{date(entry.createdAt)}</time>
                      <pre>{pretty(entry.changes)}</pre>
                    </div>
                  ))
                ) : (
                  <p>No administrative changes yet.</p>
                )}
              </section>
              <section>
                <h2>Email delivery</h2>
                {detail.deliveries.map((delivery) => (
                  <p key={delivery.id}>
                    {String(
                      (delivery as typeof delivery & { deliveryStatus?: string }).deliveryStatus ??
                        delivery.status
                    )}{' '}
                    · {delivery.attemptCount} attempts{' '}
                    {delivery.errorCode ? `· ${delivery.errorCode}` : ''}
                  </p>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={pending}
                  onClick={() => void mutate(`${endpoint}/${r.id}/retry-notifications`, 'POST')}
                >
                  Retry blocked or failed notifications
                </button>
              </section>
              <section>
                <h2>Delete report</h2>
                <p>Permanently removes this report, attachments, diagnostics, and replies.</p>
                <button
                  className="secondary danger"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(`Permanently delete ${r.referenceNumber} and all its data?`)
                    ) {
                      setPending(true);
                      void api
                        .feedbackRequest(`${endpoint}/${r.id}`, { method: 'DELETE' })
                        .then(() => navigate(base))
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : 'Could not delete report.');
                          setPending(false);
                        });
                    }
                  }}
                >
                  Delete report permanently
                </button>
              </section>
            </>
          )}
        </article>
      )}
    </main>
  );
}
