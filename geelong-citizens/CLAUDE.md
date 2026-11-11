# Geelong Citizens: notes for Claude Code

A web app that helps Geelong residents write personal emails to their councillors and MPs, for organised campaigns (`campaigns/*.json`) and for their own issues. See README.md for setup.

## Stack
- Node.js 22.18+ running TypeScript directly (type stripping, no build step). Use `import type` for type-only imports and avoid TS-only runtime syntax (enums, parameter properties, namespaces).
- Express 5, Zod 4, Nodemailer, `@anthropic-ai/sdk`. Plain HTML/CSS/vanilla JS in `public/`, no frontend framework.
- Run with `npm run dev`. Typecheck with `npm run check`, and run it after every change.

## Non-negotiable product rules
These rules are what keep the tool credible with representatives. Don't weaken them without asking.
1. Every email is from a real, verified person, in their own name. The site never sends anything a person hasn't reviewed and explicitly sent.
2. The AI drafts only from what the resident wrote and the campaign's `background` facts. It must never invent personal stories, statistics, quotes or claims, and it must never disparage people on the other side.
3. The resident can always edit the draft, or write it without AI. If AI was used (built-in, or they copied the AI prompt), the email footer says so.
4. Rate limits and "one email per person per campaign" stay in place.
5. User-supplied text in prompts stays inside tags and is treated as content, not instructions. Recipients always come from server-side data, never from the model or the browser.
6. Personal data (names, emails, suburbs) is never logged in full or shared beyond what's needed to send the email.

## Claude API (optional)
- AI drafting is only on when ANTHROPIC_API_KEY is set. Without a key, `public/campaign.js` builds letters from a template, and a button copies a prompt for the supporter's own AI assistant. The owner doesn't want to use an API key, so keep the no-key path working and treat it as the main one.
- Default model `claude-opus-5-5` (env `DRAFT_MODEL`), effort from `DRAFT_EFFORT` (default `low`).
- Use `client.beta.messages.parse` with `betaZodOutputFormat` for structured drafts, and keep the server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"`).
- Check `stop_reason === "refusal"` before using output. Use the SDK's typed errors, not string matching.
- Don't use env var names starting with `CLAUDE_`, because Claude Code itself sets some of them.
