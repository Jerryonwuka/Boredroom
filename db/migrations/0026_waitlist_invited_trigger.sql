-- Allow the waitlist_invited automation trigger so "Mark invited" can send an invite email
-- (mirrors the waitlist_joined welcome). See src/server/admin/marketing.ts automationsForEvent.
ALTER TABLE automations DROP CONSTRAINT automations_trigger_check;
ALTER TABLE automations ADD CONSTRAINT automations_trigger_check CHECK (trigger IN (
  'user_created', 'account_age_days', 'user_inactive_days', 'subscription_expiring_days',
  'subscription_expired', 'payment_failed', 'payment_successful', 'waitlist_joined', 'waitlist_invited'
));
