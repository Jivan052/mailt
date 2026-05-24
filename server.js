/**
 * server.js — Entry point for the Email Deliverability Checker
 *
 * Starts an Express server, registers middleware and routes.
 */

const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");

const verifyRoute = require("./routes/verifyRoute");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse JSON request bodies
app.use(express.json({ limit: "2mb" }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Global rate limiter — max 20 requests per IP per 15 minutes
// Prevents abuse of the /verify endpoint
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests from this IP. Please wait 15 minutes and try again.",
  },
});

app.use("/verify", globalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/verify", verifyRoute);

// Catch-all: serve index.html for any unmatched GET (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("[server error]", err.message);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  Email Checker running → http://localhost:${PORT}\n`);
});
