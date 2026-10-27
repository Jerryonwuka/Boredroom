-- No workspace API keys (owner request, 27 October 2026: "remove every API key store … the organisation should not have
-- to put any API key inside … API keys stay on our back end (env) … as long as we have the ElevenLabs API key it works
-- for all workspaces"). Every workspace now uses Boredroom's own ANTHROPIC_API_KEY (with ASSISTANT_MODEL) and
-- ELEVENLABS_API_KEY; the code no longer reads, writes or shows a workspace's key. This deletes the keys workspaces stored
-- before, encrypted, with their hints and chosen models:
--   1. organisation_secrets (0013): each workspace's Anthropic key, its hint, model and connection time.
--   2. organisation_voice_secrets (0053): each workspace's ElevenLabs key and its hint.
--
-- WAITS FOR THE OWNER'S GO-AHEAD. It lives in db/pending, NOT db/migrations: it moves into db/migrations only once the
-- owner says so, after the new web app AND worker run everywhere (an older build still reads both tables: it would fail to
-- answer chat with a workspace key gone missing mid-request, and its Settings page would error). The code in this branch
-- works before and after it (nothing reads either table; server/lib/schema-0053 no longer asks for the voice table).
--
-- Destructive, not reversible: the stored keys are gone (each workspace can still find its own in Anthropic's and
-- ElevenLabs' consoles; revoking them there is theirs to do). Idempotent (IF EXISTS everywhere), safe to run twice.
-- Keeps: the audit rows `assistant.connected` / `voice.connected` (hints only, never keys), `ai_usage` rows with purpose
-- 'test' (the old connection test), and `voice_usage_daily` rows with key_source 'organisation' (history of what was
-- said on a workspace key; the CHECK still allows it).

DROP TABLE IF EXISTS organisation_secrets;
DROP TABLE IF EXISTS organisation_voice_secrets;
