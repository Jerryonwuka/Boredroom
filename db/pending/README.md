Migrations that wait here are written but must NOT be applied yet; `pnpm db:migrate` and the test reset only read `db/migrations`.
`0055_remove_screen_recording.sql` (owner decision, 8 October 2026: phase 8) moves into `db/migrations` only after (1) the new web app AND the new worker run everywhere, and (2) the owner ran `pnpm db:delete-recordings --confirm=<host>/<database>` (the host and the database, as the dry run prints them).
Its guard refuses while any recording data remains; the procedure is in docs/runbooks.md, "Deleting the old recordings (phase 8)".
