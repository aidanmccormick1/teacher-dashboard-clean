DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'calendar_event_type') THEN
    CREATE TYPE calendar_event_type AS ENUM ('no_school', 'minimum_day', 'half_day', 'testing', 'special_schedule', 'other');
  END IF;
END $$;

ALTER TABLE courses ADD COLUMN IF NOT EXISTS sort_index integer NOT NULL DEFAULT 0;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS planned_start_meeting integer;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS planned_meeting_count integer;

CREATE TABLE IF NOT EXISTS school_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_school_year_range UNIQUE (school_id, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS school_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_year_id uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  date date NOT NULL,
  type calendar_event_type NOT NULL,
  label text NOT NULL,
  source_text text,
  confidence integer,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_school_calendar_event_date_label UNIQUE (school_year_id, date, label)
);
CREATE INDEX IF NOT EXISTS idx_school_calendar_events_year_date ON school_calendar_events(school_year_id, date);

CREATE TABLE IF NOT EXISTS section_meeting_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time,
  end_time time,
  room text,
  cancelled boolean NOT NULL DEFAULT false,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_section_meeting_override UNIQUE (section_id, date)
);

CREATE TABLE IF NOT EXISTS teacher_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  walkthrough_dismissed boolean NOT NULL DEFAULT false,
  setup_step text NOT NULL DEFAULT 'schedule',
  return_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve historical closures in the new shared calendar model when a school
-- already has a configured school-year range. Manual re-entry remains possible
-- for legacy schools with no dates yet.
INSERT INTO school_calendar_events (school_year_id, date, type, label, created_by_user_id)
SELECT sy.id, h.date, 'no_school', h.name, h.created_by_user_id
FROM school_holidays h
JOIN school_years sy ON sy.school_id = h.school_id AND h.date BETWEEN sy.start_date AND sy.end_date
ON CONFLICT (school_year_id, date, label) DO NOTHING;
