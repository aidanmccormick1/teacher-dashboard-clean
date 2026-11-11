CREATE TABLE IF NOT EXISTS lesson_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES lesson_segments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quiz', 'worksheet', 'video')),
  status text NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
  revision integer NOT NULL DEFAULT 0,
  document jsonb,
  video jsonb,
  error text,
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_lesson_resource_step_kind UNIQUE (lesson_id, segment_id, kind)
);
