-- One Google Slides deck can accompany an entire unit. The deck configuration
-- is shared curriculum; the live position is private to each class group.

ALTER TABLE "units"
  ADD COLUMN IF NOT EXISTS "google_slides_url" text,
  ADD COLUMN IF NOT EXISTS "google_slides_start_slide" integer NOT NULL DEFAULT 1;

ALTER TABLE "units"
  DROP CONSTRAINT IF EXISTS "units_google_slides_start_slide_positive";
ALTER TABLE "units"
  ADD CONSTRAINT "units_google_slides_start_slide_positive"
  CHECK ("google_slides_start_slide" > 0);

CREATE TABLE IF NOT EXISTS "section_unit_slide_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "section_id" uuid NOT NULL REFERENCES "sections"("id") ON DELETE CASCADE,
  "unit_id" uuid NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "current_slide" integer NOT NULL DEFAULT 1 CHECK ("current_slide" > 0),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "uniq_section_unit_slide_state" UNIQUE ("section_id", "unit_id")
);

CREATE INDEX IF NOT EXISTS "idx_section_unit_slide_state_section"
  ON "section_unit_slide_state" ("section_id");
