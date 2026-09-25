const nodemailer = require('nodemailer');
const config = require('../config');
const { getGraphClient } = require('./graphClient');
const settingsStore = require('./settingsStore');
const emailLog = require('./emailLog');

let smtpTransport;
function getSmtpTransport() {
  if (!smtpTransport) {
    const { host, port, user, pass } = config.mail.smtp;
    smtpTransport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 587 upgrades to TLS via STARTTLS
      auth: { user, pass },
    });
  }
  return smtpTransport;
}

function smtpConfigured() {
  return Boolean(config.mail.smtp.user && config.mail.smtp.pass);
}

function activeTransport() {
  return smtpConfigured() ? 'brevo' : 'graph';
}

/**
 * Sends mail via Brevo SMTP when BREVO_SMTP_KEY is set, otherwise via
 * Microsoft Graph. The From address (MAIL_FROM) must be a sender verified in Brevo.
 * Every attempt is recorded in the email log shown on /dashboard.
 *
 * @param {object} opts
 * @param {string} [opts.kind] label for the email log, e.g. 'unmatched', 'completion', 'test'
 * @param {{filename: string, contentType: string, content: Buffer}} [opts.attachment]
 */
async function sendMail({ to, subject, body, attachment, kind }) {
  const transport = activeTransport();
  if (!to) {
    await emailLog.record({ kind, subject, transport, status: 'skipped', detail: 'No recipient address.' });
    return;
  }

  try {
    const info = transport === 'brevo'
      ? await sendMailViaSmtp({ to, subject, body, attachment })
      : await sendMailViaGraph({ to, subject, body, attachment });
    await emailLog.record({
      kind, to, subject, transport, status: 'sent',
      detail: info?.messageId ? `Accepted by server, message id ${info.messageId}` : 'Accepted by server.',
    });
  } catch (err) {
    await emailLog.record({ kind, to, subject, transport, status: 'failed', detail: err.message });
    throw err;
  }
}

async function sendMailViaSmtp({ to, subject, body, attachment }) {
  if (!config.mail.from) {
    throw new Error('MAIL_FROM is not configured — cannot send mail via Brevo.');
  }
  return getSmtpTransport().sendMail({
    from: config.mail.from,
    to,
    subject,
    text: body,
    attachments: attachment
      ? [{ filename: attachment.filename, contentType: attachment.contentType, content: attachment.content }]
      : undefined,
  });
}

/**
 * Sends mail via Microsoft Graph, from the mailbox configured as MAIL_SENDER_UPN.
 * Requires the app registration to have the application permission Mail.Send —
 * see README for the Exchange Application Access Policy needed to scope this to
 * one mailbox instead of every mailbox in the tenant.
 */
async function sendMailViaGraph({ to, subject, body, attachment }) {
  if (!config.mail.senderUpn) {
    throw new Error('MAIL_SENDER_UPN is not configured — cannot send mail.');
  }

  const message = {
    subject,
    body: { contentType: 'Text', content: body },
    toRecipients: [{ emailAddress: { address: to } }],
  };

  if (attachment) {
    message.attachments = [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.content.toString('base64'),
      },
    ];
  }

  const client = getGraphClient();
  await client.api(`/users/${config.mail.senderUpn}/sendMail`).post({ message });
}

/**
 * Renders every result field from a raw submission into readable text — used when
 * staff will only have the email to go on (no PCO profile with these values), so
 * nothing should be left out of it.
 */
function formatFullResults(submission) {
  const lines = [];

  if (submission.topGifts?.length) {
    lines.push('', 'Top spiritual gifts:');
    submission.topGifts.forEach((gift) => {
      const pct = submission.giftScores?.[gift];
      lines.push(`- ${gift}${pct !== undefined ? ` (${pct}%)` : ''}`);
    });
  }

  if (submission.giftScores && Object.keys(submission.giftScores).length > 0) {
    lines.push('', 'Full gift scores:');
    Object.entries(submission.giftScores)
      .sort((a, b) => b[1] - a[1])
      .forEach(([gift, pct]) => lines.push(`- ${gift}: ${pct}%`));
  }

  if (submission.disc?.letter || submission.mbti?.type) {
    lines.push('', 'Personality snapshot:');
    if (submission.disc?.letter) lines.push(`- DISC style: ${submission.disc.letter}`);
    if (submission.mbti?.type) lines.push(`- MBTI type: ${submission.mbti.type}`);
  }

  if (submission.topRoles?.length) {
    lines.push('', 'Top volunteer matches:');
    submission.topRoles.forEach((r) => lines.push(`- ${r.team} (${r.score}%)${r.desc ? ` — ${r.desc}` : ''}`));
  }

  if (submission.schedule?.length) lines.push('', `Availability: ${submission.schedule.join(', ')}`);
  if (submission.skills?.length) lines.push(`Skills / interests: ${submission.skills.join(', ')}`);
  if (submission.faithStory?.length) lines.push(`Faith story: ${submission.faithStory.join(', ')}`);
  if (submission.dayJobSkill) lines.push('', `Day job / professional skill offered: ${submission.dayJobSkill}`);
  if (submission.volunteerExperience) lines.push(`Previous volunteer experience: ${submission.volunteerExperience}`);

  if (submission.pastorRequest) {
    lines.push(
      '',
      'They checked "I discovered something surprising during this and would like to talk this through with a Northshore Pastor."',
      `Note from them: ${submission.pastorNote || '(no additional note provided)'}`
    );
  }

  return lines;
}

/**
 * Alerts staff that a survey submission couldn't be confidently matched to exactly
 * one PCO person, so it doesn't just silently vanish into a server log. Includes every
 * result field (there's no PCO profile to look them up on yet) and attaches the
 * generated PDF directly, rather than relying on a SharePoint link that may not exist
 * if Azure isn't configured.
 *
 * @param {{filename: string, content: Buffer}} [pdf]
 */
async function sendUnmatchedAlert(submission, reason, candidates = [], pdf) {
  const staffAlertEmail = (await settingsStore.load()).staffAlertEmail;
  if (!staffAlertEmail) {
    console.warn('[mail] No staff alert email set (STAFF_ALERT_EMAIL or /dashboard) — skipping unmatched-submission alert.');
    await emailLog.record({ kind: 'unmatched', transport: activeTransport(), status: 'skipped', detail: 'No staff alert email set (STAFF_ALERT_EMAIL or /dashboard).' });
    return;
  }

  const lines = [
    `A spiritual gifts quiz submission could not be matched to exactly one PCO person.`,
    ``,
    `Reason: ${reason}`,
    `Submitted name: ${submission.name || '(not given)'}`,
    `Submitted email: ${submission.email || '(not given)'}`,
    `Submitted at: ${submission.submittedAt || '(unknown)'}`,
  ];

  if (candidates.length > 0) {
    lines.push(``, `Candidate PCO people (same email, name didn't disambiguate):`);
    candidates.forEach((p) => lines.push(`- ${p.attributes?.name || p.id} (person id ${p.id})`));
  }

  lines.push(...formatFullResults(submission));
  lines.push('', pdf ? 'The full results PDF is attached to this email.' : '(PDF attachment not available.)');

  await sendMail({
    kind: 'unmatched',
    to: staffAlertEmail,
    subject: `Spiritual Gifts quiz: needs manual PCO match (${submission.name || submission.email || 'unknown'})`,
    body: lines.join('\n'),
    attachment: pdf ? { filename: pdf.filename, contentType: 'application/pdf', content: pdf.content } : undefined,
  });
}

/**
 * Notifies staff that someone completed the quiz and their PCO profile was updated —
 * sent on every successful "Complete My Profile" submission, not just failures, so
 * staff see every completion rather than only the ones that needed manual review.
 */
async function sendCompletionAlert(submission, { person, pdfLink, topGifts, topRoles, dayJob, volunteerExperience }) {
  const settings = await settingsStore.load();
  if (!settings.staffAlertEmail) {
    console.warn('[mail] No staff alert email set (STAFF_ALERT_EMAIL or /dashboard) — skipping completion notification.');
    await emailLog.record({ kind: 'completion', transport: activeTransport(), status: 'skipped', detail: 'No staff alert email set (STAFF_ALERT_EMAIL or /dashboard).' });
    return;
  }

  const pastorRequest = Boolean(submission.pastorRequest);

  const lines = [
    pastorRequest
      ? `${submission.name || 'Someone'} completed the Spiritual Gifts & Volunteer Match quiz and asked to talk something through with a pastor.`
      : `${submission.name || 'Someone'} completed the Spiritual Gifts & Volunteer Match quiz — their Planning Center profile has been updated.`,
  ];

  if (settings.completionEmailNote) {
    lines.push('', settings.completionEmailNote);
  }

  lines.push(
    ``,
    `Name: ${submission.name || '(not given)'}`,
    `Email: ${submission.email}`,
    `PCO person id: ${person.id}`,
    `Submitted at: ${submission.submittedAt || '(unknown)'}`
  );

  if (pastorRequest) {
    lines.push(
      ``,
      `They checked "I discovered something surprising during this and would like to talk this through with a Northshore Pastor."`,
      `Note from them:`,
      submission.pastorNote || '(no additional note provided)'
    );
  }

  if (topGifts?.length) lines.push(``, `Top gifts: ${topGifts.join(', ')}`);
  if (topRoles) lines.push(`Top volunteer matches: ${topRoles}`);
  if (dayJob) lines.push(`Day job / professional skill: ${dayJob}`);
  if (volunteerExperience) lines.push(`Previous volunteer experience: ${volunteerExperience}`);
  if (pdfLink) lines.push(``, `Full results PDF: ${pdfLink}`);
  else lines.push(``, `(PDF link not available yet — SharePoint upload may not be configured.)`);

  const subject = pastorRequest
    ? `Pastor follow-up requested: ${submission.name || submission.email}`
    : `Spiritual Gifts quiz completed: ${submission.name || submission.email}`;

  await sendMail({ kind: 'completion', to: settings.staffAlertEmail, subject, body: lines.join('\n') });
}

module.exports = { sendMail, activeTransport, sendUnmatchedAlert, sendCompletionAlert };
