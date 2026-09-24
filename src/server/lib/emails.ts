/**
 * Every email Boredroom sends, on the design system: the black canvas, one card, one orange button, quiet grey
 * meta text. Built as tables with inline styles because that is what mail clients honour; web fonts are asked for
 * and fall back to the system sans. Each builder returns the HTML and a plain-text twin, so a client that shows
 * neither images nor HTML still gets the link.
 */

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
};

// The tokens, as mail clients can use them (no CSS variables in email).
const C = {
  canvas: "#000000", card: "#121212", cardBorder: "#2a2a2a", inset: "#0a0a0a", insetBorder: "#242424",
  fg: "#ffffff", muted: "#a1a1a1", subtle: "#6b6b6b", accent: "#ff6c02", accentFg: "#140700", accentBorder: "#ff8226",
};
// Single quotes inside: these land in double-quoted style attributes.
const FONT = `Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const DISPLAY = `'Cal Sans', Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const e = escapeHtml;
  const paragraphs = c.intro.map((p) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.muted};">${e(p)}</p>`).join("");
  const button = c.cta ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
      <tr><td style="border-radius:14px;background:${C.accent};border:1px solid ${C.accentBorder};">
        <a href="${e(c.cta.url)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;line-height:18px;color:${C.accentFg};text-decoration:none;border-radius:14px;">${e(c.cta.label)}</a>
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
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
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
          ${c.reason ? `${e(c.reason)}<br>` : ""}Boredroom keeps track of what a remote team plans, does and delivers. Nothing in it is a productivity score.
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
    "\nBoredroom keeps track of what a remote team plans, does and delivers. Nothing in it is a productivity score.",
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
