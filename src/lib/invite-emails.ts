/**
 * The addresses typed or pasted into the welcome's Team step (owner request, 11 October 2026: the first-run welcome).
 * People paste from anywhere: a list from a spreadsheet (one per line), a mail client's "Ada Obi <ada@acme.com>; Ben
 * <ben@acme.com>", or a hand-typed "ada@acme.com, ben@acme.com". So: a display name around an address in angle brackets
 * keeps only the address, and anything between commas, semicolons, spaces and new lines is one entry; entries are trimmed,
 * lower-cased and de-duplicated (first one wins, order kept). The email rule is the auth forms' own, so the step and the
 * sign-up form agree on what looks like an address; the server's stricter check still has the last word per address.
 */
import { INVITE_BATCH_MAX } from "@/lib/welcome";

/** What the auth forms accept as an email address (the same rule as `EMAIL` in components/auth/forms.tsx). */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedInviteEmails = {
  /** Addresses that look right, lower-cased, without duplicates, in the order typed. */
  emails: string[];
  /** Entries that do not look like an address, as typed (trimmed), without duplicates. */
  invalid: string[];
  /** More than INVITE_BATCH_MAX entries (good or not): nothing should be sent. */
  tooMany: boolean;
};

export function parseInviteEmails(text: string): ParsedInviteEmails {
  // Mail clients separate entries with commas or semicolons, so a segment holding "<…>" is one person: "Ada Obi
  // <ada@acme.com>" keeps only the address. Any other segment splits on spaces. A "mailto:" prefix (a pasted link) goes.
  const entries = text.replace(/mailto:/gi, " ").split(/[,;\n\r]+/).flatMap((segment) => {
    const bracketed = /<([^<>]*)>/.exec(segment);
    return bracketed ? [bracketed[1]] : segment.split(/\s+/);
  });
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const entry = raw.trim().replace(/^["'(]+|["')]+$/g, "");
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (EMAIL_PATTERN.test(entry)) emails.push(key);
    else invalid.push(entry);
  }
  return { emails, invalid, tooMany: emails.length + invalid.length > INVITE_BATCH_MAX };
}
