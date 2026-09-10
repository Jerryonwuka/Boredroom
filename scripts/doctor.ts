/** Terminal version of /api/health: `pnpm doctor`. */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { runHealthChecks } from "../src/server/lib/health";
import { getPool } from "../src/server/db";

runHealthChecks().then(async (r) => {
  for (const [name, c] of Object.entries(r.checks)) {
    console.log(`${c.ok ? "OK  " : "FAIL"} ${name.padEnd(9)} ${c.detail ?? ""}${c.fix ? `\n            fix: ${c.fix}` : ""}`);
  }
  console.log(r.ok ? "\nAll checks passed. Sign-up and sign-in should work." : "\nFix the failing checks above, then run pnpm doctor again.");
  await getPool().end().catch(() => undefined);
  process.exit(r.ok ? 0 : 1);
});
