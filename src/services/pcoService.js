const config = require('../config');

const BASE_URL = 'https://api.planningcenteronline.com/people/v2';

function authHeader() {
  const token = Buffer.from(`${config.pco.appId}:${config.pco.secret}`).toString('base64');
  return `Basic ${token}`;
}

async function pcoRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PCO API ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
  }

  return res.status === 204 ? null : res.json();
}

// PCO's generic file-upload service, shared across all their products — separate from
// the people/v2 API above. Returns a short-lived file UUID that must be attached to a
// resource (here, a FieldDatum's value) shortly after upload or it expires unused.
const UPLOAD_URL = 'https://upload.planningcenteronline.com/v2/files';

/**
 * Uploads a file to PCO and returns its file UUID, for use as a FieldDatum value on a
 * File-type custom field (e.g. "Full Assessment"). Uses the same PCO Personal Access
 * Token as everything else in this file — no Azure/SharePoint involved.
 */
async function uploadFile(buffer, filename, contentType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), filename);

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PCO file upload failed: ${res.status} ${body}`);
  }

  const result = await res.json();
  const fileId = result.data?.[0]?.id;
  if (!fileId) throw new Error(`PCO file upload succeeded but returned no file id: ${JSON.stringify(result)}`);
  return fileId;
}

/**
 * Finds the single PCO person matching a submission's email address, disambiguating
 * by name when the email is shared across multiple people (common for spouses or
 * parent/child records that share one household inbox in PCO).
 *
 * Never guesses when it isn't sure — returns a status instead of picking a "closest"
 * match, so the caller can route anything uncertain to a human rather than silently
 * attributing a result to the wrong person.
 *
 * @returns {Promise<{status: 'matched', person: object} | {status: 'none'|'ambiguous', candidates: object[]}>}
 */
async function findMatchingPerson(email, name) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return { status: 'none', candidates: [] };

  const query = new URLSearchParams();
  query.set('where[search_name_or_email_or_phone_number]', normalizedEmail);
  query.set('include', 'emails');

  const result = await pcoRequest(`/people?${query.toString()}`);

  const candidates = (result.data || []).filter((person) =>
    (result.included || [])
      .filter((inc) => inc.type === 'Email' && inc.relationships?.person?.data?.id === person.id)
      .some((inc) => (inc.attributes.address || '').trim().toLowerCase() === normalizedEmail)
  );

  if (candidates.length === 0) return { status: 'none', candidates: [] };
  if (candidates.length === 1) return { status: 'matched', person: candidates[0] };

  const normalizedName = (name || '').trim().toLowerCase();
  if (normalizedName) {
    const nameMatches = candidates.filter(
      (p) => (p.attributes?.name || '').trim().toLowerCase() === normalizedName
    );
    if (nameMatches.length === 1) return { status: 'matched', person: nameMatches[0] };
  }

  return { status: 'ambiguous', candidates };
}

/**
 * Updates standard attributes on a PCO person (e.g. { given_name, last_name, ... }).
 * See https://developer.planning.center/docs/#/apps/people/2025-09-15/vertices/person
 * for the full list of writable attributes.
 */
async function updatePerson(personId, attributes) {
  return pcoRequest(`/people/${personId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: {
        type: 'Person',
        id: personId,
        attributes,
      },
    }),
  });
}

// These must already exist in PCO under People → Configuration → Custom Fields, grouped
// under this tab (create once, by hand — see README). Rename here if you name them
// differently there. Field names aren't guaranteed unique across tabs in PCO, so lookups
// below scope to this tab rather than matching on name alone.
const TAB_NAME = 'Spiritual Gifts';

// One field per rank, so each gift/role gets its own row on the profile instead of one
// comma-joined field. Index 0 = rank 1.
const GIFT_RANK_FIELD_NAMES = ['Spiritual Gift1', 'Spiritual Gift2', 'Spiritual Gift3', 'Spiritual Gift4', 'Spiritual Gift5'];
const ROLE_RANK_FIELD_NAMES = ['Volunteer Job1', 'Volunteer Job2', 'Volunteer Job3', 'Volunteer Job4', 'Volunteer Job5'];

const SINGLE_FIELD_NAMES = {
  dayJob: 'Day Job',
  volunteerExperience: 'Volunteer Experience',
  contactMeVolunteering: 'Contact Me about Volunteering',
  pdfLink: 'Full Assessment',
};

let tabIdPromise;

async function findTabIdByName(name) {
  const query = new URLSearchParams({ 'where[name]': name });
  const result = await pcoRequest(`/tabs?${query.toString()}`);
  const id = result.data?.[0]?.id || null;
  if (!id) {
    console.warn(`[pco] No custom field tab named "${name}" found — field lookups will fall back to an unscoped name search. Create the tab in PCO first (see README).`);
  }
  return id;
}

const fieldDefinitionCache = new Map();

async function findFieldDefinitionIdByName(name) {
  if (fieldDefinitionCache.has(name)) return fieldDefinitionCache.get(name);

  if (!tabIdPromise) tabIdPromise = findTabIdByName(TAB_NAME);
  const tabId = await tabIdPromise;

  const query = new URLSearchParams({ 'where[name]': name });
  if (tabId) query.set('where[tab_id]', tabId);

  const result = await pcoRequest(`/field_definitions?${query.toString()}`);
  const id = result.data?.[0]?.id || null;

  if (!id) {
    console.warn(`[pco] No field definition named "${name}"${tabId ? ` on the "${TAB_NAME}" tab` : ''} found — create it in PCO first. Skipping update.`);
  }
  fieldDefinitionCache.set(name, id);
  return id;
}

/**
 * Creates or updates a custom field value on a person (upsert), since PCO has no
 * single "set field value" endpoint — you create a FieldDatum if none exists yet for
 * that person+field, or PATCH the existing one.
 */
async function upsertFieldDatum(personId, fieldDefinitionId, value) {
  if (!fieldDefinitionId) return;

  const existing = await pcoRequest(`/people/${personId}/field_data`);
  const match = (existing.data || []).find(
    (fd) => fd.relationships?.field_definition?.data?.id === fieldDefinitionId
  );

  if (match) {
    return pcoRequest(`/field_data/${match.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { type: 'FieldDatum', id: match.id, attributes: { value } } }),
    });
  }

  return pcoRequest(`/people/${personId}/field_data`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'FieldDatum',
        attributes: { value },
        relationships: { field_definition: { data: { type: 'FieldDefinition', id: fieldDefinitionId } } },
      },
    }),
  });
}

/**
 * Writes each present value to its matching PCO custom field:
 * - fields.topGifts / fields.topRoles: arrays, written one-per-rank into
 *   GIFT_RANK_FIELD_NAMES / ROLE_RANK_FIELD_NAMES (index 0 → rank 1, etc.)
 * - fields.dayJob / fields.volunteerExperience / fields.pdfLink: single values,
 *   written into SINGLE_FIELD_NAMES
 * Missing/empty values are skipped rather than clearing the field on PCO — e.g. a
 * submission with only 3 ranked gifts doesn't erase gifts #4–5 from a prior submission.
 *
 * @returns {Promise<string[]>} names of fields that don't exist in PCO under TAB_NAME
 * and were therefore skipped — surfaced by the caller (e.g. on /recent) instead of
 * only in server logs, since a name mismatch here fails silently otherwise.
 */
async function updateProfileFields(personId, { topGifts = [], topRoles = [], ...singleValues }) {
  const missingFields = [];

  async function writeField(fieldName, value) {
    const fieldId = await findFieldDefinitionIdByName(fieldName);
    if (!fieldId) {
      missingFields.push(fieldName);
      return;
    }
    await upsertFieldDatum(personId, fieldId, value);
  }

  for (let i = 0; i < GIFT_RANK_FIELD_NAMES.length; i++) {
    if (!topGifts[i]) continue;
    await writeField(GIFT_RANK_FIELD_NAMES[i], topGifts[i]);
  }

  for (let i = 0; i < ROLE_RANK_FIELD_NAMES.length; i++) {
    if (!topRoles[i]) continue;
    await writeField(ROLE_RANK_FIELD_NAMES[i], topRoles[i]);
  }

  for (const [key, value] of Object.entries(singleValues)) {
    if (value === undefined || value === null || value === '') continue;
    const fieldName = SINGLE_FIELD_NAMES[key];
    if (!fieldName) continue;
    await writeField(fieldName, value);
  }

  return missingFields;
}

const noteCategoryCache = new Map();

// Create this once in PCO under People → Organization Settings → Note Categories.
// Optional — if it doesn't exist, notes are still created, just uncategorized.
const NOTE_CATEGORY_NAME = 'Spiritual Gifts Assessment';

async function findNoteCategoryIdByName(name) {
  if (noteCategoryCache.has(name)) return noteCategoryCache.get(name);

  const query = new URLSearchParams({ 'where[name]': name });
  const result = await pcoRequest(`/note_categories?${query.toString()}`);
  const id = result.data?.[0]?.id || null;
  noteCategoryCache.set(name, id);
  return id;
}

/**
 * Adds a dated Note to the person with this submission's results, instead of
 * overwriting a field — so retaking the quiz builds a history on the profile
 * rather than erasing the previous result.
 */
async function addAssessmentNote(personId, { topGifts, topRoles, dayJob, volunteerExperience, pdfLink, submittedAt }) {
  const date = (submittedAt || new Date().toISOString()).slice(0, 10);
  const lines = [`Spiritual Gifts Assessment — ${date}`];
  if (topGifts?.length) lines.push(`Top gifts: ${topGifts.join(', ')}`);
  if (topRoles) lines.push(`Top volunteer matches: ${topRoles}`);
  if (dayJob) lines.push(`Day job / professional skill: ${dayJob}`);
  if (volunteerExperience) lines.push(`Previous volunteer experience: ${volunteerExperience}`);
  if (pdfLink) lines.push(`Full results PDF: ${pdfLink}`);

  const categoryId = await findNoteCategoryIdByName(NOTE_CATEGORY_NAME);

  return pcoRequest(`/people/${personId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'Note',
        attributes: {
          note: lines.join('\n'),
          ...(categoryId ? { note_category_id: categoryId } : {}),
        },
      },
    }),
  });
}

module.exports = { findMatchingPerson, updatePerson, updateProfileFields, addAssessmentNote, uploadFile };
