import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const mode = process.env.MAIL_TRANSPORT; // "smtp" | "console" | undefined

let transporter: Transporter | null = null;
if (mode === "smtp") {
  const port = Number(process.env.SMTP_PORT ?? 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
} else if (mode === "console") {
  transporter = nodemailer.createTransport({ jsonTransport: true });
}

export const sendingEnabled = transporter !== null;

const fromAddress = process.env.MAIL_FROM_ADDRESS ?? "campaigns@geelongcitizens.com";
const fromName = process.env.MAIL_FROM_NAME ?? "Geelong Citizens";

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  replyTo?: { name: string; address: string };
  /** Display name for the From header. The address is always the site's own. */
  fromDisplayName?: string;
  subject: string;
  text: string;
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (!transporter) throw new Error("Email sending is not configured (set MAIL_TRANSPORT).");
  const info = await transporter.sendMail({
    // Always send from our own domain (so SPF/DKIM/DMARC pass); the resident is in Reply-To.
    from: { name: mail.fromDisplayName ?? fromName, address: fromAddress },
    to: mail.to,
    cc: mail.cc,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
  });
  if (mode === "console") {
    const m = JSON.parse(info.message);
    console.log(
      `\n----- [console mail] -----\nFrom: ${m.from.name} <${m.from.address}>\nTo: ${m.to.map((t: { address: string }) => t.address).join(", ")}` +
        (m.cc ? `\nCc: ${m.cc.map((t: { address: string }) => t.address).join(", ")}` : "") +
        (m.replyTo ? `\nReply-To: ${m.replyTo.map((t: { address: string }) => t.address).join(", ")}` : "") +
        `\nSubject: ${m.subject}\n\n${m.text}\n--------------------------\n`,
    );
  }
}
