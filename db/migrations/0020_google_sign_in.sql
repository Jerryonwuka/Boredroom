-- Sign in with Google: an identity row links a provider subject to an account; accounts created that way have no password.
ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE auth_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('google')),
  subject     text NOT NULL,
  email       citext,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);
