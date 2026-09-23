# northshore-survey-connector

Backend for the Spiritual Gifts & Volunteer Match quiz. `GET /` is a simple "NORTHSHORE"
landing page and `GET /quiz` serves the quiz itself
([webflow-quiz/spiritual-gifts-quiz.html](webflow-quiz/spiritual-gifts-quiz.html)) — it runs
entirely in the visitor's browser; when they reach the results screen it POSTs its results
directly to this app, which renders a PDF, saves it to SharePoint, and updates the matching
Planning Center Online (PCO) person profile.

## Flow

1. Visitor completes the quiz at `/quiz`. On reaching (or updating) the results screen,
   the page POSTs a JSON summary to `POST /webhook/survey` (see `buildSurveyPayload()` in
   the quiz file for the exact shape).
2. The submission is rendered into a PDF (`src/services/pdfService.js`).
3. The PDF is uploaded to SharePoint via Microsoft Graph, and a sharing link is created
   (`src/services/sharepointService.js`).
4. The submitter is matched to **exactly one** PCO person by email — see "Matching
   accuracy" below (`src/services/pcoService.js`). If matched: their top 3 gifts and the
   PDF link are written to two custom fields (always reflecting the latest submission),
   and a dated Note is added so retaking the quiz builds a history instead of erasing the
   previous result. If not matched confidently, nothing on PCO is touched and staff get an
   email instead (`src/services/mailService.js`) — the PDF is still saved either way.

## Matching accuracy

Getting this wrong means attributing results to the wrong person, silently overwriting
data, or creating duplicate PCO people — so the matching logic is deliberately
conservative: it never guesses, and it never creates a new PCO person.

- **Primary signal**: exact email match against PCO's People search.
- **Disambiguation**: if multiple PCO people share that email (common for spouses or
  parent/child records sharing one household inbox), it narrows using the name typed
  into the quiz. Only proceeds if that narrows it to exactly one person.
- **No match, or still ambiguous after that**: the submission is *not* applied to PCO.
  Instead, `STAFF_ALERT_EMAIL` gets an email with what was submitted and (if ambiguous)
  which PCO people it could be, so a human decides. The PDF is still saved to SharePoint
  either way, so nothing is lost.
- **No auto-created people, ever**: if nobody matches, the app does not create a new PCO
  person. Auto-creating profiles from a web form is how ChMS databases end up full of
  near-duplicate people (typos, nicknames, etc.) — a human should decide to add someone.
- **No duplicate field data**: the custom-field writes upsert (check for an existing
  value for that person+field before creating a new one) rather than blindly POSTing,
  so retaking the quiz never creates duplicate field entries.

## Setup

```
npm install
cp .env.example .env   # then fill in the values below
npm run dev
```

### 1. The quiz file

[webflow-quiz/spiritual-gifts-quiz.html](webflow-quiz/spiritual-gifts-quiz.html) is a
self-contained HTML/CSS/JS page — no build step. It's served directly by this app at
`/quiz`, so `SURVEY_BACKEND_URL` is a relative `/webhook/survey` and needs no editing for
that use. If you instead paste the raw code into a Webflow page's own DOM (different
origin from this app), switch that constant to the full Render URL — see the comment
next to it in the file.

Optionally set `SURVEY_WEBHOOK_TOKEN` to match `WEBFLOW_WEBHOOK_SECRET` below — this is
**not** a real secret (it ships to the browser and anyone can read it in page source), it
just filters out stray/garbage POSTs.

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
   permissions**, and add:
   - `Sites.ReadWrite.All` (or narrower `Sites.Selected` — see
     [Graph's Sites.Selected docs](https://learn.microsoft.com/en-us/graph/permissions-reference#sitesselected)
     for the extra per-site grant step that requires). Covers the PDF upload
     and the sharing link used for the PCO PDF link.
   - `Mail.Send` — used to email staff when a submission can't be confidently
     matched to a PCO person (see "Matching accuracy" above). **Important**:
     by default this permission lets the app send as *any* mailbox in the
     tenant. Scope it down with an
     [Exchange Application Access Policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access)
     restricting it to just the mailbox you'll use as `MAIL_SENDER_UPN`.
5. Click **Grant admin consent** for both permissions (requires a tenant admin).
6. Find your target site's Graph site ID: `GET
   https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}` — the
   `id` field in the response is `SHAREPOINT_SITE_ID`.

### 3. Planning Center Online

1. Generate a Personal Access Token at
   https://api.planningcenteronline.com/oauth/applications → App ID and
   Secret become `PCO_APP_ID` / `PCO_SECRET` (sent as HTTP Basic auth).
2. In PCO People → **Configuration → Custom Fields**, use the **"Spiritual
   Gifts"** tab (create it via **Add tab** if it doesn't exist yet) — this is
   what makes the results show up together under their own tab on a person's
   profile, instead of scattered into whatever tab happens to be first. It
   should contain five fields:
   - **"Top 5 Spiritual Gifts"** — type **Text**
   - **"Top 5 Volunteer Matches"** — type **Text**
   - **"Day Job"** — type **Text**
   - **"Volunteer Experience"** — type **Text Area** (can run long)
   - **"PDF"** — type **Website** (renders as a clickable link on the profile
     — PCO's People API has no general file/document storage on a profile,
     so a link is the closest equivalent to "the PDF on their profile")

   Both the tab name and field names must match exactly what's in
   `src/services/pcoService.js` (`TAB_NAME` / `FIELD_NAMES`) — update the code
   if you'd rather name them differently. If the tab isn't found, field
   lookups fall back to matching by name only (a warning is logged), so it
   still works if you skip the tab — you just lose the grouping.
3. Optionally, in **Organization Settings → Note Categories**, create a
   **"Spiritual Gifts Assessment"** category so the history notes (added each
   time someone takes/retakes the quiz) are grouped and filterable on a
   profile. Not required — notes are still added without it, just
   uncategorized.

### 4. Deploy to Render

Create a **Web Service** (not Blueprint — Render's Blueprint flow picked up
`plan: starter` in `render.yaml`, which requires billing info; a plain Web
Service lets you pick the Free plan instead):

1. **New +** → **Web Service** → connect this repo, branch `main`.
2. Confirm **Runtime: Node** (auto-detected from `package.json`).
3. Build Command: `npm install`. Start Command: `npm start`.
4. Add the env vars from `.env.example` under **Environment** (paste the
   whole block via "Add from .env" instead of one at a time).
5. Deploy.

The quiz at `/quiz` posts to a relative `/webhook/survey`, so no URL needs
updating after deploy — it works as soon as the service is live.

## Notes

- **SharePoint sharing link scope**: `createSharingLink()` in
  `sharepointService.js` uses `scope: "organization"` — anyone signed into
  the church's Microsoft 365 tenant can open the link, no anonymous public
  access. Change this if a different access level is wanted.
- **PDF content / filename**: `src/services/pdfService.js` and
  `buildFilename()` in `src/routes/webhook.js` — adjust formatting or the
  `Name_Spiritual_Gifts_YYYY-MM-DD.pdf` naming convention as needed.
- **PCO fields written**: top 5 gifts, top 5 volunteer role matches, day job/
  professional skill, previous volunteer experience, and the PDF link — see
  `FIELD_NAMES` in `pcoService.js`. DISC/MBTI type is in the payload and PDF
  but not currently written to a PCO field; add an entry to `FIELD_NAMES` and
  the `updateProfileFields()` call in `webhook.js` to add it.
