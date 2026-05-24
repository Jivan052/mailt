# Email Deliverability Checker

A production-safe, beginner-friendly tool to validate and verify email addresses in bulk.
Checks format, DNS/MX records, and SMTP deliverability — streaming results live to the browser.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Project Structure](#project-structure)
3. [How the Pipeline Works](#how-the-pipeline-works)
4. [Status Values Explained](#status-values-explained)
5. [Setup & Installation](#setup--installation)
6. [Running the App](#running-the-app)
7. [Using the Interface](#using-the-interface)
8. [API Reference](#api-reference)
9. [Configuration & Tuning](#configuration--tuning)
10. [Edge Cases Handled](#edge-cases-handled)
11. [Known Limitations](#known-limitations)
12. [Troubleshooting](#troubleshooting)
13. [File-by-File Reference](#file-by-file-reference)

---

## What It Does

| Feature | Detail |
|---|---|
| Format validation | Structural checks + `validator.isEmail()` |
| Disposable email detection | 50+ known throwaway domains blocked immediately |
| Role-based address flagging | `admin@`, `info@`, `noreply@`, etc. flagged as Risky |
| DNS / MX lookup | Checks domain exists and has mail servers |
| MX caching | Same domain checked once per batch (speeds up large lists) |
| SMTP probe | Raw TCP — EHLO → MAIL FROM → RCPT TO |
| Port fallback | Tries port 25 first, falls back to port 587 |
| Catch-all detection | Probes with a fake address to see if domain accepts everything |
| Streaming results | Browser table fills in real-time as each email completes |
| Progress bar | Live counter + per-status mini-stats |
| Summary stats | Total / Deliverable / Risky / Failed counts |
| CSV upload | Drag-and-drop or browse, BOM-stripped, multi-column support |
| CSV export | Download results with all fields, Excel-compatible |
| Retry failed | One-click retry for SMTP Failed / Blocked emails |
| Rate limiting | Max 20 verify requests per IP per 15 minutes |
| Max batch size | 500 emails per request |

---

## Project Structure

```
email-checker/
│
├── server.js                   ← Express entry point
├── package.json
├── sample.csv                  ← Example CSV for testing
├── .gitignore
│
├── routes/
│   └── verifyRoute.js          ← POST /verify endpoint
│
├── services/
│   ├── validateEmail.js        ← Step 1: format + role + disposable check
│   ├── dnsCheck.js             ← Step 2: MX record lookup with cache
│   ├── smtpCheck.js            ← Step 3: raw TCP SMTP probe
│   └── processEmails.js        ← Orchestrator: runs pipeline for each email
│
├── utils/
│   └── csvParser.js            ← CSV file parser with BOM + multi-column support
│
├── public/
│   ├── index.html              ← Frontend UI
│   ├── style.css               ← Styles
│   └── script.js               ← All frontend JavaScript
│
└── uploads/                    ← Temp storage for CSV uploads (auto-cleaned)
```

---

## How the Pipeline Works

Each email goes through these steps in order. A failure at any step short-circuits the rest.

```
Email input
    │
    ▼
[Step 1] Format Validation (validateEmail.js)
    ├── validator.isEmail()
    ├── Length limits (local ≤ 64, domain ≤ 255, total ≤ 320)
    ├── No consecutive dots
    ├── Valid TLD (≥ 2 chars)
    ├── Role prefix detection (admin, info, noreply, …)
    └── Disposable domain detection
    │
    ├─ FAIL → status: "Invalid Format"  (stop)
    ├─ DISPOSABLE → status: "Disposable"  (stop)
    │
    ▼
[Step 2] DNS / MX Check (dnsCheck.js)
    ├── dns.resolveMx(domain) with 5s timeout
    ├── Results cached in Map() for 10 minutes
    └── Sorts records by priority
    │
    ├─ FAIL → status: "No MX Record"  (stop)
    │
    ▼
[Step 3] SMTP Probe (smtpCheck.js)
    ├── Raw TCP socket connection
    ├── Try MX host on port 25
    │     If blocked → try port 587
    │     If still blocked → try backup MX host
    ├── SMTP conversation: EHLO → MAIL FROM → RCPT TO (real)
    ├── If accepted → probe fake address for catch-all detection
    └── If fake also accepted → mark domain as catch-all
    │
    ├─ ALL BLOCKED → status: "SMTP Blocked"
    ├─ RCPT TO rejected → status: "SMTP Failed"
    ├─ RCPT TO accepted + catch-all → status: "Risky"
    │
    ▼
[Step 4] Final Status Assignment (processEmails.js)
    ├── Catch-all domain → "Risky"
    ├── Role-based address → "Risky"
    └── All clear → "Deliverable"
```

**Concurrency:** Steps 2 and 3 run with `p-limit(5)` — max 5 emails verified at the same time. This prevents hammering DNS/SMTP servers and avoids triggering rate-limits on receiving mail servers.

---

## Status Values Explained

| Status | Meaning | Action |
|---|---|---|
| **Deliverable** | Passed all checks. Format valid, MX exists, SMTP accepted. | Safe to send |
| **Risky** | Valid but low confidence. Catch-all domain OR role-based address. | Send cautiously |
| **SMTP Blocked** | Format + MX are valid, but port 25 and 587 were both unreachable (firewall / ISP restriction). | Cannot confirm — treat as unknown |
| **SMTP Failed** | SMTP reachable but server rejected the specific address (5xx). | Do not send — address likely doesn't exist |
| **No MX Record** | Domain has no mail servers at all. | Do not send |
| **Disposable** | Domain is a known throwaway email service. | Do not send |
| **Invalid Format** | Email doesn't pass structural validation. | Do not send |

### Important note on "SMTP Blocked"

Most cloud providers (AWS, GCP, Azure, DigitalOcean, Render, Railway, Heroku) and residential ISPs **block outbound port 25** to prevent spam. When you see "SMTP Blocked" in large numbers, it means your server environment doesn't allow outbound SMTP — not that the emails are bad.

For reliable SMTP verification, run the app on a:
- Bare-metal server or VPS with port 25 unblocked (Hetzner, OVH, Vultr with SMTP enabled)
- Local development machine (most home ISPs block port 25 too — try a coffee shop or office network)

---

## Setup & Installation

### Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | ≥ 16.0.0 | `node --version` |
| npm | ≥ 7.0.0 | `npm --version` |
| Internet access | — | For DNS + SMTP probes |

### Step 1 — Clone or download the project

If you have Git:
```bash
git clone <your-repo-url>
cd email-checker
```

Or download and unzip, then:
```bash
cd email-checker
```

### Step 2 — Install dependencies

```bash
npm install
```

This installs:
- `express` — web server
- `express-rate-limit` — API rate limiting
- `validator` — email format validation
- `smtp-connection` — SMTP library (wraps nodemailer internals)
- `csv-parser` — CSV file parsing
- `multer` — multipart/form-data file upload handling
- `p-limit` — concurrency limiter

### Step 3 — Verify the uploads folder exists

The app creates it automatically on startup, but you can pre-create it:
```bash
mkdir -p uploads
```

That's it. No database, no environment variables, no config files required.

---

## Running the App

### Development (with auto-restart on file changes)

```bash
npm run dev
```

Requires `nodemon`. If you don't have it: `npm install -g nodemon`

### Production

```bash
npm start
```

Or directly:
```bash
node server.js
```

### Expected output

```
✅  Email Checker running → http://localhost:3000
```

Open your browser to **http://localhost:3000**

### Changing the port

```bash
PORT=8080 node server.js
```

---

## Using the Interface

### Paste emails tab

1. Type or paste email addresses into the textarea — one per line (commas and semicolons also work)
2. The counter at the bottom shows how many emails were detected
3. Click **Verify Emails**
4. Watch results appear in real-time as each email completes

### CSV upload tab

1. Drag and drop a `.csv` file onto the upload zone, or click **browse to upload**
2. Your CSV can have a column named `email`, `Email`, `EMAIL`, `address`, `e-mail`, or similar
3. If no recognised header is found, the app scans all columns for anything that looks like an email
4. Maximum file size: 2 MB
5. Click **Verify Emails**

### Sample CSV format

See `sample.csv` in the project root. Minimum valid format:

```csv
email
user@gmail.com
test@yahoo.com
contact@company.org
```

### Reading the results table

| Column | What it shows |
|---|---|
| Email | The address checked |
| Format | ✓ if format is valid, ✗ if not |
| MX | ✓ if MX records found, ✗ if not |
| SMTP | ✓ if SMTP accepted, ✗ if rejected, — if not checked |
| Status | Colour-coded badge (see Status Values above) |
| Detail | Human-readable explanation of the result |

### Filtering results

Use the **All statuses** dropdown to filter the table to a specific status. The counter at the bottom updates to show how many rows match.

### Exporting results

Click **Export CSV** to download a `.csv` file with all results, including all boolean fields. The file includes a UTF-8 BOM so it opens correctly in Excel.

### Retrying failed emails

After verification, if any emails returned "SMTP Failed" or "SMTP Blocked", a **Retry Failed** button appears. Click it to re-run verification on just those addresses.

---

## API Reference

### `POST /verify`

Accepts either JSON or multipart form data.

**JSON body:**

```http
POST /verify
Content-Type: application/json

{
  "emails": ["user@example.com", "test@domain.org"]
}
```

**CSV file upload:**

```http
POST /verify
Content-Type: multipart/form-data

csvfile: <file.csv>
```

**Response:** Streaming NDJSON (`application/x-ndjson`)

Each line is a JSON object. Two types:

```json
{"type":"total","count":5}
```

Sent first. Tells the client how many emails to expect.

```json
{
  "type": "result",
  "data": {
    "email": "user@example.com",
    "formatValid": true,
    "isRole": false,
    "isDisposable": false,
    "mxValid": true,
    "mxRecords": [{"exchange": "aspmx.l.google.com", "priority": 1}],
    "isCatchAll": false,
    "smtpValid": true,
    "smtpBlocked": false,
    "status": "Deliverable",
    "detail": "Passed format, MX, and SMTP verification."
  }
}
```

**Error responses** (before streaming starts):

```json
{"error": "No emails provided. Send a CSV file or a JSON body with an emails array."}
```

| HTTP Code | Reason |
|---|---|
| 400 | Bad input (no emails, too many, bad CSV, invalid JSON) |
| 429 | Rate limited (> 20 requests/IP/15min) |
| 500 | Internal server error |

**Response headers:**

```
Content-Type: application/x-ndjson
Transfer-Encoding: chunked
X-Total-Count: <number>
```

---

## Configuration & Tuning

All configuration constants are at the top of each service file. No `.env` needed — just edit the values.

### `services/smtpCheck.js`

```js
const CONNECT_TIMEOUT  = 8000;  // ms — TCP connection timeout
const RESPONSE_TIMEOUT = 8000;  // ms — wait for each SMTP response
const SMTP_PORTS       = [25, 587];  // ports to try, in order
const HELO_DOMAIN      = "verify.local";  // EHLO identifier
const FROM_ADDRESS     = "verify@verify.local";  // MAIL FROM
```

Increase timeouts if you see many unexpected "blocked" results on a slow network.

### `services/dnsCheck.js`

```js
const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes
```

Increase for long-running processes or when verifying many addresses from the same domains.

### `services/processEmails.js`

```js
const CONCURRENCY = 5;  // max parallel SMTP checks
```

Lower this (e.g. to 2–3) if receiving servers are rate-limiting you. Raise it (up to 10) if you have fast network and want speed.

### `routes/verifyRoute.js`

```js
const MAX_EMAILS = 500;  // max emails per request
```

### `server.js`

```js
windowMs: 15 * 60 * 1000,  // rate limit window
max: 20,                    // max requests per window
```

### `utils/csvParser.js`

```js
if (rowCount > 10000) return;  // max rows to read from CSV
```

---

## Edge Cases Handled

### Format validation

| Edge case | How handled |
|---|---|
| No `@` symbol | "Must contain exactly one @ symbol" |
| Multiple `@` symbols | Same check |
| Empty local part (`@domain.com`) | "Local part must be 1–64 characters" |
| Local part > 64 chars | Same |
| Domain > 255 chars | "Domain must be ≤ 255 characters" |
| Total > 320 chars | "Email exceeds 320 character limit" |
| Consecutive dots (`user..name@`) | "Contains consecutive dots" |
| Leading/trailing dots in local part | Caught |
| TLD < 2 chars | "Invalid or missing TLD" |
| Role-based addresses | Flagged `isRole: true`, eventual status "Risky" |
| Disposable domains | Short-circuited as "Disposable" before DNS |
| `mailto:` prefix in CSV | Stripped automatically |

### DNS/MX

| Edge case | How handled |
|---|---|
| Domain doesn't exist (NXDOMAIN) | "Domain does not exist" |
| DNS server failure (SERVFAIL) | "DNS server failure" |
| DNS query refused | "DNS query refused" |
| DNS timeout (> 5s) | "DNS lookup timed out" |
| Domain exists but no MX record | "No MX records found" |
| Same domain checked 100 times | Cache returns result after first lookup |

### SMTP

| Edge case | How handled |
|---|---|
| Port 25 blocked (most cloud/home) | Falls back to port 587 |
| Both ports blocked | "SMTP Blocked" (format + MX still shown as valid) |
| Server closes connection early | "Incomplete SMTP dialog (N responses)" |
| Bad greeting (not 220) | "Bad greeting: <response>" |
| Temporary rejection (4xx) | "SMTP Failed" with detail |
| Permanent rejection (5xx) | "SMTP Failed" with detail |
| Catch-all domain | Fake address probe → "Risky" |
| Server greylisting | Returns temporary rejection |
| SMTP timeout during dialog | "Response timeout" |
| TCP connection timeout | "Connection timeout" |
| Network unreachable | Treated as blocked |
| Unexpected exception | Caught, returned as "SMTP Blocked" |

### CSV parsing

| Edge case | How handled |
|---|---|
| UTF-8 BOM (Excel export) | Stripped before parsing |
| No header row | All columns scanned for email-like values |
| Wrong column name | App scans all columns |
| Extra columns | Ignored (only email-like cells extracted) |
| Quoted fields with commas | `csv-parser` handles natively |
| Windows line endings (`\r\n`) | Handled by csv-parser |
| Empty rows | Skipped |
| Non-CSV file uploaded | Rejected with clear error message |
| File > 2 MB | Rejected before parsing |
| Empty CSV | "CSV file is empty or contains no data rows" |
| CSV with no emails | "No email addresses found in the CSV" |
| More than 10,000 rows | Rows after 10,000 silently ignored |
| Duplicate emails | Deduplicated (Set) |

### General

| Edge case | How handled |
|---|---|
| Empty input | "No valid email addresses found in input" |
| > 500 emails | Rejected with count in error message |
| Duplicate emails in body | Deduplicated before processing |
| Concurrent requests | Each request has its own processing pipeline |
| Server error mid-stream | Stream ended cleanly |
| Rate limit exceeded | 429 with retry-after headers |

---

## Known Limitations

### Port 25 is blocked in most cloud environments

AWS, GCP, Azure, DigitalOcean, Render, Railway, Heroku, and most residential ISPs block outbound port 25 by default to prevent spam. On these platforms, all SMTP results will be "SMTP Blocked".

**Workaround:** Run on a VPS provider that allows port 25 (Hetzner, OVH, Vultr — request SMTP removal from the control panel). Or run locally on an office/corporate network.

### SMTP verification is not 100% accurate

Some servers:
- Accept all RCPT TO without rejecting invalid addresses (catch-all) — detected and flagged as "Risky"
- Use greylisting (temporary 4xx rejections for first-time senders)
- Have secondary MX servers that accept everything
- Rate-limit RCPT TO probes after a few attempts

Result: SMTP verification gives strong signals but is not a guarantee of deliverability.

### No actual email is sent

This tool only sends SMTP commands (EHLO, MAIL FROM, RCPT TO) and then quits. No message body is ever sent. However, some aggressive spam filters may log these probe connections.

### MX cache is per-process

The domain MX cache lives in memory. Restarting the server clears it. This is intentional — it's a lightweight tool, not a service.

---

## Troubleshooting

### "Cannot find module 'p-limit'"

Run `npm install`. If you see `ERR_REQUIRE_ESM`, your Node version may be old:
```bash
node --version   # must be ≥ 16
```

### Everything shows "SMTP Blocked"

You are on a network or server where outbound port 25 and 587 are blocked. This is normal on cloud hosting. See [Known Limitations](#known-limitations).

### CSV upload returns "Only .csv files are accepted"

Check that your file:
1. Has a `.csv` extension (not `.xlsx` or `.txt`)
2. Is under 2 MB
3. Contains plain text, not Excel binary format

### Results come back very slowly

Increase concurrency in `processEmails.js`:
```js
const CONCURRENCY = 10;
```

Or reduce the SMTP timeout in `smtpCheck.js`:
```js
const CONNECT_TIMEOUT  = 4000;
const RESPONSE_TIMEOUT = 4000;
```

### "Too many requests" error

You've hit the rate limit (20 requests per IP per 15 minutes). Wait 15 minutes, or change the limit in `server.js`.

### Server crashes on startup

Check Node version: `node --version` — must be ≥ 16.0.0.
Check all packages installed: `npm install`.
Check port is free: `lsof -i :3000`

---

## File-by-File Reference

### `server.js`

Entry point. Configures Express, attaches rate-limit middleware, mounts the verify route, serves static files. Handles global errors.

### `routes/verifyRoute.js`

Handles `POST /verify`. Detects multipart vs JSON. Calls multer for file uploads with type/size guards. Deduplicates emails. Sets streaming response headers. Calls `processEmails()` and writes each result as a newline-delimited JSON chunk. Cleans up uploaded files in `finally`.

### `services/validateEmail.js`

Pure function `validateEmailFormat(email)`. No I/O. Returns `{ valid, isRole, isDisposable, reason }`. Contains the full lists of role prefixes and disposable domains.

### `services/dnsCheck.js`

`checkMxRecords(domain)` — async DNS lookup with 5s timeout and in-memory cache. `markDomainCatchAll(domain)` — updates cache when smtpCheck detects a catch-all. `clearCache()` — for testing.

### `services/smtpCheck.js`

`checkSmtp({ email, mxRecords })` — raw TCP SMTP probe. `smtpConversation()` opens a socket and sends SMTP commands sequentially, reading server responses. `probeSmtp()` runs EHLO → MAIL FROM → RCPT TO (real) → RCPT TO (fake, for catch-all). Tries port 25 then 587 on up to 2 MX hosts.

### `services/processEmails.js`

Orchestrator. `processEmails(emails, onResult)` — runs `verifyOne()` for each email with `p-limit(5)` concurrency. `verifyOne()` chains all three pipeline steps and returns the final status object.

### `utils/csvParser.js`

`parseCSV(filePath)` — streams a CSV file, strips BOM, identifies email columns by header name, falls back to scanning all columns, deduplicates, returns `string[]`.

### `public/index.html`

Single-page UI. Tabs for paste/CSV input. Progress bar. Stats row. Results table. All semantic HTML with ARIA attributes for accessibility.

### `public/style.css`

Custom CSS — no framework. CSS variables for colours. Responsive grid. Status badge colour coding. Accessible focus styles.

### `public/script.js`

All frontend logic. Streaming fetch with `ReadableStream` reader. NDJSON line parser. Live table row insertion. Progress bar updates. Stats counters. Filter dropdown. CSV export (with BOM for Excel). Error banner. Retry failed button.

---

## Quick Reference Card

```
Start server:       npm start
Dev mode:           npm run dev
URL:                http://localhost:3000
Max emails/request: 500
Rate limit:         20 req / IP / 15 min
SMTP concurrency:   5 parallel
DNS cache TTL:      10 minutes
SMTP ports tried:   25, then 587
Connect timeout:    8 seconds
Response timeout:   8 seconds per command
Max CSV size:       2 MB
Max CSV rows:       10,000
```
