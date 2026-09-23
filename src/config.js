require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.warn(`[config] Missing env var ${name} — related functionality will fail until it is set.`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,

  webflow: {
    webhookSecret: process.env.WEBFLOW_WEBHOOK_SECRET || '',
  },

  azure: {
    tenantId: required('AZURE_TENANT_ID'),
    clientId: required('AZURE_CLIENT_ID'),
    clientSecret: required('AZURE_CLIENT_SECRET'),
  },

  sharepoint: {
    siteId: required('SHAREPOINT_SITE_ID'),
    drivePath: process.env.SHAREPOINT_DRIVE_PATH || 'Survey Responses',
  },

  pco: {
    appId: required('PCO_APP_ID'),
    secret: required('PCO_SECRET'),
  },

  mail: {
    senderUpn: process.env.MAIL_SENDER_UPN || '',
    staffAlertEmail: process.env.STAFF_ALERT_EMAIL || '',
  },

  admin: {
    password: process.env.ADMIN_PASSWORD || '',
  },
};
