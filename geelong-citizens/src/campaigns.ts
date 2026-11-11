import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const Recipient = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** How the recipient is addressed in a greeting, e.g. "Councillor Smith". */
  salutation: z.string().min(1),
  role: z.string().min(1),
  emails: z.array(z.email()).min(1),
});

const Campaign = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  status: z.enum(["draft", "active", "closed"]),
  title: z.string().min(1),
  organiser: z.object({ name: z.string(), url: z.url().optional() }),
  /** Shown at the top of the campaign page. */
  summary: z.string().min(1),
  /** Facts the AI is allowed to rely on when drafting. Keep these accurate. */
  background: z.array(z.string()).min(1),
  /** What supporters are asking their representatives to do. */
  ask: z.string().min(1),
  /** Tick-box reasons offered to supporters (they can also write their own). */
  reasons: z.array(z.string()).default([]),
  recipients: z.array(Recipient).min(1),
  /** Extra drafting instructions specific to this campaign. */
  guidance: z.string().optional(),
});

export type Campaign = z.infer<typeof Campaign>;
export type Recipient = z.infer<typeof Recipient>;

/** Loads every campaigns/*.json file. Throws on the first invalid file so mistakes surface at startup. */
export async function loadCampaigns(dir: string): Promise<Map<string, Campaign>> {
  const campaigns = new Map<string, Campaign>();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    const result = Campaign.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid campaign file ${file}:\n${z.prettifyError(result.error)}`);
    }
    if (campaigns.has(result.data.slug)) {
      throw new Error(`Duplicate campaign slug "${result.data.slug}" in ${file}`);
    }
    campaigns.set(result.data.slug, result.data);
  }
  return campaigns;
}

/** The subset of a campaign that is safe and useful to send to the browser. */
export function publicCampaign(c: Campaign) {
  return {
    slug: c.slug,
    status: c.status,
    title: c.title,
    organiser: c.organiser,
    summary: c.summary,
    ask: c.ask,
    reasons: c.reasons,
    recipients: c.recipients.map((r) => ({ id: r.id, name: r.name, role: r.role, emails: r.emails })),
  };
}
