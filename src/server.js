const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const webhookRouter = require('./routes/webhook');
const recentRouter = require('./routes/recent');
const submissionsRouter = require('./routes/submissions');

const app = express();

// The quiz posts directly from the visitor's browser on the Webflow domain, so this
// needs to be reachable cross-origin. TODO: once the Webflow domain is final, restrict
// this to that origin instead of allowing all.
app.use(cors());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'webflow-quiz', 'spiritual-gifts-quiz.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/webhook', webhookRouter);
app.use('/recent', recentRouter);
app.use('/submissions', submissionsRouter);

app.listen(config.port, () => {
  console.log(`northshore-survey-connector listening on port ${config.port}`);
});
