ALTER TABLE feedback_attachments
  ALTER COLUMN storage_object_path DROP NOT NULL,
  ADD COLUMN image_data bytea,
  ADD CONSTRAINT feedback_attachment_storage CHECK (
    storage_object_path IS NOT NULL OR image_data IS NOT NULL
  ),
  ADD CONSTRAINT feedback_attachment_data_size CHECK (
    image_data IS NULL OR octet_length(image_data) <= 5242880
  );
