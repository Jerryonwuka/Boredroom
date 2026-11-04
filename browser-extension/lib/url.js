// Which URLs Brenda may open, and which pages her tabs may land on (PROTOCOL.md, Refusals).

const MAX_URL_LENGTH = 8192;

/**
 * The URL as Chrome would load it, or null when it's refused: only http(s), and never with a user or password in it
 * (credentials in a URL leak into history and logs, and are a common phishing disguise).
 */
export function checkUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;
  return url.href;
}

/**
 * Whether a main-frame navigation in Brenda's tab may go ahead. about:blank is her own neutral page, and javascript:
 * links run script in the page without leaving it, so neither is a landing.
 */
export function isLandingAllowed(raw) {
  if (typeof raw !== "string") return false;
  const lower = raw.trim().toLowerCase();
  if (lower === "about:blank" || lower.startsWith("javascript:")) return true;
  return checkUrl(raw) !== null;
}

/** The host part of a URL, or "" when it can't be parsed. */
export function hostOf(raw) {
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}
