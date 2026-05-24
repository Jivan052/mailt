/**
 * routes/verifyRoute.js
 *
 * POST /verify
 *   Accepts:
 *     - multipart/form-data  → CSV file upload  (field: "csvfile")
 *     - application/json     → { emails: ["a@b.com", ...] }
 *
 * Streams results back as newline-delimited JSON so the frontend
 * can render rows progressively instead of waiting for the full batch.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseCSV } = require("../utils/csvParser");
const { processEmails } = require("../services/processEmails");

// ── Multer config ─────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, "../uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Unique filename to avoid collisions
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `upload-${unique}.csv`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2 MB max
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;

    // Accept .csv files and text/csv or text/plain MIME types
    const validExt = ext === ".csv";
    const validMime = ["text/csv", "text/plain", "application/csv",
                       "application/vnd.ms-excel"].includes(mime);

    if (validExt || validMime) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv files are accepted."));
    }
  },
});

// ── POST /verify ──────────────────────────────────────────────────────────────

router.post(
  "/",
  (req, res, next) => {
    // Run multer only if the request is multipart
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      upload.single("csvfile")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File too large. Maximum size is 2 MB." });
          }
          return res.status(400).json({ error: err.message });
        }
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    } else {
      next();
    }
  },

  async (req, res) => {
    let emails = [];
    let tempFilePath = null;

    try {
      // ── Collect emails ───────────────────────────────────────────────────

      if (req.file) {
        // CSV upload path
        tempFilePath = req.file.path;
        try {
          emails = await parseCSV(tempFilePath);
        } catch (csvErr) {
          return res.status(400).json({ error: `CSV parse error: ${csvErr.message}` });
        }

      } else if (req.body?.emails) {
        // JSON body path
        const raw = req.body.emails;

        if (!Array.isArray(raw)) {
          return res.status(400).json({ error: "emails must be an array." });
        }

        // Sanitise: trim, deduplicate, filter empty strings
        const seen = new Set();
        for (const e of raw) {
          const trimmed = String(e).trim().toLowerCase();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            emails.push(trimmed);
          }
        }

      } else {
        return res.status(400).json({ error: "No emails provided. Send a CSV file or a JSON body with an emails array." });
      }

      // ── Guard: max 500 emails per request ────────────────────────────────
      const MAX_EMAILS = 500;
      if (emails.length === 0) {
        return res.status(400).json({ error: "No valid email addresses found in input." });
      }
      if (emails.length > MAX_EMAILS) {
        return res.status(400).json({
          error: `Too many emails. Maximum ${MAX_EMAILS} per request. You sent ${emails.length}.`,
        });
      }

      // ── Stream results ────────────────────────────────────────────────────
      // Set headers for chunked streaming so the frontend gets rows immediately
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("X-Total-Count", emails.length);
      res.flushHeaders();

      // Send total count as the first line so the frontend can set up the progress bar
      res.write(JSON.stringify({ type: "total", count: emails.length }) + "\n");

      // processEmails calls the callback for each result as it completes
      await processEmails(emails, (result) => {
        res.write(JSON.stringify({ type: "result", data: result }) + "\n");
      });

      res.end();

    } catch (err) {
      console.error("[verifyRoute error]", err);
      // If headers already sent we can't change status — just end
      if (!res.headersSent) {
        res.status(500).json({ error: "Verification failed. " + err.message });
      } else {
        res.end();
      }

    } finally {
      // Always clean up uploaded temp files
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlink(tempFilePath, () => {});
      }
    }
  }
);

module.exports = router;
