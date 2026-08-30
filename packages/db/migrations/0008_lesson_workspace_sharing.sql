ALTER TABLE lesson_segments ADD COLUMN IF NOT EXISTS step_type text;

CREATE TABLE IF NOT EXISTS lesson_shares (
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  public_token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_lesson_share_lesson UNIQUE (lesson_id)
);
