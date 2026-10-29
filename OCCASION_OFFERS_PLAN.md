# Birthday & Anniversary Offers plan

Based on *GrowwPilot Customer Occasions & Offers PRD v1.1* (27 Oct 2026) and its UI mock-ups (Appendix C), adapted to this app's MERN stack (MongoDB + Mongoose, Express, React, Node).
Built in **6 phases**. Each phase ends with a review stop and a commit line; the user commits and pushes.
Where this plan is silent, the PRD wins. The mock-ups are used for **layout only**: all screens use the app's own colours (gold, brown, cream), not the purple of the mock-ups.


---

## Context
The salon wants to bring customers back in their **birthday month** and **wedding anniversary month** with an offer (for example, 15% off Hair Spa, at most ₹500). Today the app only stores a full date of birth on the customer. It has no anniversary date, no record of marketing permission, no offers and no way to apply one at checkout.

The PRD asks for a small "retention engine" built on the existing customers, appointments and billing:
- Every month the app gives each matching customer **one offer** (an "entitlement") that is valid for the whole month.
- The front desk sees a **to-do list** of customers to contact.
- The offer is **applied at checkout** and marked used when the bill is issued.
- Owners see a simple **report**.

**Decisions made with the user (28 Oct 2026)**
- **Staff reminders only.** The app does **not** send WhatsApp, SMS or email by itself in this build, and no provider accounts are connected. Staff send the ready-made message from their own phone through a WhatsApp / SMS / email link that the app opens, and the app records it. "Send automatically" shows as *Coming later*.
- **The business owner switches the feature on**, in Settings. It is off by default (it is not a Super Admin add-on).
- **The existing "Date of birth" becomes Birthday month + day.** Old dates are copied into the new fields and marked *migrated*. The old stored date stays untouched in the database but is no longer shown or edited.

---

## A. The PRD in simple words

| Area | What it means |
|---|---|
| Switch | Off by default. The business owner turns it on. |
| Customer dates | Birthday and anniversary: **month needed, day optional, never the year**. |
| Permission to message | A separate yes/no/unknown per channel (WhatsApp, SMS, Email). **Unknown = no.** Who recorded it, when, how and why is kept. |
| Campaigns | One Birthday and one Anniversary offer, set up once and repeated every year. A % (with a max ₹) or a flat ₹ amount, a minimum spend, and the chosen services. A branch can have its own version that overrides the salon-wide one. |
| Versions | Editing a live campaign makes a new version. Offers already given keep their old terms. |
| Offers | One offer per customer, per occasion, per year. Valid from the 1st to the last day of the month, in the branch's time. **No messaging permission is needed to get the offer**; it only decides if staff may message the customer. |
| Front desk list | Who to contact, what the offer is, whether they may be messaged, and the next step: send, call, book, bill. |
| Contacting | One promotional message per customer per **7 days**. No answer means one follow-up the next day; after a second no answer the task is closed as "Unreachable". |
| Booking | A booking can carry the offer. Booking does **not** use the offer. |
| Checkout | Pick one offer. It applies only to eligible service lines and doesn't mix with other discounts. It is used up only when the bill is **issued**, and two desks can never use the same offer. A voided bill gives the offer back if the month isn't over. |
| Stop / withdraw | Turning a campaign off stops new offers; offers already given still work. In an emergency the business owner can withdraw all unused offers, with a reason. |
| Reports | Offers given, contacted, linked bookings, used, discount given, "associated sales" (never called "ROI"). |

Out of scope (PRD): wedding planning, relatives' birthdays, free services or gifts, loyalty, AI tuning, a customer-facing offer portal, offers for one exact day.

---

## B. What the code already has

| Need | Already there | Where |
|---|---|---|
| Salon / branch walls | `orgId` on every row, `scoped()`, `ctx.allowedBranchIds` | `server/src/utils/scoped.js`, `middleware/tenantContext.js` |
| Roles | OWNER + `allBranches` = business owner; OWNER + `branchIds` = branch owner; FRONT_DESK (one branch) | `config/constants.js`, `middleware/requireRole.js` |
| Permission matrix pattern | `assertCan(ctx, action)` | `modules/inventory/permissions.js` |
| Branch time zone | `Branch.timezone` (default Asia/Kolkata), luxon | `models/Branch.js`, `utils/time.js` |
| No double saves + transaction | `requireIdempotencyKey`, `runOnce` | `middleware/idempotency.js` |
| Activity log | `logActivity`, `AREAS` list | `modules/activity/activity.service.js` |
| Bell | `notify`, `businessOwnerIds`, `branchApproverIds` | `modules/notifications/notifications.service.js` |
| Rows that can never change | `appendOnly` | `models/fields.js` |
| Background job | `setInterval` loop started from `server.js`, atomic claim, dedupe key | `modules/inventory/automation/outbox.js` |
| Start-up migration | `migrateBilling()` run at start (safe to repeat) | `scripts/migrate-billing-v2.js`, `server.js` |
| Bill maths | `computeBill` (pure), `priceDraft`, `splitByPrice` | `modules/billing/tax.rules.js`, `modules/invoices/invoices.service.js`, `modules/payroll/commission.rules.js` |
| Issue / void in one transaction | `issueInvoice`, `voidInvoice` (guarded updates) | `modules/invoices/invoices.service.js` |
| Reports + CSV | `REPORTS` registry, `toCsv` | `modules/billing/reports.service.js`, `utils/csv.js` |
| WhatsApp link | `wa.me` link with a ready message | `client/src/features/billing/ShareBillModal.jsx` |
| Help assistant | `KNOWLEDGE` topics + tests | `modules/help/help.knowledge.js`, `tests/help.test.js` |
| UI pieces | `Drawer`, `Tabs`, `Table`, `Badge`, `Card`, `Modal`, `PageHeader`, `EmptyState`, `Pagination`, setup-wizard pattern | `client/src/components/ui/`, `features/inventory/setup/SetupGuide.jsx` |
| Money / time helpers | `formatMoney`, `toPaise`, `formatDate`, `todayIn`, `newRequestKey`, `useDebounce` | `client/src/lib/` |

**Gaps (what is new):**
- Customer: no anniversary, no messaging permission, **no home branch** (customers are shared by all branches today), no merge, no customer import.
- No offers, coupons or memberships anywhere. The only automatic discount is the combo price.
- No public booking page, so messages say "reply or call to book" rather than giving a booking link.
- The dashboard is owner-only; the front desk starts on **Today** (`DayBoardPage.jsx`).

---

## C. Ground rules
- **New module:** `server/src/modules/occasions/`, with small files per area (`settings`, `customers`, `campaigns`, `engine`, `worklist`, `outreach`, `checkout`, `reports`) and `permissions.js`. Models go in `server/src/models/occasions/` and are exported from `models/index.js`.
- **Routes:** `/api/occasions/...` (the app's style rather than the PRD's `/api/v1/...`). The salon and the user's role always come from the login, never from the request.
- **Client:** a new `client/src/features/occasions/` folder and `client/src/api/occasions.js`.
- **Money in whole paise; dates stored in UTC.** The month window is worked out in the **issuing branch's** time zone.
- **Every change:**
  - runs through `runOnce` with an idempotency key;
  - writes an `occasions.*` activity row (a new area in `AREAS`);
  - has its permission checked on the server, never only hidden in the screen.
- **Colours:** existing Tailwind tokens only (`gold`, `brown`, `surface`, `yellow-soft`, `orange`, `danger`, `good`), with the existing `Badge` tones.
- **Each phase:** `cd server && npm test`, `cd client && npm run build`, plus that phase's acceptance tests (AT-xx from PRD section 18).

---

## Phase 1: Switch, customer dates and messaging permission
*(PRD build order step 1 · screens CO-02, CO-10 · mock-ups UI-03 (switch part), UI-06, UI-07)*

**What owners and front desk get:**
- **Settings → Occasion offers** page (`/app/settings/occasions`):
  - The business owner has the switch "Enable Birthday & Anniversary Offers", showing three counts: birthday month known, anniversary month known, at least one messaging permission.
  - Branch owners can only look.
  - Switching on does **not** publish or send anything.
- **Customer form and profile** ("Personal details"):
  - "Birthday (optional)" and "Wedding anniversary (optional)", each a month list plus "Select day (optional)". Day is greyed out until a month is picked and must fit the month (29 Feb allowed).
  - Shows "November (day not provided)" when there is no day.
  - Sits under a folded "Optional details" section in Add customer, so saving without dates still works.
- **Home branch** on every customer:
  - Shown on the profile and editable by owners and front desk.
  - New customers get the branch they were added at.
- **Customer profile → "Messages & permission" tab:**
  - One row per channel (WhatsApp, SMS, Email): Opted in / Not recorded / Opted out, plus how and when it was recorded.
  - **Record permission:** a tick box that starts unticked, with the consent wording: "I agree to receive salon offers and promotions from [Salon] on WhatsApp / SMS / Email. I can opt out at any time." The person recording picks how it was given (customer form, in salon, customer request) and can add a note.
  - The front desk must tick "Customer asked for this".
  - **Withdraw** works straight away. **History** lists every change, which can never be edited.
  - Note shown on the tab: "An occasion offer may still be used in the salon even when messaging permission is absent."
- **Import dates (owners):**
  - Download a CSV of customers (customer ID, name, masked phone, current months).
  - Fill in the months and days, then upload.
  - Rows are checked before saving: bad rows are listed in a rejection file and good rows are saved.
  - Rows are matched by **customer ID**, never by phone alone. Imported rows **never** turn on messaging permission.
- **Remove occasion data (business owner):** clears a customer's dates and sets every channel to *opted out*, with a reason. This is the stand-in for the PRD's erasure request, because the app has no privacy workflow yet.

**Server work:**
- **`Organization.occasionOffers.enabled`** (+ who and when): kept here so the login session knows it, like add-ons. Login returns `org.occasionOffers`.
- **New `OccasionSettings`** (one per salon): consent wording + `noticeVersion`, channel order (default WhatsApp > SMS > Email), message wording (Phase 4), and the last engine run (Phase 3).
- **`Customer` gets:**
  - `occasions.birthday` / `occasions.anniversary` = `{ month 1–12, day?, source: CUSTOMER|STAFF|IMPORTED|MIGRATED, updatedAt, updatedBy }`, with a check that the day fits the month;
  - `homeBranchId`;
  - `marketing.{WHATSAPP|SMS|EMAIL}` = `{ status UNKNOWN|OPTED_IN|OPTED_OUT, source, noticeVersion, evidence, changedAt, changedBy }`;
  - `marketing.lastPromoAt` (for the 7-day limit, Phase 4).
  - Indexes `{ orgId, homeBranchId, 'occasions.birthday.month' }` and the same for anniversary.
- **New `ConsentEvent`** (`appendOnly`): old status → new status, by whom, when, evidence.
- **Migration `scripts/migrate-occasions-v1.js`** (runs at server start, safe to repeat, also `npm run migrate:occasions`):
  - `dob` → birthday month + day, read in UTC, source `MIGRATED`;
  - `homeBranchId` = branch of the customer's latest appointment, otherwise the salon's first active branch;
  - every channel = UNKNOWN (permission is **never** guessed from a phone number or past visits).
- **Routes:**
  - `GET/PUT /api/occasions/settings` (the PUT is business owner only and needs `If-Match`/version);
  - `PUT /api/occasions/customers/:id/dates`;
  - `POST /api/occasions/customers/:id/consents`;
  - `GET /api/occasions/customers/:id/consents/history`;
  - `GET /api/occasions/import/template`;
  - `POST /api/occasions/import`, with a check-only mode first, reusing `utils/csv.js`.
- **`occasions/permissions.js`** follows the PRD section 3 table, in the same style as `inventory/permissions.js`.

**Client work:**
- `features/occasions/settings/OccasionSettingsPage.jsx` (switch + counts);
- `CustomerFormModal.jsx` and `CustomerProfilePage.jsx` (replace "Date of birth", add home branch);
- new `features/customers/MessagesPermissionTab.jsx` and `ConsentModal.jsx`;
- `ImportDatesModal.jsx`;
- route and sidebar link (Settings → Occasion offers, owners).

**Tests:** AT-02 (customer with no dates), AT-34 (partial import), AT-36 (remove data, partly), plus:
- day must fit the month; 29 Feb is allowed;
- running the migration twice gives the same result;
- consent needs source and wording version; withdrawal is immediate; history can't be edited;
- front desk can't change settings (403, no change);
- one salon can't see another's data.

**Commit line:**
```
Occasion Offers Phase 1: feature switch, birthday and anniversary month/day on customers, home branch, per-channel messaging permission with history, date import, old birth dates migrated
```

---

## Phase 2: Campaigns, quick setup and versions
*(PRD step 2 · screens CO-01, CO-05 · mock-ups UI-02, UI-03, UI-04, UI-05)*

**What owners get:**
- **Quick setup in 3 steps** (copying the inventory `SetupGuide.jsx` pattern):
  1. **Enable:** the switch from Phase 1 plus the data counts.
  2. **Configure offers:** Birthday Month and Anniversary Month tabs. For each:
     - name; % or flat ₹; value; max ₹ (needed for %); minimum eligible spend; the services that count (ticked by **service ID**; all active services by default).
     - Locked notes: "Active period: entire occasion month · Repeats every year · Once per occasion per customer per year".
     - Starting suggestions, saved as **drafts**: Birthday = 15% off, max ₹500, minimum ₹0; Anniversary = flat ₹300 off on ₹1,500+.
  3. **Communication & publish:** "Staff sends offers" (chosen). "Send automatically" is visible but disabled, marked *Coming later*.
     - Publish summary: campaigns, whole month, eligible this month, can be messaged, mode.
     - Then **Publish**.
- **Settings page campaign list** (UI-02): name, type, scope (All branches / branch name), mode, status badge, Edit.
  - Delivery readiness: "Staff reminders ready".
  - Current-month audience: eligible / can be messaged / still to do (live from Phase 3).
- **Campaign detail page** (CO-05):
  - rules;
  - **version history** (who published what, when);
  - **Preview audience** (count + first 50 customers for this month, nothing saved);
  - **Turn off**, **Archive**.
  - Results come in Phase 6.
- **Branch campaigns:**
  - The business owner can create a "This branch only" campaign for any branch; a branch owner only for their own branches.
  - It overrides the salon-wide one for customers whose home branch is that branch.
  - A branch owner sees the salon-wide campaign read-only.

**Server work:**
- **New `OccasionCampaign`:** `type` BIRTHDAY|ANNIVERSARY (fixed after first publish); `scope` BUSINESS_DEFAULT|BRANCH_ONLY; `branchId`; `name`; `status` DRAFT|PUBLISHED|DISABLED|ARCHIVED; `currentVersion`; `draftRules`; `deliveryMode` (STAFF_ASSISTED only for now); `version` for stale-edit checks; created/updated by.
  - Unique index: only one PUBLISHED campaign per `{orgId, type, scope, branchId}`.
- **New `OccasionCampaignVersion`** (`appendOnly`): frozen rules `{ discountType PERCENT|FLAT, value, maxDiscount, minSubtotal, serviceIds[] }`, message wording, publishedBy and publishedAt. Unique `{campaignId, version}`.
- **Rule checks (pure, in `campaigns/campaign.rules.js`):**
  - % must be above 0 and at most 100, with a max of up to ₹1,00,000; a flat amount must be above 0; minimum ≥ 0;
  - at least one active service;
  - name unique per scope and type among live campaigns.
- **Lifecycle:**
  - publish DRAFT → v1;
  - editing a published campaign saves a draft of the next version, and publishing it makes v N+1;
  - turn off (DISABLED) and turn back on;
  - archive (only when turned off).
  - No hard delete after publishing. Every step is an activity row; publishing triggers the engine (Phase 3).
- **"Winning campaign" function:** the customer's home-branch campaign if it is published, otherwise the salon-wide one. It is used by preview now and by the engine later.
- **Routes:**
  - `GET/POST /api/occasions/campaigns`;
  - `PATCH /campaigns/:id` (version check);
  - `POST /campaigns/:id/publish|disable|enable|archive`;
  - `GET /campaigns/:id/versions`;
  - `GET /campaigns/:id/preview`.

**Client work:**
- `features/occasions/setup/QuickSetup.jsx` (3 steps);
- `CampaignForm.jsx` (shared by setup and edit);
- `CampaignList.jsx`;
- `CampaignDetailPage.jsx` (`/app/settings/occasions/campaigns/:id`).

**Tests:**
- AT-31 (front desk edit → 403 + logged, nothing changed);
- rule checks; publish → v1; edit → v2 while v1 rows are untouched; can't change type after publishing; one published per scope;
- a branch owner can't touch another branch's or the salon-wide campaign;
- the winning campaign is the branch override.

**Commit line:**
```
Occasion Offers Phase 2: birthday and anniversary campaigns with 3-step quick setup, branch overrides, immutable versions, audience preview, turn off and archive
```

---

## Phase 3: Monthly offer engine and the front desk list
*(PRD step 3 + first half of step 4 · screens CO-03, CO-04 · mock-ups UI-01, UI-08, UI-09, UI-16)*

**What owners and front desk get:**
- **Offers appear by themselves:**
  - From 01:00 (branch time) on the 1st of each month, every matching customer gets one offer, valid until the last day 23:59:59 in that branch's time.
  - A customer added mid-month, or whose dates are changed, gets theirs within minutes.
  - Next year it happens again automatically.
- **Customer occasions page** (`/app/occasions`; sidebar "Occasion offers", shown only when the feature is on):
  - **Four tiles:** Eligible · Needs action · Booked · Used.
  - **Tabs:** Action required · All eligible · Contacted · Booked · Used · Excluded.
  - **Filters:** search (name or mobile), occasion, month, can-be-messaged, assigned to, branch (owners with several branches).
  - **Columns:** customer (masked mobile), occasion + day/month, offer summary + expiry, contact (WhatsApp/SMS/Email / no permission / no valid number), staff step, booking, offer status, next action.
- **Side drawer per customer:** occasion, frozen offer terms, expiry, messaging permission, task + assignee, timeline of everything that happened. It is read-only in this phase; buttons come in Phase 4.
- **Narrow screens / tablet** (UI-16): below `md` the table becomes stacked cards, the drawer becomes a full panel, and the main buttons stick to the bottom.
- **Widget "Customer occasions — this month"** on the owner **Dashboard** and on the front desk **Today** page: the counts plus "Open list", which opens Action required for the current branch and month.
- **Customer profile:** an "Occasion offers" card shows this year's offers and their status.
- **Changing a date that affects this month's unused offer** asks first: "This change alters current-month offer eligibility. Review and confirm correction." On yes, the old offer is marked *replaced* and the new month is checked.
  - A day change in the same month does nothing.
  - If the offer is already used, the date can change but **no second offer** is given this year.
- **Emergency withdraw** (business owner, campaign page): pick a year, type a reason, confirm.
  - All **unused** offers of that campaign are withdrawn; used bills are untouched.
  - Customers who were already contacted get a task "Let the customer know the offer was withdrawn".
  - Owners get a bell.
- **Settings page:** "Last successful run" with time and counts. A **Check now** button runs this month again safely (nothing is ever given twice).

**Server work:**
- **New `OfferIssue`:**
  - `orgId`, `customerId`, `campaignId`, `campaignVersionId`, frozen `rules`, `type`, `year`, `month`, `branchId` (issuing branch), `validFrom`/`validUntil` (UTC), `status` ISSUED|REDEEMED|EXPIRED|REVOKED|SUPERSEDED, `superseded: false`, `invoiceId`, `discountGiven`, `revokedReason`, `appointmentIds`.
  - Embedded **`task`** `{ state, dueAt, assigneeId, attempts, outcome, closedReason, closedAt }`, so there is only one open task per offer.
  - **Unique `{orgId, customerId, type, year}` where `superseded: false`**, so no customer ever gets two offers.
- **New `OfferEvent`** (`appendOnly`): ISSUED, ASSIGNED, CONTACT, SENT, BOOKED, REDEEMED, RESTORED, EXPIRED, REVOKED, SUPERSEDED, with actor, note and time. It feeds the drawer timeline.
- **`occasions/engine/`:**
  - `issue.js`: for one branch and month, reads customers by index, picks the winning campaign and does a bulk **upsert with `$setOnInsert`** in batches of 1,000. Running it again is harmless.
  - `expire.js`: ISSUED past `validUntil` → EXPIRED; closes the open task.
  - `reevaluate.js`: one customer, run after a date or home-branch change or a campaign publish.
  - `scheduler.js`: `startOccasionAutomation()` started from `server.js` like inventory's. A `setInterval` every 10 minutes checks each enabled salon's branches in **their own time zone**.
    - After 01:00 it issues the month (if not already done today) and expires old offers.
    - A lock row stops two servers running the same branch at once.
    - It picks up missed days after downtime.
- **Who gets an offer:** customer in the salon, home branch active, occasion month = this month (branch time), winning campaign published and turned on, not already given this year. Messaging permission is **not** checked. February birthdays (including 29 Feb) get the whole of February every year. Moving to another branch mid-month doesn't create a second offer.
- **Task due time:**
  - given on the 1st → due the 1st at 10:00;
  - given later → next day at 10:00;
  - every day counts as a working day, because the app has no closed-days setting.
- **Front desk visibility:** front desk see only offers of their branch; branch owners their branches; the business owner all. A customer who moved branch shows at the new home branch.
- **Routes:**
  - `GET /api/occasions/offers` (cursor paging, 50 by default and 200 at most; all filtering done in the database);
  - `GET /offers/summary` (tiles and widget);
  - `GET /offers/:id`;
  - `POST /campaigns/:id/revoke`;
  - `POST /settings/run-now`.

**Client work:**
- `features/occasions/worklist/` (`OccasionsPage.jsx`, `OfferTable.jsx`, `OfferCards.jsx` for narrow screens, `OfferDrawer.jsx`);
- a `size` prop on the shared `Drawer` (`wide`);
- `OccasionWidget.jsx` used in `DashboardPage.jsx` and `DayBoardPage.jsx`;
- the date-correction confirm in the customer form.

**Tests:**
- AT-01, AT-03 (month only), AT-04 (29 Feb in a non-leap year), AT-05 (added mid-month), **AT-06** (scheduler run 5 times → one offer, one task), AT-07 (branch override wins), AT-08 (branch move), AT-09 (both in one month → two offers), AT-10 (no permission → offer still given), AT-29 (turned off → no new offers, old ones stay), AT-30 (withdraw), AT-33 (ends at 23:59:59 branch time, including the Dubai branch);
- date correction;
- worklist branch walls.

**Commit line:**
```
Occasion Offers Phase 3: monthly offer engine with branch time zones, yearly repeat, date corrections and emergency withdraw, front desk occasion list with drawer, tablet cards, dashboard and Today widgets
```

---

## Phase 4: Staff follow-up — send, call, record, assign
*(PRD rest of step 4 · screens CO-03 actions · mock-ups UI-09, UI-10, UI-15)*

**What owners and front desk get (drawer buttons):**
- **Send offer:** shown **only** when a channel has *Opted in* and a valid number or email.
  - The app picks the first allowed channel in the salon's order (WhatsApp > SMS > Email).
  - A preview shows the recipient, channel and the finished message.
  - **Confirm send** runs the final check, then opens WhatsApp (`wa.me`), SMS (`sms:`) or email (`mailto:`) with the message filled in, and marks the task "Contacted via WhatsApp".
- **No permission:** Send is hidden. The drawer shows "Offer available in salon. Promotional message disabled: permission not recorded." and "Ask for permission at the next visit". No message is ever used to ask for permission.
- **7-day limit:** a message sent in the last 7 days blocks Send. The drawer shows "Customer contacted recently; next promotional contact permitted on [date/time]". With both occasions in one month, birthday goes first and the anniversary waits.
- **Record call outcome:** Reached · No answer · Not interested · Call later (pick a date and time before the month ends) · Wrong details.
  - No answer → one follow-up the next day at 11:00. A second no answer closes the task as **Unreachable**.
  - Not interested → closed.
  - Wrong details → closed, with a prompt to fix the number.
  - Recording a call never counts as a message and never bypasses permission.
- **Assign to** another front desk person in the same branch, or an owner. The history is kept.
- **Create booking:** opens booking with the customer and offer filled in (works in Phase 5).
- **Tasks close by themselves** when the offer is used, expires or is withdrawn, or the customer opts out of every channel. Each close has a reason.
- **Message wording:** owners can edit the WhatsApp / SMS / Email wording per campaign. The wording must keep `{first_name}`, `{salon_name}`, `{offer_summary}`, `{expiry_date}` and the opt-out line ("Reply STOP to opt out" / "Opt-out: …"). Defaults come from PRD 9.5. Because there is no booking page, the message ends with "Reply or call {salon_phone} to book".

**Server work:**
- **`occasions/outreach/`:**
  - `templates.js`: default wording; fills in values with safe, short text (never the birth year).
  - `gate.js` (pure): permission = OPTED_IN, valid destination, offer still ISSUED and not expired, campaign not withdrawn, customer within the user's branches, 7-day limit.
  - `send.js`: re-checks everything **on the server** at confirm time, then takes the 7-day slot with **one guarded update** on `Customer.marketing.lastPromoAt` (older than 7 days or empty). It writes a SENT event, updates the task and returns the link plus text. The idempotency key stops a double click from counting twice.
  - `contact.js`: outcomes and follow-up rules (`task.attempts`, `dueAt`); `assign.js`.
- **Opt-out hook:** when consent is withdrawn (Phase 1 route), open tasks are closed if no channel is left, and a send in progress is refused.
- **Routes:**
  - `POST /api/occasions/offers/:id/send` `{ channel }`;
  - `POST /offers/:id/contact` `{ outcome, note, callbackAt }`;
  - `POST /offers/:id/assign` `{ assigneeId }`;
  - `PUT /campaigns/:id/messages`.

**Client work:**
- `SendOfferModal.jsx` (UI-10 layout);
- `RecordOutcomeModal.jsx`;
- `AssignSelect.jsx`;
- the drawer's action area (fixed at the bottom on narrow screens);
- the error/exclusion states from PRD section 15 and UI-15 as shared small components.

**Tests:**
- AT-09 (7-day limit holds the second message);
- AT-10 (no permission → no send; offer still usable);
- AT-11 (WhatsApp opted out, SMS opted in → SMS);
- AT-12 (permission withdrawn between preview and confirm → refused, logged);
- AT-16 (no answer twice → Unreachable, full history);
- two desks pressing Send at the same moment → one message counted;
- front desk can't act on another branch's offer.

**Not applicable in this build** (no automatic sending): AT-13, AT-14, AT-15.

**Commit line:**
```
Occasion Offers Phase 4: staff follow-up with permission-checked WhatsApp/SMS/email send, 7-day contact limit, call outcomes with follow-ups, assignment, editable message wording
```

---

## Phase 5: Bookings and checkout — apply and use the offer
*(PRD step 5 · screens CO-06, CO-07 · mock-ups UI-11, UI-12, UI-15)*

**What owners and front desk get:**
- **Booking:**
  - Once a customer is picked, an "Eligible occasion offer" box shows the offer, its max and its expiry, with "Booking does not use the offer."
  - With services chosen, a **Potential offer** line shows the likely discount.
  - If the date is after the offer ends, a warning says the offer will have expired and promises nothing.
  - Booking from the occasion list marks it **"Linked to Birthday Month campaign — not used yet"**. An ordinary booking in the birthday month is **not** counted as linked.
- **Today / appointment drawer:** a badge "Birthday offer available till 30 Nov" at check-in, without opening the offers page.
- **Checkout** (`DraftEditor.jsx`): an **Available occasion offer** box with **Apply offer**.
  - It shows the eligible subtotal, the discount, the expiry and the new payable amount, worked out by the server.
  - Only one offer per bill. If both occasions are open, staff pick one; the other can be used on another bill.
  - A new totals row reads "Birthday offer −₹300".
  - **Not eligible** messages: "Add ₹[x] of eligible services to qualify for this offer", "This occasion offer expired on [date]…", "Offer redeemed on invoice [number] at [branch/date]", "No eligible service on this bill".
  - Editing the bill re-works the offer straight away.
- **Issuing the bill uses the offer.**
  - If another desk used it a moment earlier: "Offer was redeemed elsewhere. Invoice refreshed; please review payable." The offer is taken off the draft and nothing is used.
  - Any failure leaves the offer free.
- **Bill page, PDF and share:** the offer row appears.
- **Void** (existing owner action): if the month isn't over, the offer becomes usable again (exactly once). After the month it stays expired.
- **Refunds** never give the offer back; the credit note handles the money.

**Server work:**
- **`Appointment` gets** `offerIssueId` and `offerLinked`. These are set only when booked from the list or when staff tick the offer, and checked to be the same customer and still ISSUED. Booking, moving, no-show and cancel never change the offer.
- **`Invoice` gets** `offer { offerIssueId, type, campaignName, rules, eligibleSubtotal, discount }`; each line gets `occasionDiscount`; the bill gets `occasionDiscountTotal` (counted in `discountTotal`, not in `manualDiscount`, so the front desk discount limit is unaffected).
- **`tax.rules.js` `computeBill`:** a new step after the combo price and before manual discounts.
  - Eligible lines = SERVICE lines whose `serviceId` is in the frozen rules, with no combo price.
  - The eligible subtotal is taken **before GST**. Min-spend check; % (rounded to the paisa, capped at the max and at the subtotal) or flat (capped at the subtotal).
  - The discount is spread over the eligible lines with `splitByPrice`, with the leftover paisa on the last line. No line can go below zero.
  - GST is then recalculated by the existing engine, so no tax rate is hard-coded.
- **`occasions/checkout/`:**
  - `eligibleOffers(ctx, invoice)` returns the choices and the "not eligible" reasons.
  - `applyToDraft` / `removeFromDraft` go through `priceDraft`.
  - **No mixing:** while an offer is on the bill, manual line and bill discounts are switched off (the screen explains why).
- **`issueInvoice`:** after `priceDraft`, inside the same transaction, a **guarded update** `OfferIssue {_id, status: ISSUED, validUntil > now, customerId}` → REDEEMED with `invoiceId` and `discountGiven`, plus a REDEEMED event and the task closed. No match → 409 `OFFER_TAKEN` and nothing is saved.
- **`voidInvoice`:** in the same transaction, REDEEMED → ISSUED if still in the month, otherwise → EXPIRED; plus a RESTORED event and an activity row.
- **`openDraft`:** a linked appointment shows its offer as "Available" (not applied automatically).
- **Routes:**
  - `GET /api/invoices/:id/occasion-offers`;
  - `POST /api/invoices/:id/occasion-offer` `{ offerIssueId | null }`;
  - `GET /api/occasions/customers/:id/live-offers` (booking box).

**Client work:**
- `BookingForm.jsx` (offer box + potential discount + warning);
- `AppointmentDrawer.jsx` badge;
- `features/occasions/checkout/OfferPanel.jsx` inside `DraftEditor.jsx`;
- `InvoicePage.jsx` and `invoice.pdf.js` offer row;
- add the `'offers'` query key to `useBillMutation`.

**Tests:**
- AT-17 (linked booking, nothing used), AT-18 (cancelled booking → still usable), AT-19 (no eligible service), AT-20 (₹1,499.99 against a ₹1,500 minimum → refused), **AT-21** (15% of ₹2,000, max ₹500 → ₹300 spread over lines), AT-22 (flat ₹300 on ₹200 → ₹200), AT-23 (different GST rates, prices with and without GST), AT-24 (no mixing with other discounts), **AT-25** (two bills issued at the same time → one wins, the other gets 409), AT-26 (payment fails → offer not used), AT-27 (void in the month → usable again exactly once), AT-28 (void after the month → stays expired);
- old bills without an offer still price the same.

**Commit line:**
```
Occasion Offers Phase 5: offer on bookings and check-in, apply offer at checkout with live preview, discount spread before GST, used only when the bill is issued, safe against double use, restored on void
```

---

## Phase 6: Reports, demo data, help and final checks
*(PRD steps 8–9 · screen CO-08 · mock-up UI-13)*

**What owners get:**
- **Reports → Occasion offers** page (owners; a branch owner sees their branches):
  - **Tiles:** Offers issued · Customers contacted · Offer-linked appointments · Redeemed offers.
  - **Customer progression bars:** Eligible → Contacted → Booked → Used, labelled "Counts by step; not a profit claim".
  - **Discount & billing:** Associated sales, Discounts given, Used / issued %, period.
  - **Filters:** month or date range, occasion, campaign/version, branch, channel, can-be-messaged.
  - **By-branch table** and **staff activity** (contacts, reached, linked bookings, uses; no sales credit to individuals).
  - **Export CSV** (owners only; the export is logged with who and which filters).
- The existing **Discounts given** billing report gets an "Occasion offer" column, so the totals match the bills.
- The front desk sees only the widget counts.

**Server work:**
- `occasions/reports/report.service.js`, using the PRD section 16 definitions:
  - **Contacted** = a message sent through the app or a "Reached" call.
  - **Linked bookings** = appointments with `offerLinked`.
  - **Used** = REDEEMED, not undone.
  - **Associated sales** = net value of bills that used an offer, after refunds.
  - **Discounts** = the offer discount on issued bills minus voids.
- `GET /api/occasions/reports?format=csv` through `toCsv`.
- **Demo data in `seed.js`** (new section 9, months worked out from today so it always looks live):
  - Glamour has the feature on, a salon-wide Birthday campaign (15% Hair Spa, max ₹500), an Anniversary campaign (₹300 off on ₹1,500+) and a Bandra-only birthday override.
  - Priya: birthday this month, WhatsApp opted in, task due.
  - Simran: anniversary, no permission ("In-salon only").
  - Neha: both occasions, one no-answer follow-up.
  - One offer already used on an issued bill.
  - Desert Rose (Dubai) has the feature off.
- **Help assistant topics:** setting up occasion offers, adding birthdays and anniversaries, messaging permission, the occasion list, applying an offer at checkout, why the offer can't be applied. Plus `help.test.js` questions.
- **Checks:**
  - Full role matrix test (like `inventoryRolesMatrix.test.js`) for PRD section 3.
  - `isolation-smoke-test.js` extended to the new collections (AT-32).
  - A speed script with **100,000 customers**: the monthly run must take under 15 minutes, the list under 2 s per 50 rows, and the checkout offer preview under 700 ms.
- **README:** an occasion offers section, the AT-01 to AT-36 map (with AT-13/14/15 marked not applicable), known limits, and a note that consent wording should be checked by a lawyer (DPDP Act) before going live.

**Client work:** `features/occasions/reports/OccasionReportsPage.jsx` (tiles, simple bars with Tailwind, tables, CSV) plus a link from Reports and from the Settings campaign page.

**Tests:** AT-32, AT-35 (report after a refund matches billing), report totals match the bills, CSV access by role.

**Commit line:**
```
Occasion Offers Phase 6: occasion offer reports with CSV, discounts report updated, demo data, help topics, role and isolation checks, 100k-customer speed check, README
```

---

## Defaults chosen (to confirm when each phase is done)
- **Home branch for old customers** = branch of their latest appointment, otherwise the first branch. The front desk sees offers of its own branch only.
- **Every day is a working day** for follow-up times (the app has no closed-days setting).
- **No mixing:** while an occasion offer is on a bill, manual discounts are off and combo-priced lines don't count.
- **Turning the whole feature off** hides the list and stops new offers. Offers already given can still be used at checkout until month end.
- **Calls don't count** towards the 7-day message limit; only "Send offer" does.
- **Message ending:** "Reply or call {salon_phone} to book", because there is no public booking page.
- **Emergency withdraw:** only customers who were already contacted get a "tell the customer" task.
- **Consent wording version** starts at `v1`; changing the wording in Settings raises the version.

---

## Not in this build (and why)
- Automatic sending, provider connections (WhatsApp Business API, DLT SMS, email domain), the provider health page (CO-09), delivery receipts, webhooks and retries/fallback between providers. **User's choice:** staff reminders only. The data model keeps `deliveryMode` and the channel order, so this can be added later as its own phase.
- Signed booking links (PRD item 34): the app has no public booking page.
- Customer merge (PRD 5.1 rule 6): the app has no merge feature yet.
- A full privacy/erasure workflow: only "Remove occasion data" is added.

---

## How to check each phase
- `cd server && npm test`: all old and new tests pass.
- `cd client && npm run build`.
- Run the app with the demo logins:
  - **`owner@glamour.com`:** switch the feature on, run the 3-step setup, publish both campaigns, see the list fill, edit a campaign and see v2, withdraw in an emergency, view the reports and the CSV.
  - **`desk.andheri@glamour.com`:** add a birthday to a customer, record WhatsApp permission, send the offer (WhatsApp opens), record a no-answer, book from the list, check out with the offer, then try the same offer on a second bill.
  - Check the occasion list on a narrow (tablet) window.
- Stop after each phase with a plain summary and the commit line. The user commits and pushes.
