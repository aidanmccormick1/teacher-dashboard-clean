ALTER TABLE units
  ADD COLUMN IF NOT EXISTS planned_start_meeting integer,
  ADD COLUMN IF NOT EXISTS planned_meeting_count integer;

ALTER TABLE units
  DROP CONSTRAINT IF EXISTS units_planned_start_meeting_nonnegative;

ALTER TABLE units
  ADD CONSTRAINT units_planned_start_meeting_nonnegative
  CHECK (planned_start_meeting IS NULL OR planned_start_meeting >= 0);

ALTER TABLE units
  DROP CONSTRAINT IF EXISTS units_planned_meeting_count_positive;

ALTER TABLE units
  ADD CONSTRAINT units_planned_meeting_count_positive
  CHECK (planned_meeting_count IS NULL OR planned_meeting_count > 0);
