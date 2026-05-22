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

  // ── GHL field mapping (handles both GHL custom keys and standard keys) ──
  const fullName  = lead.Name        || lead.name        || "";
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName  = nameParts.slice(1).join(" ") || "";

  const email     = lead.Email       || lead.email       || "";
  const phone     = lead.Phone       || lead.phone       || "";
  const street    = lead.Address     || lead.address1    || lead.street || "";
  const city      = lead.City        || lead.city        || "";
  const postal    = lead.PostalCode  || lead.postal_code || lead.postalCode || "";
  const source    = lead.Source      || lead.source      || "WEBSITE";
  const leadId    = lead.LeadID      || lead.id          || lead.lead_id || "";
  const vehicle   = lead.VehicleType || lead.vehicle_type || "";
  const agentName = lead["FM}"]      || lead.FM          || lead.agent_name || process.env.DEFAULT_AGENT_NAME || "";
  const tier      = lead.Type        || lead.tier        || process.env.DEFAULT_TIER || "Tier 3";
  const dealerEmail = lead.DealerEmail || lead.dealer_email || process.env.DEFAULT_DEALER_EMAIL || "";

  // Comments — use the pre-built Comment field from GHL if present,
  // otherwise build from individual fields
  const comments = lead.Comment || lead.comments || [
    lead.DateOfBirth    ? `Date of Birth: ${lead.DateOfBirth}`       : "",
    lead.JobTitle       ? `Current Position: ${lead.JobTitle}`       : "",
    lead.EmploymentStatus ? `Employment Status: ${lead.EmploymentStatus}` : "",
    lead.Employer       ? `Employer Name: ${lead.Employer}`          : "",
    lead.MonthlyIncome  ? `Monthly Income: ${lead.MonthlyIncome} CAD`: "",
    lead.TimeAtJob      ? `Time at Job: ${lead.TimeAtJob}`           : "",
    lead.Cosigner       ? `Cosigner: ${lead.Cosigner}`               : "",
    vehicle             ? `Preferred Type of Vehicle: ${vehicle}`    : "",
    lead.DurationAtAddress ? `Duration Lived At Current Address: ${lead.DurationAtAddress}` : "",
    lead.LicenseClass   ? `Driving License: ${lead.LicenseClass}`    : "",
    lead.Notes          ? `Notes: ${lead.Notes}`                     : "",
  ].filter(Boolean).join(" // ");

  return `<?xml version="1.0"?>
<?adf version="1.0"?>
<adf>
  <prospect status="new">
    <customer>
      <comments>${esc(comments)}</comments>
      <contact primarycontact="1">
        <address>
          <city>${esc(city)}</city>
          <postalcode>${esc(postal)}</postalcode>
          <street line="1">${esc(street)}</street>
        </address>
        <email>${esc(email)}</email>
        <name part="first" type="individual">${esc(firstName)}</name>
        <name part="full" type="individual">${esc(fullName.trim())}</name>
        <name part="last" type="individual">${esc(lastName)}</name>
        <phone type="voice" time="day" preferredcontact="1">${esc(phone)}</phone>
      </contact>
    </customer>
    <id source="${esc(source)}" sequence="0">${esc(leadId)}</id>
    <provider>
      <contact>
        <name part="full" type="individual">${esc(agentName.split(" ")[0])}</name>
      </contact>
      <name part="full" type="business">${esc(process.env.BUSINESS_NAME || "DF")}</name>
      <service>${esc(tier)}</service>
    </provider>
    <requestdate>${ts}</requestdate>
    <vehicle>
      <bodystyle>${esc(vehicle)}</bodystyle>
    </vehicle>
    <vendor>
      <agent>${esc(agentName)}</agent>
      <name>${esc(agentName)}</name>
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Optional webhook secret check
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const lead = req.body;

    // Accept email from either key format
    const email = lead.Email || lead.email;
    if (!lead || !email) {
      return res.status(400).json({ error: "Missing lead data or email field" });
    }

    const xml = buildAdfXml(lead);

    // Subject line
    const fullName = lead.Name || lead.name || "";
    const source   = lead.Source || lead.source || "WEBSITE";
    const subject  = `New ADF Lead – ${fullName.trim()} – ${source}`;

    // Recipient
    const toEmail = lead.DealerEmail || lead.dealer_email || process.env.DEFAULT_DEALER_EMAIL;
    if (!toEmail) {
      return res.status(400).json({ error: "No dealer email. Set DEFAULT_DEALER_EMAIL in Vercel env vars." });
    }

    const fromEmail = process.env.FROM_EMAIL || `leads@${process.env.MAILGUN_DOMAIN}`;

    await sendMailgun(toEmail, fromEmail, subject, xml);

    console.log(`ADF sent: ${fullName} → ${toEmail}`);
    return res.status(200).json({
      success: true,
      message: `ADF email sent to ${toEmail}`,
      lead: fullName.trim(),
    });
  } catch (err) {
    console.error("ADF send error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
