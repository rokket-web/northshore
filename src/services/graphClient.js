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

module.exports = { getGraphClient };
