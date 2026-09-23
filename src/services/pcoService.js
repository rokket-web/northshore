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
 * Finds a single PCO person by email address.
 * Returns null if no match, throws if more than one match (ambiguous).
 */
async function findPersonByEmail(email) {
  const query = new URLSearchParams({
    where: '', // placeholder, PCO uses bracket-style params below
  });
  query.delete('where');
  query.set('where[search_name_or_email_or_phone_number]', email);
  query.set('include', 'emails');

  const result = await pcoRequest(`/people?${query.toString()}`);

  const matches = (result.data || []).filter((person) =>
    (result.included || [])
      .filter((inc) => inc.type === 'Email' && inc.relationships?.person?.data?.id === person.id)
      .some((inc) => inc.attributes.address.toLowerCase() === email.toLowerCase())
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Ambiguous PCO match: ${matches.length} people found for email ${email}`);
  }
  return matches[0];
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
// (create once, by hand — see README). Rename here if you name them differently there.
const TOP_GIFTS_FIELD_NAME = 'Top Spiritual Gifts';
const PDF_LINK_FIELD_NAME = 'Spiritual Gifts Assessment PDF';

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

async function setTopGifts(personId, topGifts) {
  const fieldId = await findFieldDefinitionIdByName(TOP_GIFTS_FIELD_NAME);
  return upsertFieldDatum(personId, fieldId, topGifts.join(', '));
}

async function setPdfLink(personId, url) {
  const fieldId = await findFieldDefinitionIdByName(PDF_LINK_FIELD_NAME);
  return upsertFieldDatum(personId, fieldId, url);
}

module.exports = { findPersonByEmail, updatePerson, setTopGifts, setPdfLink };
