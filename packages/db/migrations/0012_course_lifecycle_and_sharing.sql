ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "course_shares" (
  "course_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE cascade,
  "public_token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uniq_course_share_course" UNIQUE("course_id")
);

ALTER TABLE "class_meetings" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'scheduled' NOT NULL;
