const express = require('express');
const config = require('../config');
const { renderSurveyPdf } = require('../services/pdfService');
const { uploadSurveyPdf, createSharingLink } = require('../services/sharepointService');
const { findMatchingPerson, updateProfileFields, addAssessmentNote, uploadFile } = require('../services/pcoService');
const { sendUnmatchedAlert, sendCompletionAlert } = require('../services/mailService');
const activityLog = require('../services/activityLog');

const router = express.Router();

function verifyWebhookSecret(req) {
  if (!config.webflow.webhookSecret) return true; // not configured yet — allow through
  return req.get('x-webhook-secret') === config.webflow.webhookSecret;
}

function buildFilename(submission) {
  const namePart = (submission.name || 'Unknown').trim().replace(/[^a-z0-9]+/gi, '_') || 'Unknown';
  const datePart = (submission.submittedAt || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  return `${namePart}_Spiritual_Gifts_${datePart}.pdf`;
}

// Body shape posted by webflow-quiz/spiritual-gifts-quiz.html's buildSurveyPayload():
// { submittedAt, name, email, giftScores, topGifts, disc, mbti, topRoles, schedule,
//   skills, faithStory, under18, dayJobSkill, volunteerExperience, pastorRequest, pastorNote }
router.post('/survey', express.json({ limit: '1mb' }), async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }

  const submission = req.body || {};

  if (!submission.email) {
    activityLog.record({ name: submission.name, email: submission.email, status: 'rejected', detail: 'missing email' });
    return res.status(422).json({ error: 'submission is missing an email address, cannot match to a PCO profile' });
  }

  try {
    const pdfBuffer = await renderSurveyPdf(submission);
    const filename = buildFilename(submission);

    // SharePoint copy, for the shared-directory requirement — independent of PCO, and
    // not required for "Full Assessment" to work (that's the PCO file upload below).
    // Not fatal: a temporary Azure/SharePoint problem shouldn't block the rest.
    let sharePointLink = null;
    try {
      const driveItem = await uploadSurveyPdf(filename, pdfBuffer);
      sharePointLink = await createSharingLink(driveItem.id);
    } catch (err) {
      console.warn('[webhook] SharePoint upload failed — continuing without it:', err.message);
    }

    const match = await findMatchingPerson(submission.email, submission.name);

    if (match.status !== 'matched') {
      const reason =
        match.status === 'none'
          ? 'No PCO person found with this email address.'
          : `Email matched ${match.candidates.length} different people, and the submitted name didn't narrow it to one.`;
      console.warn(`[webhook] ${reason} (${submission.email})`);
      await sendUnmatchedAlert(submission, reason, match.candidates);
      activityLog.record({ name: submission.name, email: submission.email, status: match.status, detail: reason, filename, pdfLink: sharePointLink });
      return res.status(202).json({ status: `pdf_saved_${match.status}_match`, filename, pdfLink: sharePointLink });
    }

    const person = match.person;

    // The "Full Assessment" custom field in PCO is a File-upload field, not a link field,
    // so it needs an actual PCO file id — uploaded via PCO's own file service, using the
    // same PCO credentials as everything else (no Azure/SharePoint involved). Not fatal:
    // the other fields below still get written even if this one upload fails.
    let pcoFileId = null;
    try {
      pcoFileId = await uploadFile(pdfBuffer, filename, 'application/pdf');
    } catch (err) {
      console.warn('[webhook] PCO file upload failed — "Full Assessment" will be left blank:', err.message);
    }

    const topGifts = Array.isArray(submission.topGifts) ? submission.topGifts.slice(0, 5) : [];
    const topRoles = Array.isArray(submission.topRoles) ? submission.topRoles.slice(0, 5) : [];
    const topRoleNames = topRoles.map((r) => r.team);
    const topRolesSummary = topRoles.map((r) => `${r.team} (${r.score}%)`).join(', ');

    await updateProfileFields(person.id, {
      topGifts,
      topRoles: topRoleNames,
      dayJob: submission.dayJobSkill,
      volunteerExperience: submission.volunteerExperience,
      pdfLink: pcoFileId,
    });

    // Human-readable reference for the Note/email — prefer the SharePoint link when it
    // exists, otherwise just say the file's attached directly to the profile.
    const pdfReference = sharePointLink || (pcoFileId ? '(attached directly to the "Full Assessment" field on their profile)' : null);

    // The field writes above are the important part and already succeeded by this point —
    // a problem adding the history note shouldn't turn that into a failed request.
    try {
      await addAssessmentNote(person.id, {
        topGifts,
        topRoles: topRolesSummary,
        dayJob: submission.dayJobSkill,
        volunteerExperience: submission.volunteerExperience,
        pdfLink: pdfReference,
        submittedAt: submission.submittedAt,
      });
    } catch (err) {
      console.warn('[webhook] adding history note failed:', err.message);
    }

    // A failed staff notification shouldn't undo the PCO update that already succeeded.
    try {
      await sendCompletionAlert(submission, {
        person,
        pdfLink: pdfReference,
        topGifts,
        topRoles: topRolesSummary,
        dayJob: submission.dayJobSkill,
        volunteerExperience: submission.volunteerExperience,
      });
    } catch (err) {
      console.warn('[webhook] staff completion email failed:', err.message);
    }

    activityLog.record({
      name: submission.name,
      email: submission.email,
      status: 'matched',
      pcoPersonId: person.id,
      topGifts,
      topRoles: topRoleNames,
      filename,
      pdfLink: sharePointLink,
      pcoFileAttached: Boolean(pcoFileId),
    });

    return res.status(200).json({ status: 'ok', filename, pcoPersonId: person.id, pdfLink: sharePointLink, pcoFileAttached: Boolean(pcoFileId) });
  } catch (err) {
    console.error('[webhook] survey processing failed:', err);
    activityLog.record({ name: submission.name, email: submission.email, status: 'error', detail: err.message });
    return res.status(500).json({ error: 'processing failed' });
  }
});

module.exports = router;
