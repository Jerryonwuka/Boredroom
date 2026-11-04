// Which form fields Brenda never types into and whose values she never reads (PROTOCOL.md, read_page "sensitive").

const SENSITIVE_AUTOCOMPLETE = ["one-time-code", "current-password", "new-password"];
const TEXT_TYPES = new Set(["text", "email", "search", "tel", "url", "number", "password", ""]);

/** Splits an identifier like "cardNumber", "card_number" or "cc-cvc2" into lower-case words. */
export function identifierWords(value) {
  if (typeof value !== "string" || value === "") return [];
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

// "card" can sit inside a longer word (creditcard, cardholder); the short codes must start or end the word so
// "classname" isn't an SSN field and "shipping" isn't a PIN.
function wordSaysCard(word) {
  return word.includes("card") || /^(cvv|cvc|iban)|(cvv|cvc|iban)$/.test(word);
}

function wordSaysSecret(word) {
  return wordSaysCard(word) || /^ssn|ssn$/.test(word) || /^pin(code|number|num|no|\d+)?$/.test(word);
}

function identifiers(field) {
  return [...identifierWords(field.name), ...identifierWords(field.id)];
}

/** A password field: type=password, or autocomplete asks for a current or new password. */
export function isPasswordField(field) {
  if (!field) return false;
  const autocomplete = lower(field.autocomplete);
  return lower(field.inputType) === "password" || autocomplete.includes("current-password") || autocomplete.includes("new-password");
}

/** A payment card or bank field: autocomplete cc-*, or a name or id that says card, cvv, cvc or iban. */
export function isCardField(field) {
  if (!field) return false;
  if (lower(field.autocomplete).includes("cc-")) return true;
  return identifiers(field).some(wordSaysCard);
}

/** Whether a field is sensitive: { inputType, autocomplete, name, id }. */
export function isSensitiveField(field) {
  if (!field) return false;
  if (isPasswordField(field) || isCardField(field)) return true;
  const autocomplete = lower(field.autocomplete);
  if (SENSITIVE_AUTOCOMPLETE.some((token) => autocomplete.includes(token))) return true;
  return identifiers(field).some(wordSaysSecret);
}

/** An <input> type that takes typed text (Return in one submits its form). */
export function isTextInputType(inputType) {
  return TEXT_TYPES.has(lower(inputType));
}

/**
 * A search box (coordinator refinement, 4 Nov 2026): type=search, role searchbox, a combobox inside role=search, or a
 * field whose name, id, placeholder or aria-label is the whole word "search" or "q".
 */
export function isSearchField(field) {
  if (!field) return false;
  if (lower(field.inputType) === "search" || lower(field.role) === "searchbox") return true;
  if (lower(field.role) === "combobox" && field.inSearchLandmark) return true;
  const words = [field.name, field.id, field.placeholder, field.ariaLabel].flatMap(identifierWords);
  return words.some((word) => word === "search" || word === "q");
}

/** A search form: role=search, or its only text input is a search box. fields: the form's controls. */
export function isSearchForm(form) {
  if (!form) return false;
  if (lower(form.role) === "search") return true;
  const textFields = (form.fields || []).filter((f) => f.tag === "input" ? isTextInputType(f.inputType) : f.tag === "textarea");
  return textFields.length === 1 && isSearchField(textFields[0]);
}
