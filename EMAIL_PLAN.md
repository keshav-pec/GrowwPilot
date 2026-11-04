# Email

Setup steps and settings are in the [README](README.md#setting-up-email); the script is in [`server/mail-script`](server/mail-script/README.md).

## How sending works

- **Main route:** the server posts JSON to a Google Apps Script web app, which sends with `GmailApp.sendEmail`. It checks a shared secret (`MAIL_SCRIPT_SECRET`) and refuses calls without it.
- **Backup route:** Gmail SMTP through `nodemailer`, used only when the script hits Gmail's daily limit or is down. Bad addresses and timeouts don't go to SMTP. Render's free plan blocks SMTP ports, so there it stays on the script.
- **Emails with a PDF** try SMTP first (the script is slow with big bodies), then the script.
- **Reading the script's reply:** an HTML page means the script is down, an empty reply means sent, and only `status: "error"` is a failure.
- **Retries:** timeouts, network errors, 429 and 503 are retried after 1, 5, 15 and 60 minutes, then marked *Failed*. Quota errors are never retried straight away.

## The outbox

Every email is a row in an outbox and is sent in the background, so nobody waits and nothing is lost on a restart. Batches hold at most 40 emails. Only `modules/mail` calls the script or nodemailer, and all user data passes through `escapeHtml`. Sent emails are removed after 180 days.

## Rules in use

- **Sender:** the salon's name, with Reply-To as the salon's contact email. One Gmail account is shared by all salons. Password emails are sent as "GrowwPilot".
- **Limits:** 90 a day for the platform, 30 automatic a day per salon, send hours 10:00–19:00 (changeable in Settings → Occasion offers). Password and test emails go first, even at the daily limit.
- **Unsubscribe:** every offer email has a link; pressing the button on its page records *Opted out* on Email only.
- **How offers are sent** (staff or automatic email) changes straight away, without a new campaign version.
- **Password links**, not codes, for both "forgot password" and "new team member". New passwords need at least 8 characters with a letter and a number. A reset logs the person out on their other devices. Only a hash of each link is stored, and the stored email loses the link once sent. The Super Admin can't use "Forgot password".
- **Branch owners** see the Email page with Recent emails for their branches; status and test email stay with the business owner.
- **Tests** never use real email settings (`vitest.config.js` blanks them), and the demo seed saves its sample emails as already finished.
