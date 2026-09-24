import { describe, it, expect } from "vitest";
import { renderEmail, verifyEmailMail, resetPasswordMail, invitationMail, escapeHtml } from "../../src/server/lib/emails";

describe("email templates", () => {
  it("renders the button link in both the HTML and the text", () => {
    const { html, text } = verifyEmailMail("https://app.example/verify?token=abc");
    expect(html).toContain('href="https://app.example/verify?token=abc"');
    expect(text).toContain("Confirm my email: https://app.example/verify?token=abc");
    expect(html).toContain("Confirm your email");
  });

  it("escapes anything a person typed", () => {
    const { html } = invitationMail({ inviter: "<b>Eve</b>", org: "Acme & Co", role: "employee", email: "a@b.c", url: "https://x/y", expiresAt: new Date("2026-10-01T00:00:00Z") });
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(html).toContain("Acme &amp; Co");
    expect(escapeHtml(`"quoted" & 'single'`)).toBe("&quot;quoted&quot; &amp; &#39;single&#39;");
  });

  it("lists the details as label and value in the text twin", () => {
    const { text } = resetPasswordMail("https://x/reset");
    expect(text).toContain("Link expires: in 60 minutes");
    expect(text).toContain("Can be used: once");
  });

  it("keeps the brand and the reason line", () => {
    const { html, text } = renderEmail({ title: "Hello", intro: ["One line."], reason: "Because." });
    expect(html).toContain("BOREDROOM");
    expect(html).toContain("Because.");
    expect(text.endsWith("Nothing in it is a productivity score.")).toBe(true);
  });
});
