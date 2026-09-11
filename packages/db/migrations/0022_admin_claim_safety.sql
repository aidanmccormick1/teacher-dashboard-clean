-- Prevent duplicate pending requests from one requester for one school. The
-- partial index keeps reviewed history intact while making concurrent claim
-- submissions converge on one pending request.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_pending_school_claim_request"
  ON "school_claim_requests" ("school_id", "requester_user_id")
  WHERE "status" = 'pending';
