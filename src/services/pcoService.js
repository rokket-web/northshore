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

const fieldDefinitionCache = new Map();

// These must already exist in PCO under People → Organization Settings → Custom Fields
// (create once, by hand — see README). Rename values here if you name them differently there.
const FIELD_NAMES = {
  topGifts: 'Top Spiritual Gifts',
  topRoles: 'Top Volunteer Matches',
  dayJob: 'Day Job / Professional Skill',
  volunteerExperience: 'Previous Volunteer Experience',
  pdfLink: 'Spiritual Gifts Assessment PDF',
};

async function findFieldDefinitionIdByName(name) {
  if (fieldDefinitionCache.has(name)) return fieldDefinitionCache.get(name);

  const query = new URLSearchParams({ 'where[name]': name });
  const result = await pcoRequest(`/field_definitions?${query.toString()}`);
  const id = result.data?.[0]?.id || null;

  if (!id) {
    console.warn(`[pco] No field definition named "${name}" found — create it in PCO first. Skipping update.`);
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
 * Writes each present value in `fields` to its matching PCO custom field, keyed by
 * FIELD_NAMES above (e.g. { topGifts: "Leadership, Teaching, ...", dayJob: "Electrician" }).
 * Keys with no value (undefined/null/empty string) are skipped rather than clearing
 * the field on PCO — a blank submission field shouldn't erase a previous answer.
 */
async function updateProfileFields(personId, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    const fieldName = FIELD_NAMES[key];
    if (!fieldName) continue;
    const fieldId = await findFieldDefinitionIdByName(fieldName);
    await upsertFieldDatum(personId, fieldId, value);
  }
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
  const relationships = categoryId
    ? { note_category: { data: { type: 'NoteCategory', id: categoryId } } }
    : undefined;

  return pcoRequest(`/people/${personId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'Note',
        attributes: { note: lines.join('\n') },
        ...(relationships ? { relationships } : {}),
      },
    }),
  });
}

module.exports = { findMatchingPerson, updatePerson, updateProfileFields, addAssessmentNote };
