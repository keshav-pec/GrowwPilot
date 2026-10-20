# Billing, POS & Payments plan

Based on *GrowwPilot Billing, POS & Payments Enhancement PRD v1.0* (18 Oct 2026), adapted to this app's MERN stack (MongoDB + Mongoose, Express, React, Node).
Built in phases; each phase ends with a check-and-commit stop. Where this plan is silent, the PRD wins.

---

## Context
The user shared the *Billing, POS & Payments Enhancement PRD v1.0* (18 Oct 2026). Today a bill is made and fully paid in one step, with no GST, no part payments, no refunds and no product sales. The PRD asks to grow the **existing** checkout into a proper till that can stand up to an audit, without building a second checkout or a second set of money numbers.
This file has three parts: (A) the PRD in simple words, (B) what the code already does, and (C) the build plan in **Phase 1 to Phase 4**. Each phase ends with a review stop and a commit line for the user to commit and push themselves.

**Decisions made with the user (18 Oct 2026)**
- **GST is optional per salon:** *GST registered* (GSTIN, tax on bills) or *Not registered* (plain bill). Composition scheme is not supported for now.
- **Prices include GST by default.** Each salon can switch to "GST extra".
- **Guest bills for products only,** when the salon switches this on. Services always need a customer.
- **"Add product" at checkout only when the Inventory add-on is on.** There is no second product list.

---

## A. The PRD in simple words

| Area | What it means |
|---|---|
| One checkout | Upgrade today's checkout; never build a second one |
| Three ways to bill | Finished appointment; walk-in or product-only sale; take a payment later on an existing bill |
| Draft → issued | A bill can be changed while it's a draft. Once issued, it gets its number and is locked. Mistakes are fixed with a credit note. |
| GST | Salon's legal name, GSTIN and state. Tax rate per service or product. A saved copy of prices and tax on every bill. Numbers restart each financial year. A tax expert must check before going live. |
| Discounts | Flat or %, per line or whole bill. Front desk has a limit; above it an owner approves. Changing a price needs permission and a reason. |
| Payments | Split (UPI + cash), part payments ("₹500 due"), pay later. Cash, UPI, Card or Other. Never recorded twice. |
| Advances | Customer pays ahead; used on a later bill; never over-used |
| Products | Sell retail products; stock goes down exactly once |
| Refunds | Pick lines, give a reason, owner approves. A product goes back to stock only if sellable. Service refunds don't return used products. Credit note under GST. |
| Commission | Stays on the existing payroll engine. Based on what was paid, after discount, without GST. Refunds add minus lines. |
| Cash closing | Opening cash + cash in − cash out = expected. The app shows the gap against the counted cash. A closed day can't be edited. |
| Reports | Gross billed, discounts, net sales, collections, dues with age, advances, retail, cash closing, sales by staff |
| Who can do what | Business owner: all. Branch owner: their branches, some things only "if delegated". Front desk: bill and take payments; refunds and big discounts are requests only. |
| Safety | Every money change is logged with who, when and why; runs in one transaction; strict salon/branch walls; no card numbers stored |

Out of scope: full accounting, bank matching, memberships/packages/loyalty, payment gateway.

---

## B. What the code already does

**Today's billing:**
- `CheckoutPage.jsx` handles completed appointments only.
- `calculateCheckout` in `server/src/modules/invoices/invoices.service.js` does the flat/% discount and split payments (Cash/UPI/Card, up to 5), but the payments **must equal the total**.
- Bill numbers run per branch (`GP-AND-000123`) and are given out safely in a transaction.
- Line snapshot, double-checkout protection, commission written with the bill, a printable page, customer spend, the dashboard "finished but not paid" list, analytics revenue, and 11 tests in `server/tests/invoices.test.js`.

**Helpers to reuse:**
| Helper | Where |
|---|---|
| `requireIdempotencyKey`, `runOnce` (no double saves, runs in a transaction) | `server/src/middleware/idempotency.js` |
| `logActivity` (activity log that can't be edited) | `server/src/modules/activity/activity.service.js` |
| `notify`, `branchApproverIds`, `businessOwnerIds` (bell) | `server/src/modules/notifications/notifications.service.js` |
| `postMovement` (the only place stock changes) | `server/src/modules/inventory/stock/stock.engine.js` |
| `recordInvoiceCommissions`, and `CommissionEntry.type` already has `'reversal'` | `server/src/modules/payroll/commission.service.js`, `models/CommissionEntry.js` |
| `splitByPrice` (spreads an amount over lines fairly, to the paisa) | `server/src/modules/payroll/commission.rules.js` |
| `Counter` (safe running numbers) | `models/Counter.js` |
| `scoped()` + `ctx.allowedBranchIds` (salon/branch walls) | `server/src/utils/scoped.js` |
| `appendOnly` (rows that can never change) | `models/fields.js` |
| pdfkit PDFs, CSV report export | `analytics.pdf.js`, `inventory/reports/reports.routes.js` |
| Per-branch switches and limits pattern | `models/inventory/InventorySettings.js` |
| `version` / `STALE_VERSION` (stale edit refused) | Inventory products |

**Gap summary:**
- **REUSE:** split payment, flat/% discount, safe numbering, branch walls, the helpers above.
- **EXTEND:** the Invoice model, the checkout and bill pages, commission, the customer profile, analytics.
- **MIGRATE:**
  - Payments move out of the bill into their own records.
  - Old bills are marked "issued + paid", keeping their old numbers.
  - New numbering is per financial year.
- **NEW:** GST, drafts, part payments and dues, product sales, refunds and credit notes, advances, cash closing, the bill list, delegation switches.

About 20% is done, 30% is quick on existing helpers, and half is new.

---

## C. Build plan

### Ground rules
- **No second invoice model.** `Invoice` grows; its routes stay at `/api/invoices`. New areas get `/api/payments`, `/api/refunds`, `/api/advances`, `/api/cash-sessions` and `/api/billing/settings|reports`, following the app's style rather than the PRD's `/api/v1/billing`.
- **Money:**
  - Whole paise; tax rates in basis points (1800 = 18%).
  - The server always works out prices and tax. The browser only shows a preview.
- **Every money change:**
  - Runs in one transaction with an idempotency key.
  - Writes a `billing.*` activity log row.
  - Notifies owners where an approval is needed.
- **Old bills keep working at every step.** Each phase runs `npm test` (server) and the client build, and adds its acceptance tests.
- **`BILLING_PLAN.md`** (this file) holds the plan and its decisions; it is updated as each phase is finished.

---

### Phase 1: GST bills, drafts, discounts, split and part payments (PRD P0)
**What owners and front desk get:**
- A **Billing settings** page (owners):
  - Salon legal name, GST registered yes/no, prices include GST (default yes), default service GST rate (18%).
  - Per branch: GSTIN, state, bill prefix.
  - Front desk discount limit; guest product sales switch (used in Phase 2).
- A GST rate (and optional SAC code) on each service; blank means the salon default.
- **Checkout:**
  - Opens a **draft** bill from the appointment.
  - Discount per line or on the whole bill.
  - Live GST breakdown (CGST + SGST) worked out by the server.
  - **Issue & Pay** button. Paying less than the total is allowed and leaves "₹X due".
- **Bill page:**
  - Status (Paid / Part paid / Unpaid), GST lines, list of payments.
  - **Record payment** for the rest.
  - Print stays browser print for now.
- A new **Bills** list (sidebar): search by number or customer; filter by date, status and branch.
- **Discount above the front desk limit:**
  - The draft waits for owner approval (bell). Once approved, the front desk issues it.
  - Changing a price: owners only, with a reason.
- **Bill numbers:** new ones look like `AND/26-27/00001` (per branch, per financial year, at most 16 characters). Old `GP-AND-000123` numbers stay as they are.

**Server work:**
- **New `BillingSettings` model:** salon-level plus per-branch GSTIN/state, the same pattern as `InventorySettings`. `Service` gets `taxRateBps` and `sacCode`.
- **New `server/src/modules/billing/tax.rules.js`:** pure functions, easy to test.
  - Line amounts, discounts and invoice-level discounts are spread with `splitByPrice`. The combo price gap is treated as a line discount.
  - Inclusive and exclusive GST; tax rounded per line, half-up.
  - CGST/SGST split; not-registered = no tax.
- **`Invoice` model extended:**
  - Statuses: `status` DRAFT/ISSUED/VOID, `settlementStatus` UNPAID/PARTIALLY_PAID/PAID, `refundStatus` (Phase 2).
  - `appointmentId` becomes optional, kept unique for non-void bills with a partial unique index.
  - `customerId` is optional (guest product sales, Phase 2).
  - Line fields: kind SERVICE/PRODUCT, appointment item id, staff, qty, unit price, discount, taxable amount, tax rate, CGST, SGST, line total.
  - Bill-level fields: tax summary, seller/customer snapshot, `subtotal`, `discountTotal`, `taxTotal`, `grandTotal`, `amountPaid`, `balanceDue`, `financialYear`, `issuedAt`, `version`.
  - A draft has no number. The number is given at issue using the `Counter` key `invoice:{branchId}:{FY}`.
- **New `Payment` + `PaymentAllocation` models:**
  - Method CASH/UPI/CARD/OTHER, `verificationStatus: RECORDED`, status VALID/REVERSED, `recordedBy`, `receivedAt`.
  - An allocation uses a guarded update (`amountPaid + x <= grandTotal`), so two desks can never over-pay a bill.
- **Flow:**
  - `POST /invoices` creates or opens a draft (idempotent).
  - `PATCH /invoices/:id` edits it (version check).
  - `POST /invoices/:id/quote` and `POST /invoices/:id/issue` take optional payments and run in one transaction.
  - `POST /payments` takes a later payment.
  - Issue sets `appointment.invoiceId`.
- **Commission (default to confirm):** written when the bill becomes **fully paid**, on the line's taxable amount (without GST, after discount), with `day` = the day it became fully paid. Adjust `recordInvoiceCommissions` to use line taxable amounts.
- **Migration script `server/src/scripts/migrate-billing-v2.js`** (safe to run twice, also run from seed):
  - Old bills → ISSUED + PAID, `grandTotal = total`, `issuedAt = paidAt`, tax 0.
  - Embedded payments → `Payment` + `PaymentAllocation`.
- **Readers updated** to issued bills only, using `grandTotal` and `issuedAt`: `dashboard.service.js`, `customers.service.js`, `analytics.service.js`, `commission.service.js`.
- **Dashboard:** "finished but not billed" plus a new "bills with dues" item.
- **Activity log:** add a `billing` area.
- **Walk-in services** keep going through a walk-in appointment (already exists), so there is no second service checkout.

**Client work:**
- `CheckoutPage.jsx` and `InvoicePage.jsx` reworked.
- New `features/billing/` (BillsListPage, RecordPaymentModal, BillingSettingsPage).
- `api/invoices.js` gets an Idempotency-Key per form.
- Routes in `client/src/routes/router.jsx`; sidebar link.

**Tests:** AC01 (old bills and migration), AC02 (services part), AC04, AC05, AC06, AC07, AC08, AC09, AC10, AC11, AC12, AC22, AC23 (snapshot) and AC21 for the new routes.

**Commit line:**
```
Billing Phase 1: GST-ready bills with drafts, per-line and bill discounts with approval, split and part payments, bills list, billing settings, old bills migrated
```

**Phase 1 status: built (18 Oct 2026), waiting for the user's check.**
- **How it was built (where it differs from the text above):**
  - Old bills are moved by `migrate-billing-v2.js`, which also **runs by itself when the server starts** (it does nothing once every bill is moved), so a deploy can't forget it. `npm run migrate:billing` runs it by hand.
  - New salons start as **Not GST registered**, so nothing changes for a salon until the business owner switches GST on.
  - Opening checkout (`POST /invoices`) is safe to repeat because of the one-bill-per-appointment index, so it needs no request key. Issue, payments, approvals and settings do need one.
  - Discount approval routes: `POST /invoices/:id/request-approval`, `/approve` and `/reject` (a reason is required to turn one down).
  - Payment method **Other** was added (with a note in the reference box).
  - The in-app help answers for checkout, discounts and bills were updated to match the new screens.
- **Defaults picked for Phase 1 (to confirm):**
  - Only the business owner changes billing settings; branch owners can only look.
  - A GST salon can't issue bills at a branch with no GSTIN (the desk is told to ask an owner).
  - Approval covers one discount amount. If the desk raises the discount afterwards, it needs approving again; lowering it is fine.
  - A bill prefix already printed on another branch's bills can't be reused.
  - "Revenue" on the dashboard and in analytics = bills issued (including any part still due). Payment mix = money actually received.
- **To check with a tax adviser:** salon services were moved from 18% to **5% GST (without input tax credit) from 22 Sep 2025**. The default rate stays at 18% as this plan says, and each salon can change it in Billing settings.

---

### Phase 2: Products, refunds, advances, stock and commission links (PRD P1)
**What owners and front desk get:**
- **Selling products** (Inventory on only):
  - Retail products get a selling price, GST rate and HSN code in the product form.
  - **Add product** at checkout (search or barcode, shows stock; not enough stock blocks issue).
  - A **New sale** button on Bills for product-only sales, to a customer or to "Guest" if the salon allows it.
- **Refund / return:**
  - From a bill: pick lines, quantity, reason; products marked **sellable** or **damaged**.
  - Front desk can only request; owners approve. Branch owners can approve if delegated (default on).
  - On approval: the money goes out (a refund payment), a **credit note** is made (GST salons, number `CN-AND/26-27/0001`), stock is handled, and commission minus lines are added.
- **Void a bill:** owners only, with a reason, and only if no payment is left on it.
- **Customer advances:**
  - Take an advance on the customer profile.
  - Use it at checkout ("Use advance ₹X").
  - Extra money at checkout can be kept as an advance instead of being refused.
- **Reverse a wrongly recorded payment:** owners, with a reason. The bill's due amount comes back.

**Server work:**
- **`InventorySku`:** add `sellPrice`, `taxRateBps`, `hsnCode` (only `RETAIL` type can be sold).
- **New movement types and bucket:**
  - Types: `SALE`, `SALE_RETURN`. New bucket `SOLD` in `config/inventory.js`.
  - Posted with `postMovement` **inside the issue/refund transaction**, with request key `sale:{invoiceId}:{lineId}`. This makes stock exactly-once by design and avoids a second retry queue. Damaged returns post a `WRITE_OFF` (DAMAGE).
- **New `Refund` model:** lines, reason, status REQUESTED/APPROVED/REJECTED/DONE, approver.
- **New `CreditNote` model:** own number series, tax reversal.
- **Refundable amount:** a line can be refunded up to what was paid for it, minus earlier refunds.
- **New `CustomerAdvance` (+ applications):**
  - The money comes in as a `Payment` with no bill.
  - Using it is a guarded update (never more than what's left, never more than the bill's due amount).
  - Usable at any branch of the salon.
- **Commission:** `type: 'reversal'` entries on refund or payment reversal; never deleted.
- **Branch delegation switches** (refund/void/settings) in `BillingSettings`.

**Client work:** product picker in checkout, New sale page, Refund modal + approval in bell, advance box on the customer profile and checkout, inventory product form fields.

**Tests:** AC02 (products part), AC03, AC14, AC15, AC16, AC17, AC18, AC24.

**Commit line:**
```
Billing Phase 2: retail product sales with stock deduction, refunds and returns with approval, credit notes, voids, customer advances, payment reversals, commission reversals
```

**Phase 2 status: built (19 Oct 2026), waiting for the user's check.**
- **How it was built (where it differs from the text above):**
  - **Refund money:** a refund takes the returned lines' value (with their GST) off the bill. Money goes back only for what was paid beyond the bill's new value; the rest just comes off what the customer still owes. So a part-paid bill first loses its due amount.
  - **Refund statuses:** REQUESTED, REJECTED and DONE. Approving does everything in one transaction, so there is no separate APPROVED step. Only one refund can wait for approval per bill at a time.
  - **Credit notes:** only GST bills get one. The number looks like `CN-AND/26-27/001` (3-digit count, 16 characters at most; a 4-letter prefix drops the dash). Non-GST bills get a refund receipt.
  - **Products:**
    - Sold from the branch's main store, in whole stock units.
    - Products measured in ml or g can't be sold.
    - A damaged return comes back into stock and is then written off as DAMAGE.
    - Voiding a bill puts its products back.
  - **Advances:**
    - Using an advance is recorded as an allocation from the advance, not as a new payment, so collections don't count the money twice.
    - A reversed advance payment keeps its record, marked "reversed".
  - **Commission:**
    - Rows now have an `eventKey` (`paid:1`, `refund:<id>`, `payment_reversed:<id>`, `void:<id>`).
    - A bill whose wrong payment was reversed earns commission again when it is paid again (`paid:2`). A refunded service never earns again.
    - The old unique index is swapped automatically at server start.
  - **Discard a draft:** added for sales the customer walked away from. Drafts have no number, so nothing is lost.
  - **Default GST rate for products** (18%) added to Billing settings.
  - **Demo data:** two retail products with selling prices at Andheri.
- **Defaults picked for Phase 2 (to confirm):**
  - Branch owners approve refunds and void bills (on). Branch owners changing their own branches' GSTIN and prefix (off).
  - Money goes back by the bill's first payment method unless changed.
  - Both business and branch owners can reverse payments.
  - A bill can be voided only with no money on it and no refunds.

---

### Phase 3: Cash closing, dues, reports, permissions (PRD P2)
**What owners and front desk get:**
- **Daily cash closing** per branch:
  - Open with float.
  - Cash in and out is filled in automatically from payments and refunds; petty cash in/out with a reason.
  - Count, then the difference is shown; close.
  - A closed day can only be corrected with an adjustment row.
  - Front desk can close if delegated (default on).
- **Dues page:** unpaid bills with age (0–30, 31–60, 61–90, 90+ days), by branch and customer.
- **Customer profile:** bills, payments, refunds, advance balance, total due.
- **Billing reports** with CSV:
  - Gross billed, discounts (by person and service), net sales, GST collected, collections by method and date, dues, advances, retail, cash closing, sales by staff.
  - Owners see their branches; front desk sees only today's collections at their branch.
- **Real PDF bill download** (pdfkit) and a share link; bill history (audit trail) on the bill page.
- Analytics and dashboard revenue switched to **net sales** (without GST); collections shown separately.

**Server work:**
- New `CashSession` + `CashMovement` models (`appendOnly` movements).
- `GET /billing/reports/:name?format=csv`, using the same pattern as inventory reports.
- `GET /invoices/:id/pdf`.
- Delegation checks on every route.

**Tests:** AC19, AC20, AC21 (full role matrix like `inventoryRolesMatrix.test.js`), report-reconciliation tests (collections = payments − refunds; sales match the bills).

**Commit line:**
```
Billing Phase 3: daily cash closing, dues with aging, customer money history, billing reports with CSV, PDF bills, role and branch checks
```

**Phase 3 status: built (19 Oct 2026), waiting for the user's check.**
- **How it was built (where it differs from the text above):**
  - **Cash belongs to the day it was received** (branch time), not to the time the drawer was open. Cash taken before the day was opened still counts. Cash taken after closing shows as a warning on the closed day, for an owner to adjust.
  - **One open cash day per branch.** Yesterday's must be closed before today's opens. A gap between counted and expected needs a note, and owners get a bell when there is one.
  - **Adjustments:** owners add them to a closed day as plus or minus amounts, with a reason. The closed figures themselves never change.
  - **Front desk switch:** "front desk closes the cash day" is a new switch in Billing settings (on by default).
  - **Reports:** sales by day, GST collected, discounts given, collections, dues, customer advances, retail sales, cash closing, sales by staff. All have CSV.
    - Refunds count on the day they were done.
    - Front desk: only today's collections at their branch. They can also see the Dues page for their branch.
  - **Share link:**
    - A signed link that opens only that bill's PDF, for 30 days, without logging in. The phone number on it is partly hidden.
    - It is at `/api/public/bills/<token>.pdf`, with a rate limit.
    - The "Send to customer" button also opens WhatsApp with a ready message.
  - **Bill history:** activity rows now carry the bill they belong to. Older rows are found by the bill number.
  - **Net sales:** the dashboard and analytics "revenue" is now net sales (after discounts and refunds, without GST), with "collected" shown next to it.
  - **New in-app help:** cash drawer, dues, reports and bill PDFs.
- **Defaults picked for Phase 3 (to confirm):**
  - The front desk can see the Dues page for its branch (the plan only mentioned today's collections).
  - Owners are notified when a closed drawer is short or over.
  - Shared links last 30 days.
  - Cash after closing is a warning only, not blocked.

---

### Phase 4: Ready for packages and memberships, final checks (PRD P3)
- **Line kinds become a small list of plug-ins.** Each kind declares its tax, discount eligibility and what happens on issue/refund. SERVICE and PRODUCT move onto this list; PACKAGE, MEMBERSHIP and GIFT_CARD can be added later without redesigning billing.
- **Payment sources** use the same allocation path as advances, so a future wallet or benefit balance plugs in.
- **Demo data in `seed.js`:** GST salon + non-GST salon, part-paid bills, a refund, an advance, a closed cash day.
- **Isolation and speed checks:**
  - `isolation-smoke-test.js` extended to the new collections.
  - Speed check at pilot volume (AC25): checkout loads in under 2 seconds; quote in under 500 ms.
- **Docs and in-app help:**
  - README section and acceptance-test map AC01–AC25.
  - In-app help topics (existing help module).
  - A note that GST wording and rules must be checked by a tax professional before going live.

**Commit line:**
```
Billing Phase 4: extensible bill line types and payment sources for future packages, demo data, isolation and performance checks, README and help
```

**Phase 4 status: built (20 Oct 2026), waiting for the user's check. This finishes the plan.**
- **Line kinds:** `server/src/modules/billing/lineKinds.js`. SERVICE and PRODUCT each declare:
  - their GST lookup
  - whether they can be discounted, need a customer, can be removed, or have a quantity
  - the add-on they need
  - what they do on issue, refund and void

  Pricing, issuing, refunds and voids only go through these. A line that can't be discounted (a future gift card) is also kept out of the bill-discount share.
- **Payment sources:** `server/src/modules/payments/paymentSources.js`. ADVANCE declares its balance and how it is taken. Bills and payments accept `sources: [{ type, amount }]`, and `useAdvance` stays as a short form. A future wallet or membership balance is one more entry, plus its field on PaymentAllocation.
- **Demo data:**
  - Glamour is GST registered, Desert Rose is not (plain bills).
  - Andheri has a part-paid bill and a pay-later bill, a ₹2,000 advance, a serum sale with one bottle refunded (credit note), and a mask return waiting for the owner.
  - Yesterday's cash days are closed at Andheri (₹50 short) and Dubai Marina.
- **Isolation smoke test:** 14 billing attempts added; all 46 attempts are blocked.
- **Speed (AC25), with 20,000 bills on file:** opening checkout about 25 ms (target 2 s), a quote about 3 ms (target 500 ms), issuing about 15 ms.
- **PRD acceptance tests:** AC01–AC25 are mapped in the README. AC13 (payment-provider webhooks) doesn't apply, because there is no payment gateway.
- **README:** billing section, data, demo data, deployment note, known limitations and the GST warning.
- **In-app help:** a "GST and billing settings" topic for owners.

---

## Defaults chosen (to confirm when each phase is done)
- Front desk discount limit: **10% of the bill**; above that the bill waits for owner approval.
- Commission is earned when the bill is **fully paid**, without GST.
- Branch owners can approve refunds and voids (on); changing GST settings is off, and only the business owner can switch it on.
- Front desk can close the cash drawer (on).
- No rounding to the nearest rupee on bills (exact paise).
- Always CGST + SGST (salon services are sold where the salon is); IGST is not needed for now.
- Advances can be used at any branch of the salon.

---

## How to check each phase
- `cd server && npm test`: all old and new tests pass, including `invoices.test.js` updated for drafts and part payments.
- `cd client && npm run build`.
- Run the app with the demo logins:
  - **`desk.andheri@glamour.com`:** check out an appointment with a discount and part payment, then record the rest later; (Phase 2) sell a product, request a refund; (Phase 3) close the cash day.
  - **`owner@glamour.com`:** approve the discount and the refund, look at the bills list, dues and reports, and check that old bills still open and print correctly.
- Stop after each phase with a plain summary and the commit line. The user commits and pushes.
