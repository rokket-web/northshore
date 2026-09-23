const PDFDocument = require('pdfkit');

// Same palette as webflow-quiz/spiritual-gifts-quiz.html's :root CSS variables.
const COLORS = {
  ink: '#231F20',
  inkSoft: '#373743',
  paperRaised: '#FDFCFA',
  line: '#D6D6D6',
  gold: '#D78A5C',
  goldDeep: '#B96C3E',
  tealDeep: '#2A5871',
};

// Keep in sync with DATA.giftColors in webflow-quiz/spiritual-gifts-quiz.html.
const GIFT_COLORS = {
  Leadership: '#D78A5C', Administration: '#B96C3E', Teaching: '#3A7596', Knowledge: '#2A5871',
  Wisdom: '#58586B', Prophecy: '#8A4520', Discernment: '#373743', Exhortation: '#E0A581',
  Shepherding: '#468CB4', Faith: '#484857', Evangelism: '#CE6F37', Apostleship: '#884821',
  Helps: '#1D3A4B', Mercy: '#AD5B2A', Giving: '#5A9BBF', Hospitality: '#292932',
};

const HEADER_FONT = 'Times-BoldItalic'; // closest built-in match to Playfair Display italic
const BODY_FONT = 'Helvetica';
const BODY_BOLD_FONT = 'Helvetica-Bold';

function ensureSpace(doc, height) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + height > bottom) doc.addPage();
}

function drawSectionHeading(doc, title) {
  ensureSpace(doc, 40);
  doc.moveDown(0.8);
  doc.x = doc.page.margins.left;
  doc.font(HEADER_FONT).fontSize(15).fillColor(COLORS.ink).text(title);
  doc.moveDown(0.3);
}

function drawRadar(doc, giftScores) {
  const entries = Object.entries(giftScores);
  if (entries.length < 3) return;

  const n = entries.length;
  const size = 190;
  ensureSpace(doc, size + 20);

  const cx = doc.page.width / 2;
  const cy = doc.y + size / 2;
  const baseR = 12;
  const maxR = size / 2 - 10;

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    doc.circle(cx, cy, baseR + f * maxR).strokeColor(COLORS.line).lineWidth(0.75).stroke();
  });

  const points = entries.map(([, pct], i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = baseR + (Math.max(0, Math.min(100, pct)) / 100) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });

  entries.forEach((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const x2 = cx + (baseR + maxR) * Math.cos(angle);
    const y2 = cy + (baseR + maxR) * Math.sin(angle);
    doc.moveTo(cx, cy).lineTo(x2, y2).strokeColor(COLORS.line).lineWidth(0.75).stroke();
  });

  doc.save();
  doc.polygon(...points);
  doc.fillOpacity(0.3);
  doc.fillAndStroke(COLORS.gold, COLORS.goldDeep);
  doc.restore();

  doc.y = cy + size / 2 + 14;
  doc.x = doc.page.margins.left;
}

function drawGiftBadges(doc, gifts) {
  const startX = doc.page.margins.left;
  const maxX = doc.page.width - doc.page.margins.right;
  const rowHeight = 20;
  const paddingX = 10;
  const gap = 8;

  ensureSpace(doc, rowHeight + 6);
  let x = startX;
  let y = doc.y;

  gifts.forEach((gift) => {
    doc.font(BODY_BOLD_FONT).fontSize(9.5);
    const boxWidth = doc.widthOfString(gift) + paddingX * 2;
    if (x + boxWidth > maxX) {
      x = startX;
      y += rowHeight + 6;
      ensureSpace(doc, rowHeight + 6);
    }
    const color = GIFT_COLORS[gift] || COLORS.tealDeep;
    doc.roundedRect(x, y, boxWidth, rowHeight, rowHeight / 2).fill(color);
    doc.fillColor('#FFFFFF').text(gift, x + paddingX, y + 5.5, { lineBreak: false });
    x += boxWidth + gap;
  });

  doc.y = y + rowHeight + 12;
  doc.x = doc.page.margins.left;
}

function drawGiftScoreBars(doc, giftScores) {
  const entries = Object.entries(giftScores).sort((a, b) => b[1] - a[1]);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const nameWidth = 115;
  const pctWidth = 34;
  const trackX = left + nameWidth + 8;
  const trackWidth = right - trackX - pctWidth - 8;
  const rowHeight = 16;

  entries.forEach(([gift, pct]) => {
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;

    doc.font(BODY_BOLD_FONT).fontSize(9.5).fillColor(COLORS.ink)
      .text(gift, left, y + 2, { width: nameWidth, lineBreak: false });

    doc.roundedRect(trackX, y, trackWidth, 8, 4).fill(COLORS.line);
    const fillWidth = Math.max(4, (Math.max(0, Math.min(100, pct)) / 100) * trackWidth);
    doc.roundedRect(trackX, y, fillWidth, 8, 4).fill(GIFT_COLORS[gift] || COLORS.tealDeep);

    doc.font(BODY_FONT).fontSize(9).fillColor(COLORS.inkSoft)
      .text(`${pct}%`, trackX + trackWidth + 8, y + 1, { width: pctWidth, align: 'right', lineBreak: false });

    doc.y = y + rowHeight + 4;
    doc.x = doc.page.margins.left;
  });
}

function drawTypeChip(doc, label, bgColor) {
  ensureSpace(doc, 40);
  doc.font(HEADER_FONT).fontSize(16);
  const paddingX = 16;
  const boxWidth = doc.widthOfString(label) + paddingX * 2;
  const boxHeight = 30;
  const x = doc.page.margins.left;
  const y = doc.y;

  doc.roundedRect(x, y, boxWidth, boxHeight, 8).fill(bgColor);
  doc.fillColor('#FFFFFF').text(label, x + paddingX, y + 7, { lineBreak: false });

  doc.y = y + boxHeight + 10;
  doc.x = doc.page.margins.left;
}

function drawRoleCard(doc, role, rank) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const paddingX = 14;
  const paddingY = 12;
  const contentWidth = width - paddingX * 2;
  const titleWidth = contentWidth - 60;

  doc.font(HEADER_FONT).fontSize(13);
  const titleHeight = doc.heightOfString(role.team, { width: titleWidth });
  doc.font(BODY_FONT).fontSize(9.5);
  const descHeight = role.desc ? doc.heightOfString(role.desc, { width: contentWidth }) : 0;

  const cardHeight = paddingY * 2 + 14 + 4 + titleHeight + (descHeight ? 6 + descHeight : 0);
  ensureSpace(doc, cardHeight + 12);

  const y = doc.y;
  doc.roundedRect(left, y, width, cardHeight, 10).fillAndStroke(COLORS.paperRaised, COLORS.line);

  doc.font(BODY_BOLD_FONT).fontSize(8.5).fillColor(COLORS.goldDeep)
    .text(`MATCH #${rank}`, left + paddingX, y + paddingY, { lineBreak: false, characterSpacing: 0.5 });

  const scoreLabel = `${role.score}%`;
  doc.font(HEADER_FONT).fontSize(15).fillColor(COLORS.goldDeep);
  const scoreWidth = doc.widthOfString(scoreLabel);
  doc.text(scoreLabel, left + width - paddingX - scoreWidth, y + paddingY - 3, { lineBreak: false });

  doc.font(HEADER_FONT).fontSize(13).fillColor(COLORS.ink)
    .text(role.team, left + paddingX, y + paddingY + 16, { width: titleWidth });

  if (role.desc) {
    doc.font(BODY_FONT).fontSize(9.5).fillColor(COLORS.inkSoft)
      .text(role.desc, left + paddingX, y + paddingY + 16 + titleHeight + 6, { width: contentWidth });
  }

  doc.y = y + cardHeight + 12;
  doc.x = doc.page.margins.left;
}

function drawLabeledLine(doc, label, value) {
  ensureSpace(doc, 20);
  doc.x = doc.page.margins.left;
  doc.font(BODY_BOLD_FONT).fontSize(10.5).fillColor(COLORS.ink).text(`${label}: `, { continued: true });
  doc.font(BODY_FONT).fillColor(COLORS.inkSoft).text(value);
}

/**
 * Renders a spiritual gifts assessment submission as a PDF styled to resemble the
 * quiz's results screen (radar chart, gift badges/bars, DISC/MBTI chips, role cards).
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

    doc.font(BODY_BOLD_FONT).fontSize(9.5).fillColor(COLORS.goldDeep)
      .text('COMPLETE', { characterSpacing: 1.2 });
    doc.moveDown(0.2);
    doc.font(HEADER_FONT).fontSize(22).fillColor(COLORS.ink)
      .text(`${submission.name ? `${submission.name}'s` : 'Your'} Gift & Service Profile`);
    doc.moveDown(0.2);
    const dateStr = (submission.submittedAt || new Date().toISOString()).slice(0, 10);
    doc.font(BODY_FONT).fontSize(10).fillColor(COLORS.inkSoft)
      .text(`Submitted ${dateStr}${submission.email ? ` · ${submission.email}` : ''}`);
    doc.moveDown(0.8);

    if (submission.giftScores && Object.keys(submission.giftScores).length > 0) {
      drawSectionHeading(doc, 'Your Top Spiritual Gifts');
      drawRadar(doc, submission.giftScores);
      if (Array.isArray(submission.topGifts) && submission.topGifts.length > 0) {
        drawGiftBadges(doc, submission.topGifts);
      }
      drawGiftScoreBars(doc, submission.giftScores);
    }

    if (submission.disc?.letter || submission.mbti?.type) {
      drawSectionHeading(doc, 'Personality Snapshot');
      if (submission.disc?.letter) drawTypeChip(doc, submission.disc.letter, COLORS.ink);
      if (submission.mbti?.type) drawTypeChip(doc, submission.mbti.type, COLORS.tealDeep);
    }

    if (Array.isArray(submission.topRoles) && submission.topRoles.length > 0) {
      drawSectionHeading(doc, 'Roles That Fit You Well');
      submission.topRoles.slice(0, 6).forEach((role, i) => drawRoleCard(doc, role, i + 1));
    }

    const practical = [
      ['Availability', submission.schedule],
      ['Skills / interests', submission.skills],
      ['Faith story', submission.faithStory],
    ].filter(([, list]) => Array.isArray(list) && list.length > 0);

    if (practical.length > 0) {
      drawSectionHeading(doc, 'Practical Details');
      practical.forEach(([label, list]) => drawLabeledLine(doc, label, list.join(', ')));
    }

    if (submission.dayJobSkill || submission.volunteerExperience) {
      drawSectionHeading(doc, 'Additional Notes');
      if (submission.dayJobSkill) drawLabeledLine(doc, 'Professional skill offered', submission.dayJobSkill);
      if (submission.volunteerExperience) drawLabeledLine(doc, 'Previous volunteer experience', submission.volunteerExperience);
    }

    if (submission.pastorRequest) {
      drawSectionHeading(doc, 'Pastor Follow-up Requested');
      doc.font(BODY_FONT).fontSize(10.5).fillColor(COLORS.ink)
        .text(submission.pastorNote || '(no additional note provided)');
    }

    doc.end();
  });
}

module.exports = { renderSurveyPdf };
