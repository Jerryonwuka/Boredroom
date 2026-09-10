/** Creates .env.local from .env.example (if missing) with a generated APP_SECRET. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.log(".env.local already exists; leaving it unchanged.");
} else {
  const example = readFileSync(".env.example", "utf8").replace(/^APP_SECRET=.*$/m, `APP_SECRET=${randomBytes(32).toString("base64")}`).replace(/^SCAN_ALLOW_UNSCANNED=.*$/m, "SCAN_ALLOW_UNSCANNED=true");
  writeFileSync(".env.local", example);
  console.log("Created .env.local with a generated APP_SECRET (local PostgreSQL defaults).");
}
