const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "");
let campaign;
let config = { sendingEnabled: false, aiDrafting: false };
let variant = Math.floor(Math.random() * 3);
let aiAssisted = false;

function show(el, on = true) { el.classList.toggle("hidden", !on); }
function showError(el, msg) { el.textContent = msg; show(el, !!msg); }

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function checkbox(name, value, labelText, small, checked) {
  const label = document.createElement("label");
  label.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = checked;
  const span = document.createElement("span");
  span.textContent = labelText;
  if (small) {
    const s = document.createElement("small");
    s.textContent = small;
    span.append(s);
  }
  label.append(input, span);
  return label;
}

const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
const selectedRecipients = () => campaign.recipients.filter((r) => checked("recipient").includes(r.id));

async function load() {
  try {
    [campaign, config] = await Promise.all([api(`/api/campaigns/${encodeURIComponent(slug)}`), api("/api/config")]);
  } catch (e) {
    show($("loading"), false);
    return showError($("load-error"), e.message);
  }
  document.title = `${campaign.title} · Geelong Citizens`;
  $("title").textContent = campaign.title;
  $("organiser").textContent = `Campaign by ${campaign.organiser.name}`;
  $("summary").textContent = campaign.summary;
  $("ask").textContent = campaign.ask;
  for (const r of campaign.recipients) $("recipients").append(checkbox("recipient", r.id, r.name, r.role, true));
  for (const reason of campaign.reasons) $("reasons").append(checkbox("reason", reason, reason, "", false));
  if (campaign.status !== "active") {
    show($("closed"));
    show($("draft-form"), false);
  }
  show($("loading"), false);
  show($("campaign"));
}

function draftRequest() {
  return {
    name: $("name").value,
    suburb: $("suburb").value,
    reasons: checked("reason"),
    personalNote: $("note").value,
    tone: $("tone").value,
    recipientIds: checked("recipient"),
  };
}

function validateBasics() {
  if (!checked("recipient").length) return "Choose at least one person to email.";
  if (!$("name").value.trim()) return "Please enter your name.";
  return "";
}

async function draft(btn) {
  const problem = validateBasics();
  if (problem) return showError($("draft-error"), problem);
  if (!checked("reason").length && !$("note").value.trim()) {
    return showError($("draft-error"), "Tick at least one reason or write a sentence in your own words.");
  }
  showError($("draft-error"), "");
  if (!config.aiDrafting) {
    if (btn.id === "redraft-btn") variant++;
    aiAssisted = false;
    const d = templateLetter();
    return openReview(d.subject, d.body);
  }
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Writing…";
  try {
    const d = await api(`/api/campaigns/${encodeURIComponent(slug)}/draft`, draftRequest());
    aiAssisted = true;
    openReview(d.subject, d.body);
  } catch (e) {
    showError(btn.id === "redraft-btn" ? $("send-error") : $("draft-error"), e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const sentence = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const joinNames = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Builds a letter from the supporter's own reasons and words, without AI. */
function templateLetter() {
  const name = $("name").value.trim();
  const suburb = $("suburb").value.trim();
  const note = $("note").value.trim();
  const reasons = checked("reason");
  const who = suburb ? `resident of ${suburb}` : "local resident";
  const ask = sentence(lcFirst(campaign.ask));
  const v = variant % 3;

  const opening = [
    `I'm writing as a ${who} to ask you to ${ask}`,
    `As a ${who}, I'd like to ask you to ${ask}`,
    `I'm a ${who}, and I'm writing to ask you to ${ask}`,
  ][v];
  const reasonsIntro = ["This matters to me because:", "My reasons are simple:", "Here's why it matters to me:"][v];
  const closing = [
    "Thank you for taking the time to consider my views. I'd welcome a reply.",
    "Thank you for your time. I'd appreciate hearing where you stand.",
    "I appreciate you reading this, and I'd be glad to hear back from you.",
  ][v];

  const parts = [`Dear ${joinNames(selectedRecipients().map((r) => r.salutation))},`, opening];
  if (note) parts.push(sentence(note));
  if (reasons.length) parts.push(`${note ? "I'd also add:" : reasonsIntro}
${reasons.map((r) => `- ${r}`).join("\n")}`);
  parts.push(closing, `Kind regards,\n${name}${suburb ? `\n${suburb}` : ""}`);
  return { subject: campaign.title, body: parts.join("\n\n") };
}

/** A prompt the supporter can paste into their own AI assistant to polish the letter. */
function aiPrompt() {
  return `Please help me polish this email to my elected representatives.

- Keep it in my voice: first person, Australian English, about 150-220 words.
- Use only the facts in my draft and the background below. Don't add personal details, statistics or claims I haven't made.
- Keep it courteous and don't criticise people who see it differently.
- Reply with just the subject line and the email, as plain text.

Background:
${campaign.background.map((b) => `- ${b}`).join("\n")}

My draft:
Subject: ${$("subject").value}

${$("body").value}`;
}

async function copyAiPrompt() {
  try {
    await navigator.clipboard.writeText(aiPrompt());
    aiAssisted = true;
    $("ai-copy-btn").textContent = "Prompt copied ✓";
    setTimeout(() => ($("ai-copy-btn").textContent = "Copy a prompt for your AI assistant"), 2500);
  } catch {
    showError($("send-error"), "Couldn't copy automatically. Please select and copy the email text instead.");
  }
}

function writeMyself() {
  const problem = validateBasics();
  if (problem) return showError($("draft-error"), problem);
  showError($("draft-error"), "");
  const greeting = joinNames(selectedRecipients().map((r) => r.salutation));
  const suburb = $("suburb").value.trim();
  aiAssisted = false;
  openReview(campaign.title, `Dear ${greeting},\n\n\n\nYours sincerely,\n${$("name").value.trim()}${suburb ? `\n${suburb}` : ""}`);
}

function openReview(subject, body) {
  $("subject").value = subject;
  $("body").value = body;
  const rs = selectedRecipients();
  $("to-line").textContent = `To: ${rs.map((r) => `${r.name} (${r.role})`).join("; ")}`;
  $("addresses").textContent = rs.flatMap((r) => r.emails).join(", ");
  show($("send-for-me"), config.sendingEnabled);
  show($("ai-polish"), !config.aiDrafting);
  show($("send-done"), false);
  showError($("send-error"), "");
  show($("review"));
  updateLinks();
  $("review").scrollIntoView({ behavior: "smooth" });
}

function updateLinks() {
  const to = selectedRecipients().flatMap((r) => r.emails).join(",");
  const subject = $("subject").value;
  const body = $("body").value;
  $("mailto-btn").href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  $("gmail-btn").href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyEmail() {
  const text = `To: ${selectedRecipients().flatMap((r) => r.emails).join(", ")}\nSubject: ${$("subject").value}\n\n${$("body").value}`;
  try {
    await navigator.clipboard.writeText(text);
    $("copy-btn").textContent = "Copied ✓";
    setTimeout(() => ($("copy-btn").textContent = "Copy email"), 2000);
  } catch {
    $("body").select();
  }
}

async function sendForMe() {
  const btn = $("send-btn");
  showError($("send-error"), "");
  const email = $("email").value.trim();
  if (!$("email").checkValidity() || !email) return showError($("send-error"), "Please enter a valid email address.");
  btn.disabled = true;
  try {
    await api(`/api/campaigns/${encodeURIComponent(slug)}/send`, {
      name: $("name").value,
      email,
      suburb: $("suburb").value,
      recipientIds: checked("recipient"),
      subject: $("subject").value,
      body: $("body").value,
      aiAssisted,
    });
    $("send-done").textContent = `Nearly done! We've emailed a confirmation link to ${email}. Open it and press “Send” to send your email. (Check your spam folder if it doesn't arrive.)`;
    show($("send-done"));
  } catch (e) {
    showError($("send-error"), e.message);
  } finally {
    btn.disabled = false;
  }
}

$("draft-form").addEventListener("submit", (e) => { e.preventDefault(); draft($("draft-btn")); });
$("self-btn").addEventListener("click", writeMyself);
$("redraft-btn").addEventListener("click", () => draft($("redraft-btn")));
$("copy-btn").addEventListener("click", copyEmail);
$("ai-copy-btn").addEventListener("click", copyAiPrompt);
$("send-btn").addEventListener("click", sendForMe);
$("subject").addEventListener("input", updateLinks);
$("body").addEventListener("input", updateLinks);
document.addEventListener("change", (e) => { if (e.target.name === "recipient" && !$("review").classList.contains("hidden")) openReview($("subject").value, $("body").value); });

load();
