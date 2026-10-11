/**
 * The Team step's address parser (owner request, 11 October 2026: the first-run welcome): commas, semicolons, new lines
 * and spaces separate entries; entries are trimmed, lower-cased and de-duplicated; anything that is not an address is
 * listed as typed; more than INVITE_BATCH_MAX entries is too many.
 */
import { describe, expect, it } from "vitest";
import { parseInviteEmails } from "@/lib/invite-emails";
import { INVITE_BATCH_MAX } from "@/lib/welcome";

describe("parseInviteEmails", () => {
  it("splits on commas, semicolons, new lines and spaces", () => {
    const r = parseInviteEmails("ada@acme.com, ben@acme.com;cara@acme.com\ndan@acme.com\r\neve@acme.com fola@acme.com\tgbenga@acme.com");
    expect(r).toEqual({ emails: ["ada@acme.com", "ben@acme.com", "cara@acme.com", "dan@acme.com", "eve@acme.com", "fola@acme.com", "gbenga@acme.com"], invalid: [], tooMany: false });
  });

  it("trims, lower-cases and drops duplicates, keeping the first one's place", () => {
    const r = parseInviteEmails("  Ada@Acme.com ,ben@acme.com, ADA@acme.COM ,, ;; ben@acme.com ");
    expect(r.emails).toEqual(["ada@acme.com", "ben@acme.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("keeps the address from a mail client's \"Name <address>\" entries", () => {
    const r = parseInviteEmails("Ada Obi <ada@acme.com>; \"Ben Eze\" <Ben@Acme.com>, cara@acme.com");
    expect(r.emails).toEqual(["ada@acme.com", "ben@acme.com", "cara@acme.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("drops a pasted mailto: prefix", () => {
    expect(parseInviteEmails("mailto:ada@acme.com").emails).toEqual(["ada@acme.com"]);
  });

  it("lists what isn't an address, as typed, once", () => {
    const r = parseInviteEmails("ada@acme.com, ben@acme, Cara, @acme.com, cara");
    expect(r.emails).toEqual(["ada@acme.com"]);
    expect(r.invalid).toEqual(["ben@acme", "Cara", "@acme.com"]);
    expect(r.tooMany).toBe(false);
  });

  it("gives nothing for empty or blank text", () => {
    expect(parseInviteEmails("")).toEqual({ emails: [], invalid: [], tooMany: false });
    expect(parseInviteEmails(" \n , ; ")).toEqual({ emails: [], invalid: [], tooMany: false });
  });

  it("allows INVITE_BATCH_MAX entries and refuses one more", () => {
    expect(INVITE_BATCH_MAX).toBe(20);
    const list = (n: number) => Array.from({ length: n }, (_, i) => `person${i + 1}@acme.com`).join("\n");
    expect(parseInviteEmails(list(20))).toMatchObject({ tooMany: false });
    const r = parseInviteEmails(list(21));
    expect(r.tooMany).toBe(true);
    expect(r.emails).toHaveLength(21);
  });

  it("counts entries that are not addresses towards the limit", () => {
    const text = `${Array.from({ length: 20 }, (_, i) => `p${i}@acme.com`).join(",")}, oops`;
    expect(parseInviteEmails(text)).toMatchObject({ tooMany: true, invalid: ["oops"] });
  });
});
