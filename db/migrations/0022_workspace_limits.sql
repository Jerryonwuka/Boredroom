-- Workspaces per plan (owner decision, 25 September 2026): Free owns 1, Pro up to 5, Enterprise unlimited (NULL).
-- The allowance belongs to a person: the best plan among the workspaces they own sets how many they may own.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_workspaces integer CHECK (max_workspaces IS NULL OR max_workspaces > 0);
UPDATE plans SET max_workspaces = 1 WHERE code = 'free';
UPDATE plans SET max_workspaces = 5 WHERE code = 'pro';
UPDATE plans SET max_workspaces = NULL WHERE code = 'enterprise';
