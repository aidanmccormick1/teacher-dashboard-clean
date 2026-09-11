-- A shared course still has exactly one accountable owner. Fail before adding
-- the invariant if legacy data needs an operator decision; never silently
-- choose an owner or delete a collaborator during migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "course_collaborators"
    WHERE "role" = 'owner'
    GROUP BY "course_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      '0024 cannot add uniq_course_owner while duplicate course owners exist; resolve ownership conflicts first';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_course_owner"
  ON "course_collaborators" ("course_id")
  WHERE "role" = 'owner';
