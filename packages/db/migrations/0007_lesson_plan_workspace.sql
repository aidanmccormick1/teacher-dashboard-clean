ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS lesson_plan jsonb NOT NULL DEFAULT '{"objective":null,"teacherNotes":null,"studentDirections":null,"materials":null,"links":[]}'::jsonb;
