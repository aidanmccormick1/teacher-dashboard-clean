ALTER TABLE section_meetings
  ADD COLUMN IF NOT EXISTS end_time time;

-- Preserve existing schedules while making every already-timed class usable
-- by the new start/end-time UI. Untimed legacy rows remain visibly incomplete
-- and must be edited by the teacher before schedule confirmation.
UPDATE section_meetings
SET end_time = meeting_time + INTERVAL '55 minutes'
WHERE meeting_time IS NOT NULL
  AND end_time IS NULL;
