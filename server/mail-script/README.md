# GrowwPilot mail script

`Code.gs` is a small Google Apps Script web app. The server sends it each email over HTTPS and it sends the email from a Gmail account. See **Setting up email** in the main README for the server side.

## Deploy it (about 10 minutes)

1. Sign in to Google with the Gmail account that will send the emails.
2. Go to [script.google.com](https://script.google.com) → **New project**. Name it "GrowwPilot mail".
3. Replace what is in `Code.gs` with this folder's `Code.gs`. Save.
4. **Give it permission to send:** pick `testSendEmail` in the function list → **Run** → allow access. You get an email "GrowwPilot mail script works".
5. **Set the secret:** ⚙ **Project Settings** → **Script Properties** → add `MAIL_SECRET` with a long random value, at least 24 characters (for example from `openssl rand -hex 24`).
6. **Deploy:** **Deploy** → **New deployment** → type **Web app**, execute as **Me**, access **Anyone** (the secret is what keeps others out). Copy the URL ending in `/exec`.
7. On the server set `MAIL_SCRIPT` to the `/exec` URL and `MAIL_SCRIPT_SECRET` to the same value as `MAIL_SECRET`.
8. Open the `/exec` URL in a browser: it should show `{"status":"ok","service":"growwpilot-mail"}`. Then in the app: **Email → Send test email**.

## After changing the script

Apps Script keeps serving the old code until you publish a new version: **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL stays the same.

To change the secret, change `MAIL_SECRET` here and `MAIL_SCRIPT_SECRET` on the server at the same time.

## Limits

A free Gmail account sends about 100 emails a day this way. The server stops at `MAIL_DAILY_LIMIT` (default 90), and batches at most 40 emails per call.
