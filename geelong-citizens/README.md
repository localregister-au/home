# Geelong Citizens: campaign email tool

A small web app that helps residents write to their councillors and Members of Parliament about local campaigns. You can reuse it for any number of campaigns.

For each campaign, supporters:

1. Pick who to email (from the campaign's list of representatives).
2. Enter their name and suburb, tick the reasons that apply to them, and add a sentence or two in their own words.
3. Get a personal draft written by Claude, which they **edit and approve themselves**. ("I'll write it myself" skips the AI.)
4. Send it **from their own email** (opens their mail app or Gmail with everything filled in), **or** have the site send it for them after they confirm their email address.

## Keeping it credible

Representatives quickly discount copy-paste form letters and anything that looks like astroturfing. The tool is built so every email is a real person's message:

- **The AI only uses facts the resident gave and the campaign background.** It never invents personal stories, statistics or claims, and it's told not to disparage people on the other side.
- **The resident always reviews and edits the email** before it goes anywhere.
- **"Send it for me" needs email confirmation.** Nothing reaches a representative until the resident clicks a link sent to their own inbox, so nobody can send in someone else's name.
- Emails sent by the site have the **resident as Reply-To and CC**. The footer says who sent it, that they confirmed their address, and (if they used the AI draft) that it was drafted with AI assistance.
- **One email per address per campaign**, plus per-IP rate limits on drafting and sending.

## Quick start (local)

Requires Node.js 22.18 or newer (it runs the TypeScript directly, with no build step).

```bash
cd geelong-citizens
npm install
cp .env.example .env      # then put your Anthropic API key in .env
npm run dev               # http://localhost:3000
```

With `MAIL_TRANSPORT=console` (the default in `.env.example`), "send it for me" prints emails to the terminal instead of sending them. Copy the confirmation link from there to test the full flow.

`npm run check` type-checks the server code.

## Adding a campaign

Add a JSON file to `campaigns/`. Copy `campaigns/corio-bay-miniature-railway.json` as a starting point. Every file is checked at startup, and the server won't start if a file is invalid. Restart the server to pick up changes.

| Field | What it's for |
|---|---|
| `slug` | URL: `/c/<slug>` |
| `status` | `active` (taking emails), `closed` (shown, but no new emails), or `draft` (hidden from the home page, still reachable by URL) |
| `title`, `summary` | Shown at the top of the campaign page |
| `organiser.name` (and optional `organiser.url`) | Who is running the campaign |
| `ask` | The one thing supporters are asking representatives to do |
| `background` | **The only campaign facts the AI may use.** Keep these accurate and neutral. |
| `reasons` | Tick-boxes offered to supporters |
| `recipients` | `id`, `name`, `salutation` (e.g. "Councillor Smith"), `role`, and one or more `emails` |
| `guidance` | Optional extra drafting instructions for this campaign |

Check recipients' addresses against official council and parliament websites before you launch.

## Domain and email setup

You only need this for "send it for me". The "open in my email app" option works without it.

1. **Register the domain** (e.g. `geelongcitizens.com`) with any registrar. A `.com.au` needs an ABN; a `.com` doesn't.
2. **Sign up with a transactional email provider.** [Resend](https://resend.com) is the simplest to set up, and Postmark, Amazon SES and Mailgun also work. Any provider with SMTP works.
3. **Add your domain in the provider's dashboard** and create the DNS records it gives you at your registrar: **SPF**, **DKIM**, and a **DMARC** record (e.g. `v=DMARC1; p=none; rua=mailto:you@yourdomain`). Without these, emails to `.gov.au` addresses will land in spam or be rejected.
4. Put the SMTP details in `.env`:
   ```
   MAIL_TRANSPORT=smtp
   MAIL_FROM_ADDRESS=campaigns@geelongcitizens.com
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASS=<your Resend API key>
   ```
   Leave `MAIL_TRANSPORT` unset to turn "send it for me" off completely.

## Deploying

The app is a single Node server, so any host that runs Node 22 will do (Render, Railway, Fly.io, a small VPS).

- Root directory: `geelong-citizens`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: those in `.env.example`, plus `PUBLIC_URL=https://geelongcitizens.com` and `TRUST_PROXY=1` (needed behind the host's proxy so rate limits see real visitor IPs)
- Point the domain at the host with the CNAME or A record the host gives you.

**Run a single instance.** Pending confirmations, rate limits and the "already sent" list are kept in memory. A restart clears them, so a confirmation link sent before a restart stops working. To scale out or keep history, move `src/store.ts` to SQLite or Redis.

## Costs

Each draft is one Claude API call, a few thousand tokens at most, which costs roughly 1–3 cents on Claude Opus 5.5. The draft endpoint is rate-limited to 15 drafts per IP per hour. Settings:

- `DRAFT_MODEL` (default `claude-opus-5-5`)
- `DRAFT_EFFORT` (default `low`, for fast responses; try `medium` if drafts feel thin)

Requests use the API's server-side refusal fallback (`fallbacks: "default"`). If a safety classifier declines a draft, the request is retried on a fallback model automatically.

## Layout

```
campaigns/        one JSON file per campaign
public/           static pages: home, campaign, confirm
src/server.ts     routes and the send/confirm flow
src/draft.ts      Claude prompt and API call
src/campaigns.ts  campaign schema and loader
src/mailer.ts     SMTP / console email transport
src/store.ts      in-memory rate limits and pending confirmations
```
