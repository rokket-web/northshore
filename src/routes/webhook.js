const express = require('express');
const config = require('../config');
const { renderSurveyPdf } = require('../services/pdfService');
const { uploadSurveyPdf, createSharingLink } = require('../services/sharepointService');
const { findMatchingPerson, updateProfileFields, addAssessmentNote } = require('../services/pcoService');
const { sendUnmatchedAlert } = require('../services/mailService');

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
    return res.status(422).json({ error: 'submission is missing an email address, cannot match to a PCO profile' });
  }

  try {
    const pdfBuffer = await renderSurveyPdf(submission);
    const filename = buildFilename(submission);
    const driveItem = await uploadSurveyPdf(filename, pdfBuffer);
    const pdfLink = await createSharingLink(driveItem.id);

    const match = await findMatchingPerson(submission.email, submission.name);

    if (match.status !== 'matched') {
      const reason =
        match.status === 'none'
          ? 'No PCO person found with this email address.'
          : `Email matched ${match.candidates.length} different people, and the submitted name didn't narrow it to one.`;
      console.warn(`[webhook] ${reason} (${submission.email})`);
      await sendUnmatchedAlert(submission, reason, match.candidates);
      return res.status(202).json({ status: `pdf_saved_${match.status}_match`, filename, pdfLink });
    }

    const person = match.person;

    const topGifts = Array.isArray(submission.topGifts) ? submission.topGifts.slice(0, 5) : [];
    const topRoles = Array.isArray(submission.topRoles)
      ? submission.topRoles.slice(0, 5).map((r) => `${r.team} (${r.score}%)`).join(', ')
      : '';

    await updateProfileFields(person.id, {
      topGifts: topGifts.join(', '),
      topRoles,
      dayJob: submission.dayJobSkill,
      volunteerExperience: submission.volunteerExperience,
      pdfLink,
    });
    await addAssessmentNote(person.id, {
      topGifts,
      topRoles,
      dayJob: submission.dayJobSkill,
      volunteerExperience: submission.volunteerExperience,
      pdfLink,
      submittedAt: submission.submittedAt,
    });

    return res.status(200).json({ status: 'ok', filename, pcoPersonId: person.id, pdfLink });
  } catch (err) {
    console.error('[webhook] survey processing failed:', err);
    return res.status(500).json({ error: 'processing failed' });
  }
});

module.exports = router;
