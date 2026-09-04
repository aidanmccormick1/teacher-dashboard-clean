-- Courses hold reusable curriculum. Class groups are teacher-owned local
-- schedules that link to that curriculum. This migration preserves all
-- existing data by turning every historic course owner into an accepted owner
-- membership and every existing section into a class group owned by that
-- course's teacher.

ALTER TABLE "sections" ADD COLUMN IF NOT EXISTS "teacher_id" uuid;

UPDATE "sections" AS section
SET "teacher_id" = course."teacher_id"
FROM "courses" AS course
WHERE section."course_id" = course."id"
  AND section."teacher_id" IS NULL;

ALTER TABLE "sections"
  ALTER COLUMN "teacher_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_teacher_id_users_id_fk') THEN
    ALTER TABLE "sections"
      ADD CONSTRAINT "sections_teacher_id_users_id_fk"
      FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_sections_teacher" ON "sections" ("teacher_id");

CREATE TABLE IF NOT EXISTS "course_collaborators" (
  "course_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('owner', 'editor')),
  "status" text NOT NULL DEFAULT 'invited' CHECK ("status" IN ('invited', 'accepted')),
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "joined_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("course_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_course_collaborators_user_status"
  ON "course_collaborators" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_course_collaborators_course_status"
  ON "course_collaborators" ("course_id", "status");

INSERT INTO "course_collaborators" (
  "course_id", "user_id", "role", "status", "invited_by_user_id", "joined_at", "archived_at"
)
SELECT id, teacher_id, 'owner', 'accepted', teacher_id, created_at, archived_at
FROM "courses"
ON CONFLICT ("course_id", "user_id") DO NOTHING;
