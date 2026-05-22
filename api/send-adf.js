// ADF Email Sender — Vercel Serverless Function
// Receives GHL webhook, builds ADF XML, sends via Mailgun

const https = require("https");
const querystring = require("querystring");

// ─── Build ADF XML from lead data ───────────────────────────────────────────
function buildAdfXml(lead) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${oh}${om}`;

  const firstName = esc(lead.first_name || lead.firstName || "");
  const lastName = esc(lead.last_name || lead.lastName || "");
  const fullName = `${firstName} ${lastName}`.trim();

  const comments = [
    lead.date_of_birth ? `Date of Birth: ${lead.date_of_birth}` : "",
    lead.job_title ? `Current Position: ${lead.job_title}` : "",
    lead.employment_status ? `Employment Status: ${lead.employment_status}` : "",
    lead.employer ? `Employer Name: ${lead.employer}` : "",
    lead.monthly_income ? `Monthly Income: ${lead.monthly_income} CAD` : "",
    lead.time_at_job ? `Time at Job: ${lead.time_at_job}` : "",
    lead.cosigner ? `Cosigner: ${lead.cosigner}` : "",
    lead.vehicle_type ? `Preferred Type of Vehicle: ${lead.vehicle_type}` : "",
    lead.duration_at_address ? `Duration Lived At Current Address: ${lead.duration_at_address}` : "",
    lead.license_class ? `Driving License: ${lead.license_class}` : "",
    lead.notes ? `Notes: ${lead.notes}` : "",
  ]
    .filter(Boolean)
    .join(" // ");

  return `<?xml version="1.0"?>
<?adf version="1.0"?>
<adf>
  <prospect status="new">
    <customer>
      <comments>${esc(comments)}</comments>
      <contact primarycontact="1">
        <address>
          <city>${esc(lead.city)}</city>
          <postalcode>${esc(lead.postal_code || lead.postalCode || "")}</postalcode>
          <street line="1">${esc(lead.address1 || lead.street || "")}</street>
        </address>
        <email>${esc(lead.email)}</email>
        <name part="first" type="individual">${firstName}</name>
        <name part="full" type="individual">${esc(fullName)}</name>
        <name part="last" type="individual">${lastName}</name>
        <phone type="voice" time="day" preferredcontact="1">${esc(lead.phone)}</phone>
      </contact>
    </customer>
    <id source="${esc(lead.source || "WEBSITE")}" sequence="0">${esc(lead.id || lead.lead_id || "")}</id>
    <provider>
      <contact>
        <name part="full" type="individual">${esc(lead.agent_name || process.env.DEFAULT_AGENT_NAME || "")}</name>
      </contact>
      <name part="full" type="business">${esc(process.env.BUSINESS_NAME || "DF")}</name>
      <service>${esc(lead.tier || process.env.DEFAULT_TIER || "Tier 3")}</service>
    </provider>
    <requestdate>${ts}</requestdate>
    <vehicle>
      <bodystyle>${esc(lead.vehicle_type || "")}</bodystyle>
    </vehicle>
    <vendor>
      <agent>${esc(lead.agent_name || process.env.DEFAULT_AGENT_NAME || "")}</agent>
      <name>${esc(lead.agent_name || process.env.DEFAULT_AGENT_NAME || "")}</name>
    </vendor>
  </prospect>
</adf>`;
}

// ─── Send email via Mailgun ──────────────────────────────────────────────────
function sendMailgun(toEmail, fromEmail, subject, xmlBody) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;

    if (!apiKey || !domain) {
      return reject(new Error("MAILGUN_API_KEY or MAILGUN_DOMAIN not set in environment variables"));
    }

    const postData = querystring.stringify({
      from: fromEmail,
      to: toEmail,
      subject: subject,
      text: xmlBody,
    });

    // Mailgun US region — change to api.eu.mailgun.net if your account is EU
    const options = {
      hostname: "api.mailgun.net",
      path: `/v3/${domain}/messages`,
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({ success: true, response: data });
        } else {
          reject(new Error(`Mailgun error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ─── Main handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Allow CORS for testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional webhook secret check (set WEBHOOK_SECRET in Vercel env vars)
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const lead = req.body;

    if (!lead || !lead.email) {
      return res.status(400).json({ error: "Missing lead data or email field" });
    }

    // Build ADF XML
    const xml = buildAdfXml(lead);

    // Build subject
    const firstName = lead.first_name || lead.firstName || "";
    const lastName = lead.last_name || lead.lastName || "";
    const source = lead.source || "WEBSITE";
    const subject = `New ADF Lead – ${firstName} ${lastName} – ${source}`;

    // Recipient(s) — use env var or lead field
    const toEmail = lead.dealer_email || process.env.DEFAULT_DEALER_EMAIL;
    if (!toEmail) {
      return res.status(400).json({ error: "No dealer email set. Add DEFAULT_DEALER_EMAIL to environment variables." });
    }

    const fromEmail = process.env.FROM_EMAIL || `leads@${process.env.MAILGUN_DOMAIN}`;

    // Send
    await sendMailgun(toEmail, fromEmail, subject, xml);

    console.log(`ADF sent: ${firstName} ${lastName} → ${toEmail}`);
    return res.status(200).json({
      success: true,
      message: `ADF email sent to ${toEmail}`,
      lead: `${firstName} ${lastName}`,
    });
  } catch (err) {
    console.error("ADF send error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
