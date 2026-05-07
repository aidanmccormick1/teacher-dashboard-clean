ALTER TYPE ai_job_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE ai_jobs
ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;
