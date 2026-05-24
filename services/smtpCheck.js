/**
 * services/smtpCheck.js
 *
 * Raw TCP SMTP probe for RCPT TO verification.
 * Uses Node's built-in 'net' module — no external library needed.
 *
 * Why raw sockets:
 *   smtp-connection v4 wraps nodemailer and requires a full message stream
 *   for send(). For a deliverability probe we only need EHLO/MAIL FROM/RCPT TO
 *   — raw sockets are cleaner, lighter, and easier to control.
 *
 * Strategy:
 *   1. Try port 25 on each MX host (standard mail exchange)
 *   2. Fall back to port 587 if port 25 is blocked/refused
 *   3. If all attempts are connection failures → "SMTP Blocked"
 *   4. If RCPT TO is 5xx rejected → "SMTP Failed"
 *   5. If RCPT TO is accepted (2xx/3xx) → probe with fake address for catch-all
 *
 * Timeouts:
 *   CONNECT_TIMEOUT: TCP SYN → SYN-ACK (8s)
 *   RESPONSE_TIMEOUT: wait for each SMTP response (8s)
 */

const net = require("net");
const { markDomainCatchAll } = require("./dnsCheck");

const CONNECT_TIMEOUT  = 8000;
const RESPONSE_TIMEOUT = 8000;
const SMTP_PORTS       = [25, 587];
const HELO_DOMAIN      = "verify.local";
const FROM_ADDRESS     = "verify@verify.local";

/**
 * smtpConversation({ host, port, commands })
 *
 * Opens a raw TCP connection and runs through SMTP commands sequentially.
 * Each command is sent after reading a server response.
 *
 * @param {string}   host
 * @param {number}   port
 * @param {string[]} commands - SMTP lines to send (after greeting)
 * @returns {Promise<{ responses: string[], blocked: boolean, error: string|null }>}
 */
function smtpConversation({ host, port, commands }) {
  return new Promise((resolve) => {
    let socket;
    let settled = false;
    let responseBuffer = "";
    let commandIndex = 0;
    let responses = [];
    let connectTimer;
    let responseTimer;

    function done(result) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      try { socket && socket.destroy(); } catch (_) {}
      resolve(result);
    }

    function resetResponseTimer() {
      clearTimeout(responseTimer);
      responseTimer = setTimeout(() => {
        done({ responses, blocked: false, error: "Response timeout" });
      }, RESPONSE_TIMEOUT);
    }

    function sendNext() {
      if (commandIndex >= commands.length) {
        // All commands sent — done successfully
        clearTimeout(responseTimer);
        done({ responses, blocked: false, error: null });
        return;
      }
      const cmd = commands[commandIndex++];
      resetResponseTimer();
      socket.write(cmd + "\r\n");
    }

    function processLine(line) {
      // SMTP responses: "CODE text" or "CODE-text" (multi-line continuation)
      // Only process complete responses (no dash after code = final line)
      const match = line.match(/^(\d{3})([ \-])(.*)/);
      if (!match) return; // partial line — wait for more

      const [, code, separator] = match;

      // Multi-line response — wait for the final line (space separator)
      if (separator === "-") return;

      responses.push(line);
      sendNext();
    }

    // Connect
    connectTimer = setTimeout(() => {
      done({ responses, blocked: true, error: "Connection timeout" });
    }, CONNECT_TIMEOUT);

    try {
      socket = net.createConnection({ host, port });
    } catch (err) {
      return done({ responses, blocked: true, error: err.message });
    }

    socket.setEncoding("utf8");

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      resetResponseTimer(); // wait for server greeting
    });

    socket.on("data", (data) => {
      responseBuffer += data;
      const lines = responseBuffer.split("\r\n");
      responseBuffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (line.trim()) processLine(line.trim());
      }
    });

    socket.on("error", (err) => {
      const msg = err.message || "";
      const blocked =
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ENETUNREACH") ||
        msg.includes("EHOSTUNREACH");
      done({ responses, blocked, error: msg });
    });

    socket.on("close", () => {
      if (!settled) done({ responses, blocked: false, error: "Connection closed unexpectedly" });
    });
  });
}

/**
 * getLastResponseCode(responses)
 * Extract the numeric code from the last recorded SMTP response.
 */
function getLastCode(responses) {
  if (!responses.length) return null;
  const last = responses[responses.length - 1];
  const m = last.match(/^(\d{3})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * probeSmtp({ mxHost, port, email })
 *
 * Full EHLO → MAIL FROM → RCPT TO conversation.
 *
 * Returns:
 *  { accepted, catchAllProbeAccepted, blocked, error }
 */
async function probeSmtp({ mxHost, port, email }) {
  const [, domain] = email.split("@");
  const fakeEmail = `zzz-catchall-probe-99999@${domain}`;

  const commands = [
    `EHLO ${HELO_DOMAIN}`,
    `MAIL FROM:<${FROM_ADDRESS}>`,
    `RCPT TO:<${email}>`,
    `RCPT TO:<${fakeEmail}>`,
    `QUIT`,
  ];

  const { responses, blocked, error } = await smtpConversation({ host: mxHost, port, commands });

  if (blocked) {
    return { accepted: false, catchAllProbeAccepted: false, blocked: true, error };
  }

  // responses[0] = greeting (220)
  // responses[1] = EHLO response (250)
  // responses[2] = MAIL FROM response (250)
  // responses[3] = RCPT TO (real address)
  // responses[4] = RCPT TO (fake address) — catch-all probe
  // responses[5] = QUIT

  // If we got fewer responses the server closed early
  if (responses.length < 4) {
    return { accepted: false, catchAllProbeAccepted: false, blocked: false, error: `Incomplete SMTP dialog (${responses.length} responses)` };
  }

  // Greeting must be 220
  const greetingCode = responses[0] ? parseInt(responses[0], 10) : 0;
  if (greetingCode !== 220) {
    return { accepted: false, catchAllProbeAccepted: false, blocked: false, error: `Bad greeting: ${responses[0]}` };
  }

  // RCPT TO for real address is responses[3]
  const rcptResponse = responses[3] || "";
  const rcptCode = parseInt(rcptResponse, 10);

  // 2xx = accepted, 4xx = temporary (greylisting etc), 5xx = permanent rejection
  const accepted = rcptCode >= 200 && rcptCode < 300;

  // If the real address was not accepted, no point checking catch-all
  if (!accepted) {
    return { accepted: false, catchAllProbeAccepted: false, blocked: false, error: rcptResponse };
  }

  // Check catch-all: responses[4] is the fake address response
  const fakeRcptResponse = responses[4] || "";
  const fakeRcptCode = parseInt(fakeRcptResponse, 10);
  const catchAllProbeAccepted = fakeRcptCode >= 200 && fakeRcptCode < 300;

  return { accepted: true, catchAllProbeAccepted, blocked: false, error: null };
}

/**
 * checkSmtp({ email, mxRecords })
 *
 * Tries up to 2 MX hosts × 2 ports.
 *
 * Returns:
 *  {
 *    smtpValid:   boolean
 *    blocked:     boolean   — all connection attempts failed
 *    isCatchAll:  boolean
 *    smtpError:   string | null
 *  }
 */
async function checkSmtp({ email, mxRecords }) {
  if (!mxRecords || mxRecords.length === 0) {
    return { smtpValid: false, blocked: false, isCatchAll: false, smtpError: "No MX records to probe" };
  }

  const [, domain] = email.split("@");
  const hostsToTry = mxRecords.slice(0, 2).map((r) => r.exchange);
  const allBlocked = [];

  for (const mxHost of hostsToTry) {
    for (const port of SMTP_PORTS) {
      let result;
      try {
        result = await probeSmtp({ mxHost, port, email });
      } catch (err) {
        allBlocked.push(`${mxHost}:${port} — unexpected: ${err.message}`);
        continue;
      }

      if (result.accepted) {
        if (result.catchAllProbeAccepted) {
          markDomainCatchAll(domain);
        }
        return {
          smtpValid: true,
          blocked: false,
          isCatchAll: result.catchAllProbeAccepted,
          smtpError: null,
        };
      }

      if (result.blocked) {
        allBlocked.push(`${mxHost}:${port} blocked`);
        continue; // try next port/host
      }

      // Got a real SMTP rejection — definitive answer
      return {
        smtpValid: false,
        blocked: false,
        isCatchAll: false,
        smtpError: result.error,
      };
    }
  }

  // Every host/port was blocked
  return {
    smtpValid: false,
    blocked: true,
    isCatchAll: false,
    smtpError: allBlocked.join(" | "),
  };
}

module.exports = { checkSmtp };
