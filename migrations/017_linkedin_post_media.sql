-- 017_linkedin_post_media.sql
-- Add optional single-media attachment to LinkedIn posts (image or document).
-- The asset is uploaded to LinkedIn at compose time (Images/Documents API),
-- and its URN is stored here so scheduled posts can reference it at publish.
ALTER TABLE linkedin_posts ADD COLUMN media_type  TEXT;   -- 'image' | 'document' | NULL
ALTER TABLE linkedin_posts ADD COLUMN media_urn   TEXT;   -- urn:li:image:... | urn:li:document:...
ALTER TABLE linkedin_posts ADD COLUMN media_title TEXT;   -- document title / file name
ALTER TABLE linkedin_posts ADD COLUMN media_alt   TEXT;   -- image alt text (accessibility)
