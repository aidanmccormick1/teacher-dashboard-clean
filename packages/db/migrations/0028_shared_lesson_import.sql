ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_request_id uuid,
  ADD COLUMN IF NOT EXISTS imported_from jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_import_request_unique
  ON lessons (imported_by, import_request_id);
