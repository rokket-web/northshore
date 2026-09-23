const config = require('../config');
const { getGraphClient } = require('./graphClient');

/**
 * Sends mail via Microsoft Graph, from the mailbox configured as MAIL_SENDER_UPN.
 * Requires the app registration to have the application permission Mail.Send —
 * see README for the Exchange Application Access Policy needed to scope this to
 * one mailbox instead of every mailbox in the tenant.
 */
async function sendMail({ to, subject, body }) {
  if (!config.mail.senderUpn || !to) return;

  const client = getGraphClient();
  await client.api(`/users/${config.mail.senderUpn}/sendMail`).post({
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    },
  });
}

/**
 * Alerts staff that a survey submission couldn't be confidently matched to exactly
 * one PCO person, so it doesn't just silently vanish into a server log.
 */
async function sendUnmatchedAlert(submission, reason, candidates = []) {
  if (!config.mail.staffAlertEmail) {
    console.warn('[mail] STAFF_ALERT_EMAIL not set — skipping unmatched-submission alert.');
    return;
  }

  const lines = [
    `A spiritual gifts quiz submission could not be matched to exactly one Planning Center profile.`,
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

  lines.push(``, `The generated PDF was still saved to SharePoint under this person's name/date.`);

  await sendMail({
    to: config.mail.staffAlertEmail,
    subject: `Spiritual Gifts quiz: needs manual PCO match (${submission.name || submission.email || 'unknown'})`,
    body: lines.join('\n'),
  });
}

/**
 * Notifies staff that someone completed the quiz and their PCO profile was updated —
 * sent on every successful "Complete My Profile" submission, not just failures, so
 * staff see every completion rather than only the ones that needed manual review.
 */
async function sendCompletionAlert(submission, { person, pdfLink, topGifts, topRoles, dayJob, volunteerExperience }) {
  if (!config.mail.staffAlertEmail) {
    console.warn('[mail] STAFF_ALERT_EMAIL not set — skipping completion notification.');
    return;
  }

  const lines = [
    `${submission.name || 'Someone'} completed the Spiritual Gifts & Volunteer Match quiz — their Planning Center profile has been updated.`,
    ``,
    `Name: ${submission.name || '(not given)'}`,
    `Email: ${submission.email}`,
    `PCO person id: ${person.id}`,
    `Submitted at: ${submission.submittedAt || '(unknown)'}`,
  ];

  if (topGifts?.length) lines.push(``, `Top gifts: ${topGifts.join(', ')}`);
  if (topRoles) lines.push(`Top volunteer matches: ${topRoles}`);
  if (dayJob) lines.push(`Day job / professional skill: ${dayJob}`);
  if (volunteerExperience) lines.push(`Previous volunteer experience: ${volunteerExperience}`);
  if (pdfLink) lines.push(``, `Full results PDF: ${pdfLink}`);
  else lines.push(``, `(PDF link not available yet — SharePoint upload may not be configured.)`);

  await sendMail({
    to: config.mail.staffAlertEmail,
    subject: `Spiritual Gifts quiz completed: ${submission.name || submission.email}`,
    body: lines.join('\n'),
  });
}

module.exports = { sendMail, sendUnmatchedAlert, sendCompletionAlert };
