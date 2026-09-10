/** Creates .env.local from .env.example (if missing) with a generated APP_SECRET. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.log(".env.local already exists; leaving it unchanged.");
} else {
  const template = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "DATABASE_ADMIN_URL=postgres://boardroom_owner:boardroom_owner@localhost:5432/boardroom\nDATABASE_URL=postgres://boardroom_app:boardroom_app@localhost:5432/boardroom\nTEST_DATABASE_ADMIN_URL=postgres://boardroom_owner:boardroom_owner@localhost:5432/boardroom_test\nTEST_DATABASE_URL=postgres://boardroom_app:boardroom_app@localhost:5432/boardroom_test\nAPP_ORIGIN=http://localhost:3000\nAPP_SECRET=change-me\nMAIL_PROVIDER=sink\nSTORAGE_PROVIDER=local\nSCAN_ALLOW_UNSCANNED=true\n";
  const example = template.replace(/^APP_SECRET=.*$/m, `APP_SECRET=${randomBytes(32).toString("base64")}`).replace(/^SCAN_ALLOW_UNSCANNED=.*$/m, "SCAN_ALLOW_UNSCANNED=true");
  writeFileSync(".env.local", example);
  console.log("Created .env.local with a generated APP_SECRET (local PostgreSQL defaults).");
}
