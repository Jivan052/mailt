/**
 * services/processEmails.js
 *
 * Orchestrates the full validation pipeline for a batch of emails.
 *
 * Pipeline per email:
 *   1. Format validation      (validateEmail.js)
 *   2. MX record lookup       (dnsCheck.js)    — cached per domain
 *   3. SMTP verification      (smtpCheck.js)   — skipped if MX fails
 *
 * Status values (mutually exclusive, in priority order):
 *   "Invalid Format"  — failed regex/structural checks
 *   "Disposable"      — known throwaway email service
 *   "No MX Record"    — domain has no mail servers
 *   "SMTP Blocked"    — MX exists but port 25 and 587 are both unreachable
 *   "SMTP Failed"     — MX exists, SMTP reachable, but mailbox rejected
 *   "Risky"           — valid format+MX+SMTP but catch-all OR role-based address
 *   "Deliverable"     — passed all checks cleanly
 *
 * Concurrency:
 *   p-limit(5) — max 5 SMTP checks in parallel to avoid triggering rate-limits
 *   on receiving mail servers.
 */

const pLimit = require("p-limit");
const { validateEmailFormat } = require("./validateEmail");
const { checkMxRecords } = require("./dnsCheck");
const { checkSmtp } = require("./smtpCheck");

const CONCURRENCY = 5;

/**
 * processEmails(emails, onResult)
 *
 * @param {string[]} emails      - Array of email strings (already deduped/trimmed)
 * @param {Function} onResult    - Callback called with each result object as it completes
 *
 * Returns a Promise that resolves when all emails have been processed.
 *
 * Each result object:
 *  {
 *    email:       string
 *    formatValid: boolean
 *    isRole:      boolean
 *    isDisposable: boolean
 *    mxValid:     boolean
 *    mxRecords:   Array<{exchange, priority}>
 *    isCatchAll:  boolean
 *    smtpValid:   boolean | null   (null = not checked)
 *    smtpBlocked: boolean
 *    status:      string
 *    detail:      string           (human-readable explanation)
 *  }
 */
async function processEmails(emails, onResult) {
  const limit = pLimit(CONCURRENCY);

  const tasks = emails.map((email) =>
    limit(async () => {
      const result = await verifyOne(email);
      onResult(result);
      return result;
    })
  );

  await Promise.allSettled(tasks);
}

/**
 * verifyOne(email)
 * Full pipeline for a single email address.
 */
async function verifyOne(email) {
  const base = {
    email,
    formatValid: false,
    isRole: false,
    isDisposable: false,
    mxValid: false,
    mxRecords: [],
    isCatchAll: false,
    smtpValid: null,
    smtpBlocked: false,
    status: "Unknown",
    detail: "",
  };

  // ── STEP 1: Format validation ─────────────────────────────────────────────

  let formatResult;
  try {
    formatResult = validateEmailFormat(email);
  } catch (err) {
    return { ...base, status: "Invalid Format", detail: `Format check crashed: ${err.message}` };
  }

  base.formatValid = formatResult.valid;
  base.isRole = formatResult.isRole;
  base.isDisposable = formatResult.isDisposable;

  if (!formatResult.valid) {
    return {
      ...base,
      status: "Invalid Format",
      detail: formatResult.reason || "Email format is invalid",
    };
  }

  // Known disposable domain — short-circuit before DNS (saves resources)
  if (formatResult.isDisposable) {
    return {
      ...base,
      status: "Disposable",
      detail: "This domain belongs to a known throwaway/disposable email service",
    };
  }

  // ── STEP 2: MX record lookup ──────────────────────────────────────────────

  const domain = email.split("@")[1];
  let mxResult;

  try {
    mxResult = await checkMxRecords(domain);
  } catch (err) {
    return {
      ...base,
      formatValid: true,
      status: "No MX Record",
      detail: `MX check crashed: ${err.message}`,
    };
  }

  base.mxValid = mxResult.hasMx;
  base.mxRecords = mxResult.mxRecords || [];
  base.isCatchAll = mxResult.isCatchAll;

  if (!mxResult.hasMx) {
    return {
      ...base,
      status: "No MX Record",
      detail: mxResult.error || "No MX records found for this domain",
    };
  }

  // ── STEP 3: SMTP verification ─────────────────────────────────────────────

  let smtpResult;
  try {
    smtpResult = await checkSmtp({ email, mxRecords: mxResult.mxRecords });
  } catch (err) {
    // SMTP check threw unexpectedly — treat as blocked rather than crashing
    return {
      ...base,
      status: "SMTP Blocked",
      detail: `SMTP check error: ${err.message}`,
    };
  }

  base.smtpValid = smtpResult.smtpValid;
  base.smtpBlocked = smtpResult.blocked;
  base.isCatchAll = smtpResult.isCatchAll || mxResult.isCatchAll;

  // ── STEP 4: Assign final status ───────────────────────────────────────────

  if (smtpResult.blocked) {
    // Could not reach SMTP on any port — MX exists but firewall/ISP blocked
    // This is common on cloud hosts. Format + MX are still valid signals.
    return {
      ...base,
      status: "SMTP Blocked",
      detail: "Port 25 and 587 are both unreachable. The address format and MX records are valid.",
    };
  }

  if (!smtpResult.smtpValid) {
    return {
      ...base,
      status: "SMTP Failed",
      detail: smtpResult.smtpError || "SMTP server rejected the recipient address",
    };
  }

  // SMTP accepted the address — check for Risky signals
  if (smtpResult.isCatchAll) {
    return {
      ...base,
      status: "Risky",
      detail: "Domain accepts all addresses (catch-all). Cannot confirm specific mailbox exists.",
    };
  }

  if (formatResult.isRole) {
    return {
      ...base,
      status: "Risky",
      detail: "Role-based address (admin, info, support, etc.). These are often shared inboxes.",
    };
  }

  // All checks passed
  return {
    ...base,
    status: "Deliverable",
    detail: "Passed format, MX, and SMTP verification.",
  };
}

module.exports = { processEmails };
