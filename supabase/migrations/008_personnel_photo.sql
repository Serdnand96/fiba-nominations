-- Add profile photo URL to personnel (TDs / VGOs).
-- Photos are stored in the public `inventory` bucket under personnel/<id>.<ext>
-- and served as a public URL, mirroring the assets photo pattern.
alter table personnel add column if not exists photo_url text;
