import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CalendarImportResponse, SchoolCalendarResponse } from '@teacheros/contracts';
import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab } from '../lib/management-tabs.js';

type ManualDayOff = { title: string; startDate: string; endDate: string };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read file'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(`${value}T12:00:00`));
}
function dateRange(startDate: string, endDate: string) {
  return startDate === endDate
    ? shortDate(startDate)
    : `${shortDate(startDate)} – ${shortDate(endDate)}`;
}
function exceptionKey(event: { startDate: string; endDate: string; type: string; title: string }) {
  return `${event.startDate}|${event.endDate}|${event.type}|${event.title.trim().toLowerCase()}`;
}
function savedEventGroups(events: SchoolCalendarResponse['events']) {
  const sorted = [...events].sort((a, b) =>
    `${a.type}:${a.label}:${a.date}`.localeCompare(`${b.type}:${b.label}:${b.date}`)
  );
  return sorted.reduce<Array<{ title: string; type: string; startDate: string; endDate: string }>>(
    (groups, event) => {
      const previous = groups.at(-1);
      const distance = previous
        ? (new Date(`${event.date}T12:00:00Z`).getTime() -
            new Date(`${previous.endDate}T12:00:00Z`).getTime()) /
          86400000
        : Infinity;
      if (
        previous &&
        previous.title === event.label &&
        previous.type === event.type &&
        distance <= 3
      )
        previous.endDate = event.date;
      else
        groups.push({
          title: event.label,
          type: event.type,
          startDate: event.date,
          endDate: event.date
        });
      return groups;
    },
    []
  );
}

export function SchoolPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<SchoolCalendarResponse | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CalendarImportResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [editingSchoolYear, setEditingSchoolYear] = useState(false);
  const [showManualCalendar, setShowManualCalendar] = useState(false);
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualEndDate, setManualEndDate] = useState('');
  const [manualDaysOff, setManualDaysOff] = useState<ManualDayOff[]>([
    { title: '', startDate: '', endDate: '' }
  ]);
  const [timezone, setTimezone] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await api.getSchoolCalendar();
      setCalendar(next);
      setTimezone(next.timezone);
      setStartDate(next.schoolYear?.startDate ?? '');
      setEndDate(next.schoolYear?.endDate ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the school calendar');
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  const readCalendar = async () => {
    if (!sourceText.trim() && !file) return setError('Paste calendar text or choose a document.');
    try {
      setBusy(true);
      setError(null);
      setSaved(null);
      const dataUrl = file ? await readFileAsDataUrl(file) : undefined;
      const result = await api.importSchoolCalendar({
        text: sourceText.trim() || undefined,
        fileBase64: dataUrl,
        fileName: file?.name,
        fileMimeType: file?.type || undefined
      });
      setPreview(result);
      setStartDate(result.schoolYear.startDate);
      setEndDate(result.schoolYear.endDate);
      setSelected(new Set(result.events.filter((event) => !event.needsReview).map(exceptionKey)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the school calendar');
    } finally {
      setBusy(false);
    }
  };
  const updateManualDayOff = (index: number, patch: Partial<ManualDayOff>) => {
    setManualDaysOff((current) =>
      current.map((event, eventIndex) => (eventIndex === index ? { ...event, ...patch } : event))
    );
  };
  const reviewManualCalendar = () => {
    if (!manualStartDate || !manualEndDate) {
      setError('Add the first and last instructional day.');
      return;
    }
    if (manualEndDate < manualStartDate) {
      setError('The last instructional day must be after the first day.');
      return;
    }

    const completedDaysOff = manualDaysOff.filter(
      (event) => event.title.trim() || event.startDate || event.endDate
    );
    if (
      completedDaysOff.some((event) => !event.title.trim() || !event.startDate || !event.endDate)
    ) {
      setError('Complete the name, start date, and end date for every day off.');
      return;
    }
    if (completedDaysOff.some((event) => event.endDate < event.startDate)) {
      setError('Each day-off end date must be on or after its start date.');
      return;
    }

    const events: CalendarImportResponse['events'] = completedDaysOff.map((event) => ({
      title: event.title.trim(),
      startDate: event.startDate,
      endDate: event.endDate,
      type: 'no_school',
      affectsInstruction: true,
      scheduleKnown: true,
      confidence: 100,
      sourceText: 'Added manually',
      needsReview: false
    }));
    setPreview({
      schoolYear: { startDate: manualStartDate, endDate: manualEndDate, confidence: 100 },
      events,
      overrides: [],
      ignoredEvents: [],
      notices: []
    });
    setStartDate(manualStartDate);
    setEndDate(manualEndDate);
    setSelected(new Set(events.map(exceptionKey)));
    setError(null);
  };
  const toggle = (event: CalendarImportResponse['events'][number]) =>
    setSelected((current) => {
      const next = new Set(current);
      const key = exceptionKey(event);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const saveDates = async () => {
    if (!startDate || !endDate) return;
    try {
      setBusy(true);
      setCalendar(await api.saveSchoolYear({ startDate, endDate }));
      setSaved('School year saved.');
      setEditingSchoolYear(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save school year');
    } finally {
      setBusy(false);
    }
  };
  const commit = async (mode: 'merge' | 'replace') => {
    if (!preview || !startDate || !endDate) return;
    try {
      setBusy(true);
      const events = preview.events.filter((event) => selected.has(exceptionKey(event)));
      const next = await api.commitSchoolCalendar({
        mode,
        schoolYear: { startDate, endDate },
        events,
        overrides: preview.overrides,
        approvedEventKeys: [...selected]
      });
      setCalendar(next);
      setPreview(null);
      setSourceText('');
      setFile(null);
      setSaved(mode === 'replace' ? 'Calendar replaced.' : 'Calendar saved.');
      setError(null);
      void api
        .updatePreferences({ setupStep: 'courses', walkthroughDismissed: false })
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the calendar');
    } finally {
      setBusy(false);
    }
  };

  const daysOff =
    preview?.events.filter((event) => event.type === 'no_school' && !event.needsReview) ?? [];
  const specialDays =
    preview?.events.filter((event) => event.type !== 'no_school' && !event.needsReview) ?? [];
  const savedGroups = useMemo(() => savedEventGroups(calendar?.events ?? []), [calendar]);
  const savedDaysOff = savedGroups.filter((event) => event.type === 'no_school');
  const savedSpecialDays = savedGroups.filter((event) => event.type !== 'no_school');
  const hasExistingCalendar = Boolean(calendar?.schoolYear || calendar?.events.length);
  const saveTimezone = async () => {
    try {
      setBusy(true);
      const next = await api.updateSchoolTimezone(timezone);
      setCalendar(next);
      setTimezone(next.timezone);
      setSaved('School timezone saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save school timezone');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="school-page stack">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">School profile</p>
          <h1>School Calendar</h1>
          <p>Set the instructional year and the days that change normal student learning.</p>
        </div>
        <Link
          className="button-link secondary"
          to="/management"
          onClick={() => rememberManagementTab('import')}
        >
          Import schedule
        </Link>
      </section>
      {error ? <p className="notice warning">{error}</p> : null}
      {saved ? <p className="notice success">{saved}</p> : null}
      <section className="card stack">
        <div>
          <p className="eyebrow">Local time</p>
          <h2>School timezone</h2>
          <p className="muted">
            Used to resolve class times, today’s schedule, and calendar dates.
          </p>
        </div>
        <div className="profile-actions">
          <input
            className="input"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="America/Los_Angeles"
            aria-label="School timezone"
          />
          <button
            type="button"
            disabled={busy || !timezone.trim()}
            onClick={() => void saveTimezone()}
          >
            Save timezone
          </button>
        </div>
      </section>
      {!preview ? (
        <>
          <section className="card stack calendar-import-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{hasExistingCalendar ? 'Update' : 'Start here'}</p>
                <h2>
                  {hasExistingCalendar ? 'Import Updated Calendar' : 'Import School Calendar'}
                </h2>
                <p>
                  Upload a file or image, or paste calendar text. We’ll identify the instructional
                  year first.
                </p>
              </div>
            </div>
            <textarea
              rows={5}
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste a school calendar…"
            />
            <div className="profile-actions">
              <input
                type="file"
                accept="application/pdf,image/*,.doc,.docx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? <span className="status-pill upcoming">{file.name}</span> : null}
              <button
                type="button"
                disabled={busy || (!sourceText.trim() && !file)}
                onClick={() => void readCalendar()}
              >
                {busy ? (
                  <>
                    <span className="calendar-reader-dot" />
                    Reading your calendar…
                  </>
                ) : (
                  'Read Calendar'
                )}
              </button>
            </div>
          </section>
          <section className="card stack manual-calendar-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Manual option</p>
                <h2>Set up the school calendar yourself</h2>
                <p>
                  Enter the instructional year and any days students are off. You can review before
                  saving.
                </p>
              </div>
              <button
                className="secondary"
                type="button"
                aria-expanded={showManualCalendar}
                onClick={() => setShowManualCalendar((shown) => !shown)}
              >
                {showManualCalendar ? 'Hide manual entry' : 'Enter calendar manually'}
              </button>
            </div>
            {showManualCalendar ? (
              <div className="stack">
                <div className="profile-form-grid">
                  <label>
                    First instructional day
                    <input
                      className="input"
                      type="date"
                      value={manualStartDate}
                      onChange={(event) => setManualStartDate(event.target.value)}
                    />
                  </label>
                  <label>
                    Last instructional day
                    <input
                      className="input"
                      type="date"
                      value={manualEndDate}
                      onChange={(event) => setManualEndDate(event.target.value)}
                    />
                  </label>
                </div>
                <div className="manual-days-off-list">
                  <div>
                    <p className="eyebrow">Days off</p>
                    <p className="muted">
                      Add a single day or a break date range. This is optional.
                    </p>
                  </div>
                  {manualDaysOff.map((event, index) => (
                    <div
                      className="profile-form-grid manual-day-off-row"
                      key={`manual-day-off-${index}`}
                    >
                      <label>
                        Day off or break name
                        <input
                          className="input"
                          value={event.title}
                          placeholder="Winter Break"
                          onChange={(input) =>
                            updateManualDayOff(index, { title: input.target.value })
                          }
                        />
                      </label>
                      <label>
                        Starts
                        <input
                          className="input"
                          type="date"
                          value={event.startDate}
                          onChange={(input) =>
                            updateManualDayOff(index, { startDate: input.target.value })
                          }
                        />
                      </label>
                      <label>
                        Ends
                        <input
                          className="input"
                          type="date"
                          value={event.endDate}
                          onChange={(input) =>
                            updateManualDayOff(index, { endDate: input.target.value })
                          }
                        />
                      </label>
                      {manualDaysOff.length > 1 ? (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() =>
                            setManualDaysOff((current) =>
                              current.filter((_, eventIndex) => eventIndex !== index)
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="profile-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      setManualDaysOff((current) => [
                        ...current,
                        { title: '', startDate: '', endDate: '' }
                      ])
                    }
                  >
                    Add a day off
                  </button>
                  <button type="button" onClick={reviewManualCalendar}>
                    Review manual calendar
                  </button>
                </div>
              </div>
            ) : null}
          </section>
          {calendar?.schoolYear ? (
            <section className="school-grid">
              <article className="card stack calendar-saved-year">
                <div>
                  <p className="eyebrow">School Year</p>
                  {editingSchoolYear ? (
                    <div className="profile-form-grid">
                      <label>
                        First day
                        <input
                          className="input"
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                        />
                      </label>
                      <label>
                        Last day
                        <input
                          className="input"
                          type="date"
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <h2>
                      {shortDate(calendar.schoolYear.startDate)} <span>→</span>{' '}
                      {shortDate(calendar.schoolYear.endDate)}
                    </h2>
                  )}
                </div>
                <div className="profile-actions">
                  {editingSchoolYear ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => void saveDates()}>
                        Save
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setEditingSchoolYear(false)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setEditingSchoolYear(true)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </article>
              <article className="card stack">
                <div>
                  <p className="eyebrow">Breaks & special days</p>
                  <h2>
                    {savedDaysOff.length} Days Off <span>·</span> {savedSpecialDays.length} Special
                    Schedule Days
                  </h2>
                </div>
                <button className="secondary" type="button" onClick={() => navigate('/management')}>
                  View Calendar
                </button>
              </article>
            </section>
          ) : null}
        </>
      ) : (
        <section className="calendar-review stack" aria-live="polite">
          <header className="calendar-ready-heading">
            <div>
              <p className="eyebrow">Calendar Ready</p>
              <h2>Review the instructional calendar</h2>
              <p>Only dates that cancel or change normal student instruction are included.</p>
            </div>
          </header>
          <article className="card calendar-year-review">
            <div>
              <div>
                <p className="eyebrow">School Year</p>
                <strong>First Day</strong>
                <input
                  className="input"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <span className="calendar-arrow">→</span>
              <div>
                <strong>Last Day</strong>
                <input
                  className="input"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
          </article>
          {daysOff.length ? (
            <CalendarSection
              title="Days Off"
              events={daysOff}
              selected={selected}
              onToggle={toggle}
            />
          ) : null}
          {specialDays.length ? (
            <CalendarSection
              title="Special Days"
              events={specialDays}
              selected={selected}
              onToggle={toggle}
            />
          ) : null}
          {preview.events
            .filter((event) => event.needsReview)
            .map((event) => (
              <article className="card calendar-needs-review" key={exceptionKey(event)}>
                <p className="eyebrow">Needs review</p>
                <h3>{event.title}</h3>
                <p>{dateRange(event.startDate, event.endDate)} · Do students have class?</p>
                <div className="profile-actions">
                  <button
                    type="button"
                    className={selected.has(exceptionKey(event)) ? '' : 'secondary'}
                    onClick={() =>
                      setSelected((current) => new Set(current).add(exceptionKey(event)))
                    }
                  >
                    No School
                  </button>
                  <button
                    type="button"
                    className={!selected.has(exceptionKey(event)) ? '' : 'secondary'}
                    onClick={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        next.delete(exceptionKey(event));
                        return next;
                      })
                    }
                  >
                    Normal School
                  </button>
                </div>
              </article>
            ))}
          {preview.ignoredEvents.length ? (
            <details
              className="calendar-ignored"
              open={showIgnored}
              onToggle={(event) => setShowIgnored((event.target as HTMLDetailsElement).open)}
            >
              <summary>
                {preview.ignoredEvents.length} ignored{' '}
                {preview.ignoredEvents.length === 1 ? 'event' : 'events'}
              </summary>
              <div>
                {preview.ignoredEvents.map((event, index) => (
                  <p key={`${event.title}-${index}`}>
                    <strong>{event.title}</strong>
                    {event.date ? ` · ${shortDate(event.date)}` : ''}
                    <span>{event.reason}</span>
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          <div className="profile-actions calendar-review-actions">
            <button
              type="button"
              disabled={busy || !startDate || !endDate}
              onClick={() => void commit('merge')}
            >
              {hasExistingCalendar ? 'Update Calendar' : 'Save Calendar'}
            </button>
            {hasExistingCalendar ? (
              <button
                className="secondary"
                type="button"
                disabled={busy || !startDate || !endDate}
                onClick={() => void commit('replace')}
              >
                Replace Calendar
              </button>
            ) : null}
            <button className="button-link" type="button" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
function CalendarSection({
  title,
  events,
  selected,
  onToggle
}: {
  title: string;
  events: CalendarImportResponse['events'];
  selected: Set<string>;
  onToggle: (event: CalendarImportResponse['events'][number]) => void;
}) {
  return (
    <article className="card calendar-event-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>
            {events.length} {events.length === 1 ? 'date' : 'dates found'}
          </h2>
        </div>
      </div>
      <div className="calendar-event-rows">
        {events.map((event) => (
          <label key={exceptionKey(event)} className="calendar-event-row">
            <input
              type="checkbox"
              checked={selected.has(exceptionKey(event))}
              onChange={() => onToggle(event)}
            />
            <div>
              <strong>{event.title}</strong>
              <span>{dateRange(event.startDate, event.endDate)}</span>
            </div>
            <em>{event.type === 'no_school' ? 'No School' : event.type.replaceAll('_', ' ')}</em>
          </label>
        ))}
      </div>
    </article>
  );
}
