import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadCampaigns, publicCampaign } from "./campaigns.ts";
import type { Campaign, Recipient } from "./campaigns.ts";
import { DraftError, DraftRequest, draftEmail } from "./draft.ts";
import { sendMail, sendingEnabled } from "./mailer.ts";
import { RateLimiter, addPending, deletePending, getPending, hasSent, markSent } from "./store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaigns = await loadCampaigns(path.join(root, "campaigns"));
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
const SITE_NAME = new URL(PUBLIC_URL).host;

// AI drafting is optional: without a key, the site builds letters from a template instead.
const aiDrafting = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const HOUR = 60 * 60 * 1000;
const draftLimiter = new RateLimiter(15, HOUR); // per IP: Claude calls cost money
const sendLimiter = new RateLimiter(5, HOUR); // per IP: confirmation emails
const sendPerEmailLimiter = new RateLimiter(3, HOUR); // per address: don't spam someone's inbox

const app = express();
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function findCampaign(req: Request, res: Response): Campaign | undefined {
  const campaign = campaigns.get(String(req.params.slug));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found." });
    return undefined;
  }
  return campaign;
}

function requireActive(campaign: Campaign, res: Response): boolean {
  if (campaign.status !== "active") {
    res.status(410).json({ error: "This campaign is no longer taking new emails." });
    return false;
  }
  return true;
}

function pickRecipients(campaign: Campaign, ids: string[], res: Response): Recipient[] | undefined {
  const chosen = campaign.recipients.filter((r) => ids.includes(r.id));
  if (chosen.length === 0 || chosen.length !== new Set(ids).size) {
    res.status(400).json({ error: "Please choose at least one valid recipient." });
    return undefined;
  }
  return chosen;
}

function badRequest(res: Response, error: z.ZodError) {
  const first = error.issues[0];
  res.status(400).json({ error: `Check the "${first?.path.join(".") || "form"}" field: ${first?.message ?? "invalid"}` });
}

// ---------- API ----------

app.get("/api/config", (_req, res) => {
  res.json({ sendingEnabled, aiDrafting });
});

app.get("/api/campaigns", (_req, res) => {
  res.json([...campaigns.values()].filter((c) => c.status !== "draft").map(publicCampaign));
});

app.get("/api/campaigns/:slug", (req, res) => {
  const campaign = findCampaign(req, res);
  if (campaign) res.json(publicCampaign(campaign));
});

app.post("/api/campaigns/:slug/draft", async (req, res) => {
  if (!aiDrafting) return res.status(404).json({ error: "AI drafting isn't switched on." });
  const campaign = findCampaign(req, res);
  if (!campaign || !requireActive(campaign, res)) return;

  const parsed = DraftRequest.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const recipients = pickRecipients(campaign, parsed.data.recipientIds, res);
  if (!recipients) return;

  if (!draftLimiter.take(req.ip ?? "unknown")) {
    return res.status(429).json({ error: "You've drafted a lot of emails in the last hour. Please try again later." });
  }

  try {
    const draft = await draftEmail(campaign, recipients, { ...parsed.data, name: oneLine(parsed.data.name), suburb: oneLine(parsed.data.suburb) });
    res.json(draft);
  } catch (err) {
    if (err instanceof DraftError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

const SendRequest = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  suburb: z.string().trim().max(100).default(""),
  recipientIds: z.array(z.string()).min(1),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(20).max(6000),
  /** Whether the resident started from the AI draft (vs. writing it themselves). */
  aiAssisted: z.boolean().default(true),
});

// Step 1 of "send it for me": email the resident a confirmation link. Nothing reaches
// representatives until they click it, so nobody can send in someone else's name.
app.post("/api/campaigns/:slug/send", async (req, res) => {
  if (!sendingEnabled) return res.status(404).json({ error: "Sending from this site isn't switched on." });
  const campaign = findCampaign(req, res);
  if (!campaign || !requireActive(campaign, res)) return;

  const parsed = SendRequest.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const data = { ...parsed.data, name: oneLine(parsed.data.name), suburb: oneLine(parsed.data.suburb), subject: oneLine(parsed.data.subject) };
  const recipients = pickRecipients(campaign, data.recipientIds, res);
  if (!recipients) return;

  if (hasSent(campaign.slug, data.email)) {
    return res.status(409).json({ error: "An email for this campaign has already been sent from this address. Thank you!" });
  }
  if (!sendLimiter.take(req.ip ?? "unknown") || !sendPerEmailLimiter.take(data.email.toLowerCase())) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const token = addPending({ campaignSlug: campaign.slug, ...data });
  const link = `${PUBLIC_URL}/confirm/${token}`;
  try {
    await sendMail({
      to: [data.email],
      subject: `Confirm your email to ${recipients.map((r) => r.name).join(" and ")}`,
      text:
        `Hi ${data.name},\n\n` +
        `You asked ${SITE_NAME} to send the email below on your behalf for the campaign "${campaign.title}".\n\n` +
        `To send it, open this link and press "Send":\n${link}\n\n` +
        `If this wasn't you, ignore this message and nothing will be sent. The link expires in 24 hours.\n\n` +
        `----- Your email -----\nTo: ${recipients.map((r) => r.name).join(", ")}\nSubject: ${data.subject}\n\n${data.body}\n`,
    });
  } catch (err) {
    deletePending(token);
    console.error("Failed to send confirmation email:", err);
    return res.status(502).json({ error: "We couldn't send the confirmation email. Please use the 'Open in my email app' option instead." });
  }
  res.json({ ok: true });
});

app.get("/api/confirm/:token", (req, res) => {
  const p = getPending(req.params.token);
  const campaign = p && campaigns.get(p.campaignSlug);
  if (!p || !campaign) return res.status(404).json({ error: "This link has expired or has already been used." });
  res.json({
    campaignTitle: campaign.title,
    name: p.name,
    email: p.email,
    recipients: campaign.recipients.filter((r) => p.recipientIds.includes(r.id)).map((r) => r.name),
    subject: p.subject,
    body: p.body,
  });
});

// Step 2: the resident confirms (POST, so link-scanners that prefetch GET URLs can't trigger it).
app.post("/api/confirm/:token", async (req, res) => {
  const token = req.params.token;
  const p = getPending(token);
  const campaign = p && campaigns.get(p.campaignSlug);
  if (!p || !campaign) return res.status(404).json({ error: "This link has expired or has already been used." });
  if (!requireActive(campaign, res)) return;
  if (hasSent(campaign.slug, p.email)) {
    deletePending(token);
    return res.status(409).json({ error: "An email for this campaign has already been sent from this address." });
  }

  const recipients = campaign.recipients.filter((r) => p.recipientIds.includes(r.id));
  deletePending(token); // single use: a double-click can't send twice
  try {
    await sendMail({
      to: recipients.flatMap((r) => r.emails),
      cc: [p.email],
      replyTo: { name: p.name, address: p.email },
      fromDisplayName: `${p.name} via ${SITE_NAME}`,
      subject: p.subject,
      text:
        `${p.body}\n\n--\n` +
        `Sent by ${p.name} <${p.email}>${p.suburb ? ` of ${p.suburb}` : ""} using ${SITE_NAME}, ` +
        `a community tool that helps residents write to their representatives. ` +
        `The sender confirmed their email address and reviewed this message before sending` +
        (p.aiAssisted ? `; it was drafted with AI assistance. ` : `. `) +
        `Reply to this email to respond to ${p.name} directly.`,
    });
  } catch (err) {
    console.error("Failed to send campaign email:", err);
    return res.status(502).json({ error: "Sending failed. Please use the 'Open in my email app' option on the campaign page instead." });
  }
  markSent(campaign.slug, p.email);
  res.json({ ok: true, recipients: recipients.map((r) => r.name) });
});

// ---------- Pages ----------

const pub = path.join(root, "public");
app.get("/c/:slug", (_req, res) => res.sendFile(path.join(pub, "campaign.html")));
app.get("/confirm/:token", (_req, res) => res.sendFile(path.join(pub, "confirm.html")));
app.use(express.static(pub));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Geelong Citizens running at ${PUBLIC_URL} (port ${port})`);
  console.log(`Campaigns: ${[...campaigns.keys()].join(", ") || "(none)"}`);
  console.log(`"Send it for me": ${sendingEnabled ? `on (${process.env.MAIL_TRANSPORT})` : "off"}`);
  console.log(`AI drafting: ${aiDrafting ? "on" : "off (letters are built from a template; set ANTHROPIC_API_KEY to turn on)"}`);
});
