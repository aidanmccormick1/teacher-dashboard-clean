CREATE TYPE "school_membership_role" AS ENUM ('teacher', 'admin');
CREATE TYPE "school_membership_status" AS ENUM ('active', 'inactive');
CREATE TYPE "school_claim_status" AS ENUM ('unclaimed', 'claimed');
CREATE TYPE "teacher_invite_policy" AS ENUM ('admin_only', 'members', 'code');
CREATE TYPE "school_claim_request_status" AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE "schools"
  ADD COLUMN IF NOT EXISTS "claim_status" "school_claim_status" NOT NULL DEFAULT 'unclaimed',
  ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "claimed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "teacher_invite_policy" "teacher_invite_policy" NOT NULL DEFAULT 'members';

CREATE TABLE IF NOT EXISTS "school_memberships" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "school_id" uuid NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "role" "school_membership_role" NOT NULL DEFAULT 'teacher',
  "status" "school_membership_status" NOT NULL DEFAULT 'active',
  "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "school_id")
);

CREATE INDEX IF NOT EXISTS "idx_school_memberships_school_status"
  ON "school_memberships" ("school_id", "status");
CREATE INDEX IF NOT EXISTS "idx_school_memberships_user_status"
  ON "school_memberships" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "school_claim_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" uuid NOT NULL REFERENCES "schools"("id") ON DELETE CASCADE,
  "requester_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "school_claim_request_status" NOT NULL DEFAULT 'pending',
  "school_email" text NOT NULL,
  "position" text NOT NULL,
  "verification_notes" text,
  "review_notes" text,
  "reviewed_at" timestamp with time zone,
  "reviewed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_school_claim_requests_school_status"
  ON "school_claim_requests" ("school_id", "status");
CREATE INDEX IF NOT EXISTS "idx_school_claim_requests_requester_status"
  ON "school_claim_requests" ("requester_user_id", "status");

INSERT INTO "school_memberships" (
  "user_id", "school_id", "role", "status", "joined_at", "created_at", "updated_at"
)
SELECT
  "user_id",
  "school_id",
  -- Legacy profile roles are not proof of a reviewed school claim. Existing
  -- administrators must complete the explicit claim-review flow.
  'teacher'::"school_membership_role",
  'active'::"school_membership_status",
  "created_at",
  "created_at",
  "updated_at"
FROM "teacher_profiles"
ON CONFLICT ("user_id", "school_id") DO UPDATE
SET "updated_at" = now();
