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
  const labelFontSize = 7.5;
  const labelGap = 8;

  doc.font(BODY_FONT).fontSize(labelFontSize);
  const labelWidths = entries.map(([gift]) => doc.widthOfString(gift));

  ensureSpace(doc, size + labelFontSize * 2 + 24);

  const cx = doc.page.width / 2;
  const cy = doc.y + size / 2 + labelFontSize;
  const baseR = 12;
  const maxR = size / 2 - 10;
  const labelR = baseR + maxR + labelGap;

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

  // Gift name around each spoke, anchored so the label sits outside the ring without
  // crossing over it: right-side spokes left-align, left-side right-align, top/bottom center.
  doc.font(BODY_FONT).fontSize(labelFontSize).fillColor(COLORS.inkSoft);
  entries.forEach(([gift], i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const lx = cx + labelR * Math.cos(angle);
    const ly = cy + labelR * Math.sin(angle);
    const cosA = Math.cos(angle);
    const w = labelWidths[i];

    let x;
    if (cosA > 0.15) x = lx;
    else if (cosA < -0.15) x = lx - w;
    else x = lx - w / 2;

    doc.text(gift, x, ly - labelFontSize / 2, { lineBreak: false });
  });

  doc.y = cy + size / 2 + labelGap + labelFontSize + 10;
  doc.x = doc.page.margins.left;
}

function drawGiftBadges(doc, gifts) {
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowHeight = 20;
  const paddingX = 10;
  const gap = 8;

  doc.font(BODY_BOLD_FONT).fontSize(9.5);
  const widths = gifts.map((gift) => doc.widthOfString(gift) + paddingX * 2);

  // Group into rows first so each row's total width is known, then center that row —
  // rather than left-aligning and wrapping, which is what a running x/maxX check gives you.
  const rows = [];
  let row = [];
  let rowWidth = 0;
  gifts.forEach((gift, i) => {
    const w = widths[i];
    const needed = row.length ? rowWidth + gap + w : w;
    if (needed > contentWidth && row.length) {
      rows.push(row);
      row = [{ gift, w }];
      rowWidth = w;
    } else {
      row.push({ gift, w });
      rowWidth = needed;
    }
  });
  if (row.length) rows.push(row);

  ensureSpace(doc, rows.length * (rowHeight + 6));
  let y = doc.y;

  rows.forEach((r) => {
    const totalWidth = r.reduce((sum, item) => sum + item.w, 0) + gap * (r.length - 1);
    let x = left + (contentWidth - totalWidth) / 2;
    r.forEach(({ gift, w }) => {
      const color = GIFT_COLORS[gift] || COLORS.tealDeep;
      doc.roundedRect(x, y, w, rowHeight, rowHeight / 2).fill(color);
      doc.fillColor('#FFFFFF').text(gift, x + paddingX, y + 5.5, { lineBreak: false });
      x += w + gap;
    });
    y += rowHeight + 6;
  });

  doc.y = y + 6;
  doc.x = doc.page.margins.left;
}

// One block per top gift: name (colored, matching its badge) then its definition —
// same content as the web results screen shows under the radar, just laid out for print.
function drawGiftDefinitions(doc, gifts, giftDefs) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  gifts.forEach((gift) => {
    const def = giftDefs?.[gift];
    if (!def) return;

    doc.font(BODY_BOLD_FONT).fontSize(10);
    const nameHeight = doc.heightOfString(gift, { width });
    doc.font(BODY_FONT).fontSize(9.5);
    const defHeight = doc.heightOfString(def, { width });
    ensureSpace(doc, nameHeight + defHeight + 12);

    doc.font(BODY_BOLD_FONT).fontSize(10).fillColor(GIFT_COLORS[gift] || COLORS.tealDeep)
      .text(gift, left, doc.y, { width });
    doc.font(BODY_FONT).fontSize(9.5).fillColor(COLORS.inkSoft)
      .text(def, left, doc.y + 2, { width });
    doc.moveDown(0.7);
    doc.x = doc.page.margins.left;
  });
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

function drawTypeChip(doc, label, bgColor, description) {
  ensureSpace(doc, 40);
  doc.font(HEADER_FONT).fontSize(16);
  const paddingX = 16;
  const boxWidth = doc.widthOfString(label) + paddingX * 2;
  const boxHeight = 30;
  const x = doc.page.margins.left;
  const y = doc.y;

  doc.roundedRect(x, y, boxWidth, boxHeight, 8).fill(bgColor);
  doc.fillColor('#FFFFFF').text(label, x + paddingX, y + 7, { lineBreak: false });

  doc.y = y + boxHeight + 8;
  doc.x = doc.page.margins.left;

  if (description) {
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font(BODY_FONT).fontSize(10);
    const descHeight = doc.heightOfString(description, { width });
    ensureSpace(doc, descHeight + 14);
    doc.fillColor(COLORS.inkSoft).text(description, doc.page.margins.left, doc.y, { width });
    doc.moveDown(0.6);
  } else {
    doc.moveDown(0.3);
  }
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

    const hasGiftScores = submission.giftScores && Object.keys(submission.giftScores).length > 0;
    if (hasGiftScores) {
      drawSectionHeading(doc, 'Your Top Spiritual Gifts');
      drawRadar(doc, submission.giftScores);
      if (Array.isArray(submission.topGifts) && submission.topGifts.length > 0) {
        drawGiftBadges(doc, submission.topGifts);
        drawGiftDefinitions(doc, submission.topGifts, submission.giftDefs);
      }

      // Always its own page — unconditional, not just "whenever it happens to fit" —
      // so the full 16-gift score list always reads as its own section.
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.font(HEADER_FONT).fontSize(11).fillColor(COLORS.inkSoft).text('Spiritual Gifts Continued');
      doc.moveDown(0.5);
      doc.x = doc.page.margins.left;

      drawGiftScoreBars(doc, submission.giftScores);
    }

    if (submission.disc?.letter || submission.mbti?.type) {
      // Always its own page after the gifts section — the score bar list runs long
      // enough that squeezing this in below it (whenever it happens to fit) reads
      // cramped rather than as a new section.
      if (hasGiftScores) {
        doc.addPage();
        doc.x = doc.page.margins.left;
      }
      drawSectionHeading(doc, 'Personality Snapshot');
      if (submission.disc?.letter) drawTypeChip(doc, submission.disc.letter, COLORS.ink, submission.disc.blurb);
      if (submission.mbti?.type) {
        drawTypeChip(
          doc,
          submission.mbti.type,
          COLORS.tealDeep,
          'This is a light-touch snapshot, not a clinical assessment — it’s here to help color which roles might energize you rather than drain you.'
        );
      }
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
