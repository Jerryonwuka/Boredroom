-- Inbound mail received to any @boredroom.cc address (via Resend inbound → /api/inbound/resend webhook).
-- Platform-level (not tenant-scoped), like email_log/marketing_contacts; read through withSystem behind the
-- communications.view admin permission. The body is fetched from Resend and stored so the inbox reads our own DB.
CREATE TABLE inbound_emails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL DEFAULT 'resend',
  resend_inbox_id text,
  resend_thread_id text,
  resend_email_id text UNIQUE,
  message_id      text,
  from_addr       text NOT NULL,
  to_addr         text NOT NULL,
  cc              text,
  subject         text,
  body_text       text,
  body_html       text,
  attachments     jsonb NOT NULL DEFAULT '[]',
  received_at     timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_emails_received_idx ON inbound_emails(received_at DESC);
CREATE INDEX inbound_emails_to_idx ON inbound_emails(to_addr);
GRANT SELECT, INSERT, UPDATE ON inbound_emails TO boardroom_app;
