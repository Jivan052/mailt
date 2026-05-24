/**
 * server.js — Entry point for the Email Deliverability Checker
 *
 * Starts an Express server, registers middleware and routes.
 */

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const verifyRoute = require("./routes/verifyRoute");

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────

const allowedOrigins = process.env.NODE_ENV === "production"
  ? [process.env.FRONTEND_URL]
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true,
}));

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse JSON request bodies
app.use(express.json({ limit: "5mb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Global rate limiter — max 20 requests per IP per 15 minutes
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

// Health check — confirms the server is running
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("[server error]", err.message);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  Email Checker running → http://localhost:${PORT}\n`);
});