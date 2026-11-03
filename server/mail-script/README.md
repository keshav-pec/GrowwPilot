# GrowwPilot mail script

`Code.gs` is a small Google Apps Script web app. The server sends it each email over HTTPS and it sends the email from a Gmail account with `GmailApp`. No paid service is needed. See **Setting up email** in the main README for the server side.

## Deploy it (about 10 minutes)

1. Sign in to Google with the Gmail account that will send the emails (use the same one for `EMAIL_USER` if you add the SMTP backup).
2. Go to [script.google.com](https://script.google.com) → **New project**. Name it "GrowwPilot mail".
3. Delete what is in `Code.gs` and paste in this folder's `Code.gs`. Save.
4. **Give it permission to send:** pick `testSendEmail` in the function list at the top → **Run** → allow access when Google asks. You get an email "GrowwPilot mail script works".
5. **Set the secret:** ⚙ **Project Settings** → **Script Properties** → **Add script property**:
   - Property: `MAIL_SECRET`
   - Value: a long random text, at least 24 characters (for example the output of `openssl rand -hex 24`).
6. **Deploy:** **Deploy** → **New deployment** → type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the server isn't a Google user; the secret is what keeps others out)
   - **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
7. On the server set:
   - `MAIL_SCRIPT` = the `/exec` URL
   - `MAIL_SCRIPT_SECRET` = the same value as `MAIL_SECRET`
8. Open the `/exec` URL in a browser: it should show `{"status":"ok","service":"growwpilot-mail"}`. Then in the app: **Settings → Email → Send test email**.

## After changing the script

Apps Script keeps serving the **old** code until you publish a new version: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL stays the same. (A "New deployment" gives a new URL, which you would then have to copy to the server again.)

## Limits

- A free Gmail account sends about **100 emails a day** this way (Google Workspace accounts: more). The server stops at `MAIL_DAILY_LIMIT` (default 90) and keeps the rest for the next day; password and test emails still go out.
- At most 40 emails per call; the server batches for you.
- To change the secret: change `MAIL_SECRET` here and `MAIL_SCRIPT_SECRET` on the server at the same time (no new version needed: properties are read on every call).
