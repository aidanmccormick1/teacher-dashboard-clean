-- Platform support grants are provisioned by operators against an authenticated
-- Clerk subject. School roles and mutable onboarding emails confer no access.
CREATE TABLE platform_support_users (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE feedback_reference_seq START WITH 1001;
CREATE TABLE feedback_issue_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL,
  signature text, status text NOT NULL DEFAULT 'new', priority text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text NOT NULL UNIQUE DEFAULT ('FB-' || nextval('feedback_reference_seq')),
  reporter_user_id uuid NOT NULL REFERENCES users(id), school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
  category text NOT NULL CHECK(category IN ('bug','feature_request','usability','other')),
  description text NOT NULL, expected_behavior text, reproduction_steps text,
  page_path text NOT NULL, page_name text, sanitized_url text,
  attachment_status text NOT NULL DEFAULT 'none' CHECK(attachment_status IN ('none','pending','uploading','attached','failed')), attachment_started_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}', diagnostics jsonb NOT NULL DEFAULT '{}',
  client_session_id uuid, client_report_id uuid NOT NULL,
  error_fingerprint text, app_version text, commit_sha text, environment text,
  status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','investigating','planned','fixed','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
  assigned_to uuid REFERENCES platform_support_users(user_id) ON DELETE SET NULL,
  issue_group_id uuid REFERENCES feedback_issue_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE(reporter_user_id, client_report_id)
);
CREATE INDEX feedback_created_idx ON feedback_reports(created_at DESC);
CREATE INDEX feedback_reporter_idx ON feedback_reports(reporter_user_id);
CREATE INDEX feedback_status_idx ON feedback_reports(status);
CREATE INDEX feedback_category_idx ON feedback_reports(category);
CREATE INDEX feedback_school_idx ON feedback_reports(school_id);
CREATE INDEX feedback_priority_idx ON feedback_reports(priority);
CREATE INDEX feedback_fingerprint_idx ON feedback_reports(error_fingerprint);
CREATE INDEX feedback_group_idx ON feedback_reports(issue_group_id);
CREATE TABLE feedback_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
  storage_object_path text NOT NULL UNIQUE, UNIQUE(report_id), mime_type text NOT NULL, file_size integer NOT NULL,
  width integer NOT NULL, height integer NOT NULL, attachment_type text NOT NULL DEFAULT 'screenshot',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
  event_timestamp timestamptz NOT NULL, event_type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_events_report_idx ON feedback_events(report_id);
CREATE TABLE feedback_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id), message text NOT NULL,
  visibility text NOT NULL CHECK(visibility IN ('teacher','internal')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  changes jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
  notification_type text NOT NULL, recipient_identifier text NOT NULL,
  reply_id uuid REFERENCES feedback_replies(id) ON DELETE CASCADE,
  delivery_status text NOT NULL DEFAULT 'pending', provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0, first_attempted_at timestamptz, last_attempted_at timestamptz, sent_at timestamptz,
  error_code text, payload jsonb, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(report_id, notification_type, recipient_identifier, reply_id)
);
CREATE UNIQUE INDEX feedback_new_notification_once ON feedback_notification_deliveries(report_id) WHERE notification_type='new_report';
CREATE INDEX feedback_delivery_pending_idx ON feedback_notification_deliveries(delivery_status,next_attempt_at);

CREATE INDEX feedback_replies_report_idx ON feedback_replies(report_id,created_at);
CREATE INDEX feedback_history_report_idx ON feedback_history(report_id,created_at);
CREATE INDEX feedback_attachments_report_idx ON feedback_attachments(report_id);
CREATE INDEX feedback_deliveries_report_idx ON feedback_notification_deliveries(report_id);
