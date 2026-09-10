import { config } from "dotenv";

// Next.js loads .env.local itself; scripts, the worker and tests use this loader.
export function loadEnv() {
  config({ path: [".env.local", ".env"], quiet: true });
}
