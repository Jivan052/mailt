/**
 * utils/csvParser.js
 *
 * Parses a CSV file and extracts email addresses.
 *
 * Handles:
 *  - BOM character (U+FEFF) that Excel adds to UTF-8 exports
 *  - Multiple columns — scans ALL columns for anything that looks like an email
 *  - Headers named: email, Email, EMAIL, e-mail, E-mail, address, etc.
 *  - Single-column files with no header (just raw emails)
 *  - Quoted fields (csv-parser handles this natively)
 *  - Empty rows and blank cells
 *  - Files with Windows line endings (\r\n)
 *  - Returns deduplicated, trimmed, lowercased email array
 */

const fs = require("fs");
const path = require("path");
const csvParser = require("csv-parser");

// Column header names we recognise as "email" columns (case-insensitive)
const EMAIL_HEADER_PATTERNS = [
  /^e[-_]?mail(s)?$/i,
  /^address(es)?$/i,
  /^email[-_]?address(es)?$/i,
  /^mail$/i,
  /^recipient(s)?$/i,
  /^to$/i,
];

/**
 * looksLikeEmail(str)
 * Quick pre-filter — not a full validator, just avoids passing obvious non-emails
 * to the main pipeline unnecessarily.
 */
function looksLikeEmail(str) {
  return typeof str === "string" && str.includes("@") && str.includes(".");
}

/**
 * parseCSV(filePath)
 *
 * @param {string} filePath - Absolute path to the uploaded CSV file
 * @returns {Promise<string[]>} - Deduplicated array of potential email strings
 */
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error("CSV file not found on disk."));
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext && ext !== ".csv") {
      return reject(new Error("File must have a .csv extension."));
    }

    const emails = new Set(); // Use Set for automatic deduplication
    let rowCount = 0;
    let emailColumnKeys = null; // Will be determined from the first row's headers
    let headersParsed = false;
    let isHeaderless = false; // True if no recognisable email header found

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });

    // Strip UTF-8 BOM that Excel inserts — csv-parser doesn't handle it in all versions
    let firstChunk = true;
    const transformStream = new (require("stream").Transform)({
      transform(chunk, encoding, callback) {
        let data = chunk.toString("utf8");
        if (firstChunk) {
          // Remove BOM (U+FEFF) if present at start
          data = data.replace(/^\uFEFF/, "");
          firstChunk = false;
        }
        callback(null, Buffer.from(data, "utf8"));
      },
    });

    stream.pipe(transformStream).pipe(
      csvParser({
        mapHeaders: ({ header }) => header.trim(), // Trim whitespace from headers
        skipEmptyLines: true,
      })
    )
    .on("headers", (headers) => {
      headersParsed = true;

      // Find which columns match email-like header names
      emailColumnKeys = headers.filter((h) =>
        EMAIL_HEADER_PATTERNS.some((pattern) => pattern.test(h.trim()))
      );

      if (emailColumnKeys.length === 0) {
        // No recognised email column — we'll scan all columns
        emailColumnKeys = headers;
        isHeaderless = true;
      }
    })
    .on("data", (row) => {
      rowCount++;

      // Guard against absurdly large files that pass the multer size check
      // but have huge numbers of rows
      if (rowCount > 10000) return;

      if (!headersParsed) return;

      const keysToCheck = emailColumnKeys || Object.keys(row);

      for (const key of keysToCheck) {
        const cell = String(row[key] || "").trim().toLowerCase();
        if (looksLikeEmail(cell)) {
          // Remove mailto: prefix if present
          const cleaned = cell.replace(/^mailto:/i, "").trim();
          if (cleaned) emails.add(cleaned);
        }
      }
    })
    .on("end", () => {
      if (rowCount === 0) {
        return reject(new Error("CSV file is empty or contains no data rows."));
      }
      if (emails.size === 0) {
        return reject(
          new Error(
            "No email addresses found in the CSV. " +
            "Make sure your CSV has a column named 'email' (or similar), " +
            "or contains addresses in the format user@domain.com."
          )
        );
      }
      resolve([...emails]);
    })
    .on("error", (err) => {
      reject(new Error(`CSV parsing failed: ${err.message}`));
    });

    stream.on("error", (err) => {
      reject(new Error(`Could not read file: ${err.message}`));
    });
  });
}

module.exports = { parseCSV };
