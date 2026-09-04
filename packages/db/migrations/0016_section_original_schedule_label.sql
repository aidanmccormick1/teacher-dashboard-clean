ALTER TABLE "sections"
  ADD COLUMN IF NOT EXISTS "original_schedule_label" text;

-- Historical imports did not retain a separate source label. Preserve the
-- visible class-group name as the best available legacy reference.
UPDATE "sections"
SET "original_schedule_label" = "name"
WHERE "original_schedule_label" IS NULL;
