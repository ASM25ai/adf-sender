# ADF Email Sender

Serverless Vercel function that receives a GHL webhook and sends a properly formatted ADF/XML email via Mailgun — no local PC required.

---

## How it works

```
GHL New Lead → Webhook POST → Vercel Function → Mailgun → Dealer CRM
```

---

## Deploy in 5 steps (no coding needed)

### Step 1 — Get your code on GitHub
1. Go to [github.com](https://github.com) → create free account
2. Click **+** → **New repository** → name it `adf-sender` → **Create**
3. Upload all these files by dragging them into the GitHub file area

### Step 2 — Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) → sign up with GitHub
2. Click **Add New Project** → import your `adf-sender` repo
3. Click **Deploy** (no settings to change)
4. Your webhook URL will be: `https://your-project.vercel.app/send-adf`

### Step 3 — Add environment variables in Vercel
1. In Vercel → your project → **Settings** → **Environment Variables**
2. Add each variable from `.env.example` with your real values:

| Variable | Where to get it |
|---|---|
| `MAILGUN_API_KEY` | Mailgun dashboard → API Keys |
| `MAILGUN_DOMAIN` | Mailgun → Sending → Domains |
| `FROM_EMAIL` | e.g. `leads@mg.yourdomain.com` |
| `DEFAULT_DEALER_EMAIL` | The dealer's CRM email address |
| `BUSINESS_NAME` | Your business short name e.g. `DF` |
| `DEFAULT_AGENT_NAME` | e.g. `Nicholas Bonneville` |
| `WEBHOOK_SECRET` | Make up any random string |

3. Click **Redeploy** after adding variables

### Step 4 — Set up GHL webhook
1. In GHL → **Settings** → **Webhooks** → **Add Webhook**
2. **URL**: `https://your-project.vercel.app/send-adf`
3. **Events**: Select `Contact Created` or your lead form trigger
4. **Custom Header**: Key = `x-webhook-secret`, Value = your `WEBHOOK_SECRET`
5. Save

### Step 5 — Set up Mailgun
1. Go to [mailgun.com](https://mailgun.com) → free account
2. Add your sending domain (e.g. `mg.yourdomain.com`)
3. Follow their DNS setup (add 3-4 DNS records to your domain)
4. Copy your API key → paste into Vercel env vars

---

## GHL field mapping

The function automatically maps these GHL webhook fields to ADF:

| GHL field | ADF field |
|---|---|
| `first_name` | Customer first name |
| `last_name` | Customer last name |
| `email` | Customer email |
| `phone` | Customer phone |
| `address1` | Street address |
| `city` | City |
| `postal_code` | Postal code |
| `source` | Lead source (FACEBOOK, GOOGLE, etc.) |
| `id` | Lead ID |
| `date_of_birth` | Comments → Date of Birth |
| `job_title` | Comments → Current Position |
| `employment_status` | Comments → Employment Status |
| `employer` | Comments → Employer Name |
| `monthly_income` | Comments → Monthly Income |
| `time_at_job` | Comments → Time at Job |
| `cosigner` | Comments → Cosigner |
| `vehicle_type` | Vehicle body style + Comments |
| `duration_at_address` | Comments → Duration at Address |
| `license_class` | Comments → Driving License |
| `notes` | Comments → Notes |
| `dealer_email` | Override recipient per-lead |
| `agent_name` | Override agent per-lead |
| `tier` | Override tier per-lead |

---

## Test your webhook manually

Use this curl command (replace values) to test before connecting GHL:

```bash
curl -X POST https://your-project.vercel.app/send-adf \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-here" \
  -d '{
    "first_name": "Isaac",
    "last_name": "Jerome",
    "email": "jeromeisaac@hotmail.com",
    "phone": "+18196297081",
    "address1": "128 Rue Naneweak",
    "city": "Winneway",
    "postal_code": "J0Z 2J0",
    "source": "FACEBOOK",
    "id": "LG_WBK_test123",
    "vehicle_type": "SUV",
    "monthly_income": "3600",
    "job_title": "Bus Driver and Maintenance",
    "employer": "School of Longpoint First Nation"
  }'
```

---

## Sending to multiple dealers

To send to different dealers per lead, include `dealer_email` in your GHL webhook payload. Otherwise all leads go to `DEFAULT_DEALER_EMAIL`.

---

## Logs

View all sends and errors in: Vercel → your project → **Deployments** → **Functions** → **Logs**
