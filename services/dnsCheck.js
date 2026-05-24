/**
 * services/dnsCheck.js
 *
 * Step 2 of the pipeline: DNS/MX record verification.
 *
 * Features:
 *  - Resolves MX records using dns/promises
 *  - In-memory cache per process (Map) — avoids repeated lookups for same domain
 *  - 5-second timeout on DNS resolution
 *  - Catch-all domain detection attempt (best-effort SMTP probe)
 *  - Handles NXDOMAIN, ENOTFOUND, ENODATA, ETIMEOUT gracefully
 */

const dns = require("dns/promises");

// ── In-memory domain cache ────────────────────────────────────────────────────
// Keyed by domain string → { hasMx, mxRecords, isCatchAll, checkedAt }
// TTL: 10 minutes (avoids stale results in long-running processes)
const MX_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── DNS timeout wrapper ───────────────────────────────────────────────────────

/**
 * resolveWithTimeout(domain, timeoutMs)
 * Wraps dns.resolveMx in a race against a timeout promise.
 */
function resolveWithTimeout(domain, timeoutMs = 5000) {
  return Promise.race([
    dns.resolveMx(domain),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs)
    ),
  ]);
}

/**
 * checkMxRecords(domain)
 *
 * Returns:
 *  {
 *    hasMx:      boolean         — at least one MX record exists
 *    mxRecords:  Array<{exchange, priority}> — sorted by priority
 *    isCatchAll: boolean         — domain appears to accept any address
 *    error:      string | null   — reason if lookup failed
 *  }
 */
async function checkMxRecords(domain) {
  if (!domain || typeof domain !== "string") {
    return { hasMx: false, mxRecords: [], isCatchAll: false, error: "Invalid domain" };
  }

  const lowerDomain = domain.toLowerCase().trim();

  // ── Cache hit ───────────────────────────────────────────────────────────────
  const cached = MX_CACHE.get(lowerDomain);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  let result;

  try {
    const records = await resolveWithTimeout(lowerDomain, 5000);

    if (!records || records.length === 0) {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: "No MX records found" };
    } else {
      // Sort by priority (lowest number = highest priority)
      const sorted = [...records].sort((a, b) => a.priority - b.priority);
      result = {
        hasMx: true,
        mxRecords: sorted.map((r) => ({ exchange: r.exchange, priority: r.priority })),
        isCatchAll: false, // will be updated by smtpCheck if needed
        error: null,
      };
    }

  } catch (err) {
    const msg = err.message || "";

    if (msg === "DNS_TIMEOUT") {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: "DNS lookup timed out" };
    } else if (
      msg.includes("ENOTFOUND") ||
      msg.includes("ENODATA") ||
      msg.includes("NXDOMAIN")
    ) {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: "Domain does not exist" };
    } else if (msg.includes("ESERVFAIL")) {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: "DNS server failure" };
    } else if (msg.includes("EREFUSED")) {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: "DNS query refused" };
    } else {
      result = { hasMx: false, mxRecords: [], isCatchAll: false, error: `DNS error: ${msg}` };
    }
  }

  // ── Store in cache ──────────────────────────────────────────────────────────
  MX_CACHE.set(lowerDomain, { result, checkedAt: Date.now() });

  return result;
}

/**
 * markDomainCatchAll(domain)
 * Called by smtpCheck when it detects a catch-all.
 * Updates the cache entry so other emails on the same domain benefit.
 */
function markDomainCatchAll(domain) {
  const lowerDomain = domain.toLowerCase().trim();
  const cached = MX_CACHE.get(lowerDomain);
  if (cached) {
    cached.result.isCatchAll = true;
  }
}

/**
 * clearCache()
 * Utility for testing or manual cache invalidation.
 */
function clearCache() {
  MX_CACHE.clear();
}

module.exports = { checkMxRecords, markDomainCatchAll, clearCache };
