/**
 * Every email Boredroom sends, on the design system: the black canvas, one card, one white button, quiet grey
 * meta text. Built as tables with inline styles because that is what mail clients honour; the fonts are named and fall
 * back to the system sans (no web font is loaded: a font request tells its host who opened the mail; 11 November 2026). Each builder returns the HTML and a plain-text twin, so a client that shows
 * neither images nor HTML still gets the link.
 */
import { LEGAL_ENTITY, legalEntityReady } from "@/lib/legal";

export type EmailContent = {
  /** The line inbox previews show after the subject; hidden in the body. */
  preheader?: string;
  /** Small orange label above the title (the eyebrow). */
  eyebrow?: string;
  title: string;
  /** One paragraph per entry. */
  intro: string[];
  cta?: { label: string; url: string };
  /** Small facts under the button: who invited you, the role, when the link expires. */
  details?: { label: string; value: string }[];
  /** A quiet line after the details: "if you did not ask for this, ignore it". */
  note?: string;
  /** Why the person received it; the footer. */
  reason?: string;
  /** Product news only (owner decision, 11 November 2026): the person's own unsubscribe link, in the footer. */
  unsubscribeUrl?: string;
};

// The tokens, as mail clients can use them (no CSS variables in email).
const C = {
  canvas: "#000000", card: "#121212", cardBorder: "#2a2a2a", inset: "#0a0a0a", insetBorder: "#242424",
  fg: "#ffffff", muted: "#a1a1a1", subtle: "#6b6b6b", accent: "#ff6c02", accentFg: "#140700", accentBorder: "#ff8226",
  // The button is white like the app's primary (owner request, 26 October 2026: orange is an accent, never a button).
  button: "#ffffff", buttonFg: "#0a0a0a", buttonBorder: "#ffffff",
};
// Single quotes inside: these land in double-quoted style attributes.
const FONT = `Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const DISPLAY = `'Cal Sans', Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const e = escapeHtml;
  // Who sent it and from where (11 November 2026): the operator's name and postal address, once the owner has given them.
  const sender = legalEntityReady() ? `${LEGAL_ENTITY.name.trim()}, ${LEGAL_ENTITY.address.trim()}` : "";
  const paragraphs = c.intro.map((p) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.muted};">${e(p)}</p>`).join("");
  const button = c.cta ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
      <tr><td style="border-radius:14px;background:${C.button};border:1px solid ${C.buttonBorder};">
        <a href="${e(c.cta.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;line-height:18px;color:${C.buttonFg};text-decoration:none;border-radius:14px;">${e(c.cta.label)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.subtle};">If the button does not work, copy this link into your browser:<br><a href="${e(c.cta.url)}" style="color:${C.muted};text-decoration:underline;word-break:break-all;">${e(c.cta.url)}</a></p>` : "";
  const details = c.details?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid ${C.insetBorder};border-radius:12px;background:${C.inset};">
      ${c.details.map((d, i) => `<tr>
        <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.insetBorder};` : ""}font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.subtle};width:38%;">${e(d.label)}</td>
        <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.insetBorder};` : ""}font-family:${FONT};font-size:14px;color:${C.fg};">${e(d.value)}</td>
      </tr>`).join("")}
    </table>` : "";
  const note = c.note ? `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.subtle};">${e(c.note)}</p>` : "";
  const eyebrow = c.eyebrow ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.accent};">${e(c.eyebrow)}</p>` : "";
  const preheader = c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">${e(c.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>` : "";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${e(c.title)}</title>
  <style>
    body { margin: 0; padding: 0; background: ${C.canvas}; -webkit-text-size-adjust: 100%; }
    a { color: ${C.accent}; }
    @media (max-width: 600px) { .card { padding: 24px 20px !important; } .wrap { padding: 20px 12px !important; } }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
    <tr><td class="wrap" align="center" style="padding:36px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">
        <tr><td style="padding:0 6px 18px;font-family:${DISPLAY};font-size:18px;letter-spacing:0.06em;color:${C.fg};">BOREDROOM<span style="color:${C.accent};">.</span></td></tr>
        <tr><td class="card" style="padding:32px 32px 28px;background:${C.card};border:1px solid ${C.cardBorder};border-radius:20px;">
          ${eyebrow}
          <h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:28px;line-height:1.15;letter-spacing:-0.02em;font-weight:700;color:${C.fg};">${e(c.title)}</h1>
          ${paragraphs}
          ${button}
          ${details}
          ${note}
        </td></tr>
        <tr><td style="padding:20px 6px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.subtle};">
          ${c.reason ? `${e(c.reason)}<br>` : ""}${c.unsubscribeUrl ? `<a href="${e(c.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a> from product news.<br>` : ""}Boredroom keeps track of what a remote team plans, does and delivers. Nothing in it is a productivity score.${sender ? `<br>${e(sender)}` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    c.eyebrow ? c.eyebrow.toUpperCase() : null,
    c.title,
    "",
    ...c.intro,
    c.cta ? `\n${c.cta.label}: ${c.cta.url}` : null,
    c.details?.length ? "\n" + c.details.map((d) => `${d.label}: ${d.value}`).join("\n") : null,
    c.note ? `\n${c.note}` : null,
    c.reason ? `\n${c.reason}` : null,
    c.unsubscribeUrl ? `Unsubscribe from product news: ${c.unsubscribeUrl}` : null,
    "\nBoredroom keeps track of what a remote team plans, does and delivers. Nothing in it is a productivity score.",
    sender || null,
  ].filter((l): l is string => l !== null).join("\n");

  return { html, text };
}

// ---- The emails --------------------------------------------------------------

export function verifyEmailMail(url: string) {
  return renderEmail({
    preheader: "One click confirms your email and opens your Boredroom account.",
    eyebrow: "Welcome",
    title: "Confirm your email",
    intro: ["Thanks for creating a Boredroom account. Confirm this address and you can open your workspace."],
    cta: { label: "Confirm my email", url },
    details: [{ label: "Link expires", value: "in 24 hours" }],
    note: "If you did not create an account, ignore this message and nothing happens.",
    reason: "You received this because an account was created with this address.",
  });
}

export function resetPasswordMail(url: string) {
  return renderEmail({
    preheader: "Choose a new password for your Boredroom account.",
    eyebrow: "Password",
    title: "Choose a new password",
    intro: ["Someone asked to reset the password for the Boredroom account at this address. Press the button to choose a new one."],
    cta: { label: "Choose a new password", url },
    details: [{ label: "Link expires", value: "in 60 minutes" }, { label: "Can be used", value: "once" }],
    note: "If you did not ask for this, ignore it; your password stays as it is.",
    reason: "You received this because a password reset was requested for this address.",
  });
}

export function invitationMail(input: { inviter: string; org: string; role: string; team?: string | null; email: string; url: string; expiresAt: Date }) {
  const role: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };
  return renderEmail({
    preheader: `${input.inviter} invited you to join ${input.org} on Boredroom.`,
    eyebrow: "Invitation",
    title: `Join ${input.org} on Boredroom`,
    intro: [`${input.inviter} invited you to ${input.org}. Accept and you will land in the workspace with the people you work with.`],
    cta: { label: "Accept the invitation", url: input.url },
    details: [
      { label: "Invited by", value: input.inviter },
      { label: "Your role", value: role[input.role] ?? input.role },
      ...(input.team ? [{ label: "Team", value: input.team }] : []),
      { label: "Sign in as", value: input.email },
      { label: "Link expires", value: input.expiresAt.toUTCString() },
    ],
    note: "The link works once. If you were not expecting this, ignore it.",
    reason: `You received this because ${input.inviter} entered this address at ${input.org}.`,
  });
}

/** A demo request, to Boredroom (owner request, 17 November 2026: book a demo). Replying answers the person. */
export function demoRequestMail(input: { name: string; email: string; company: string; companySize: string | null; role: string; times: string; notes: string; timezone: string; page: string }) {
  return renderEmail({
    preheader: `${input.name} at ${input.company} asked for a demo.`,
    eyebrow: "Demo request",
    title: `${input.name} asked for a demo`,
    intro: [input.notes ? `They would like to see: ${input.notes}` : "They left no note about what they would like to see.", "Reply to this email to agree a time with them."],
    details: [
      { label: "Name", value: input.name },
      { label: "Email", value: input.email },
      { label: "Company", value: input.company },
      ...(input.companySize ? [{ label: "Team size", value: input.companySize }] : []),
      ...(input.role ? [{ label: "Role", value: input.role }] : []),
      ...(input.times ? [{ label: "Times that suit", value: input.times }] : []),
      ...(input.timezone ? [{ label: "Time zone", value: input.timezone }] : []),
      { label: "Sent from", value: input.page },
    ],
    reason: "You received this because someone sent the Book a demo form on boredroom.cc.",
  });
}

/** The receipt for a demo request, to the person who asked. */
export function demoReceivedMail(input: { firstName: string }) {
  return renderEmail({
    preheader: "We will email you to agree a time.",
    eyebrow: "Demo",
    title: "We have your demo request",
    intro: [`Thanks, ${input.firstName}. We will email you at this address to agree a time for your Boredroom demo.`, "If anything changes before then, reply to this email."],
    note: "If you did not ask for a demo, ignore this message and nothing happens.",
    reason: "You received this because a demo was requested with this address on boredroom.cc.",
  });
}

export function testMail(provider: string) {
  return renderEmail({
    preheader: "Real email delivery is working.",
    eyebrow: "Test",
    title: "Mail is set up",
    intro: [`This is a test message from Boredroom. If you can read it, real email delivery is working through the ${provider} provider.`],
    details: [{ label: "Sent", value: new Date().toUTCString() }],
    reason: "You received this because someone ran the mail test from the Boredroom server.",
  });
}
