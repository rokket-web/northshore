# northshore-survey-connector

Backend for the Spiritual Gifts & Volunteer Match quiz. The quiz itself
([webflow-quiz/spiritual-gifts-quiz.html](webflow-quiz/spiritual-gifts-quiz.html)) runs
entirely in the visitor's browser on Webflow; when they reach the results screen it POSTs
its results directly to this app, which renders a PDF, saves it to SharePoint, and updates
the matching Planning Center Online (PCO) person profile.

## Flow

1. Visitor completes the quiz on Webflow. On reaching (or updating) the results screen,
   the page POSTs a JSON summary to `POST /webhook/survey` (see `buildSurveyPayload()` in
   the quiz file for the exact shape).
2. The submission is rendered into a PDF (`src/services/pdfService.js`).
3. The PDF is uploaded to SharePoint via Microsoft Graph (`src/services/sharepointService.js`).
4. The submitter is matched to a PCO person by email, and their profile is updated with
   their top 3 gifts and a link to the PDF (`src/services/pcoService.js`).

## Setup

```
npm install
cp .env.example .env   # then fill in the values below
npm run dev
```

### 1. The quiz file

[webflow-quiz/spiritual-gifts-quiz.html](webflow-quiz/spiritual-gifts-quiz.html) is a
self-contained HTML/CSS/JS page — no build step. Before publishing it to Webflow:

- Set `SURVEY_BACKEND_URL` (near the top of the `<script>` block) to your deployed Render
  URL, e.g. `https://northshore-survey-connector.onrender.com/webhook/survey`.
- Optionally set `SURVEY_WEBHOOK_TOKEN` to match `WEBFLOW_WEBHOOK_SECRET` below — this is
  **not** a real secret (it ships to the browser and anyone can read it in page source),
  it just filters out stray/garbage POSTs.
- In Webflow, paste the page into an **Embed** element (or the page's custom code area).
  Because it renders everything into `<div id="app">` and builds its own `<head>` content
  via the `<link>`/`<style>` tags at the top, the simplest approach is usually a dedicated
  Webflow page with this as the full custom code, rather than embedding it inside an
  existing designed layout.

The submission fires automatically (debounced ~800ms) once a visitor has entered their
email and reached the results screen, and again whenever they edit the optional fields
below it (day job, volunteer experience, pastor note) — no button click required. The
"Email my results to our team" button remains as a separate, visitor-initiated `mailto:`
option.

### 2. Azure AD app registration (for SharePoint uploads)

This app writes to SharePoint via Microsoft Graph, authenticating as an app
(not a user), so it needs its own Azure AD app registration:

1. In the [Azure Portal](https://portal.azure.com), go to **Azure Active
   Directory → App registrations → New registration**. Name it e.g.
   "Northshore Survey Connector". Leave redirect URI blank (not needed for
   this flow).
2. Note the **Application (client) ID** and **Directory (tenant) ID** from the
   overview page → these become `AZURE_CLIENT_ID` / `AZURE_TENANT_ID`.
3. Go to **Certificates & secrets → New client secret**. Copy the secret
   **value** immediately (it's hidden after you navigate away) → this becomes
   `AZURE_CLIENT_SECRET`.
4. Go to **API permissions → Add a permission → Microsoft Graph → Application
   permissions**, and add `Sites.ReadWrite.All` (or a narrower
   `Sites.Selected` scope if you want to restrict it to one site — see
   [Graph's Sites.Selected docs](https://learn.microsoft.com/en-us/graph/permissions-reference#sitesselected)
   for the extra per-site grant step that requires). This also covers creating
   the sharing link used for the PCO PDF link.
5. Click **Grant admin consent** for the permission (requires a tenant admin).
6. Find your target site's Graph site ID: `GET
   https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}` — the
   `id` field in the response is `SHAREPOINT_SITE_ID`.

### 3. Planning Center Online

1. Generate a Personal Access Token at
   https://api.planningcenteronline.com/oauth/applications → App ID and
   Secret become `PCO_APP_ID` / `PCO_SECRET` (sent as HTTP Basic auth).
2. In PCO People → **Organization Settings → Custom Fields**, create two
   fields (any tab/category works):
   - **"Top Spiritual Gifts"** — type **Text**
   - **"Spiritual Gifts Assessment PDF"** — type **Website** (renders as a
     clickable link on the profile)

   The names must match exactly what's in `src/services/pcoService.js`
   (`TOP_GIFTS_FIELD_NAME` / `PDF_LINK_FIELD_NAME`) — update one side if you'd
   rather name them differently.

### 4. Deploy to Render

`render.yaml` is set up as a blueprint — in Render, **New → Blueprint**,
point it at this repo, and fill in the env vars flagged `sync: false` in the
dashboard (secrets aren't stored in the repo). Once deployed, go back into
the quiz file and set `SURVEY_BACKEND_URL` to the real URL, then republish it
to Webflow.

## Notes

- **SharePoint sharing link scope**: `createSharingLink()` in
  `sharepointService.js` uses `scope: "organization"` — anyone signed into
  the church's Microsoft 365 tenant can open the link, no anonymous public
  access. Change this if a different access level is wanted.
- **PDF content / filename**: `src/services/pdfService.js` and
  `buildFilename()` in `src/routes/webhook.js` — adjust formatting or the
  `Name_Spiritual_Gifts_YYYY-MM-DD.pdf` naming convention as needed.
- **PCO fields written**: currently just top 3 gifts + PDF link. DISC/MBTI
  and top role matches are already included in the payload and the PDF if
  you want to add more fields later (`setTopGifts`/`setPdfLink` in
  `pcoService.js` are the pattern to copy).
