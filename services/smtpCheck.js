/**
 * services/smtpCheck.js
 *
 * Raw TCP SMTP probe for RCPT TO verification.
 * Uses Node's built-in 'net' module — no external library needed.
 *
 * Strategy:
 *   1. Try port 25 on each MX host (standard mail exchange)
 *   2. Fall back to port 587 if port 25 is blocked/refused
 *   3. If all attempts are connection failures → "SMTP Blocked"
 *   4. If RCPT TO is 5xx rejected → "SMTP Failed"
 *   5. If RCPT TO is accepted (2xx/3xx) → probe with fake address for catch-all
 *
 * Timeouts:
 *   CONNECT_TIMEOUT:  TCP SYN → SYN-ACK (8s)
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
      // FIX 1: Response timeout → treat as blocked
      // On cloud hosts (Render, Railway etc) ports are silently dropped,
      // so a response timeout means the network is blocking us, not a real SMTP rejection
      responseTimer = setTimeout(() => {
        done({ responses, blocked: true, error: "Response timeout" });
      }, RESPONSE_TIMEOUT);
    }

    function sendNext() {
      if (commandIndex >= commands.length) {
        clearTimeout(responseTimer);
        done({ responses, blocked: false, error: null });
        return;
      }
      const cmd = commands[commandIndex++];
      resetResponseTimer();
      socket.write(cmd + "\r\n");
    }

    function processLine(line) {
      const match = line.match(/^(\d{3})([ \-])(.*)/);
      if (!match) return;

      const [, code, separator] = match;

      // Multi-line response — wait for the final line (space separator)
      if (separator === "-") return;

      responses.push(line);
      sendNext();
    }

    // Connect timeout — always blocked
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
      responseBuffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) processLine(line.trim());
      }
    });

    socket.on("error", (err) => {
      const msg = err.message || "";
      // FIX 2: Treat ALL socket errors as blocked on cloud environments
      // ECONNREFUSED, ETIMEDOUT, ECONNRESET, ENETUNREACH, EHOSTUNREACH
      // are all symptoms of network-level blocking, not SMTP rejections
      const blocked =
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT")    ||
        msg.includes("ECONNRESET")   ||
        msg.includes("ENETUNREACH")  ||
        msg.includes("EHOSTUNREACH") ||
        msg.includes("ENOTFOUND")    ||
        msg.includes("EACCES");
      done({ responses, blocked, error: msg });
    });

    // FIX 3: Unexpected close → treat as blocked
    // On Render/Railway the connection is often silently dropped mid-conversation
    socket.on("close", () => {
      if (!settled) done({ responses, blocked: true, error: "Connection closed unexpectedly" });
    });
  });
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

  // FIX 4: Incomplete dialog → treat as blocked, not a real SMTP rejection
  // If the server closed before we got all responses, it's a network issue
  if (responses.length < 4) {
    return {
      accepted: false,
      catchAllProbeAccepted: false,
      blocked: true,   // was false — wrong on cloud hosts
      error: `Incomplete SMTP dialog (${responses.length} responses)`,
    };
  }

  // Greeting must be 220
  const greetingCode = responses[0] ? parseInt(responses[0], 10) : 0;
  if (greetingCode !== 220) {
    // Bad greeting is also a network/block issue, not a mailbox rejection
    return {
      accepted: false,
      catchAllProbeAccepted: false,
      blocked: true,   // was false
      error: `Bad greeting: ${responses[0]}`,
    };
  }

  // RCPT TO for real address is responses[3]
  const rcptResponse = responses[3] || "";
  const rcptCode = parseInt(rcptResponse, 10);

  // 2xx = accepted, 4xx = temporary (greylisting), 5xx = permanent rejection
  const accepted = rcptCode >= 200 && rcptCode < 300;

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

  // Every host/port combination was blocked
  return {
    smtpValid: false,
    blocked: true,
    isCatchAll: false,
    smtpError: allBlocked.join(" | "),
  };
}

module.exports = { checkSmtp };