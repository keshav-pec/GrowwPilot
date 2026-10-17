# GrowwPilot

**A multi-tenant salon management and CRM SaaS**, built with MongoDB, Express, React and Node (MERN).

GrowwPilot runs many salons on one platform. Each salon (an *organization*) has one or more branches, its own staff, services, customers, leads, bookings and payments, and it can never see another salon's data.

- **Live demo:** growwpilot.vercel.app
- **Demo accounts:** login page has a clickable "Demo accounts" list

| Role | Email | What to try |
|---|---|---|
| Super Admin | `admin@growwpilot.com` | Onboard a salon, deactivate one, switch the Inventory add-on on or off |
| Owner, all branches | `owner@glamour.com` | Dashboard, analytics + PDF, team, catalogue, Inventory (approve a write-off, review an order) |
| Owner, one branch | `bandra.owner@glamour.com` | Same screens, limited to the Bandra branch |
| Front desk | `desk.andheri@glamour.com` | Day board, booking, checkout, leads, attendance |
| Front desk | `desk.bandra@glamour.com` | The Bandra branch |
| Inventory login | `inventory.andheri@glamour.com` | Inventory only, at Andheri: issue, finish & replace, deliveries, stock count |
| Owner, another salon | `owner@desertrose.com` | A second salon in Dubai (different timezone) |
| Front desk, another salon | `desk@desertrose.com` | |

---

## Contents

1. [What it does](#1-what-it-does)
2. [Architecture](#2-architecture)
3. [Data model (ER diagram)](#3-data-model-er-diagram)
4. [Run it locally](#4-run-it-locally)
5. [Tests](#5-tests)
6. [Deployment](#6-deployment)
7. [Assumptions](#7-assumptions)
8. [Product and UX decisions](#8-product-and-ux-decisions)
9. [Technical decisions](#9-technical-decisions)
10. [Trade-offs](#10-trade-offs)
11. [Known limitations](#11-known-limitations)
12. [Tenant isolation smoke test](#12-tenant-isolation-smoke-test)
13. [AI usage](#13-ai-usage)
14. [Future scope](#14-future-scope)

---

## 1. What it does

| Who | Logs in? | Main screens |
|---|---|---|
| **Super Admin** (GrowwPilot team) | Yes | Salon list with search and status filter; onboarding (salon + first branch + owner login in one step); activate or deactivate a salon; switch paid add-ons (Inventory) on or off |
| **Owner** | Yes | **Dashboard** (Salon Pulse, KPIs, Requires attention), **Analytics** (demand charts + sales PDF), **Payroll** (pay setup, commission, monthly payroll, salary payments, payslips, advances, activity log), branches, team (staff, front desk logins, branch owners), services and combos, plus everything the front desk sees |
| **Front desk** | Yes | **Day board**, booking (multi-service or combo), appointment list, customers, leads (and convert to appointment), checkout with split payments, staff attendance, **Staff pay** (see how each person is paid, request a change). Works in **one branch only**. |
| **Inventory login** (add-on) | Yes | **Inventory only**, for one branch: products, issuing and finishing stock, write-offs (up to a limit), purchase orders (sent for approval), deliveries, stock counts, reports without costs |
| **Staff** (stylists) | No | A record: booked on appointments, attendance marked by the front desk, paid through payroll |
| **Front desk member** | Their front desk login, if linked | A team member of type *Front desk*: never booked, attendance marked like stylists, paid a salary, per day or per hour (no commission). Their pay is for owners only. |
| **Customer** | No | A record: created by the front desk or by converting a lead |

There are **two kinds of owner**: the **primary owner** (shown as **Business owner** in the app) sees and manages every branch, and a **branch owner** only sees the branches the primary owner gives them.

**Payroll** (salary, commission and payroll, built from the *Payroll PRD v1*; full plan and decisions in [`PAYROLL_PLAN.md`](PAYROLL_PLAN.md)). There is no separate "payroll admin" role; payroll uses the existing roles and branch access:

| | Business owner | Branch owner | Front desk |
|---|---|---|---|
| Pay setup (how each person is paid) | Every branch | Their branches | See only, at their branch; **request** a change for an owner to approve |
| Commission, monthly payroll, lock the month | Every branch | Their branches | No |
| Salary payments, payslips, advances | Every branch | Their branches | No |
| Front desk members' pay (setup, payroll, payments, payslips, advances) | Every branch | Their branches | No, not even their own |
| Activity log | Every branch | Their branches | No |

- **7 ways to pay:** fixed monthly, monthly + commission, commission only, per day, per hour, per service, or a mix. A change starts on a date and never rewrites past pay.
- **Two sections, Staff and Front desk.** Owners switch between them in Pay setup and Monthly payroll; the month is still worked out and locked for the whole branch at once, and the branch total shows both. Front desk members are paid a monthly salary, per day or per hour only.
- **Commission** is earned when a service is completed **and paid**, on what the customer actually paid; a special rate per service beats the person's normal %.
- **Monthly payroll** per branch: worked out from pay setups, attendance and commission, with a "things to check" list, bonuses and deductions with a reason, and **Lock month**. A locked month never changes; corrections go into a later month.
- **Payments** (full or part; cash, UPI, bank) only against locked months, **payslip PDFs**, and **advances** taken back monthly.
- **Every change is logged** in an activity log that can't be edited, and a **bell** notifies the business owner of changes made by others, branch owners of requests to approve, and the front desk of the answers.

**Inventory & Procurement** (a paid add-on, built from the *Inventory & Procurement PRD v1*; full plan and decisions in [`INVENTORY_PLAN.md`](INVENTORY_PLAN.md)). The Super Admin switches it on per salon; when it's off, every inventory screen and API is closed and nothing else changes.

| | Business owner | Branch owner | Inventory login | Front desk |
|---|---|---|---|---|
| See stock | Every branch | Their branches | Their branch | Their branch |
| Add or edit products | Yes | Products used only at their branches | Products used only at their branch | No |
| Issue / move / return, mark finished, receive | Yes | Yes | Yes | Only what an owner switches on (finish is on by default) |
| Use / write off / adjust | Yes | Up to their limit | Up to the branch limit | **Report a problem** only |
| Purchase orders | Create and approve | Create; approve up to their limit | Create (always sent for approval) | No |
| Recipes, stock count approval, settings | Yes | Their branches | Recipes view only; count | No |
| Costs and stock value | Yes | Their branches (unless turned off) | No | No |

- **Every stock change is a movement** in a history that can't be edited. Balances are never typed in; opening stock, counts and corrections are movements too, and stock can never go below zero, even when two people act at once.
- **Four ways stock is used:** whole bottles handed out and used up when someone marks them **finished** (with *Finish & replace* in one step); a set number of units **per service**; a set amount of ml or g **per service**; or recorded **by hand**. Measured products are counted in whole ml or g and shown as *"3 bottles + 400 ml"*.
- **Service recipes:** completing an appointment takes its stock automatically in the background (once per service, never twice), from the branch where it happened. If stock is short nothing goes negative; it waits in an exceptions list to post later.
- **Purchasing:** suppliers, reorder suggestions (counting stock already on approved orders), purchase orders with approval limits, part deliveries, over-receipt only with the business owner's OK, returns to suppliers, and **stock counts** an owner approves.
- **First-time setup guide** with a **CSV import** that shows every row (✅ / ⚠️ / ❌, duplicates flagged) before anything is saved.
- **Reports** (stock summary, low stock, use, waste, purchasing, stock value, bottle efficiency…) with **CSV export**; cost columns are removed on the server for anyone who can't see costs.
- **Product photos and catalogue:** up to 4 photos per product (one main), a **Catalogue** view of photo cards next to the product list, **bulk photo upload** matched by product code (`SKU-000012.jpg`, `SKU-000012-2.jpg`), and a **printable catalogue** (print or save as PDF; costs only for owners).
- **Inventory logins** are created by owners in **Team → Inventory logins**, one branch each.

**Help assistant:** owners, front desk and inventory users also get a round chat button at the bottom right. Ask it *"how do I take a split payment?"* or *"what does Salon Pulse mean?"* and it answers with the steps **for your role**, links you to the right screen, and tells a front desk user who to ask for owner-only tasks. The **Need help?** link in the sidebar still emails GrowwPilot support.

---

## 2. Architecture

```mermaid
flowchart LR
  B[Browser<br/>React + Vite] -- "/api/* (same site)" --> V[Vercel<br/>static site + rewrite]
  V -- "proxy /api/*" --> R[Render<br/>Node + Express API]
  R -- Mongoose --> M[(MongoDB Atlas<br/>replica set)]
```

- **Frontend (`client/`):** React 19, React Router, TanStack Query (caching, auto-refresh every 60 s on live screens), react-hook-form + Zod, Tailwind CSS, Recharts, Luxon.
- **Backend (`server/`):** Express 5, Mongoose, Zod validation, JWT in an httpOnly cookie, bcrypt, Luxon, pdfkit.
- **Database:** MongoDB Atlas. A replica set is required because bookings, checkout, onboarding and lead conversion use **transactions**.
- **Same-site cookie:** Vercel forwards `/api/*` to Render, so the browser only ever talks to one site and the login cookie is first-party (no cross-site cookie problems).

**Backend layers:** `routes → controller → service → model`

```
server/src/
  config/        env.js (checks env vars at start-up), db.js, constants.js
  middleware/    auth (who are you), tenantContext (which salon/branches), requireRole, requireAddon, idempotency, validate (Zod), errorHandler
  modules/       one folder per feature: *.routes.js, *.controller.js, *.service.js, *.schemas.js
                 admin, auth, branches, staff, users, services, combos, customers, appointments
                 (+ scheduling.service.js = the booking engine), leads, invoices, attendance, dashboard, analytics,
                 payroll (pay setups, commission, monthly payroll, payments, payslips, advances), activity, notifications,
                 inventory (permissions.js, stock/stock.engine.js = the only code that writes stock, products, locations,
                 imports, allocations, movements, approvals, recipes, automation, suppliers, purchasing, stockCounts, reports)
  models/        one Mongoose model per collection (inventory/ for the add-on's collections)
  utils/         time (branch time <-> UTC), money (paise), phone, scoped, stateMachine, appointmentAlerts
  scripts/       seed.js, isolation-smoke-test.js
server/tests/    Vitest tests (in-memory MongoDB replica set)
client/src/
  api/           axios client + React Query hooks per feature
  components/    ui/ kit (Button, Input, Modal, Drawer, Table...) + shared pieces
  features/      admin, auth, dashboard, appointments, customers, leads, checkout, attendance, team, catalog, branches, analytics, payroll, inventory
  layouts/       AdminLayout, AppLayout (role-based sidebar + branch switcher)
  routes/        router.jsx, ProtectedRoute.jsx
```

**Every request** to salon data goes through `requireAuth` (loads the user from the database on every request, so deactivation takes effect immediately) → `tenantContext` (builds `req.ctx = { orgId, allowedBranchIds, activeBranchId }` from the user, never from the request) → `requireRole` → `validate` → the controller.

---

## 3. Data model (ER diagram)

```mermaid
erDiagram
  ORGANIZATION ||--o{ BRANCH : has
  ORGANIZATION ||--o{ USER : employs
  ORGANIZATION ||--o{ SERVICE : sells
  ORGANIZATION ||--o{ COMBO : sells
  ORGANIZATION ||--o{ CUSTOMER : "has (shared by all branches)"
  BRANCH ||--o{ STAFF : employs
  BRANCH ||--o{ APPOINTMENT : hosts
  BRANCH ||--o{ LEAD : receives
  BRANCH ||--o{ INVOICE : issues
  STAFF ||--o{ ATTENDANCE : "one per day"
  COMBO }o--|{ SERVICE : bundles
  CUSTOMER ||--o{ APPOINTMENT : books
  APPOINTMENT ||--o| INVOICE : "paid by (at most one)"
  LEAD |o--o| APPOINTMENT : "converted into"
  LEAD |o--o| CUSTOMER : "linked to"
  USER |o--o{ LEAD : "follows up"
  STAFF ||--o{ PAY_PLAN : "paid by (dated)"
  STAFF ||--o{ COMMISSION_ENTRY : earns
  INVOICE ||--o{ COMMISSION_ENTRY : "commission from"
  BRANCH ||--o{ PAYROLL_RUN : "one per month"
  PAYROLL_RUN ||--o{ PAYROLL_ITEM : "one per person"
  PAYROLL_ITEM ||--o{ PAYROLL_PAYMENT : "paid by"
  STAFF ||--o{ EMPLOYEE_ADVANCE : receives

  ORGANIZATION { string name string slug "unique" string status }
  BRANCH { ObjectId orgId string timezone string openTime string closeTime int defaultServiceMinutes string status }
  USER { ObjectId orgId string role string email "unique" bool allBranches ObjectId[] branchIds string status }
  STAFF { ObjectId orgId ObjectId branchId string name string status int scheduleVersion "booking lock" }
  SERVICE { ObjectId orgId string name int durationMinutes "optional" int price "paise" ObjectId[] branchIds }
  COMBO { ObjectId orgId ObjectId[] serviceIds int comboPrice "paise" }
  CUSTOMER { ObjectId orgId string phone "unique per org" string name ObjectId preferredStaffId }
  APPOINTMENT { ObjectId orgId ObjectId branchId ObjectId customerId object[] items "snapshots" date startAt "UTC" int totalPrice string status object[] statusHistory ObjectId invoiceId }
  INVOICE { ObjectId appointmentId "unique" string invoiceNumber int subtotal int discount int total object[] payments }
  LEAD { ObjectId orgId ObjectId branchId string source string status date nextFollowUpAt object[] notes }
  ATTENDANCE { ObjectId staffId string date "unique with staffId" string status date checkInAt }
  PAY_PLAN { ObjectId staffId string model int monthlyBase "paise" int commissionBps string effectiveFrom string effectiveTo }
  COMMISSION_ENTRY { ObjectId invoiceId ObjectId itemId "unique together" int saleAmount int rateBps int amount "never edited" }
  PAYROLL_RUN { ObjectId branchId string month "unique with branchId" string status "draft or locked" string totalsHash }
  PAYROLL_ITEM { ObjectId runId ObjectId staffId object[] lines int gross int deductions int net }
  PAYROLL_PAYMENT { ObjectId itemId int amount string method string status "recorded or cancelled" string idempotencyKey }
  EMPLOYEE_ADVANCE { ObjectId staffId int amount int monthlyRepayment string firstMonth }
```

**Inventory add-on** (collections named `inventory_*`; every row has `orgId`, branch rows also `branchId`):

```mermaid
erDiagram
  ORGANIZATION ||--o{ INVENTORY_SKU : "products (salon-wide)"
  INVENTORY_SKU ||--o{ INVENTORY_SKU_BRANCH : "used at a branch (reorder levels, average cost)"
  BRANCH ||--o{ INVENTORY_LOCATION : "Main store, In use, stations"
  INVENTORY_LOCATION ||--o{ INVENTORY_BALANCE : "quick lookup, rebuildable"
  INVENTORY_TRANSACTION ||--|{ INVENTORY_LEDGER_ENTRY : "signed lines (append-only)"
  INVENTORY_ALLOCATION ||--o{ INVENTORY_ALLOCATION_EVENT : "hand-out history"
  SERVICE ||--o{ INVENTORY_RECIPE : "versions"
  APPOINTMENT ||--o{ INVENTORY_CONSUMPTION_EVENT : "stock used per service line"
  INVENTORY_SUPPLIER ||--o{ INVENTORY_PURCHASE_ORDER : supplies
  INVENTORY_PURCHASE_ORDER ||--o{ INVENTORY_GOODS_RECEIPT : "deliveries"
  BRANCH ||--o{ INVENTORY_STOCK_COUNT : counts

  INVENTORY_SKU { string code "unique per salon" string[] barcodes "unique per salon" string wayOfUse string stockUnit string baseUnit int unitsPerStockUnit int version }
  INVENTORY_BALANCE { ObjectId locationId ObjectId skuId "unique together" int qty ">= 0" }
  INVENTORY_TRANSACTION { string type string reason object actor object heldBy ObjectId correctsId "unique" date occurredAt date postedAt }
  INVENTORY_LEDGER_ENTRY { ObjectId transactionId ObjectId skuId ObjectId locationId int qty "signed" number unitCost string bucket }
  INVENTORY_ALLOCATION { object recipient int issuedQty int remainingQty string status bool needsHandover }
  INVENTORY_RECIPE { ObjectId serviceId ObjectId branchId "null = salon-wide" int version date effectiveFrom date effectiveTo object[] lines }
  INVENTORY_CONSUMPTION_EVENT { string key "unique: salon+branch+appointment+service line+recipe line" int recipeVersion int qty }
  INVENTORY_PURCHASE_ORDER { string number "PO-AND-000045" string status object[] lines int total }
```

Also: `inventory_settings` (front desk switches, approval limits), `inventory_approvals` (write-offs waiting, problem reports), `inventory_exceptions` (automatic uses that couldn't be posted), `inventory_outbox` ("service completed" events), `inventory_imports` (CSV previews, removed after 24 h) and `idempotency_records` (the saved answer for each `Idempotency-Key`, 7 days). Product photos are files in the GridFS bucket `inventory_images` (a 1000 px picture and a 240 px thumbnail each), listed on the product in `images`.

**Important indexes:** `customer (orgId, phone)` unique (no duplicate customers), `invoice.appointmentId` unique (no double checkout), `attendance (staffId, date)` unique, `appointment (orgId, branchId, startAt)` and `appointment (items.staffId, items.startAt)` for the day board and clash checks. Payroll: `payPlan (staffId, effectiveFrom)`, `commissionEntry (invoiceId, itemId, type)`, `payrollRun (branchId, month)`, `payrollItem (runId, staffId)` and `payrollPayment (orgId, idempotencyKey)` are all unique, so nothing is counted or paid twice. Payroll also has pay change requests, special commission rates, bonuses/deductions, the activity log and notifications (not drawn).

---

## 4. Run it locally

You need **Node 20+** and a free **MongoDB Atlas** cluster (Atlas is a replica set, which transactions need; a plain local `mongod` is not).

```bash
# 1. API  ->  http://localhost:5000 (or the PORT in .env)
cd server
cp .env.example .env    # add your Atlas URI (keep /growwpilot in it) and a JWT secret
npm install
npm run seed            # wipes the database and loads the demo data below
npm run dev

# 2. Web app  ->  http://localhost:5199
cd client
cp .env.example .env    # API_PROXY_TARGET = the API URL above
npm install
npm run dev
```

**Demo data** (`npm run seed`): 2 salons, 3 branches (Mumbai and Dubai timezones), 8 staff, 10 services, 2 combos, 13 customers, 9 leads (every status and source, some overdue), about 100 appointments over 4 weeks (every status, multi-service and combo bookings, split payments, discounts) with 85 invoices, and 2 weeks of attendance. **Today's appointments are placed around the current time**, so the day board and dashboard always show something happening: a customer waiting, a possible no-show, one running late, a bill not collected, and tomorrow's booking with a stylist on leave. **Payroll:** every Glamour stylist has a pay setup (one of each kind), front desk members Kavya (Andheri, ₹15,000/month) and Ritu (Bandra, ₹600/day) are linked to their logins, Rahul has a special 15% rate on Hair Colour, a front desk pay request waits for approval, Andheri's payroll from two months ago is locked and partly paid, last month has a bonus, and Neha has an advance. Desert Rose staff have no pay setup, to show that state. **Inventory:** Glamour Studio has the add-on. Andheri is set up with 7 products (bottles, kits, measured colour and developer), 2 stations, 2 suppliers, recipes for Facial, Hair Colour and Haircut, 4 hand-outs, a part-delivered order and a draft, a write-off waiting for approval and a front desk problem report. 4 products have simple generated photos for the catalogue. Bandra has nothing yet, so Vikram sees the setup guide. Desert Rose doesn't have the add-on. (Seed during opening hours for the best picture: after closing time, today's later bookings are already in the past and show up as possible no-shows.) The seed refuses to run when `NODE_ENV=production` unless you pass `-- --force`.

---

## 5. Tests

```bash
cd server
npm test                  # 476 Vitest tests, on a temporary in-memory MongoDB replica set (never your real data)
npm run smoke:isolation   # tenant isolation check against a running API with the demo seed (see section 12)
```

The tests cover the parts where a bug would cost money or trust:

- **Booking engine:** the PDF's overlap example (2:00–2:45 vs 2:30), back-to-back bookings allowed, **two and five simultaneous bookings where exactly one wins**, opening hours, inactive/absent/other-branch stylists, another salon's ids, Kolkata vs Dubai time, availability, rescheduling onto its own slot.
- **State machines:** every allowed and blocked appointment and lead status change.
- **Lead conversion:** links to an existing customer by phone; a clash rolls back everything (no customer, no booking, lead unchanged).
- **Checkout:** ₹1,530 = 1,000 + 500 + 30 works; ₹30 short fails; discount larger than the bill fails; paying twice (including two desks at the same moment) fails; invoice numbers never skip.
- **Dashboard warnings:** no-show, waiting and running-late rules.
- **Payroll:** each way of paying; mid-month pay changes; absences not cutting salary; the PRD's commission example (₹2,500 service, ₹200 off, 10% = ₹230); combos and two stylists on one bill; a rate change never changing past commission; commission and payments never counted twice (including two identical requests at the same moment); locking refused while something must be fixed, and a locked month refusing every change; part payments, overpayment rules, cancelled payments, staff who have left; advances; and that branch owners, the front desk and another salon only reach what they're allowed to. **Front desk pay:** never booked, no commission, moving a stylist to the front desk only once their pay fits, the separate front desk totals, and an API test that logs in as each role and tries every front desk pay action (owners only; front desk logins can't reach any of it).
- **Inventory:** every PRD acceptance test that applies (map below), plus: stock never going below zero when five people take the last bottles at once, the same request sent twice changing stock once, approval limits for write-offs and orders, CSV import duplicates, recipe versions never overlapping, the add-on switch, photo uploads (type and 2 MB limits, at most 4, another salon's photo not found, the front desk can view but not upload, bulk matching by code), and an API test that logs in as the business owner, a branch owner of another branch, an inventory login and the front desk and tries **every inventory action** (and cost visibility in screens and CSV exports).
- **Help assistant:** 35 typical questions land on the right topic; answers are limited to the asker's role (front desk vs owner, main owner vs branch owner); unknown questions get an honest "not sure" with suggestions.

**Inventory acceptance tests (PRD AC01–AC30)** — all in `server/tests/`:

| PRD test | What it checks | File |
|---|---|---|
| AC01 | Opening receipt of 10 bottles: store 10 and a movement | `inventoryProducts.test.js` |
| AC02–AC09 | Issue, finish, finish & replace, replacement out of stock, duplicate finish, simultaneous finishes, moving a hand-out, returning unused | `inventoryDaily.test.js` |
| AC10–AC14 | Facial takes one kit, duplicate completion, cancelled visit, finish-mode shampoo never per wash, measured use and corrections posting only the difference | `inventoryRecipes.test.js` |
| AC15 | Retail sale deducts once; refund doesn't restock | *Not in this release* (checkout is services-only) |
| AC16–AC18 | Waste kept apart from use, low stock on available-to-issue, front desk can't see costs or write off | `inventoryDaily.test.js`, `inventoryRolesMatrix.test.js` |
| AC19 | Branch owner can't reach other branches | `inventoryRolesMatrix.test.js`, `inventoryAccess.test.js` |
| AC20 | Another salon's ids are refused | `inventoryProducts.test.js`, `inventoryDaily.test.js` |
| AC21, AC22 | Part receipt posts only what arrived; a stock count posts movements, never overwrites | `inventoryPurchasing.test.js` |
| AC23 | Recipe edits don't change past use | `inventoryRecipes.test.js` |
| AC24 | Every balance matches the movement history after mixed actions | `inventoryProducts`, `inventoryDaily`, `inventoryRecipes`, `inventoryPurchasing`, `inventoryImport` |
| AC25, AC26 | A closed hand-out can't be finished twice; a stylist leaving flags their hand-outs | `inventoryDaily.test.js` |
| AC27 | Exports respect cost permissions | `inventoryRolesMatrix.test.js` |
| AC28 | A failed event replays without double deduction | `inventoryRecipes.test.js` |
| AC29 | CSV import previews duplicates before saving | `inventoryImport.test.js` |
| AC30 | Reorder suggestions count approved orders | `inventoryPurchasing.test.js` |

---

## 6. Deployment

The repo includes `render.yaml` (API) and `client/vercel.json` (web app).

1. **MongoDB Atlas:** create a database user. Under *Network Access* allow `0.0.0.0/0` (Render's free plan has no fixed IP). Copy the connection string and keep `/growwpilot` as the database name.
2. **Render (API):** *New → Blueprint →* this repo. Fill in `MONGODB_URI` and `CLIENT_ORIGIN` (your Vercel URL). `JWT_SECRET` is generated for you and `TRUST_PROXY=2` is already set. Check `https://<your-service>.onrender.com/api/health` shows `"db":"connected"`.
3. **Vercel (web app):** import the repo with **root directory `client`** (framework: Vite). In `client/vercel.json`, replace `YOUR-RENDER-SERVICE` with your Render service name. Deploy.
4. **Seed production once, on purpose:** in Render's shell run `npm run seed -- --force`.
5. Log in on the Vercel URL. Optionally run `API_URL=https://<your-vercel-url> npm run smoke:isolation` from your machine.
6. **Inventory add-on (per salon):** log in as Super Admin, open the salon and click **Switch on** next to Inventory. The owner then creates the first inventory login in **Team → Inventory logins** (one branch each, temporary password shown once). Completed services take stock in a background job inside the API process; it also retries every 3 minutes, so no extra service is needed.
7. **Product photos** are stored in MongoDB GridFS (`IMAGE_STORAGE=gridfs`, already set in `render.yaml`): up to 4 per product, 2 MB each before resizing, kept as WebP at 1000 px and 240 px (usually 50–150 kB per product). They count towards your Atlas storage (the free tier has 512 MB), so a salon with 1,000 products and photos uses roughly 100 MB. The screens upload one photo per request, so they stay well under proxy size limits.

---

## 7. Assumptions

1. **Customers are shared by all branches of a salon.** One phone number = one customer per salon (a unique index enforces it). The same phone can exist in another salon.
2. **Services and combos are defined once per salon** and each can be limited to some branches. The price is the same at every branch.
3. **A lead's "assigned employee" is a login user** (owner or front desk), because they make the follow-up calls. Stylists don't log in.
4. **Leads belong to a branch**, because the branch that took the enquiry follows it up.
5. **The front desk doesn't see revenue**: no dashboard, analytics or PDF export.
6. **Only the primary owner** creates branches, services, combos and other owners. Branch owners manage staff and front desk logins for their own branches.
7. **"Delete" means archive** (branches, staff) or disable (services, combos), so history stays correct.
8. **Phone numbers are Indian 10-digit mobiles**; `+91 98765 43210`, `098765-43210` and `9876543210` are the same number.
9. **"Today" and every date filter mean the branch's own local day.** An analytics report across branches in different timezones reads each branch's dates in its own time.
10. **Revenue = invoices paid** in the period, so cancelled bookings never count. Analytics also shows **service value** (list price of completed services, before discounts and combo prices).

---

## 8. Product and UX decisions

- **The day board is the receptionist's home screen.** It answers *"who is free right now?"* at a glance: one column per stylist, time running down the page, colour by status, and one-click buttons to move a booking along (**Mark arrived → Start → Complete → Checkout**). Absent stylists are hidden unless they still have bookings. The **list view** is for searching and filtering (date, status, stylist, customer name or phone), and its filters live in the URL so a refresh keeps them.
- **Booking is one page in five steps**: customer (search by phone or add inline), services or a combo, stylist (changeable per service), date and a free time, then review and confirm. The free times refresh every 60 s; if another desk takes the slot first, the page says *"This slot was just booked by another desk. Please pick another time."*, refreshes the times and keeps everything else that was entered.
- **The owner's dashboard gives one verdict and a short to-do list, not ten reports.** An owner opening the app wants to know *"Is my salon doing fine, and what needs me?"*. So the top card, **Salon Pulse**, gives one verdict (Doing well / Keep an eye / Needs action) from three simple signals, each with a one-line reason:
  1. **Revenue vs usual:** today so far, compared with the average of the same weekday over the last 4 weeks up to the same time of day (a quiet Monday morning isn't compared with a busy Saturday evening).
  2. **Chairs filled:** booked stylist time as a share of the stylist time available today.
  3. **Attention count:** how many urgent items are waiting.

  Below it, **Requires attention** lists what to do, most urgent first, each with a one-click action: customers waiting or not showing up, bills not collected, bookings whose stylist is absent or inactive, overdue follow-ups and leads nobody contacted in 24 hours.
- **Checkout makes mistakes hard:** a live "Remaining ₹30" bar, a "Rest" button that fills in what's left, and the Pay button only works at exactly ₹0.
- **Deactivating a stylist who has future bookings** first shows those bookings and asks to confirm; they then appear in Requires attention so they get reassigned.
- **Converting a lead** reuses the booking form and says upfront whether the customer already exists (*"Existing customer found: Priya S. The booking will be linked to her profile."*).
- **The help assistant feels like a chat, but stays honest.** It shows typing dots, then the answer types itself out, like an AI chat. Every answer says which help article it came from and offers a button to open that screen. It answers for *your* role only: a front desk user asking how to add a stylist is told that owners do that, not given steps for a page they can't open. When it doesn't understand, it says so and suggests questions instead of guessing. It stays open with its history as you move between pages, and it doesn't replace the **Need help?** email link.
- **Payroll is built for the owner, not an accountant.** The pay form asks "How do you pay this person?" in plain words and shows a worked example month. The monthly payroll opens on a single total and a short "things to check" list, each with a link to fix it; details live in a side panel per person. Mistakes are hard to make: locking needs a tick-box confirmation, payments can't exceed what's owed, and nothing is ever deleted (it's cancelled or corrected with a reason, and logged).
- **Inventory is built for the salon floor, not a warehouse.** The Overview has three big buttons (Issue product, Mark finished, Adjust stock) and a list of what's in use; *Finish & replace* is one step with the replacement ticked and filled in. Adding a product asks for five things only. Measured products are typed as *full bottles + an open amount*. A barcode scanner works in every product search. Things that need someone (write-offs to approve, problem reports, services that couldn't take stock, hand-outs of a stylist who left) wait on the Overview with one-click actions, and the bell tells the right people.
- **Charts:** every chart shows one series in one colour, the heatmap uses a single hue from light to dark (checked with a palette validator), and every chart has a table of the same numbers, so nothing depends on hovering or on colour alone. Statuses always pair an icon with a text label.

---

## 9. Technical decisions

- **Tenant isolation on the server.** `orgId` and the allowed branches come from the logged-in user. Every query goes through `scoped(ctx, filter)`, which adds `orgId`; records are loaded with `findOne({ _id, orgId })`, never `findById` alone. Ids from another salon simply aren't found (**404**). Ids in request bodies (customer, stylist, service, branch, assignee) are each loaded inside the salon before use. The `X-Branch-Id` header is only accepted if it's one of the user's branches (**403** otherwise), and a front desk user only has one.
- **No double booking (the concurrency fix).** A booking runs in one MongoDB transaction: (1) "touch" each chosen stylist's `Staff` document (`scheduleVersion + 1`), (2) check for overlapping bookings, (3) save. MongoDB won't let two open transactions change the same document, so a second desk booking the same stylist at the same moment gets a write conflict; Mongoose retries it, and on the retry it **sees** the first booking and returns 409 *"Rahul is already booked from 2:00 PM to 2:45 PM"*. A test fires simultaneous bookings and checks exactly one wins; with the lock removed, both were saved every time. Rescheduling uses the same lock and ignores the appointment's own current slot.
- **Transactions wherever several writes must succeed together:** booking, rescheduling, salon onboarding (salon + branch + owner), lead conversion (customer + appointment + lead), checkout (invoice number + invoice + mark the appointment paid).
- **Times are stored in UTC.** Each branch has an IANA timezone; Luxon converts "28 Sep, 2:30 PM at Andheri" to UTC and back. Opening hours, "today", the day board, availability, attendance dates and the analytics heatmap all use the branch's own time.
- **Money is stored as whole paise** (₹1,530.50 = `153050`), so no floating-point rounding errors. The server recalculates every price; the browser never sends one.
- **Snapshots.** Appointment items and invoice lines keep the service name, stylist name and price at booking time, so renaming or disabling a service never changes history.
- **Calculated, not stored.** Customer visits, spend and last visit, and every dashboard and analytics number, come from aggregations over appointments and invoices, so they can't drift out of sync.
- **Fixed status rules.** Appointment and lead statuses follow a small state machine (`utils/stateMachine.js`). Status updates also check the status hasn't changed since it was read, so two clicks at once can't both win. "Appointment booked" for a lead can only be set by the convert flow.
- **Paying only once**, three ways: a check before saving, an "only if still unpaid" update inside the transaction, and a unique index on `invoice.appointmentId` as the final safety net.
- **Auth:** JWT (holding only the user id) in an httpOnly, SameSite=Lax cookie (Secure in production); passwords hashed with bcrypt; the user and their salon are reloaded on every request, so deactivating a user or a salon logs them out on their next click. Failed logins are rate-limited.
- **Validation twice:** Zod on the server for every request (the source of truth), and on the client for instant feedback.
- **Security basics:** helmet headers, CORS limited to the client URL, a 100 kB body limit, env vars checked at start-up, error responses without stack traces in production, and no secrets in the repo.
- **Payroll money can always be explained.** Pay setups are dated and never edited once started. Commission lines and payroll items can't be updated (the models refuse it), and each commission line keeps the rate it used. Locking a month saves a fingerprint (SHA-256) of every amount. Payments carry an `Idempotency-Key`, so a double click is recorded once, and each payment bumps the month's paid total inside its transaction, so two payments at the same moment can't both slip under the amount owed (the same write-conflict trick as bookings). Every payroll change goes into an append-only activity log in the same transaction as the change.
- **One place writes stock.** `inventory/stock/stock.engine.js` posts every movement inside a transaction: each line changes its balance with a conditional `$inc` that only matches when enough is left (so two people can't both take the last bottle), then writes the append-only header and lines. Balances can always be rebuilt from the lines; owners can run that check from Settings. Average cost is moving, per product per branch.
- **Safe to repeat.** Every inventory change needs an `Idempotency-Key`; the answer is saved in the same transaction as the change (`middleware/idempotency.js`), so a double click or retry gets the first answer back.
- **Automatic use with an outbox.** Completing an appointment writes a "service completed" event in the same transaction; a background job handles it right after and a sweep retries failures. Each service line and recipe line has a unique key, so replays never deduct twice.
- **Permissions in one table** (`inventory/permissions.js`): `can(ctx, 'inventory.writeOff', { settings, value })` returns allowed / needs approval, with the branch's front desk switches and limits. The server checks it on every request; hidden buttons are only a convenience. Cost fields are stripped on the server.
- **Photos behind one switch.** `inventory/images/imageStore.js` offers `save`, `stream` and `remove`, chosen by `IMAGE_STORAGE`. Today it is GridFS; a Cloudinary store can be added there without touching the screens. Every upload is checked to really be a picture (not just by its name), resized with sharp, and read back only after two checks: the product belongs to your salon, and so does the file.
- **Help assistant = the simplest possible retrieval** (`server/src/modules/help/`). There's no AI model, no document upload and no chunking: the "documents" are 50 hand-written help topics in `help.knowledge.js`, each with keywords, the roles it's for, and an answer (optionally a different answer per role). For each question the server:
  1. **cleans the text:** lower case, no punctuation, drops filler words ("how do I…"), trims plurals and maps synonyms (stylist / barber / beautician → *staff*, appointment → *booking*);
  2. **scores every topic:** a keyword counts when all its words are in the question, worth 1 point per word (strong single words like *checkout* are worth 2); on a tie a specific topic ("cancel a booking") beats a general one ("booking");
  3. **answers for the asker:** the role comes from the session, never from the request. If the role is allowed it gets the steps (and a link); if not, it gets *who* can do it instead; below 2 points it says it isn't sure and suggests questions.

  The matching is a pure function, so it's unit-tested without a database.

---

## 10. Trade-offs

- **Polling instead of WebSockets.** Live screens refresh every 60 s (and when the tab regains focus). That's enough for a salon and much simpler; the server still decides every clash, so a stale screen can never cause a double booking.
- **A lock document per stylist instead of a special locking library.** It uses a normal MongoDB transaction and write conflict, which is easy to explain and test, at the cost of retrying the losing booking.
- **Availability shows the main stylist's free times.** When one booking uses several stylists, the slot picker shows the first stylist; the server checks every stylist on confirm.
- **Revenue signal compares with the last 4 same weekdays.** Simple and explainable, but it says "No data" for a new salon's first month.
- **Some pages load all rows for the selected day or branch** (with a limit) instead of full pagination. Customers are paginated because that list grows forever.
- **Server-side PDF** uses pdfkit's built-in fonts, so amounts show as "Rs." instead of "₹".
- **Inventory's background job runs inside the API process** instead of a separate queue service. It's simpler to deploy on one Render service; events are stored in MongoDB (the outbox), so a restart only delays them until the next sweep.
- **Keyword matching instead of a real AI model for the help assistant.** It's free, instant, can't make things up, and every answer is written and checked by us, but it only understands questions whose words overlap its keywords, and it has no memory of the conversation. Swapping the matcher for an LLM later only changes `help.matcher.js`; the role rules and the chat window stay the same.

---

## 11. Known limitations

- No real-time push: another desk's booking appears within 60 s (or immediately after your own action or a 409).
- A new owner or front desk login gets a temporary password to share manually; there's no email invite or forced password change yet.
- Prices are the same at every branch; per-branch pricing isn't supported.
- Phone validation assumes Indian mobile numbers, even for the Dubai demo salon.
- No buffer time between appointments and no stylist-specific working hours (the branch's opening hours apply to everyone).
- The Render free plan sleeps when idle, so the first request after a while can take 30–60 s.
- Analytics "utilisation" counts every day in the range as a working day (minus marked absences).
- Inventory: no retail selling at checkout yet (AC15), no moving stock between branches, a completed service can't be reversed (the app has no "un-complete"), no camera barcode scanning (USB/Bluetooth scanners work), photos are stored in the database (GridFS) rather than a CDN, and reports cover one or all of your branches but not a custom set.
- Payroll: stylists don't log in, so there's no "My earnings" screen (owners download payslips instead); front desk members can't see their own payslip yet; no PF, ESI, TDS or professional tax (add them as deductions until a payroll expert has reviewed them); one service can't be split between two stylists; notifications are in the app only (no email); monthly pay periods only.

---

## 12. Tenant isolation smoke test

`npm run smoke:isolation` logs in as **Desert Rose** to collect its real ids, then logs in as **Glamour Studio** and tries to use them. Result against the local API with the demo seed:

| Where | Attempt (as Glamour, with Desert Rose's ids) | Result |
|---|---|---|
| URL | read their branch / customer / appointment / lead / invoice | 404 ✅ |
| URL | edit their stylist, change their service price, cancel their appointment, deactivate their front desk | 404 ✅ |
| Body | book their customer | 404 ✅ |
| Body | book their stylist / their service | 400 `INVALID_STAFF` / `INVALID_SERVICE` ✅ |
| Body | check out their appointment | 404 ✅ |
| Body | add a stylist to their branch, offer a service at their branch | 400 `INVALID_BRANCH` ✅ |
| Body | assign a lead to their user, make their stylist a customer's favourite | 400 `INVALID_ASSIGNEE` / `INVALID_STAFF` ✅ |
| Query | analytics for their branch | 404 ✅ |
| URL | read or set their stylist's pay, give their stylist an advance, pay their payroll line, download their payslip | 404 ✅ |
| Header | `X-Branch-Id` = their branch (staff list, dashboard, monthly payroll, inventory overview and reports) | 403 `BRANCH_FORBIDDEN` ✅ |
| Inventory | Desert Rose (no add-on) opening, editing or finishing Glamour's products, orders and hand-outs | 403 `ADDON_DISABLED` ✅ |

**All 32 attempts were blocked.** (Two salons that both have Inventory are tested in `server/tests`: another salon's inventory ids are not found, 404.) A front desk user sending another branch of their *own* salon in `X-Branch-Id` is also refused (403).

---

## 13. AI usage

This project was built with assistance from **Claude Code** (Anthropic's AI coding assistant) as a pair programmer:

- **Planning:** I wrote the requirements and the agreed changes; the AI helped turn them into `IMPLEMENTATION_PLAN.md` (data model, business rules, 15 phases with "done when" checks).
- **Building:** phase by phase, the AI wrote code following the plan, and I reviewed each phase, and committed it myself.
- **Testing:** for every phase the AI wrote and ran API checks against the real database, browser checks in headless Chrome (with screenshots), and Vitest tests. These caught real bugs that were then fixed, for example logout not clearing the session, availability hiding an appointment's own slot when rescheduling, a Zod default silently resetting a service's branches on edit, and a heatmap colour that was too faint to read.
- **What I checked myself:** the business rules (booking conflicts, checkout maths, tenant isolation), the UX on each screen, and that I can explain every part of the code.

---

## 14. Future scope

Ordered roughly by value (from the plan's bonus phases): automated API/E2E test suite, walk-in quick add, an audit log for the rest of the app (payroll already has one), drag-to-reschedule and a week view, a staff free/busy view, real-time sync with WebSockets, a "win back" list of customers who haven't returned, WhatsApp confirmations and reminders, before/after photos, emailing the sales PDF, an LLM-backed help assistant that can also answer questions about your own data (the current one matches keywords over a fixed help knowledge base), staff logins with their own earnings page, commission slabs and target bonuses, statutory deductions (PF, ESI, TDS) after legal review, and no-show tracking with reminders. **Inventory:** retail selling at checkout, moving stock between branches, reversing a completed service, photo/AI catalogue import, camera barcode scanning, Cloudinary image storage, plan-based billing for add-ons, and stock events for other systems.
