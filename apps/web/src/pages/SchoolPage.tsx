import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GetScheduleResponse, ProfileResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';

type SchoolYearSettings = {
  startDate: string;
  endDate: string;
  meetingDays: string[];
  bellScheduleType: 'weekly' | 'block' | 'ab' | 'rotating';
};

const schoolYearStorageKey = 'teacheros_school_year_settings';
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function defaultSchoolYearSettings(): SchoolYearSettings {
  return {
    startDate: '',
    endDate: '',
    meetingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    bellScheduleType: 'weekly'
  };
}

function daysBetween(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function SchoolPage() {
  const api = useApiClient();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [schedule, setSchedule] = useState<GetScheduleResponse | null>(null);
  const [settings, setSettings] = useState<SchoolYearSettings>(defaultSchoolYearSettings);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(schoolYearStorageKey);
    if (raw) {
      try {
        setSettings({ ...defaultSchoolYearSettings(), ...(JSON.parse(raw) as Partial<SchoolYearSettings>) });
      } catch {
        setSettings(defaultSchoolYearSettings());
      }
    }

    void (async () => {
      try {
        const [profileResult, scheduleResult] = await Promise.allSettled([api.getProfile(), api.getSchedule()]);
        if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
        if (scheduleResult.status === 'fulfilled') setSchedule(scheduleResult.value);
        if (profileResult.status === 'rejected' || scheduleResult.status === 'rejected') {
          setError('Some school setup data could not load.');
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load school setup');
      }
    })();
  }, [api]);

  const schoolDays = useMemo(() => daysBetween(settings.startDate, settings.endDate), [settings.endDate, settings.startDate]);
  const setupScore = useMemo(() => {
    const hasDates = Boolean(settings.startDate && settings.endDate);
    const hasMeetingDays = settings.meetingDays.length > 0;
    const hasSchedule = Boolean(schedule?.sections.some((section) => section.meetings.length > 0));
    const hasHolidays = Boolean(schedule?.holidays.length);
    return (profile?.school ? 25 : 0) + (hasDates ? 30 : 0) + (hasMeetingDays ? 20 : 0) + (hasSchedule ? 15 : 0) + (hasHolidays ? 10 : 0);
  }, [profile?.school, schedule?.holidays.length, schedule?.sections, settings.endDate, settings.meetingDays.length, settings.startDate]);

  const updateSettings = (patch: Partial<SchoolYearSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    window.localStorage.setItem(schoolYearStorageKey, JSON.stringify(next));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const toggleMeetingDay = (day: string) => {
    const nextDays = settings.meetingDays.includes(day)
      ? settings.meetingDays.filter((item) => item !== day)
      : [...settings.meetingDays, day];
    updateSettings({ meetingDays: nextDays });
  };

  const addHoliday = async () => {
    if (!holidayDate || !holidayName.trim()) {
      setError('Add a date and name for the no-school day.');
      return;
    }

    try {
      await api.upsertHolidays({ holidays: [{ date: holidayDate, name: holidayName.trim() }] });
      setSchedule(await api.getSchedule());
      setHolidayDate('');
      setHolidayName('');
      setError(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save no-school day');
    }
  };

  return (
    <div className="school-page stack">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">School setup</p>
          <h1>{profile?.school?.name ?? 'School year settings'}</h1>
          <p>
            These details help the dashboard and Year Timeline understand pacing. You can skip this and still build courses,
            but dates and no-school days make the app smarter.
          </p>
        </div>
        <div className="guide-progress-card">
          <span>{setupScore}</span>
          <p>pacing setup</p>
        </div>
      </section>

      {error ? <p className="notice warning">{error}</p> : null}
      {saved ? <p className="notice success">Saved.</p> : null}

      <section className="school-grid">
        <article className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">School year</p>
              <h2>Dates and rhythm</h2>
            </div>
            <Link to="/management">Management</Link>
          </div>
          <div className="profile-form-grid">
            <label>
              Start date
              <input
                className="input"
                type="date"
                value={settings.startDate}
                onChange={(event) => updateSettings({ startDate: event.target.value })}
              />
            </label>
            <label>
              End date
              <input
                className="input"
                type="date"
                value={settings.endDate}
                onChange={(event) => updateSettings({ endDate: event.target.value })}
              />
            </label>
            <label>
              Bell schedule type
              <select
                className="input"
                value={settings.bellScheduleType}
                onChange={(event) =>
                  updateSettings({ bellScheduleType: event.target.value as SchoolYearSettings['bellScheduleType'] })
                }
              >
                <option value="weekly">Weekly</option>
                <option value="block">Block</option>
                <option value="ab">A/B</option>
                <option value="rotating">Rotating</option>
              </select>
            </label>
          </div>
          <div className="day-picker">
            {weekdays.map((day) => (
              <button key={day} type="button" className={settings.meetingDays.includes(day) ? 'active' : ''} onClick={() => toggleMeetingDay(day)}>
                {day}
              </button>
            ))}
          </div>
          <p className="muted">
            {schoolDays ? `${schoolDays} calendar days in this school year.` : 'Add dates to unlock pacing context.'}
          </p>
        </article>

        <article className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">No-school days</p>
              <h2>Holidays and closures</h2>
            </div>
          </div>
          <div className="inline-editor">
            <input className="input" type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
            <input className="input" value={holidayName} onChange={(event) => setHolidayName(event.target.value)} placeholder="Name, like Fall Break" />
            <button type="button" onClick={() => void addHoliday()}>
              Add day
            </button>
          </div>
          {schedule?.holidays.length ? (
            <div className="holiday-list">
              {schedule.holidays.map((holiday) => (
                <div key={holiday.id}>
                  <strong>{holiday.date}</strong>
                  <span>{holiday.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No holidays added yet.</p>
          )}
        </article>

        <article className="card stack wide-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pacing readiness</p>
              <h2>What this unlocks</h2>
            </div>
          </div>
          <div className="setup-readiness-grid">
            <div className={settings.startDate && settings.endDate ? 'setup-readiness-step done' : 'setup-readiness-step'}>
              <span>{settings.startDate && settings.endDate ? 'Done' : 'Needed'}</span>
              <strong>Year Timeline</strong>
              <p>School-year dates let the app place lessons across the year.</p>
            </div>
            <div className={schedule?.holidays.length ? 'setup-readiness-step done' : 'setup-readiness-step'}>
              <span>{schedule?.holidays.length ? 'Done' : 'Optional'}</span>
              <strong>No-school impact</strong>
              <p>Holidays help pacing warnings avoid fake teaching days.</p>
            </div>
            <div className={schedule?.sections.length ? 'setup-readiness-step done' : 'setup-readiness-step'}>
              <span>{schedule?.sections.length ? 'Done' : 'Next'}</span>
              <strong>Class meetings</strong>
              <p>Class periods connect school rhythm to actual teaching progress.</p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
