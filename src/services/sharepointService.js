const config = require('../config');
const { getGraphClient } = require('./graphClient');

/**
 * Uploads a PDF into the configured SharePoint document library folder,
 * creating the folder path if it doesn't already exist.
 *
 * @param {string} filename - e.g. "Doe_Jane_Survey_2026-09-23.pdf"
 * @param {Buffer} pdfBuffer
 * @returns {Promise<object>} the created Graph driveItem
 */
async function uploadSurveyPdf(filename, pdfBuffer) {
  const client = getGraphClient();
  const folderPath = config.sharepoint.drivePath.replace(/^\/+|\/+$/g, '');
  const itemPath = folderPath ? `${folderPath}/${filename}` : filename;

  // Simple PUT upload — fine for the small PDFs this app generates (<4MB).
  // Files approaching/over 4MB would need Graph's resumable upload session instead.
  return client
    .api(`/sites/${config.sharepoint.siteId}/drive/root:/${encodeURI(itemPath)}:/content`)
    .put(pdfBuffer);
}

/**
 * Creates (or reuses) an organization-scoped sharing link for a driveItem, so it can be
 * pasted somewhere like a PCO custom field. Scope "organization" means anyone signed into
 * the church's Microsoft 365 tenant can open it — no anonymous public link.
 *
 * @param {string} itemId - driveItem id, as returned by uploadSurveyPdf()
 * @returns {Promise<string>} the sharing URL
 */
async function createSharingLink(itemId) {
  const client = getGraphClient();
  const result = await client
    .api(`/sites/${config.sharepoint.siteId}/drive/items/${itemId}/createLink`)
    .post({ type: 'view', scope: 'organization' });

  return result.link.webUrl;
}

/**
 * Checks the Azure credentials and SharePoint permissions end to end: reads the site,
 * then writes and deletes a small test file in the configured folder (the same write
 * access real uploads need).
 *
 * @returns {Promise<{siteName: string, siteUrl: string, folder: string}>}
 */
async function testConnection() {
  const client = getGraphClient();
  const site = await client.api(`/sites/${config.sharepoint.siteId}`).select('displayName,webUrl').get();

  const folderPath = config.sharepoint.drivePath.replace(/^\/+|\/+$/g, '');
  const itemPath = folderPath ? `${folderPath}/_connection-test.txt` : '_connection-test.txt';
  const item = await client
    .api(`/sites/${config.sharepoint.siteId}/drive/root:/${encodeURI(itemPath)}:/content`)
    .put(Buffer.from(`Connection test from Northshore admin dashboard at ${new Date().toISOString()}\n`));
  await client.api(`/sites/${config.sharepoint.siteId}/drive/items/${item.id}`).delete();

  return { siteName: site.displayName, siteUrl: site.webUrl, folder: folderPath || '(library root)' };
}

module.exports = { uploadSurveyPdf, createSharingLink, testConnection };
