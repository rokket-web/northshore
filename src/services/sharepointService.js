const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const config = require('../config');

let graphClient;

function getGraphClient() {
  if (graphClient) return graphClient;

  const credential = new ClientSecretCredential(
    config.azure.tenantId,
    config.azure.clientId,
    config.azure.clientSecret
  );

  graphClient = Client.init({
    authProvider: async (done) => {
      try {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        done(null, token.token);
      } catch (err) {
        done(err, null);
      }
    },
  });

  return graphClient;
}

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

module.exports = { uploadSurveyPdf, createSharingLink };
