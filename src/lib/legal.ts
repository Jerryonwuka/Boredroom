/**
 * The legal pages' facts (owner request, 11 November 2026: Privacy and Terms before launch; owner decisions the same
 * day: a registered company operates Boredroom, 18 and over only, one required tick box at sign-up, marketing email only
 * for people who opt in). One place, read by /privacy, /terms, the sign-up form, the acceptance record and the emails'
 * footer, so they never disagree.
 *
 * `LEGAL_VERSION` is the date of the Terms and Privacy Policy a person agrees to. Change it only when their meaning
 * changes: it is written into each person's acceptance record (audit_events, action `legal.accepted`).
 *
 * `LEGAL_ENTITY`: the owner gives the registered name and address. Until both are filled in, the pages show a marked
 * blank ("to be confirmed") and `legalEntityReady()` is false; do not announce the pages before it is true.
 */
export const LEGAL_VERSION = "2026-11-11";

export const LEGAL_ENTITY: { name: string; address: string; country: string } = {
  name: "Boredroom", // owner, 17 November 2026
  address: "",
  country: "Nigeria",
};

export const legalEntityReady = () => LEGAL_ENTITY.name.trim().length > 0 && LEGAL_ENTITY.address.trim().length > 0;
/** The operator's name as the pages write it. */
export const legalName = () => LEGAL_ENTITY.name.trim() || "[registered company name to be confirmed]";
export const legalAddress = () => LEGAL_ENTITY.address.trim() || "[registered address to be confirmed]";

/** Where privacy requests and legal notices go. Mail to any @boredroom.cc address reaches the Control Center's inbox. */
export const PRIVACY_EMAIL = "privacy@boredroom.cc";
export const SUPPORT_EMAIL = "info@boredroom.cc";

/** The youngest a person may be to hold an account (owner decision, 11 November 2026). */
export const MINIMUM_AGE = 18;

/** The words beside the sign-up boxes: the form, the Google path's refusal and the tests read the same ones. */
export const LEGAL_WORDS = {
  agreeError: "Tick the box to confirm your age and agree to the Terms and Privacy Policy.",
  marketing: "Email me product news and tips",
  marketingHint: "Optional. You can unsubscribe from any of these emails.",
  googleNeedsAgreement: "To create an account with Google, start from Create account and tick the box to agree to the Terms and Privacy Policy.",
} as const;
