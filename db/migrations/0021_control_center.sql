-- Boredroom Control Center: the internal control plane. Administrators, their audit trail, platform settings and
-- launch mode, plans and subscriptions with Paystack payments, marketing contacts, segments, templates, campaigns and
-- automations, the waitlist, impersonation records, and the platform event log.
--
-- Every table here is reached only through the system role (app_is_worker()), never from a member's context, so an
-- ordinary Boredroom user can neither read nor write any of it. Tenant tables gain a few columns for moderation.

-- ---- Moderation columns on existing tables ------------------------------------------------------------------

ALTER TABLE organisations
  ADD COLUMN suspended_at     timestamptz,
  ADD COLUMN suspended_reason text,
  ADD COLUMN archived_at      timestamptz,
  ADD COLUMN feature_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE auth_users
  ADD COLUMN status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
  ADD COLUMN status_reason     text,
  ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN last_login_at     timestamptz;

ALTER TABLE auth_sessions
  ADD COLUMN impersonation_id uuid;

-- ---- Administrators --------------------------------------------------------------------------------------------

CREATE TABLE platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('super_admin', 'operations', 'support', 'billing', 'marketing', 'technical', 'read_only')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by    uuid REFERENCES auth_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  disabled_at   timestamptz
);

CREATE TABLE platform_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id   uuid REFERENCES auth_users(id),
  action          text NOT NULL,
  target_type     text NOT NULL,
  target_id       text,
  target_label    text,
  organisation_id uuid,
  before          jsonb,
  after           jsonb,
  reason          text,
  ip              text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_time_idx ON platform_audit_events(occurred_at DESC);
CREATE INDEX platform_audit_target_idx ON platform_audit_events(target_type, target_id);
CREATE INDEX platform_audit_org_idx ON platform_audit_events(organisation_id, occurred_at DESC);

CREATE TABLE admin_impersonations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  uuid NOT NULL REFERENCES auth_users(id),
  target_user_id uuid NOT NULL REFERENCES auth_users(id),
  session_id     uuid,
  reason         text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz
);

-- ---- Platform settings and events ----------------------------------------------------------------------------------

CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth_users(id)
);
INSERT INTO platform_settings(key, value) VALUES
  ('launch', '{"mode":"live","waitlist_open":true,"app_access":true}'),
  ('general', '{"platform_name":"Boredroom","support_email":"","currency":"NGN"}'),
  ('landing', '{"headline":"","subheadline":"","cta":""}'),
  ('feature_flags', '{}'),
  ('billing', '{"trial_days":14,"grace_days":3}');

CREATE TABLE platform_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  organisation_id uuid,
  auth_user_id    uuid,
  contact_id      uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_events_type_idx ON platform_events(type, occurred_at DESC);

-- ---- Plans, subscriptions, payments --------------------------------------------------------------------------------

CREATE TABLE plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text,
  currency           text NOT NULL DEFAULT 'NGN',
  monthly_price      integer NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),   -- minor units (kobo, cents)
  annual_price       integer NOT NULL DEFAULT 0 CHECK (annual_price >= 0),
  max_users          integer,
  max_storage_bytes  bigint,
  trial_days         integer NOT NULL DEFAULT 0,
  features           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"VIDEO_RECORDING": true, ...}
  limits             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'archived')),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plans(code, name, description, currency, monthly_price, annual_price, max_users, max_storage_bytes, trial_days, features, sort_order) VALUES
  ('free', 'Free', 'For a small team trying Boredroom out.', 'NGN', 0, 0, 5, 2147483648, 0, '{"HEARTBEAT_TRACKING":true,"EXPORT_REPORTS":false,"VIDEO_RECORDING":false,"ADVANCED_ANALYTICS":false}', 0),
  ('pro', 'Pro', 'Everything a remote team needs, recordings included.', 'NGN', 1500000, 15000000, 50, 107374182400, 14, '{"HEARTBEAT_TRACKING":true,"EXPORT_REPORTS":true,"VIDEO_RECORDING":true,"ADVANCED_ANALYTICS":false}', 1),
  ('enterprise', 'Enterprise', 'Larger organisations, advanced analytics, priority support.', 'NGN', 5000000, 50000000, NULL, NULL, 14, '{"HEARTBEAT_TRACKING":true,"EXPORT_REPORTS":true,"VIDEO_RECORDING":true,"ADVANCED_ANALYTICS":true,"AUDIT_LOGS":true,"API_ACCESS":true}', 2);

CREATE TABLE subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL UNIQUE REFERENCES organisations(id),
  plan_id                   uuid NOT NULL REFERENCES plans(id),
  status                    text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'payment_failed', 'past_due', 'cancelled', 'expired', 'suspended')),
  billing_interval          text NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'annual')),
  started_at                timestamptz NOT NULL DEFAULT now(),
  trial_ends_at             timestamptz,
  current_period_end        timestamptz,
  cancelled_at              timestamptz,
  auto_renew                boolean NOT NULL DEFAULT true,
  paystack_customer_code    text,
  paystack_subscription_code text,
  paystack_email_token      text,
  paystack_authorization    jsonb,
  last_payment_at           timestamptz,
  payment_status            text,
  notes                     text,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_period_idx ON subscriptions(current_period_end);

-- Every existing organisation starts on Free, active, so nothing is locked out by the arrival of billing.
INSERT INTO subscriptions(organisation_id, plan_id, status, current_period_end)
SELECT o.id, (SELECT id FROM plans WHERE code = 'free'), 'active', NULL FROM organisations o;

CREATE TABLE payment_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  organisation_id  uuid REFERENCES organisations(id),
  subscription_id  uuid REFERENCES subscriptions(id),
  plan_id          uuid REFERENCES plans(id),
  customer_email   citext,
  amount           integer NOT NULL,             -- minor units
  currency         text NOT NULL DEFAULT 'NGN',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded', 'abandoned')),
  channel          text,
  gateway_response text,
  paystack_id      bigint,
  paid_at          timestamptz,
  refunded_at      timestamptz,
  interval         text,
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_transactions_org_idx ON payment_transactions(organisation_id, created_at DESC);
CREATE INDEX payment_transactions_status_idx ON payment_transactions(status, created_at DESC);

CREATE TABLE paystack_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key    text NOT NULL UNIQUE,     -- event name + reference/id, so a redelivered webhook is a no-op
  event        text NOT NULL,
  reference    text,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

-- ---- Marketing, communications, waitlist ----------------------------------------------------------------------------

CREATE TABLE marketing_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  first_name       text,
  last_name        text,
  company          text,
  company_size     text,
  role_title       text,
  country          text,
  interest         text,
  source           text NOT NULL DEFAULT 'waitlist',
  status           text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'registered', 'activated', 'trial', 'paid', 'unsubscribed')),
  is_waitlist      boolean NOT NULL DEFAULT true,
  auth_user_id     uuid REFERENCES auth_users(id) ON DELETE SET NULL,
  invited_at       timestamptz,
  unsubscribed_at  timestamptz,
  brevo_id         bigint,
  brevo_synced_at  timestamptz,
  brevo_error      text,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_contacts_status_idx ON marketing_contacts(status, created_at DESC);

CREATE TABLE marketing_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  rules       jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  category   text NOT NULL CHECK (category IN ('marketing', 'lifecycle', 'billing', 'transactional')),
  subject    text NOT NULL,
  eyebrow    text,
  title      text NOT NULL,
  body       text NOT NULL,          -- paragraphs separated by blank lines; {{variables}} allowed
  cta_label  text,
  cta_url    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO email_templates(code, name, category, subject, eyebrow, title, body, cta_label, cta_url) VALUES
  ('welcome', 'Welcome', 'lifecycle', 'Welcome to Boredroom, {{first_name}}', 'Welcome', 'Your team, in one room', 'Thanks for joining Boredroom. Clock in, plan the day, press Start on the first to-do, and your lead sees the work as it happens.\n\nIf anything is unclear, reply to this email.', 'Open Boredroom', '{{app_url}}/app'),
  ('day7', 'Day 7 education', 'lifecycle', 'One week in: three things worth trying', 'Week one', 'Three things worth trying this week', 'Ask the assistant to draft your to-dos from a note.\n\nAttach a task to a message when you ask for an update.\n\nSubmit the day''s report at the end of the day; your lead approves it in a click.', 'Open My Day', '{{app_url}}/app'),
  ('day30', '30-day engagement', 'lifecycle', 'A month of {{organization_name}} on Boredroom', 'One month', 'A month in', 'Reports now show a month of confirmed hours per person and team. Take a look, and tell us what is missing.', 'See reports', '{{app_url}}/app'),
  ('inactive', 'Inactive user', 'lifecycle', 'Still there, {{first_name}}?', 'We miss you', 'Your room is still open', 'Nothing has happened in your workspace for a while. Your to-dos and records are exactly where you left them.', 'Come back', '{{app_url}}/app'),
  ('renewal_reminder', 'Renewal reminder', 'billing', '{{organization_name}} renews on {{subscription_expiry}}', 'Billing', 'Your plan renews soon', 'The {{plan_name}} plan for {{organization_name}} renews on {{subscription_expiry}} for {{renewal_amount}}. Nothing to do if your card is up to date.', 'Manage billing', '{{app_url}}/app'),
  ('subscription_expiring', 'Subscription expiring', 'billing', '{{organization_name}}: your plan ends on {{subscription_expiry}}', 'Billing', 'Your plan ends on {{subscription_expiry}}', 'The {{plan_name}} plan for {{organization_name}} ends on {{subscription_expiry}}. Renew to keep recordings, reports and history for the whole team.', 'Renew now', '{{app_url}}/app'),
  ('subscription_expired', 'Subscription expired', 'billing', '{{organization_name}}: your plan has ended', 'Billing', 'Your plan has ended', 'The {{plan_name}} plan for {{organization_name}} has ended. The workspace is on the Free plan until you renew; nothing has been deleted.', 'Renew now', '{{app_url}}/app'),
  ('payment_failed', 'Payment failed', 'billing', 'A payment for {{organization_name}} did not go through', 'Billing', 'A payment did not go through', 'We could not collect {{renewal_amount}} for the {{plan_name}} plan. Update the card or try again to keep the plan active.', 'Fix payment', '{{app_url}}/app'),
  ('payment_successful', 'Payment successful', 'billing', 'Receipt: {{plan_name}} for {{organization_name}}', 'Receipt', 'Payment received', 'Thanks. {{renewal_amount}} was received for the {{plan_name}} plan for {{organization_name}}. Reference {{payment_reference}}.', 'Open Boredroom', '{{app_url}}/app'),
  ('launch', 'Launch announcement', 'marketing', 'Boredroom is live', 'Launch', 'Boredroom is open', 'Thanks for waiting. Boredroom is now open to everyone: create your organisation, invite your team, and see the day as it happens.', 'Create your organisation', '{{app_url}}/signup?intent=org'),
  ('waitlist_confirmation', 'Waitlist confirmation', 'transactional', 'You are on the Boredroom waitlist', 'Waitlist', 'You are on the list', 'Thanks, {{first_name}}. We will email you the moment Boredroom opens. Until then, reply to this email with anything you would like it to do.', NULL, NULL),
  ('account_suspended', 'Account suspended', 'transactional', 'Your Boredroom access has been suspended', 'Account', 'Access suspended', 'Your access to Boredroom has been suspended. Reason: {{reason}}. Reply to this email if you think this is a mistake.', NULL, NULL);

CREATE TABLE campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  subject      text NOT NULL,
  template_id  uuid REFERENCES email_templates(id),
  eyebrow      text,
  title        text,
  body         text,
  cta_label    text,
  cta_url      text,
  audience     jsonb NOT NULL DEFAULT '{"kind":"waitlist"}'::jsonb,   -- {"kind":"waitlist"|"all"|"free"|"paid"|"trial"|"expiring"|"segment","segmentId":...}
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  recipients   integer NOT NULL DEFAULT 0,
  sent         integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  skipped      integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES auth_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES marketing_contacts(id) ON DELETE SET NULL,
  email        citext NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_id  text,
  error        text,
  sent_at      timestamptz,
  UNIQUE (campaign_id, email)
);

CREATE TABLE automations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  trigger        text NOT NULL CHECK (trigger IN ('user_created', 'account_age_days', 'user_inactive_days', 'subscription_expiring_days', 'subscription_expired', 'payment_failed', 'payment_successful', 'waitlist_joined')),
  trigger_value  integer,                 -- days for the age, inactivity and expiring triggers
  template_id    uuid NOT NULL REFERENCES email_templates(id),
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO automations(name, trigger, trigger_value, template_id, enabled) VALUES
  ('Welcome, one day in', 'account_age_days', 1, (SELECT id FROM email_templates WHERE code = 'welcome'), true),
  ('Day 7 education', 'account_age_days', 7, (SELECT id FROM email_templates WHERE code = 'day7'), true),
  ('30-day engagement', 'account_age_days', 30, (SELECT id FROM email_templates WHERE code = 'day30'), true),
  ('Inactive for 14 days', 'user_inactive_days', 14, (SELECT id FROM email_templates WHERE code = 'inactive'), false),
  ('Expiring in 14 days', 'subscription_expiring_days', 14, (SELECT id FROM email_templates WHERE code = 'subscription_expiring'), true),
  ('Expiring in 7 days', 'subscription_expiring_days', 7, (SELECT id FROM email_templates WHERE code = 'subscription_expiring'), true),
  ('Expiring in 3 days', 'subscription_expiring_days', 3, (SELECT id FROM email_templates WHERE code = 'subscription_expiring'), true),
  ('Expiring tomorrow', 'subscription_expiring_days', 1, (SELECT id FROM email_templates WHERE code = 'subscription_expiring'), true),
  ('Subscription expired', 'subscription_expired', NULL, (SELECT id FROM email_templates WHERE code = 'subscription_expired'), true),
  ('Payment failed', 'payment_failed', NULL, (SELECT id FROM email_templates WHERE code = 'payment_failed'), true),
  ('Renewal successful', 'payment_successful', NULL, (SELECT id FROM email_templates WHERE code = 'payment_successful'), true),
  ('Waitlist confirmation', 'waitlist_joined', NULL, (SELECT id FROM email_templates WHERE code = 'waitlist_confirmation'), true);

CREATE TABLE automation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  subject_key    text NOT NULL,          -- what it ran for (user id, org id, contact id) so it runs once
  email          citext NOT NULL,
  status         text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error          text,
  ran_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, subject_key)
);

CREATE TABLE email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email        citext NOT NULL,
  subject         text NOT NULL,
  category        text NOT NULL,          -- transactional | marketing | lifecycle | billing | admin
  provider        text NOT NULL,
  provider_id     text,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error           text,
  campaign_id     uuid,
  automation_id   uuid,
  organisation_id uuid,
  sent_by         uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_time_idx ON email_log(created_at DESC);
CREATE INDEX email_log_to_idx ON email_log(to_email, created_at DESC);

-- ---- Row security: system and worker only ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_admins','platform_audit_events','admin_impersonations','platform_settings','platform_events','plans','subscriptions','payment_transactions','paystack_events','marketing_contacts','marketing_segments','email_templates','campaigns','campaign_recipients','automations','automation_runs','email_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_system ON %I FOR ALL USING (app_is_worker()) WITH CHECK (app_is_worker())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO boardroom_app', t);
  END LOOP;
END $$;

-- Plans are the one thing a signed-in member may read (to see what they are on and what they could move to).
CREATE POLICY plans_member_select ON plans FOR SELECT USING (app_user_id() IS NOT NULL AND status <> 'archived');
CREATE POLICY subscriptions_member_select ON subscriptions FOR SELECT USING (app_is_member(organisation_id));
CREATE POLICY payment_transactions_member_select ON payment_transactions FOR SELECT USING (organisation_id IS NOT NULL AND app_has_role(organisation_id, 'owner', 'hr'));

-- The audit trail is append-only for everyone but the database owner.
REVOKE UPDATE, DELETE ON platform_audit_events FROM boardroom_app;
