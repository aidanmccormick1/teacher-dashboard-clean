ALTER TABLE course_collaborators
  ADD COLUMN IF NOT EXISTS invitation_mode text NOT NULL DEFAULT 'join_or_copy'
    CHECK (invitation_mode IN ('join_or_copy', 'copy_only')),
  DROP CONSTRAINT IF EXISTS course_collaborators_status_check;

ALTER TABLE course_collaborators ADD CONSTRAINT course_collaborators_status_check
  CHECK (status IN ('invited', 'accepted', 'copied', 'declined', 'canceled'));

CREATE TABLE IF NOT EXISTS curriculum_invitation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  sender_id uuid,
  invitation_mode text NOT NULL,
  status text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION record_curriculum_invitation_outcome() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'invited' AND NEW.status <> OLD.status THEN
    INSERT INTO curriculum_invitation_history
      (course_id, recipient_id, sender_id, invitation_mode, status)
    VALUES (OLD.course_id, OLD.user_id, OLD.invited_by_user_id, OLD.invitation_mode, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS curriculum_invitation_outcome ON course_collaborators;
CREATE TRIGGER curriculum_invitation_outcome AFTER UPDATE ON course_collaborators
FOR EACH ROW EXECUTE FUNCTION record_curriculum_invitation_outcome();
