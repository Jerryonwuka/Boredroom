/**
 * Sends one test message through the configured mail provider so you can confirm real delivery works:
 *
 *   pnpm mail:test you@example.com
 *
 * With MAIL_PROVIDER=sink the message lands in the local sink (/dev/mail). With MAIL_PROVIDER=smtp (Brevo or any
 * relay) the login is checked first, then the message is sent from MAIL_FROM; with resend it goes through Resend's
 * API. The output shows the provider's message id, or the exact reason it was refused.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { mail, mailConfigProblem } from "../src/server/lib/mail";

async function main() {
  const to = process.argv[2];
  if (!to || !/@/.test(to)) { console.error("Usage: pnpm mail:test <address>"); process.exit(1); }
  const kind = process.env.MAIL_PROVIDER ?? "sink";
  const problem = mailConfigProblem();
  if (problem) { console.error(`Mail is not configured: ${problem}`); process.exit(1); }
  const provider = mail();
  if (provider.verify) { await provider.verify(); if (kind !== "sink") console.log("Logged in to the mail relay."); }
  console.log(`Sending a test message to ${to} via ${kind} from ${process.env.MAIL_FROM ?? "(default sender)"}…`);
  const { id } = await provider.send({
    to,
    category: "test",
    subject: "Boredroom mail test",
    text: `This is a test message from Boredroom.\n\nIf you can read it, real email delivery is working (provider: ${kind}).\nSent ${new Date().toUTCString()}.`,
  });
  console.log(kind === "sink" ? `Written to the local sink (id ${id}); read it at ${process.env.APP_ORIGIN ?? "http://localhost:3000"}/dev/mail.` : `Accepted by the ${kind} provider (message id ${id}). Check the inbox, and the spam folder the first time.`);
}
main().catch((err) => { console.error((err as Error).message); process.exit(1); });
