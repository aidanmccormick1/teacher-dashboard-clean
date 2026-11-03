ALTER TABLE lessons ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_lesson_edit_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.edit_revision := OLD.edit_revision + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lesson_edit_revision ON lessons;
CREATE TRIGGER lesson_edit_revision BEFORE UPDATE ON lessons
FOR EACH ROW EXECUTE FUNCTION increment_lesson_edit_revision();

CREATE OR REPLACE FUNCTION increment_parent_lesson_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lessons SET edit_revision = edit_revision WHERE id = COALESCE(NEW.lesson_id, OLD.lesson_id);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS lesson_step_edit_revision ON lesson_segments;
CREATE TRIGGER lesson_step_edit_revision AFTER INSERT OR UPDATE OR DELETE ON lesson_segments
FOR EACH ROW EXECUTE FUNCTION increment_parent_lesson_revision();
