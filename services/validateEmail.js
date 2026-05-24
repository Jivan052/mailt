/**
 * services/validateEmail.js
 *
 * Step 1 of the pipeline: validate email format.
 *
 * Checks:
 *  - Basic format via validator.isEmail()
 *  - Reasonable length limits (local part ≤ 64, domain ≤ 255, total ≤ 320)
 *  - No consecutive dots in local part
 *  - Valid TLD (at least 2 characters)
 *  - Role-based address detection (flags as "Risky")
 *  - Disposable domain detection (flags as "Risky")
 */

const validator = require("validator");

// ── Role-based prefixes ────────────────────────────────────────────────────────
// These addresses are often shared inboxes; lower deliverability confidence
const ROLE_PREFIXES = new Set([
  "admin", "administrator", "info", "contact", "support", "help",
  "sales", "marketing", "billing", "accounts", "finance", "hr",
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "postmaster", "webmaster", "hostmaster", "abuse", "security",
  "privacy", "legal", "press", "media", "jobs", "careers",
  "newsletter", "notifications", "alerts", "team", "office",
  "hello", "hi", "mail", "email", "enquiries", "enquiry",
]);

// ── Disposable / throwaway email domains ──────────────────────────────────────
// A representative (not exhaustive) list. Extend as needed.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info",
  "guerrillamail.biz", "guerrillamail.de", "guerrillamail.net",
  "guerrillamail.org", "spam4.me", "trashmail.com", "trashmail.me",
  "trashmail.net", "trashmail.org", "trashmail.at", "trashmail.io",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "tempmail.com", "temp-mail.org", "throwam.com", "throwam.me",
  "yopmail.com", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf",
  "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
  "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf", "dispostable.com", "spamgourmet.com",
  "mailnull.com", "spamfree24.org", "spamfree24.de",
  "fakeinbox.com", "maildrop.cc", "sharklasers.com",
  "guerillamail.info", "grr.la", "guerillamail.biz",
  "guerillamail.de", "guerillamail.net", "guerillamail.org",
  "spam.la", "discard.email", "spamevader.com",
  "getairmail.com", "filzmail.com", "throwam.com",
  "getnada.com", "mailnesia.com", "mailnull.com",
  "owlpic.com", "tempinbox.com", "spamboy.com",
]);

/**
 * validateEmailFormat(email)
 *
 * Returns an object:
 *  {
 *    valid:       boolean   — passes all format checks
 *    isRole:      boolean   — role-based local part
 *    isDisposable: boolean  — known disposable domain
 *    reason:      string | null — human-readable failure reason
 *  }
 */
function validateEmailFormat(email) {
  if (!email || typeof email !== "string") {
    return { valid: false, isRole: false, isDisposable: false, reason: "Empty or non-string input" };
  }

  const trimmed = email.trim().toLowerCase();

  // ── Total length ────────────────────────────────────────────────────────────
  if (trimmed.length > 320) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Email exceeds 320 character limit" };
  }

  // ── Must contain exactly one @ ──────────────────────────────────────────────
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Must contain exactly one @ symbol" };
  }

  const [localPart, domain] = trimmed.split("@");

  // ── Local part length ───────────────────────────────────────────────────────
  if (localPart.length === 0 || localPart.length > 64) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Local part must be 1–64 characters" };
  }

  // ── Domain length ───────────────────────────────────────────────────────────
  if (!domain || domain.length > 255) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Domain must be ≤ 255 characters" };
  }

  // ── No consecutive dots ─────────────────────────────────────────────────────
  if (trimmed.includes("..")) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Contains consecutive dots" };
  }

  // ── Leading/trailing dots in local part ────────────────────────────────────
  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Local part cannot start or end with a dot" };
  }

  // ── TLD must be at least 2 characters ──────────────────────────────────────
  const domainParts = domain.split(".");
  const tld = domainParts[domainParts.length - 1];
  if (!tld || tld.length < 2) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Invalid or missing TLD" };
  }

  // ── validator.js final check ────────────────────────────────────────────────
  if (!validator.isEmail(trimmed, { allow_utf8_local_part: false })) {
    return { valid: false, isRole: false, isDisposable: false, reason: "Failed validator.isEmail() check" };
  }

  // ── Enrichment: role-based ──────────────────────────────────────────────────
  const isRole = ROLE_PREFIXES.has(localPart);

  // ── Enrichment: disposable domain ──────────────────────────────────────────
  const isDisposable = DISPOSABLE_DOMAINS.has(domain);

  return { valid: true, isRole, isDisposable, reason: null };
}

module.exports = { validateEmailFormat };
