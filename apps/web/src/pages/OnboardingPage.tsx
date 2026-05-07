import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';

export function OnboardingPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    workEmail: '',
    phone: '',
    role: 'teacher' as 'teacher' | 'department_head' | 'admin',
    schoolName: '',
    district: '',
    state: '',
    subjects: '',
    grades: ''
  });

  return (
    <div className="card stack" style={{ maxWidth: 720 }}>
      <h1>Onboarding</h1>
      <p className="muted">Finish teacher profile setup in the new API-first stack.</p>

      <div className="row">
        <input
          className="input"
          placeholder="Full name"
          value={form.fullName}
          onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
        />
        <input
          className="input"
          placeholder="Work email"
          value={form.workEmail}
          onChange={(e) => setForm((prev) => ({ ...prev, workEmail: e.target.value }))}
        />
      </div>

      <div className="row">
        <input
          className="input"
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
        />
        <select
          className="input"
          value={form.role}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              role: e.target.value as 'teacher' | 'department_head' | 'admin'
            }))
          }
        >
          <option value="teacher">Teacher</option>
          <option value="department_head">Department Head</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="row">
        <input
          className="input"
          placeholder="School name"
          value={form.schoolName}
          onChange={(e) => setForm((prev) => ({ ...prev, schoolName: e.target.value }))}
        />
        <input
          className="input"
          placeholder="District"
          value={form.district}
          onChange={(e) => setForm((prev) => ({ ...prev, district: e.target.value }))}
        />
        <input
          className="input"
          placeholder="State"
          value={form.state}
          onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))}
        />
      </div>

      <div className="row">
        <input
          className="input"
          placeholder="Subjects (comma separated)"
          value={form.subjects}
          onChange={(e) => setForm((prev) => ({ ...prev, subjects: e.target.value }))}
        />
        <input
          className="input"
          placeholder="Grades (comma separated)"
          value={form.grades}
          onChange={(e) => setForm((prev) => ({ ...prev, grades: e.target.value }))}
        />
      </div>

      {error ? <p style={{ color: '#b02020' }}>{error}</p> : null}

      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            await api.onboarding({
              fullName: form.fullName,
              phone: form.phone || null,
              workEmail: form.workEmail || null,
              role: form.role,
              schoolName: form.schoolName,
              district: form.district || null,
              state: form.state || null,
              subjects: form.subjects
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
              grades: form.grades
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            });
            navigate('/');
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Failed to save onboarding data');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? 'Saving...' : 'Complete onboarding'}
      </button>
    </div>
  );
}
