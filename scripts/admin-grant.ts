/**
 * Grants a Control Center role to an account, creating the account when it does not exist:
 *
 *   pnpm admin:grant <email> [role] [--password <password>] [--name "<display name>"]
 *
 * Roles: super_admin (default), operations, support, billing, marketing, technical, read_only.
 * With --password the account's password is set (or reset) and the email is marked verified, so the person can
 * sign in at once. Runs with the admin database URL; nothing is emailed.
 */
import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { Client } from "pg";
import { hashPassword } from "../src/server/lib/crypto";
import { ADMIN_ROLES } from "../src/server/admin/permissions";

async function main() {
  const args = process.argv.slice(2);
  const email = args[0]?.trim().toLowerCase();
  const role = (args[1] && !args[1].startsWith("--") ? args[1] : "super_admin") as (typeof ADMIN_ROLES)[number];
  const password = args.includes("--password") ? args[args.indexOf("--password") + 1] : null;
  const name = args.includes("--name") ? args[args.indexOf("--name") + 1] : null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Usage: pnpm admin:grant <email> [role] [--password <password>] [--name <name>]"); process.exit(1); }
  if (!ADMIN_ROLES.includes(role)) { console.error(`Unknown role ${role}. One of: ${ADMIN_ROLES.join(", ")}`); process.exit(1); }
  if (password !== null && password.length < 10) { console.error("The password must be at least 10 characters."); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect();
  try {
    await c.query("BEGIN");
    let u = (await c.query<{ id: string }>("SELECT id FROM auth_users WHERE email = $1", [email])).rows[0];
    let created = false;
    if (!u) {
      if (!password) { console.error(`No account has ${email}. Pass --password to create one.`); process.exit(1); }
      u = (await c.query<{ id: string }>("INSERT INTO auth_users(email, password_hash, email_verified_at, status) VALUES ($1, $2, now(), 'active') RETURNING id", [email, await hashPassword(password)])).rows[0];
      await c.query("INSERT INTO profiles(auth_user_id, display_name, email) VALUES ($1, $2, $3)", [u.id, (name ?? email.split("@")[0]).slice(0, 120), email]);
      created = true;
    } else if (password) {
      await c.query("UPDATE auth_users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()), status = 'active', status_reason = NULL, updated_at = now() WHERE id = $1", [u.id, await hashPassword(password)]);
      if (name) await c.query("UPDATE profiles SET display_name = $2 WHERE auth_user_id = $1", [u.id, name.slice(0, 120)]);
    }
    await c.query("INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, $2, 'active') ON CONFLICT (auth_user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', disabled_at = NULL", [u.id, role]);
    await c.query("INSERT INTO platform_audit_events(admin_user_id, action, target_type, target_id, target_label, metadata) VALUES (NULL, 'admin.granted_by_script', 'admin', $1, $2, $3)", [u.id, email, JSON.stringify({ role, created, passwordSet: !!password })]);
    await c.query("COMMIT");
    console.log(`${created ? "Created" : "Updated"} ${email}: ${role}${password ? ", password set, email verified" : ""}. Sign in at ${process.env.APP_ORIGIN ?? "http://localhost:3000"}/login, then open /admin.`);
  } catch (err) { await c.query("ROLLBACK"); throw err; } finally { await c.end(); }
}
main().catch((err) => { console.error((err as Error).message); process.exit(1); });
