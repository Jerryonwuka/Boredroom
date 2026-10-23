/**
 * Connected apps (owner decisions, 22 October 2026: connectors, D4): connector data is never used for scores, monitoring,
 * reports about a person or attendance judgements. These files never import the connectors, and the channel digest never
 * reads a connector_* table.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DENY = [
  "src/server/services/daily-report.ts", "src/server/services/work-summary.ts", "src/server/services/attendance.ts", "src/server/services/views.ts",
  "src/server/services/follow-ups.ts", "src/server/services/follow-up-facts.ts", "src/server/services/standup-compose.ts", "src/server/services/notice-facts.ts",
  "src/server/services/catch-up.ts", "src/server/services/profile.ts", "src/lib/presence.ts",
];

describe("D4 boundaries", () => {
  it.each(DENY)("%s never imports the connectors", (p) => {
    if (!existsSync(join(process.cwd(), p))) return;
    const s = read(p);
    expect(s).not.toMatch(/@\/server\/connectors|server\/connectors\//);
    expect(s).not.toMatch(/\bconnector_(items|connections|identities|sources|task_links)\b/);
  });

  it("the channel digest reads no connector_* table", () => {
    const s = read("src/server/connectors/posting/digest.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(s).not.toMatch(/connector_[a-z_]+/);
  });
});
