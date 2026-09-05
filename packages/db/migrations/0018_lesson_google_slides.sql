-- A lesson can optionally use its own deck. Its saved position remains scoped
-- to the teacher's class group, independently from the unit-wide deck.
ALTER TABLE "lessons"
  ADD COLUMN IF NOT EXISTS "google_slides_url" text,
  ADD COLUMN IF NOT EXISTS "google_slides_start_slide" integer NOT NULL DEFAULT 1;

ALTER TABLE "lessons"
  DROP CONSTRAINT IF EXISTS "lessons_google_slides_start_slide_positive";

ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_google_slides_start_slide_positive"
  CHECK ("google_slides_start_slide" > 0);

CREATE TABLE IF NOT EXISTS "section_lesson_slide_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "section_id" uuid NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "lesson_id" uuid NOT NULL REFERENCES "lessons"("id") ON DELETE CASCADE,
  "current_slide" integer NOT NULL DEFAULT 1 CHECK ("current_slide" > 0),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uniq_section_lesson_slide_state" UNIQUE ("section_id", "lesson_id")
);

CREATE INDEX IF NOT EXISTS "idx_section_lesson_slide_state_section"
  ON "section_lesson_slide_state" ("section_id");
