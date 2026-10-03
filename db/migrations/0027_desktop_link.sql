-- Brenda desktop (owner decision, 3 October 2026): the desktop app signs in with a short code shown on the computer
-- and approved in Boredroom, so it never holds a password. Approval binds the code to a person and a workspace; the
-- app then claims an ordinary session marked as a desktop session, which the person can see and revoke.

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'desktop'));
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_name text;

-- Server-only, like the other auth tables: read and written in the system context, never under a person's RLS.
CREATE TABLE IF NOT EXISTS desktop_link_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash  text NOT NULL UNIQUE,            -- the long secret the app polls with, stored hashed
  user_code         text NOT NULL UNIQUE,            -- the short code the person types or sees, e.g. KQ7M-4TXD
  device_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  approved_at       timestamptz,
  approved_user_id  uuid REFERENCES auth_users(id) ON DELETE CASCADE,
  organisation_id   uuid REFERENCES organisations(id),
  claimed_at        timestamptz,
  session_id        uuid REFERENCES auth_sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS desktop_link_codes_expiry_idx ON desktop_link_codes(expires_at) WHERE claimed_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON desktop_link_codes TO boardroom_app;
