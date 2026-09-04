-- Collaboration events and discussion are course-level curriculum data.
-- Neither table references class-meeting or section-progress records.

ALTER TABLE "course_collaborators"
  ADD COLUMN IF NOT EXISTS "share_progress" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "course_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "subject_type" text NOT NULL CHECK ("subject_type" IN ('course', 'unit', 'lesson')),
  "subject_id" uuid,
  "summary" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_course_activity_course_created"
  ON "course_activity" ("course_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_course_activity_subject"
  ON "course_activity" ("subject_type", "subject_id");

CREATE TABLE IF NOT EXISTS "lesson_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "lesson_id" uuid NOT NULL REFERENCES "lessons"("id") ON DELETE CASCADE,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL CHECK (char_length("body") BETWEEN 1 AND 10000),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_lesson_comments_lesson_created"
  ON "lesson_comments" ("lesson_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_lesson_comments_course_created"
  ON "lesson_comments" ("course_id", "created_at");
