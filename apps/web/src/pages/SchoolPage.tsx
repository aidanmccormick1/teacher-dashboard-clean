import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { CalendarImportResponse, SchoolCalendarResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { rememberManagementTab } from '../lib/management-tabs.js';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read file'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
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

  const eventKey = (event: { date: string; type: string; label: string }) => `${event.date}|${event.type}|${event.label.trim().toLowerCase()}`;
  const load = useCallback(async () => {
    try {
      const next = await api.getSchoolCalendar();
      setCalendar(next);
      setStartDate(next.schoolYear?.startDate ?? '');
      setEndDate(next.schoolYear?.endDate ?? '');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not load the school calendar'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const saveDates = async () => {
    if (!startDate || !endDate) return setError('Add both school-year dates.');
    try {
      setBusy(true);
      setCalendar(await api.saveSchoolYear({ startDate, endDate }));
      setSaved('School year saved.'); setError(null);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save school year'); }
    finally { setBusy(false); }
  };
  const readCalendar = async () => {
    if (!sourceText.trim() && !file) return setError('Paste calendar text or choose a document.');
    try {
      setBusy(true);
      const dataUrl = file ? await readFileAsDataUrl(file) : undefined;
      const result = await api.importSchoolCalendar({ text: sourceText.trim() || undefined, fileBase64: dataUrl, fileName: file?.name, fileMimeType: file?.type || undefined });
      setPreview(result); setStartDate(result.schoolYear.startDate); setEndDate(result.schoolYear.endDate);
      setSelected(new Set(result.events.map(eventKey))); setError(null);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not read the school calendar'); }
    finally { setBusy(false); }
  };
  const commit = async (mode: 'merge' | 'replace') => {
    if (!preview) return;
    try {
      setBusy(true);
      const next = await api.commitSchoolCalendar({ mode, schoolYear: preview.schoolYear, events: preview.events, overrides: preview.overrides, approvedEventKeys: [...selected] });
      setCalendar(next); setPreview(null); setSourceText(''); setFile(null); setSaved(mode === 'merge' ? 'Calendar merged.' : 'Calendar replaced.'); setError(null);
      void api.updatePreferences({ setupStep: 'courses', walkthroughDismissed: false }).catch(() => undefined);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save the calendar'); }
    finally { setBusy(false); }
  };

  return <div className="school-page stack">
    <section className="paper-hero"><div><p className="eyebrow">School profile</p><h1>School Year</h1><p>Import your calendar, review it, then save it for every teacher at your school.</p></div><Link className="button-link secondary" to="/management" onClick={() => rememberManagementTab('import')}>Import schedule</Link></section>
    {error ? <p className="notice warning">{error}</p> : null}{saved ? <p className="notice success">{saved}</p> : null}
    <section className="card stack"><div className="section-heading"><div><p className="eyebrow">Recommended</p><h2>Import School Calendar</h2></div></div><textarea rows={4} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste a school calendar, or upload a PDF or image." /><div className="profile-actions"><input type="file" accept="application/pdf,image/*,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><button type="button" disabled={busy || (!sourceText.trim() && !file)} onClick={() => void readCalendar()}>{busy ? 'Reading…' : 'Read calendar'}</button></div></section>
    {preview ? <section className="card stack" aria-live="polite"><div className="section-heading"><div><p className="eyebrow">Review</p><h2>{preview.schoolYear.startDate} – {preview.schoolYear.endDate}</h2></div><span>{selected.size} selected</span></div>{preview.notices.map((notice) => <p key={notice} className="muted">{notice}</p>)}<div className="holiday-list">{preview.events.map((event) => { const key = eventKey(event); return <label key={key}><input type="checkbox" checked={selected.has(key)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} /><strong>{event.date}</strong><span>{event.label} · {event.type.replace('_', ' ')}</span></label>; })}</div>{preview.overrides.length ? <div className="soft-panel"><strong>Alternate Class Group times</strong>{preview.overrides.map((override) => <span key={`${override.date}-${override.classGroup}`}>{override.date} · {override.classGroup} · {override.startTime ?? 'time TBD'}–{override.endTime ?? 'time TBD'}</span>)}</div> : null}<div className="profile-actions"><button type="button" disabled={busy || !selected.size} onClick={() => void commit('merge')}>Merge calendars</button><button className="secondary" type="button" disabled={busy || !selected.size} onClick={() => void commit('replace')}>Replace calendar</button><button className="button-link" type="button" onClick={() => setPreview(null)}>Cancel</button></div></section> : null}
    <section className="school-grid"><article className="card stack"><div className="section-heading"><div><p className="eyebrow">Required</p><h2>School dates</h2></div></div><div className="profile-form-grid"><label>Start<input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>End<input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div><button type="button" disabled={busy || !startDate || !endDate} onClick={() => void saveDates()}>Save dates</button>{calendar?.schoolYear ? <button className="secondary" type="button" onClick={() => navigate('/management')}>Build Year Plan</button> : null}</article><article className="card stack"><div className="section-heading"><div><p className="eyebrow">Shared calendar</p><h2>Breaks & special days</h2></div></div>{calendar?.events.length ? <div className="holiday-list">{calendar.events.map((event) => <div key={event.id}><div><strong>{event.date}</strong><span>{event.label} · {event.type.replace('_', ' ')}</span></div></div>)}</div> : <p className="muted">Import a calendar to add closures, breaks, and special days.</p>}</article></section>
  </div>;
}
