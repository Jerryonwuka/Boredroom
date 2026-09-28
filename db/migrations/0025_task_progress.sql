-- How far along a task is (owner decision, 28 September 2026): the person holding it sets a percentage, shown as a
-- half-ring on their list. Completed tasks read as 100 regardless.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100);
