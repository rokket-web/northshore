const express = require('express');
const cors = require('cors');
const config = require('./config');
const webhookRouter = require('./routes/webhook');

const app = express();

// The quiz posts directly from the visitor's browser on the Webflow domain, so this
// needs to be reachable cross-origin. TODO: once the Webflow domain is final, restrict
// this to that origin instead of allowing all.
app.use(cors());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/webhook', webhookRouter);

app.listen(config.port, () => {
  console.log(`northshore-survey-connector listening on port ${config.port}`);
});
