-- Her voice (owner decision, 7 October 2026: personal assistants, phase 2). Each person chooses when their own assistant
-- reads her replies aloud, on the web and in the notch alike: 'voice' (the default: replies to what they dictated or
-- said to her), 'always' or 'never'. Which voice and how fast are kept on each device, not here (voices differ by
-- computer). Everyone in the workspace may read it with the rest of the profile (0035's policies); only the person
-- writes their own (0035's insert and update policies cover the new column; the table grants cover it too).
-- Additive and idempotent: safe to run by hand twice. The constant DEFAULT keeps the new column metadata-only (no table
-- rewrite; existing rows read 'voice'); the CHECK is validated by one quick scan of this small table. Code deployed
-- before this runs reads 'voice' for everyone and refuses to save (server/services/assistant-profile).
ALTER TABLE assistant_profiles ADD COLUMN IF NOT EXISTS speak text NOT NULL DEFAULT 'voice'
  CONSTRAINT assistant_profiles_speak_check CHECK (speak IN ('voice', 'always', 'never'));
