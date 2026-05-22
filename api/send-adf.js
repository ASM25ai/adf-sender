// ADF Email Sender — Vercel Serverless Function
// Receives GHL webhook, builds ADF XML, sends via Mailgun

const https = require("https");
const querystring = require("querystring");

function buildAdfXml(data) {
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

  // GHL sends custom fields inside customData{} and standard fields at root
  const c = data.customData || {};

  const firstName = c.FirstName  || data.first_name  || "";
  const lastName  = c.LastName   || data.last_name   || "";
  const fullName  = `${firstName} ${lastName}`.trim();

  const email   = c.Email       || data.email        || "";
  const phone   = c.Phone       || data.phone        || "";
  const street  = c.Address     || data.address1     || "";
  const city    = c.City        || data.city         || "";
  const postal  = c.PostalCode  || data.postal_code  || "";
  const source  = c.Source      || data.contact_source || data.source || "WEBSITE";
  const leadId  = c.LeadID      || data.contact_id   || data.id      || "";
  const vehicle = c.VehicleType || c["Type of Vehicle"] || "";
  const agent   = c["FM}"]      || c.FM              || data.user?.firstName || process.env.DEFAULT_AGENT_NAME || "";
  const tier    = c.Type        || process.env.DEFAULT_TIER || "Tier 3";
  const comments = c.Comment    || "";

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
    const data = req.body;
    const c = data.customData || {};

    const email = c.Email || data.email;
    if (!email) {
      return res.status(400).json({ error: "Missing email field" });
    }

    const xml = buildAdfXml(data);

    const firstName = c.FirstName || data.first_name || "";
    const lastName  = c.LastName  || data.last_name  || "";
    const source    = c.Source    || data.contact_source || "WEBSITE";
    const subject   = `New ADF Lead – ${firstName} ${lastName}`.trim() + ` – ${source}`;

    const toEmail = c.DealerEmail || data.dealer_email || process.env.DEFAULT_DEALER_EMAIL;
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
