-- Boredroom for Mac: one sign-in for its window and its notch (owner request, 24 October 2026: option A).
--
-- Why: the Mac app now shows the whole dashboard in its own window and keeps Brenda in the notch. One sign-in links
-- both. The app's identity stays the desktop session Rust holds (kind 'desktop', 90 days, a Bearer token, as 0027 made
-- it); the window's web session is an ordinary 'web' session tied to it, so revoking either revokes both.
--
-- What:
-- 1. auth_sessions.desktop_session_id: a web session that belongs to a desktop session (the window's). A trigger checks
--    the parent is a desktop session of the same person.
-- 2. desktop_auth_requests: PKCE (S256) sign-in requests the app starts. The window (or the person's browser, for Google
--    and password managers) signs in normally; approving mints a 120-second single-use code bound to the request's
--    challenge, which only the app that holds the verifier can redeem.
-- 3. desktop_handoff_codes: 60-second single-use codes a linked app mints with its Bearer token and hands to its own
--    window by script (never in a URL), which the window redeems for its web session cookie.
-- 4. desktop_browser_tickets: 5-minute single-use tickets that carry a connector consent from the window to the
--    person's default browser (Google and most providers refuse embedded web views).
--
-- Rules: every secret is stored only as its sha256 (hex); every claim is one UPDATE … WHERE unused AND unexpired AND
-- origin = APP_ORIGIN RETURNING; the three tables are server-only (row security lets only the system and worker
-- contexts in; a person's context sees nothing).
--
-- Waits in db/pending until the owner's go-ahead. Additive and idempotent; needs 0027 (desktop sessions). Without it the
-- code degrades to today (src/server/lib/schema-0064.ts): the window signs in on its own and the notch uses the code.

DO $$
BEGIN
  IF to_regclass('public.desktop_link_codes') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_ORDER: apply 0027_desktop_link.sql before 0064_desktop_app.sql.';
  END IF;
END $$;

-- 1. The window's web session belongs to the app's desktop session ----------------------------------------------------
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS desktop_session_id uuid REFERENCES auth_sessions(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_desktop_parent_check') THEN
    ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_desktop_parent_check
      CHECK (desktop_session_id IS NULL OR (kind = 'web' AND desktop_session_id <> id));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS auth_sessions_desktop_family_idx ON auth_sessions(desktop_session_id) WHERE desktop_session_id IS NOT NULL;

-- The parent must be a desktop session of the same person (a window session can never hang off someone else's Mac).
CREATE OR REPLACE FUNCTION app_auth_sessions_desktop_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.desktop_session_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth_sessions p WHERE p.id = NEW.desktop_session_id AND p.kind = 'desktop' AND p.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'DESKTOP_PARENT: a window session must belong to a desktop session of the same person'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS auth_sessions_desktop_parent ON auth_sessions;
CREATE TRIGGER auth_sessions_desktop_parent BEFORE INSERT OR UPDATE OF desktop_session_id ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION app_auth_sessions_desktop_parent();

-- 2. Sign-in requests (PKCE) -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS desktop_auth_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_hash         text NOT NULL UNIQUE CONSTRAINT desktop_auth_requests_start_check CHECK (start_hash ~ '^[0-9a-f]{64}$'),
  state              text NOT NULL CONSTRAINT desktop_auth_requests_state_check CHECK (state ~ '^[A-Za-z0-9_-]{22,64}$'),
  challenge          text NOT NULL CONSTRAINT desktop_auth_requests_challenge_check CHECK (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  via                text NOT NULL CONSTRAINT desktop_auth_requests_via_check CHECK (via IN ('window', 'browser')),
  intent             text CONSTRAINT desktop_auth_requests_intent_check CHECK (intent IS NULL OR intent = 'google'),
  device_name        text CONSTRAINT desktop_auth_requests_device_check CHECK (device_name IS NULL OR char_length(device_name) <= 120),
  origin             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  bound_at           timestamptz,               -- the start link was opened (once)
  approved_at        timestamptz,
  approved_user_id   uuid REFERENCES auth_users(id) ON DELETE CASCADE,
  organisation_id    uuid REFERENCES organisations(id) ON DELETE CASCADE,
  web_session_id     uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,   -- the window's session (via 'window' only)
  code_hash          text UNIQUE CONSTRAINT desktop_auth_requests_code_check CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at    timestamptz,
  redeemed_at        timestamptz,
  desktop_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,
  -- The desktop session the app held when it started this request (its Bearer), so the finish page can name who the
  -- notch is signed in as now and ask before replacing them (security review, 24 October 2026: SEC-3).
  replacing_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL,
  CONSTRAINT desktop_auth_requests_approval_check CHECK (
    (approved_at IS NULL) = (code_hash IS NULL) AND (approved_at IS NULL) = (approved_user_id IS NULL))
);
-- For a database that ran an earlier draft of this file (idempotent).
ALTER TABLE desktop_auth_requests ADD COLUMN IF NOT EXISTS replacing_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS desktop_auth_requests_expiry_idx ON desktop_auth_requests(expires_at);
ALTER TABLE desktop_auth_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS desktop_auth_requests_server ON desktop_auth_requests;
CREATE POLICY desktop_auth_requests_server ON desktop_auth_requests FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON desktop_auth_requests TO boardroom_app;

-- 3. Handoff codes (a linked app signs its own window in) ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS desktop_handoff_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash          text NOT NULL UNIQUE CONSTRAINT desktop_handoff_codes_code_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  desktop_session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  origin             text NOT NULL,
  next               text NOT NULL CONSTRAINT desktop_handoff_codes_next_check
                       CHECK (char_length(next) <= 300 AND next ~ '^/' AND next !~ '^/[/\\]'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz,
  web_session_id     uuid REFERENCES auth_sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS desktop_handoff_codes_expiry_idx ON desktop_handoff_codes(expires_at);
ALTER TABLE desktop_handoff_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS desktop_handoff_codes_server ON desktop_handoff_codes;
CREATE POLICY desktop_handoff_codes_server ON desktop_handoff_codes FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON desktop_handoff_codes TO boardroom_app;

-- 4. Browser tickets (a connector consent continues in the person's browser) -------------------------------------------
CREATE TABLE IF NOT EXISTS desktop_browser_tickets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_hash        text NOT NULL UNIQUE CONSTRAINT desktop_browser_tickets_ticket_check CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  user_id            uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  source_session_id  uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  purpose            text NOT NULL CONSTRAINT desktop_browser_tickets_purpose_check CHECK (purpose IN ('connect')),
  payload            jsonb NOT NULL CONSTRAINT desktop_browser_tickets_payload_check
                       CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 4096),
  origin             text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz,
  browser_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS desktop_browser_tickets_expiry_idx ON desktop_browser_tickets(expires_at);
ALTER TABLE desktop_browser_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS desktop_browser_tickets_server ON desktop_browser_tickets;
CREATE POLICY desktop_browser_tickets_server ON desktop_browser_tickets FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker());
GRANT SELECT, INSERT, UPDATE, DELETE ON desktop_browser_tickets TO boardroom_app;
