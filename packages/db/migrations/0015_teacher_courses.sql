-- A curriculum is reusable shared content. A teacher course is that teacher's
-- locally named way of using it. Class groups remain linked to curriculum IDs
-- during this compatible migration, so no schedule/class name is changed.
CREATE TABLE IF NOT EXISTS "teacher_courses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacher_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "curriculum_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "source_curriculum_id" uuid REFERENCES "courses"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "subject" text,
  "grade_level" text,
  "relationship_type" text NOT NULL DEFAULT 'independent'
    CHECK ("relationship_type" IN ('shared', 'independent')),
  "sort_index" integer NOT NULL DEFAULT 0,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "teacher_courses_teacher_curriculum_unique" UNIQUE ("teacher_id", "curriculum_id")
);

CREATE INDEX IF NOT EXISTS "idx_teacher_courses_teacher_active"
  ON "teacher_courses" ("teacher_id", "archived_at");
CREATE INDEX IF NOT EXISTS "idx_teacher_courses_curriculum"
  ON "teacher_courses" ("curriculum_id");

-- Preserve every existing personal course view. A member of an already shared
-- curriculum is marked shared; original one-teacher curricula remain independent.
INSERT INTO "teacher_courses" (
  "teacher_id", "curriculum_id", "name", "subject", "grade_level", "relationship_type", "sort_index",
  "archived_at", "created_at", "updated_at"
)
SELECT
  cc."user_id",
  c."id",
  c."name",
  c."subject",
  c."grade_level",
  CASE WHEN member_counts."count" > 1 THEN 'shared' ELSE 'independent' END,
  c."sort_index",
  cc."archived_at",
  c."created_at",
  c."updated_at"
FROM "course_collaborators" cc
JOIN "courses" c ON c."id" = cc."course_id"
JOIN (
  SELECT "course_id", count(*) AS "count"
  FROM "course_collaborators"
  WHERE "status" = 'accepted'
  GROUP BY "course_id"
) member_counts ON member_counts."course_id" = cc."course_id"
WHERE cc."status" = 'accepted'
ON CONFLICT ("teacher_id", "curriculum_id") DO NOTHING;
