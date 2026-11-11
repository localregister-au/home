import { randomBytes } from "node:crypto";

// In-memory state. Fine for a single small server; it resets on restart.
// Swap for SQLite/Redis if you run more than one instance or need history.

/** Simple fixed-window rate limiter keyed by an arbitrary string (IP, email...). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns true if the action is allowed (and records it). */
  take(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

export interface PendingSend {
  campaignSlug: string;
  name: string;
  email: string;
  suburb: string;
  recipientIds: string[];
  subject: string;
  body: string;
  aiAssisted: boolean;
  createdAt: number;
}

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const pending = new Map<string, PendingSend>();
/** "campaign:email" pairs that have already sent, so one person sends once per campaign. */
const sent = new Set<string>();

export function addPending(p: Omit<PendingSend, "createdAt">): string {
  const token = randomBytes(24).toString("base64url");
  pending.set(token, { ...p, createdAt: Date.now() });
  for (const [t, v] of pending) if (Date.now() - v.createdAt > PENDING_TTL_MS) pending.delete(t);
  return token;
}

export function getPending(token: string): PendingSend | undefined {
  const p = pending.get(token);
  if (p && Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(token);
    return undefined;
  }
  return p;
}

export function deletePending(token: string) {
  pending.delete(token);
}

const sentKey = (slug: string, email: string) => `${slug}:${email.toLowerCase()}`;
export const hasSent = (slug: string, email: string) => sent.has(sentKey(slug, email));
export const markSent = (slug: string, email: string) => sent.add(sentKey(slug, email));
