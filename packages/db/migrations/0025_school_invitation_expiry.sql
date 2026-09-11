-- Pending school invitations are short-lived and can be explicitly revoked.
-- Existing pending rows receive the same fourteen-day window from creation;
-- accepted and revoked history remains untouched.
ALTER TABLE "school_invitations"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;

UPDATE "school_invitations"
SET "expires_at" = "created_at" + interval '14 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "school_invitations"
  ALTER COLUMN "expires_at" SET DEFAULT (now() + interval '14 days'),
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_school_invitations_pending_expiry"
  ON "school_invitations" ("school_id", "expires_at")
  WHERE "status" = 'pending';
