ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "invite_code" text;

UPDATE "schools"
SET "invite_code" = upper(substr(replace("id"::text, '-', ''), 1, 8))
WHERE "invite_code" IS NULL;

ALTER TABLE "schools" ALTER COLUMN "invite_code" SET DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
ALTER TABLE "schools" ALTER COLUMN "invite_code" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "schools_invite_code_unique" ON "schools" ("invite_code");

ALTER TABLE "course_shares"
  ADD COLUMN IF NOT EXISTS "school_visible" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "course_id" uuid REFERENCES "courses"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "action_url" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_not_self" CHECK ("actor_user_id" IS NULL OR "actor_user_id" <> "recipient_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_created"
  ON "notifications" ("recipient_user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_unread"
  ON "notifications" ("recipient_user_id", "read_at")
  WHERE "read_at" IS NULL;
