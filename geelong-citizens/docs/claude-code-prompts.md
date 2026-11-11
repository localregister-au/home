# Building Geelong Citizens on your Mac with Claude Code

Paste these prompts into Claude Code **one at a time**, in order. After each one:
- try the result in your browser
- ask Claude to fix anything that's off
- say **"commit this"** before moving on.

For the bigger prompts (3 onwards), press **Shift+Tab** first to switch to *plan mode*. Claude will show you a plan before writing any code, which makes it easier to steer.

---

## 0. One-time setup (in Terminal)

1. Install Node.js 22 or newer: run `brew install node`, or use the installer from nodejs.org.
2. Install Claude Code. Follow https://code.claude.com/docs, or run:
   `curl -fsSL https://claude.ai/install.sh | bash`
3. You don't need an Anthropic API key. Claude Code uses your normal Claude login, and the app builds letters without AI unless you add a key later.
4. Unzip `geelong-citizens.zip`, then:
   ```bash
   cd ~/Downloads/geelong-citizens   # wherever you unzipped it
   git init && git add -A && git commit -m "Starting point"
   claude
   ```

---

## 1. Get it running

```
Read CLAUDE.md and README.md. Check Node.js 22+ is installed (help me install
it if not). Install the dependencies and create .env from .env.example with
MAIL_TRANSPORT=console. I'm NOT using an Anthropic API key, so leave AI
drafting off. Then start the dev server, open it in my browser, and walk me
through testing the Corio Bay Miniature Railway campaign: build a letter,
edit it, try "Copy a prompt for your AI assistant", and do the "send it for
me" flow using the confirmation link printed in the terminal. Fix anything
that doesn't work on macOS.
```

---

## 2. A real database

```
Replace the in-memory store in src/store.ts with SQLite, using Node's built-in
node:sqlite module (fall back to better-sqlite3 if node:sqlite causes problems).
Keep the database file in ./data (gitignored) and make its path configurable
with DATABASE_PATH. Store pending confirmations and a record of every sent
email (campaign, recipients, subject, body, sender, timestamp, and whether AI
was used). Rate limits can stay in memory. Add a simple migrations setup so we
can add tables later. Keep all existing behaviour and rules from CLAUDE.md.
```

---

## 3. Resident accounts

```
Add resident accounts with passwordless sign-in:
- Register with full name, suburb, postcode and personal email. Verify the
  email with a one-time sign-in link (expires in 30 minutes, single use).
  Store the session in a secure httpOnly SameSite=Lax cookie. No passwords.
- When signed in, name and suburb are filled in automatically on campaign pages.
- Add "My letters", showing the emails they've sent, plus an account page to
  edit details and delete the account. Deleting removes their personal data.
- Add a plain-English privacy page: what we store, why, and how to delete it.
- People who aren't signed in can still use the current flow (their own email
  app, or the confirmation link).
Follow the rules in CLAUDE.md.
```

---

## 4. Personal @geelongcitizens.com addresses

```
Give each verified resident a personal sending address on our domain, e.g.
jane.smith@geelongcitizens.com.
- Generate it from their real name (firstname.lastname, plus a number if it's
  taken). Only lowercase a-z, 0-9 and dots. Users can't pick arbitrary names.
- Block reserved and misleading names: admin, info, contact, support, abuse,
  postmaster, noreply, council, councillor, mayor, mp, minister, premier,
  media, and the names of anyone in our recipient lists. Also block anything
  that looks like an organisation.
- When a signed-in resident sends a letter, send it From "Jane Smith
  <jane.smith@geelongcitizens.com>" with Reply-To set to the same address,
  and CC their personal email. They're already verified, so they just press
  Send (no confirmation email).
- Keep the footer saying it was sent by a verified resident using
  geelongcitizens.com, and that it was AI-assisted if it was.
- Add a per-user limit of 10 emails a day.
Explain what DNS/SPF/DKIM/DMARC setup this needs so mail from these addresses
doesn't land in spam.
```

---

## 5. Receive replies from MPs and councillors

```
Make replies to residents' @geelongcitizens.com addresses reach them.
- Recommend an email provider that supports both sending and inbound email
  webhooks (e.g. Postmark or Mailgun), explain why, and list the MX records I
  need to add for geelongcitizens.com.
- Add an inbound webhook endpoint that verifies the provider's signature, finds
  the resident by address, saves the reply against the original letter, and
  forwards it to their personal email.
- Show replies under each letter in "My letters", with a button to reply from
  their @geelongcitizens.com address (same review-then-send flow).
- Silently drop mail to unknown addresses. Don't forward spam: use the
  provider's spam score.
- On each campaign page, show counts of letters sent and replies received
  (counts only, no personal details).
```

---

## 6. Write your own letter (no campaign needed)

```
Add a "Write to your representatives" page for residents' own issues, not just
organised campaigns.
- Create data/representatives.json listing City of Greater Geelong councillors
  (with their wards), Victorian state MPs and federal MPs whose electorates
  cover Greater Geelong, with names, roles, salutations and official email
  addresses. Get these from the official council, Parliament of Victoria and
  Australian Parliament websites. Add a "source" URL and "last_checked" date
  to each entry, and flag anything you're unsure of so I can check it.
- Add a suburb/postcode lookup that shows the resident who represents them at
  each level (council ward, state, federal). Let them choose who to write to.
- The resident describes the issue in their own words, and optionally what
  they'd like done. Build the letter the same way campaign letters are built
  (template, plus the optional "copy a prompt for your AI assistant" button,
  and Claude drafting only if an API key is set), following the same rules.
  Then the same review-and-send flow.
```

---

## 7. Admin and safety

```
Add an admin area, available only to signed-in users whose email is listed in
ADMIN_EMAILS:
- create, edit, close and preview campaigns, stored in the database (keep the
  campaigns/*.json import for seeding)
- see per-campaign counts of letters, replies and AI-assisted vs self-written
- suspend a resident (blocks sending and their address)
- a "report abuse" link in every email footer that goes to a form, with
  reports listed in admin.
Log admin actions with who did what and when.
```

---

## 8. Go live

```
Help me deploy this to Render (or recommend something simpler if there is
one) with a persistent disk for the SQLite database. Give me a step-by-step
checklist covering: environment variables, connecting geelongcitizens.com,
HTTPS, the DNS records for sending (SPF, DKIM, DMARC) and receiving (MX), and
database backups. Then help me send a test letter to my own Gmail and Outlook
addresses and check it doesn't land in spam.
```

---

### Tips
- You don't need an API key. If you ever add one, put it in `.env` yourself and never paste it into the chat.
- **"Explain what you just changed in plain English"** is a useful follow-up after any prompt.
- Before launching a campaign, check the recipients' email addresses against the official websites yourself.
