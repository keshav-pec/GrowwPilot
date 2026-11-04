# Email plan

Based on *Email Integration Reference (Apps Script + SMTP fallback)* from the earlier project, adapted to this app (ES modules, Node 20, multi-salon, MongoDB outbox pattern, Render + Vercel hosting).
Built in **5 parts**. Each part ends with a review stop and a commit line; the user commits and pushes.
Part 3 (automatic offer emails) is **optional**: it can be skipped without breaking Parts 4 and 5.

---

## Context

Today the app sends **no email at all**. Places where it is needed:

| Where | Today | After this plan |
|---|---|---|
| Occasion offers, Email channel | "Send" opens `mailto:` on the staff member's device; the app only records it | The app sends the email itself; staff see *Queued → Sent / Failed* |
| Occasion offers, automatic | "Send automatically" shows *Coming later* | Optional: the app emails opted-in customers itself, within a daily limit |
| Forgot password | Not possible; an owner must reset it and read out a temporary password | "Forgot password?" on the login page emails a reset link |
| New team member / owner reset | Temporary password shown on screen only | Also "Email a set-password link" |
| Bills | Share link (`/api/public/bills/<token>.pdf`) | Also "Email bill" with the PDF attached |

WhatsApp and SMS stay as they are (staff send them from their phone).

**This changes an earlier decision.** The Occasion Offers plan said "staff reminders only, no email provider". From this plan on, **email** is sent by the app; WhatsApp and SMS are unchanged.

---

## A. The reference in simple words, and what we change

**Kept from the reference:**
- **Main route:** the server POSTs JSON to a **Google Apps Script web app**, which sends with `GmailApp.sendEmail`. No paid service.
- **Backup route:** Gmail **SMTP** through `nodemailer`, used only when the script hits the Gmail daily limit or the script URL is dead.
- One `doPost` that takes a single email or a batch (≤ 40), and a `doGet` health check.
- `fetch` with `redirect: "follow"`; an HTML reply = "script is down"; an empty or non-JSON reply = success; only `status: "error"` is a failure.
- Fallback only for **quota** ("too many times", or "quota" + "mail") and **script down** (404, unpublished, HTML page, URL missing). Other errors (bad address, timeout) are not sent to SMTP.
- Emails with a PDF try SMTP first (Apps Script is slow with big bodies), then Apps Script.
- All user data passes through `escapeHtml`. One mail module; no other file calls Apps Script or nodemailer.
- Retry timeouts, network errors, 429 and 503; never retry quota errors straight away.

**Changed for this app:**

| Reference | Here | Why |
|---|---|---|
| Script URL open to **anyone** | Script checks a shared secret (`MAIL_SCRIPT_SECRET`) and refuses calls without it | Anyone who finds the URL could send mail from our Gmail |
| Fixed sender name "Auto Service Center" | Sender name = **salon name**; **Reply-To = salon's contact email** | Many salons share one sending account; replies must reach the salon, not us |
| Controllers send directly and wait | Every email is a row in an **outbox**, sent in the background with retries (same pattern as `modules/inventory/automation/outbox.js`) | The front desk never waits; nothing is lost on a restart; one place to see what went out |
| SMTP backup "strongly recommended" | SMTP is **optional**. On Render's **free** plan it can't work: Render blocks outgoing SMTP ports 25/465/587 there. Apps Script (HTTPS) is the main route. | Our `render.yaml` uses `plan: free` |
| 120 s script timeout | 30 s (`MAIL_SCRIPT_TIMEOUT_MS`), SMTP connect timeout 10 s | Background sends can be slow, but a blocked SMTP port must not hang the worker |
| `MAIL_FORGOT_PASSWORD` required | Optional; falls back to `MAIL_SCRIPT` | Gmail's limit is per account; a second script only helps if it runs on a second account |
| Bulk marketing, 4 workers | Batches of ≤ 40 from the outbox, with a daily limit for the whole platform and one per salon | One Gmail account is shared by all salons |
| Marketing email without an unsubscribe link | Every offer email has an **unsubscribe link**; it records *Opted out* like the existing permission screen | Consent rules (PRD, DPDP Act) and Gmail's spam rules |

**Limits to know:** a free Gmail account sends about **100 emails a day** through Apps Script (about 500 through SMTP; Workspace accounts get more). That is fine for testing and a few salons. For real volume, swap the sending part for Resend / Brevo / SES **behind the same functions**; nothing else changes. Sending many salons' offers from one personal Gmail account can also get it flagged as spam, so a proper sending domain is needed before a wide launch.

---

## B. What the code already has

| Need | Already there | Where |
|---|---|---|
| Env checking | zod schema, stops the server on bad values | `server/src/config/env.js` |
| Background worker with retries | outbox rows, atomic claim, `dedupeKey`, sweep every few minutes, started from `server.js` | `modules/inventory/automation/outbox.js` |
| No double sends | `runOnce` + `Idempotency-Key`; guarded 7-day slot on the customer | `middleware/idempotency.js`, `occasions/outreach/followup.service.js` |
| Message wording + placeholders | `campaignMessages`, `fillMessage`, `messageValues`, opt-out check | `occasions/outreach/templates.js` |
| Who may be emailed | `checkSend`, `hasDestination` (email format), consent per channel | `occasions/outreach/gate.js`, `models/Customer.js` |
| Consent history | `ConsentEvent` | `models/occasions/ConsentEvent.js` |
| Bell + activity log | `notify`, `logActivity` | `modules/notifications`, `modules/activity` |
| Bill PDF | `writeInvoicePdf(stream, invoice, { maskPhone })` | `modules/invoices/invoice.pdf.js` |
| Public links | `/api/public/...` routes; Vercel forwards `/api/*` to Render, so `CLIENT_ORIGIN + /api/public/...` works | `modules/invoices/public.routes.js`, `client/vercel.json` |
| Salon contact email | `Organization.contactEmail` | `models/Organization.js` |
| Help assistant topics | `help.knowledge.js` | `modules/help` |

Missing: any mail code, `nodemailer`, a way to end other logins after a password change (`passwordChangedAt`).

---

## C. Settings (environment variables)

All optional. With none set, email is **"not set up"**: in development emails are printed to the console and marked *Logged*; in production the Email channel falls back to today's `mailto:` link and the email buttons are hidden.

| Variable | Purpose | Default |
|---|---|---|
| `MAIL_SCRIPT` | Apps Script `/exec` URL for all emails | — |
| `MAIL_SCRIPT_SECRET` | Shared secret the script checks (min 24 chars) | — (required when `MAIL_SCRIPT` is set) |
| `MAIL_FORGOT_PASSWORD` | Separate script URL for password emails | `MAIL_SCRIPT` |
| `MAIL_SCRIPT_TIMEOUT_MS` | Script request timeout | 30000 |
| `EMAIL_HOST` / `EMAIL_PORT` | SMTP backup | `smtp.gmail.com` / 587 |
| `EMAIL_USER` / `EMAIL_PASS` | Gmail address + **app password**; SMTP is on only when both are real values | — |
| `MAIL_DAILY_LIMIT` | Most emails per 24 h for the whole platform | 90 (10 spare under Gmail's 100) |

Use the **same Gmail account** for the script and SMTP so the sender looks the same either way.

---

## Part 1: Mail foundation — sending, outbox, test email

**Goal:** the app can send an email reliably, and the business owner can check it works. No feature uses it yet.

**Apps Script (kept in the repo, pasted into script.google.com):**
- `server/mail-script/Code.gs`: `doPost` (single, batch ≤ 40, attachments), `doGet` health JSON, `testSendEmail()`.
  - Checks `secret` against Script Properties `MAIL_SECRET`; wrong or missing → `{ status: "error", message: "unauthorised" }`.
  - Per email accepts `to, subject, htmlBody, textBody, fromName, replyTo, attachments`; sends with `GmailApp.sendEmail(to, subject, textBody, { htmlBody, name: fromName, replyTo, attachments })`.
  - Batch: first "too many times" stops the loop; the rest come back `failed` with `skipped: true`.
- `server/mail-script/README.md`: deploy steps (Execute as **Me**, access **Anyone**, set the secret, **new version after every change**).

**Server:**
- `npm i nodemailer`.
- `config/env.js`: the variables in section C, with "placeholder" values (`your-email@gmail.com`, `xxxx`) treated as not set.
- `modules/mail/transport/appsScript.js`: `callScript(url, payload)` with the reply rules from section A.
- `modules/mail/transport/smtp.js`: one pooled nodemailer transport (3 connections, 100 messages each), created on first use, 10 s connect timeout.
- `modules/mail/transport/send.js`: `sendOne(email)`, `sendBatch(emails)`, and the helpers `isQuotaError`, `isScriptDown`, `smtpConfigured`, `mailConfigured`. Order: no attachment → script, then SMTP on quota/down; attachment → SMTP first, then script. "Using SMTP backup" is logged once per process. A `log` transport (development) and a `memory` transport (tests) behind the same functions.
- `modules/mail/html.js`: `escapeHtml`, `textToHtml` (escape, then line breaks → `<br>`), `layout({ salonName, body, footer })`: a plain, mobile-friendly HTML wrapper in the app's colours. Subjects lose line breaks (stops header tricks).
- **New `EmailOutbox` model** (`models/EmailOutbox.js`): `orgId, branchId?, kind (TEST | OCCASION_OFFER | PASSWORD | BILL), priority (1 password … 5 automatic), to, subject, html, text, fromName, replyTo, attachment { type: 'INVOICE', id }?, ref { offerId?, invoiceId?, userId? }, dedupeKey (unique per salon), status PENDING | SENDING | SENT | FAILED | SKIPPED, via APPS_SCRIPT | SMTP | LOG, attempts, nextAttemptAt, lockedUntil, lastError, sentAt, createdBy`. Indexes on `status + nextAttemptAt + priority`, and `orgId + createdAt`. Rows older than 180 days are removed automatically (TTL).
  - Attachments are **not stored**: a bill PDF is rebuilt from the invoice when the email is sent.
- `modules/mail/outbox.js`:
  - `queueEmail(ctx, email, session)`: insert inside the caller's transaction (dedupe key makes a repeat do nothing).
  - `kickMailer()`: called after the transaction commits; the sweep runs every minute too.
  - Claim rows atomically (PENDING → SENDING with a lock time); stale SENDING rows (cut off by a restart) are picked up again.
  - Before sending, a **check hook** by kind may say "skip" (Part 2 uses it: permission withdrawn → SKIPPED).
  - Non-attachment rows go out in **batches of ≤ 40**; attachment rows one at a time.
  - Retry with waits of 1, 5, 15, 60 min (max 5 tries) for timeouts, network, 429, 503. Quota with no SMTP → wait 1 hour, and the whole mailer pauses until then. Bad address → FAILED at once.
  - **Daily limit:** count of SENT in the last 24 h; at the limit, only priority 1–2 rows go out.
  - After SENT / FAILED / SKIPPED, a **result hook** by kind (Part 2 uses it).
- `modules/mail/mail.routes.js` (business owner only):
  - `GET /api/mail/status`: set up or not, which routes (script / SMTP), script reachable (`doGet`), sent in last 24 h vs limit, failed in last 7 days.
  - `POST /api/mail/test`: queues a test email to the owner's own login email.
- `server.js`: `startMailer()`.

**Client:**
- Settings → new **Email** card: "Email is set up / not set up", sent today of the limit, "Send test email" (shows *Sent* or the error in plain words).

**Docs:** README section "Setting up email" (Gmail app password, deploying the script, the variables, the Render free-plan SMTP note). `render.yaml`: the new keys with `sync: false`.

**Tests** (`tests/mail.test.js`, `fetch` and nodemailer replaced by fakes):
- script success, `status: "error"`, HTML 404 page → SMTP, empty reply = success, quota text → SMTP, quota with no SMTP → waits and pauses;
- bad address → FAILED, no SMTP; timeout → retried, then FAILED after 5;
- attachment → SMTP first; SMTP down → script;
- batch of 45 → two calls; quota midway → the skipped ones go to SMTP;
- two workers claiming at once → each row sent once;
- daily limit holds priority 5 rows but lets priority 1 out;
- user text with `<script>` comes out escaped; a subject with a line break is cleaned;
- only the business owner can call the status and test routes; another salon's rows are never visible.

**Commit line:**
```
Email Part 1: mail foundation with Google Apps Script sending and Gmail SMTP backup, secured script, background email outbox with retries, batching and daily limit, owner email status card and test email, setup guide
```

---

## Part 2: Occasion offers — the app sends the offer email

**Goal:** when staff press **Send** on the Email channel, the app emails the customer. WhatsApp and SMS stay as links.

**Server:**
- `occasions/outreach/followup.service.js` `sendOffer`: when `channel === 'EMAIL'` and mail is set up:
  - same checks and same guarded 7-day slot as today;
  - inside the same transaction, `queueEmail` with `kind: 'OCCASION_OFFER'`, `ref.offerId`, dedupe key `offer:<id>:send:<sentAt>`, sender name = salon name, Reply-To = `Organization.contactEmail`;
  - `task.emailStatus = 'QUEUED'`; the reply has `queued: true` and **no `link`**;
  - mail not set up → today's `mailto:` link, unchanged.
- **New `occasions/outreach/emailOffer.js`**: builds the email from the campaign's EMAIL wording (`campaignMessages` + `fillMessage`), then `textToHtml` + `layout`. Footer: salon name and phone, "You're getting this because you agreed to receive offers from <salon> by email", **Unsubscribe** link. Plain-text version too.
- **Check hook** (just before sending): customer still *Opted in* on Email, the offer still ISSUED → otherwise SKIPPED with the reason.
- **Result hook:**
  - SENT → `task.emailStatus = 'SENT'`, offer event `EMAIL_SENT`.
  - FAILED or SKIPPED → `task.emailStatus = 'FAILED'`, offer event `EMAIL_FAILED` with the reason, task back to OPEN, **the 7-day slot is given back** (only if `marketing.lastPromoAt` still equals this send's time), bell to the person who pressed Send, activity row.
- `OFFER_EVENT_KINDS` gets `EMAIL_SENT`, `EMAIL_FAILED`; `OfferIssue.task` gets `emailStatus`.
- **Unsubscribe link:** `CLIENT_ORIGIN/api/public/unsubscribe/<token>`, token = salon id + customer id + an HMAC signature (key derived from `JWT_SECRET`; no database lookup to check it, can't be guessed or changed).
  - `GET` shows a small page with an **Unsubscribe** button (a page, not an instant change, because email scanners open links on their own).
  - `POST` sets `marketing.EMAIL` to *Opted out* (source `CUSTOMER_REQUEST`, evidence "Email unsubscribe link"), writes a `ConsentEvent`, and runs the existing "opted out of all channels → close open tasks" rule. Rate limited. Wrong token → "This link isn't valid".
  - SMTP emails also carry `List-Unsubscribe` / `List-Unsubscribe-Post` headers (Apps Script can't set headers; the footer link covers it).
- `templates.js`: default EMAIL opt-out line becomes "Opt-out: use the unsubscribe link at the bottom of this email." Saved custom wording keeps working (the footer link is always added).

**Client:**
- `SendOfferModal.jsx`: for Email the button reads **Send email**; after confirm: "Email is on its way to a\*\*\*@gmail.com". No `mailto:`.
- Offer drawer and front desk list: Email status badge *Queued / Sent / Failed*, with the reason on Failed; Send is available again after a failure.
- Message wording screen: the preview shows how the email will look.

**Tests** (`tests/emailOffers.test.js`):
- Send on Email → one outbox row, task *Contacted via Email*, status Queued → Sent;
- two desks pressing Send together → one email;
- permission withdrawn after queueing → SKIPPED, slot given back, task open, bell;
- bad address → Failed, slot given back; sending again works;
- mail not set up → `mailto:` link as before;
- WhatsApp / SMS unchanged;
- unsubscribe: valid token → Opted out + ConsentEvent; forged or other-salon token refused; repeat press is harmless; GET alone changes nothing;
- the customer's name with HTML in it is escaped in the email;
- front desk can't send for another branch's customer (existing rule still holds).

**Commit line:**
```
Email Part 2: occasion offer emails sent by the app with queued/sent/failed status, permission re-checked before sending, 7-day slot given back on failure, unsubscribe link with confirm page, email preview
```

---

## Part 3 (optional): Occasion offers — send offer emails automatically

**Goal:** the "Send automatically" choice becomes real **for Email only**. Customers who allow only WhatsApp/SMS stay on the staff list.

**Server:**
- `config/occasions.js`: `DELIVERY_MODES = ['STAFF_ASSISTED', 'AUTO_EMAIL']`. Changing it on a live campaign follows the existing version rules.
- `OccasionSettings`: `autoEmail { dailyLimit (default 30 per salon), sendFrom '10:00', sendUntil '19:00' }`.
- **New `occasions/engine/autoSend.js`**, run in the existing scheduler tick, per branch (same branch lock):
  - offers ISSUED this month on an `AUTO_EMAIL` campaign, not yet sent, task OPEN;
  - only inside the branch's send hours (branch time zone);
  - same `checkSend` rules (Email opted in, valid email, 7-day gap, birthday first);
  - takes the 7-day slot with the same guarded update, queues with priority 5, `sentVia: 'EMAIL'`, sent by "Automatic";
  - stops at the salon's daily limit (and the platform limit from Part 1); the rest go the next day.
- Front desk list: label *Emailed automatically*; those offers drop off "to contact" unless the email fails.
- Report: an "emailed automatically" column and CSV field.

**Client:**
- Quick setup step 3: "Send automatically by email" can be chosen (WhatsApp/SMS automatic still *Coming later*), with a line explaining the daily limit.
- Settings → Occasion offers: daily email limit and send hours.

**Tests:** revisit PRD AT-13/14/15 for email; sends only inside send hours; daily limit holds and the rest go the next day; two servers never send twice; opted-out customer never emailed; Email-not-allowed customer stays on the staff list; email not set up → nothing queued, campaign shows a warning.

**Commit line:**
```
Email Part 3: automatic birthday and anniversary offer emails within branch send hours and a daily limit per salon, staff list and report show automatic sends
```

---

## Part 4: Password emails — forgot password and set-password links

**Goal:** people can reset their own password; owners can email a set-password link instead of reading out a temporary password.

**Server:**
- **New `PasswordToken` model:** `userId, orgId, purpose (RESET | INVITE), tokenHash, expiresAt (RESET 1 h, INVITE 48 h), usedAt`. Only the hash is stored. A new token cancels the user's older ones.
- `User.passwordChangedAt`; `requireAuth` refuses logins issued before it (other devices are logged out after a reset).
- `auth.routes.js`:
  - `POST /api/auth/forgot-password { email }`: **always the same reply** ("If an account exists, we've emailed a link"), whether or not the email exists. Inactive users get nothing. Limited to 5 per IP per 15 min and 3 per email per hour. Queues a priority-1 email (uses `MAIL_FORGOT_PASSWORD` if set).
  - `POST /api/auth/reset-password { token, password }`: checks the token, sets the password (same rules as today), marks the token used, sets `passwordChangedAt`.
- `users.service.js`: new `POST /api/users/:id/email-password-link` (same people who can reset today). Creating a user gets a "Email them a link to set their password" option. The current temporary-password flow stays.
- Sender name "GrowwPilot"; Reply-To = the salon's contact email.

**Client:**
- Login page: **Forgot password?** → email box → "Check your email".
- New `/reset-password?token=` page: new password twice → "Password changed, please log in".
- Team: **Email a password link** button next to Reset password; option on Add user.

**Tests:** same reply for known and unknown emails; limits hold; expired, used or changed token refused; old login refused after reset; a branch owner can't send a link to someone outside their branches; another salon's user can't be touched; the token never appears in logs or API replies.

**Commit line:**
```
Email Part 4: forgot password and set-password emails with one-time links, other devices logged out after a reset, owners can email a password link to team members
```

---

## Part 5: Bill emails, email log, help and wrap-up

**Goal:** email a bill with its PDF; owners can see what was emailed; everything documented.

**Server:**
- `POST /api/invoices/:id/email { to? }`: issued bills only; default = the customer's email; front desk for their own branch, owners for theirs. Queues `kind: 'BILL'` with `attachment { type: 'INVOICE', id }`; at send time the PDF is rebuilt with `writeInvoicePdf` into memory (phone partly hidden, same as the public link). PDF → SMTP first, then the script.
- Credit notes / refunds: same button where a PDF exists.
- `GET /api/mail/log`: emails of the salon (business owner: all branches; branch owner: their branches), filter by type, status, date; no email body, the address partly hidden.
- Help assistant: topics "Why didn't my customer get the email?", "Email is not set up", "Forgot password", "Email a bill".
- Demo data: a few sent and failed emails in the seed.
- Isolation smoke test and roles matrix: the new routes.

**Client:**
- Bill page and checkout success: **Email bill** (shows the customer's email, can be changed) → *Queued / Sent / Failed*.
- Settings → Email card: **Recent emails** list with filters and the failure reason in plain words.

**Docs:** README (what is emailed, limits, moving to a paid sender later); this plan's choices updated.

**Tests:** bill email has the PDF; draft bill refused; front desk refused for another branch; log shows only allowed branches; full flow of all four kinds under the daily limit.

**Commit line:**
```
Email Part 5: email bills with PDF attached, recent emails log for owners, help topics, demo data, role and isolation checks, README
```

---

## Choices awaiting your OK

All 5 parts are built (3–4 Nov 2026), using the defaults below. Nothing was answered yet, so each is still open: say if you want one changed.

1. **Part 3 (automatic offer emails): built.** It stays off unless an owner picks *Send automatically by email* on a campaign (or in the quick setup). Easy to remove before committing if you'd rather stop at staff-pressed emails.
2. **Sender:** salon name as the sender name, salon's contact email as Reply-To; one shared Gmail account for all salons. Password emails are sent as "GrowwPilot".
3. **Hosting:** built for Render free with Apps Script only (about 100 emails a day for the whole platform). SMTP is ready if you move to a paid plan.
4. **Password emails use a link**, not a 6-digit code (one way for both "forgot password" and "new team member").
5. **Limits:** 90 a day for the platform, 30 automatic a day per salon, send hours 10:00–19:00 (changeable in Settings → Occasion offers).
6. **Every offer email has an unsubscribe link**, and pressing it records *Opted out* on Email only (WhatsApp/SMS untouched).
7. **Payslip emails** are left for later.

## Decisions made while building

- **How offers are sent** (staff or automatic email) changes straight away, without publishing a new campaign version, so automatic emails can be stopped at once.
- **Password rule** (none existed): at least 8 characters, with a letter and a number. An owner's **Reset password** now also logs the person out on their other devices.
- **The Super Admin** can't use "Forgot password" (the account belongs to no salon).
- **Stored password emails lose their link** once sent (only a hash of the link is kept).
- **Credit notes and refunds** have no PDF yet, so only bills can be emailed.
- **Branch owners** see the Email page with **Recent emails** for their branches only; the setup and test email stay with the business owner.
- **Tests never use the real email settings** in `server/.env` (`vitest.config.js` blanks them), and the demo seed saves its sample emails as already finished, so nothing is sent.
