const PDFDocument = require('pdfkit');

function section(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#000').text(title, { underline: true });
  doc.moveDown(0.3);
}

/**
 * Renders a spiritual gifts assessment submission as a PDF.
 * See webflow-quiz/spiritual-gifts-quiz.html buildSurveyPayload() for the input shape.
 *
 * @param {object} submission
 * @returns {Promise<Buffer>}
 */
function renderSurveyPdf(submission) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Spiritual Gifts & Volunteer Match', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#555').text(`Submitted: ${submission.submittedAt || new Date().toISOString()}`);
    if (submission.name) doc.text(`Name: ${submission.name}`);
    if (submission.email) doc.text(`Email: ${submission.email}`);

    if (Array.isArray(submission.topGifts) && submission.topGifts.length > 0) {
      section(doc, 'Top Spiritual Gifts');
      doc.fontSize(11).fillColor('#000');
      submission.topGifts.forEach((gift) => {
        const pct = submission.giftScores?.[gift];
        doc.text(`- ${gift}${pct !== undefined ? ` (${pct}%)` : ''}`);
      });
    }

    if (submission.giftScores && Object.keys(submission.giftScores).length > 0) {
      section(doc, 'Full Gift Scores');
      doc.fontSize(10).fillColor('#333');
      Object.entries(submission.giftScores)
        .sort((a, b) => b[1] - a[1])
        .forEach(([gift, pct]) => doc.text(`${gift}: ${pct}%`));
    }

    if (submission.disc || submission.mbti) {
      section(doc, 'Personality Snapshot');
      doc.fontSize(11).fillColor('#000');
      if (submission.disc?.letter) doc.text(`DISC style: ${submission.disc.letter}`);
      if (submission.mbti?.type) doc.text(`MBTI type: ${submission.mbti.type}`);
    }

    if (Array.isArray(submission.topRoles) && submission.topRoles.length > 0) {
      section(doc, 'Top Matched Volunteer Roles');
      doc.fontSize(11).fillColor('#000');
      submission.topRoles.forEach((r) => doc.text(`- ${r.team} (${r.score}%)`));
    }

    const practical = [
      ['Availability', submission.schedule],
      ['Skills / interests', submission.skills],
      ['Faith story', submission.faithStory],
    ].filter(([, list]) => Array.isArray(list) && list.length > 0);

    if (practical.length > 0) {
      section(doc, 'Practical Details');
      doc.fontSize(11).fillColor('#000');
      practical.forEach(([label, list]) => doc.text(`${label}: ${list.join(', ')}`));
    }

    if (submission.dayJobSkill || submission.volunteerExperience) {
      section(doc, 'Additional Notes');
      doc.fontSize(11).fillColor('#000');
      if (submission.dayJobSkill) doc.text(`Professional skill offered: ${submission.dayJobSkill}`);
      if (submission.volunteerExperience) doc.text(`Previous volunteer experience: ${submission.volunteerExperience}`);
    }

    if (submission.pastorRequest) {
      section(doc, 'Pastor Follow-up Requested');
      doc.fontSize(11).fillColor('#000');
      doc.text(submission.pastorNote || '(no additional note provided)');
    }

    doc.end();
  });
}

module.exports = { renderSurveyPdf };
