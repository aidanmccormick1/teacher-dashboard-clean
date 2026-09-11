CREATE TYPE "school_invitation_status" AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE IF NOT EXISTS "school_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" uuid NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "invitee_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "school_invitation_status" NOT NULL DEFAULT 'pending',
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_school_invitations_invitee_status"
  ON "school_invitations" ("invitee_user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_school_invitations_school_status"
  ON "school_invitations" ("school_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pending_school_invitation"
  ON "school_invitations" ("school_id", "invitee_user_id")
  WHERE "status" = 'pending';
