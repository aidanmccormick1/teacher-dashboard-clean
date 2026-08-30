CREATE TABLE IF NOT EXISTS class_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  scheduled_start_time time,
  scheduled_end_time time,
  completed_step_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  stopped_after_step_id uuid REFERENCES lesson_segments(id) ON DELETE SET NULL,
  raw_note text,
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_class_meeting_section_date UNIQUE (section_id, meeting_date)
);
CREATE INDEX IF NOT EXISTS idx_class_meetings_section_date ON class_meetings(section_id, meeting_date);
