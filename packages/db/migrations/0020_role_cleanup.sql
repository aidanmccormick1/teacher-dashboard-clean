ALTER TABLE "teacher_profiles"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "teacher_profiles"
  ALTER COLUMN "role" TYPE text
  USING "role"::text;

UPDATE "teacher_profiles"
SET "role" = 'teacher'
WHERE "role" = 'department_head';

DROP TYPE "user_role";

CREATE TYPE "user_role" AS ENUM ('teacher', 'admin');

ALTER TABLE "teacher_profiles"
  ALTER COLUMN "role" TYPE "user_role"
  USING "role"::"user_role";

ALTER TABLE "teacher_profiles"
  ALTER COLUMN "role" SET DEFAULT 'teacher';
