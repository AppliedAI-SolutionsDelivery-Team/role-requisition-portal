# Role Requests portal (draft)

Applied AI Talent Acquisition portal for raising, approving and tracking role requisitions before they are posted in HiBob.

## What it does
- Raise a role with department, level, role type and business case
- Approval route mapped automatically from the approval matrix (department head, exec for IC5 and above, final approver)
- Approver queues with approve or decline and comments
- Tracker with stages, overdue flags, reminders and a full audit trail
- Approval matrix by level and department, read live from HR's Google Sheet and editable in the portal by HR admins (see `apps-script/README.md`)

## Run locally
Open `index.html` in a browser, or run:

    python3 -m http.server 8000

then go to http://localhost:8000

## Deploy on Vercel
Import this repository in Vercel. No build step is needed: Framework preset "Other", no build command, output directory is the repo root.

## Connect the approval matrix to Google Sheets
See `apps-script/README.md`. Until `SHEET_API_URL` is set in `index.html`, the portal runs in demo mode, using a snapshot of the sheet.

## Current limitations (draft)
- Data is stored in each visitor's browser, so requests are not shared between people yet. A shared backend (for example Supabase) is the next step.
- Emails and reminders are simulated in the activity feed. Real emails need the talent acquisition Gmail account.
- "Demo view as" lets anyone switch roles for demo purposes. Production would use sign in.
