// ADF Email Sender — Vercel Serverless Function
// Receives GHL webhook, builds ADF XML, sends via Mailgun

const https = require("https");
const querystring = require("querystring");

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

  // ── Field mapping ──────────────────────────────────────────────────────────
  const firstName = lead.FirstName  || lead.first_name  || "";
  const lastName  = lead.LastName   || lead.last_name   || "";
  const fullName  = `${firstName} ${lastName}`.trim();

  const email   = lead.Email      || lead.email      || "";
  const phone   = lead.Phone      || lead.phone      || "";
  const street  = lead.Address    || lead.address1   || "";
  const city    = lead.City       || lead.city       || "";
  const postal  = lead.PostalCode || lead.postal_code || "";
  const source  = lead.Source     || lead.source     || "WEBSITE";
  const leadId  = lead.LeadID     || lead.id         || "";
  const vehicle = lead.VehicleType || lead.type_of_vehicle || "";
  const agent   = lead["FM}"]     || lead.FM         || lead.agent_name || process.env.DEFAULT_AGENT_NAME || "";
  const tier    = lead.Type       || lead.tier       || process.env.DEFAULT_TIER || "Tier 3";
  const comments = lead.Comment   || lead.comments   || "";

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
        <name part="full" type="individual">${esc(fullName)}</name>
        <name part="last" type="individual">${esc(lastName)}</name>
        <phone type="voice" time="day" preferredcontact="1">${esc(phone)}</phone>
      </contact>
    </customer>
    <id source="${esc(source)}" sequence="0">${esc(leadId)}</id>
    <provider>
      <contact>
        <name part="full" type="individual">${esc(agent.split(" ")[0])}</name>
      </contact>
      <name part="full" type="business">${esc(process.env.BUSINESS_NAME || "DF")}</name>
      <service>${esc(tier)}</service>
    </provider>
    <requestdate>${ts}</requestdate>
    <vehicle>
      <bodystyle>${esc(vehicle)}</bodystyle>
    </vehicle>
    <vendor>
      <agent>${esc(agent)}</agent>
      <name>${esc(agent)}</name>
    </vendor>
  </prospect>
</adf>`;
}

function sendMailgun(toEmail, fromEmail, subject, xmlBody) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;

    if (!apiKey || !domain) {
      return reject(new Error("MAILGUN_API_KEY or MAILGUN_DOMAIN not set"));
    }

    const postData = querystring.stringify({
      from: fromEmail,
      to: toEmail,
      subject: subject,
      text: xmlBody,
    });

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-webhook-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const lead = req.body;
    const email = lead.Email || lead.email;

    if (!lead || !email) {
      return res.status(400).json({ error: "Missing lead data or email field" });
    }

    const xml = buildAdfXml(lead);

    const firstName = lead.FirstName || lead.first_name || "";
    const lastName  = lead.LastName  || lead.last_name  || "";
    const source    = lead.Source    || lead.source     || "WEBSITE";
    const subject   = `New ADF Lead – ${firstName} ${lastName}`.trim() + ` – ${source}`;

    const toEmail = lead.DealerEmail || lead.dealer_email || process.env.DEFAULT_DEALER_EMAIL;
    if (!toEmail) {
      return res.status(400).json({ error: "No dealer email. Set DEFAULT_DEALER_EMAIL in Vercel env vars." });
    }

    const fromEmail = process.env.FROM_EMAIL || `leads@${process.env.MAILGUN_DOMAIN}`;

    await sendMailgun(toEmail, fromEmail, subject, xml);

    console.log(`ADF sent: ${firstName} ${lastName} → ${toEmail}`);
    return res.status(200).json({
      success: true,
      message: `ADF email sent to ${toEmail}`,
      lead: `${firstName} ${lastName}`.trim(),
    });
  } catch (err) {
    console.error("ADF send error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
