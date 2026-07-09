CREATE TABLE IF NOT EXISTS "test_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "session_token_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "test_accounts_username_unique" UNIQUE("username"),
  CONSTRAINT "test_accounts_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_test_accounts_session_token_hash" ON "test_accounts" USING btree ("session_token_hash");
