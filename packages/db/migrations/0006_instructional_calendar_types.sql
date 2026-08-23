-- These types make the saved calendar describe the instructional impact of a
-- day instead of flattening every altered schedule into a generic event.
ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS 'early_release';
ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS 'late_start';
ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS 'testing_schedule';
ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS 'other_abnormal';
