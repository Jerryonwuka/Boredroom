-- Work status a person sets for themselves (active, away, do not disturb, offline), shown as a dot on their avatar.
ALTER TABLE profiles
  ADD COLUMN presence text NOT NULL DEFAULT 'active' CHECK (presence IN ('active', 'away', 'busy', 'offline')),
  ADD COLUMN presence_set_at timestamptz;

-- New messages reach open browsers at once (the toast and the thread), not only through the notification row.
DROP TRIGGER IF EXISTS messages_notify ON messages;
CREATE TRIGGER messages_notify AFTER INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION notify_org_change();
