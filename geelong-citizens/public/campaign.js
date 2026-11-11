const $ = (id) => document.getElementById(id);
const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] ?? "");
let campaign;
let config = { sendingEnabled: false };
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

function writeMyself() {
  const problem = validateBasics();
  if (problem) return showError($("draft-error"), problem);
  showError($("draft-error"), "");
  const greeting = selectedRecipients().map((r) => r.name).join(" and ");
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
$("send-btn").addEventListener("click", sendForMe);
$("subject").addEventListener("input", updateLinks);
$("body").addEventListener("input", updateLinks);
document.addEventListener("change", (e) => { if (e.target.name === "recipient" && !$("review").classList.contains("hidden")) openReview($("subject").value, $("body").value); });

load();
