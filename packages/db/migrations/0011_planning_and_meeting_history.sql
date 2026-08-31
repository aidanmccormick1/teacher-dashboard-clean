-- Phase 2 keeps course curriculum shared while giving a section a sparse,
-- additive planning layer. Empty rows simply inherit the existing lesson plan.
CREATE TABLE IF NOT EXISTS section_lesson_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  planned_start_meeting integer,
  planned_meeting_count integer,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_section_lesson_plan UNIQUE (section_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_section_lesson_plans_section ON section_lesson_plans(section_id);

-- Shift/undo stores only the prior sparse overrides. This leaves the shared
-- course plan untouched and makes an operation reversible without guessing.
CREATE TABLE IF NOT EXISTS section_plan_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  previous_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_section_plan_operations_section ON section_plan_operations(section_id, created_at DESC);

ALTER TABLE section_meeting_overrides
  ADD COLUMN IF NOT EXISTS occurrence_key text NOT NULL DEFAULT 'legacy';
ALTER TABLE section_meeting_overrides
  DROP CONSTRAINT IF EXISTS uniq_section_meeting_override;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_section_meeting_override_occurrence'
  ) THEN
    ALTER TABLE section_meeting_overrides
      ADD CONSTRAINT uniq_section_meeting_override_occurrence
      UNIQUE (section_id, date, occurrence_key);
  END IF;
END $$;

ALTER TABLE class_meetings
  ADD COLUMN IF NOT EXISTS occurrence_key text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS step_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS stopping_point_step_id uuid,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
-- Existing records already captured the scheduled start when one was known.
-- Give those rows their durable timed identity before dropping the date-only
-- unique constraint; only genuinely unscheduled history remains `legacy`.
UPDATE class_meetings
SET occurrence_key = to_char(scheduled_start_time, 'HH24:MI')
WHERE occurrence_key = 'legacy'
  AND scheduled_start_time IS NOT NULL;
ALTER TABLE class_meetings
  DROP CONSTRAINT IF EXISTS uniq_class_meeting_section_date;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_class_meeting_occurrence'
  ) THEN
    ALTER TABLE class_meetings
      ADD CONSTRAINT uniq_class_meeting_occurrence
      UNIQUE (section_id, meeting_date, occurrence_key);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_class_meetings_section_lesson_date
  ON class_meetings(section_id, lesson_id, meeting_date);

ALTER TABLE section_lesson_state
  ADD COLUMN IF NOT EXISTS historical_completed_segment_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Preserve pre-history progress exactly once as a baseline. Rows with meeting
-- history are already derivable from their meetings and deliberately remain
-- empty to avoid double-counting.
UPDATE section_lesson_state state
SET historical_completed_segment_ids = state.completed_segment_ids
WHERE state.historical_completed_segment_ids = '[]'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM class_meetings meeting
    WHERE meeting.section_id = state.section_id
      AND meeting.lesson_id = state.lesson_id
  );
