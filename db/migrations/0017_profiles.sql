-- Profile page: avatar, job title and a short status line, set by the person themselves.
-- Visibility follows profiles_select (co-members of an organisation); only the owner of a profile can update it (profiles_update).
ALTER TABLE profiles
  ADD COLUMN avatar_key    text,
  ADD COLUMN avatar_mime   text CHECK (avatar_mime IS NULL OR avatar_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD COLUMN title         text CHECK (title IS NULL OR length(title) <= 80),
  ADD COLUMN status_text   text CHECK (status_text IS NULL OR length(status_text) <= 140),
  ADD COLUMN status_set_at timestamptz;
