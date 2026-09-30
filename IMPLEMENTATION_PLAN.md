# GrowwPilot: Implementation Plan

A multi-tenant salon management and CRM SaaS built with MERN (MongoDB, Express, React, Node).

This plan combines the original assignment PDF with the changes agreed afterwards. Where the two disagree, the agreed changes win.

---

## 0. The big picture (read this first)

### Who uses the system

| Entity | Logs in? | What they do |
|---|---|---|
| **Super Admin** (GrowwPilot team) | Yes | Onboards salons, activates/deactivates them, creates each salon's first owner |
| **Owner** | Yes | Runs the salon: branches, staff, front desk accounts, services, combos, dashboard, analytics, PDF export. Also has full access to every front desk screen. |
| **Front Desk** (receptionist) | Yes | Books slots, manages customers and leads, handles checkout and staff attendance. Works in **one branch only**. |
| **Staff** (stylist, beautician) | No | A plain record: assigned to appointments, attendance is marked by the front desk |
| **Customer** | No | A plain record: created by the front desk, or by converting a lead |

**Two kinds of owner:**
- **Primary owner:** created by the Super Admin and can see and manage **all** branches.
- **Branch owner:** created by the primary owner and can see and manage only the branches assigned to them.

### How the data is organised (tenant tree)

```
GrowwPilot (platform)
└── Organization (one salon brand)       ← the tenant: every record carries orgId
    ├── Branch (a location, with its own timezone)
    │   ├── Staff, Front Desk users, Attendance
    │   └── Appointments, Invoices, Leads
    ├── Services and Combos               (shared catalogue, each can be limited to some branches)
    └── Customers                         (shared across branches: one person = one record per salon)
```

### Five core rules we follow everywhere

1. **Tenant isolation lives on the server.** The server works out `orgId` (and which branches a user may access) from the logged-in user's token, **never** from the URL or request body. Every database query includes `orgId`. If someone asks for a record that belongs to another salon, they get `404 Not Found`.
2. **All times are stored in UTC.** Each branch has a timezone (for example `Asia/Kolkata`). The server converts "28 Sep, 2:30 PM at the Andheri branch" into UTC before saving and converts back when displaying. "Today" always means today *in that branch's timezone*.
3. **Money is stored as whole paise (integers).** ₹1,530.50 is stored as `153050`, which avoids floating-point rounding errors.
4. **History is never destroyed.** "Delete" means *archive* (soft delete). Appointments and invoices keep **snapshots** of the service name, price and staff name at the moment of booking, so old records still make sense after a service or staff member changes.
5. **Status changes follow fixed rules** (a state machine). Records can't jump between random statuses.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Database | **MongoDB Atlas** (free M0 cluster) | Atlas supports **transactions** out of the box, which we need for safe booking. Plain local MongoDB does not. |
| ODM | Mongoose | Schemas, indexes and transactions in one place |
| Backend | Node + Express (plain JavaScript, ES modules) | Simple and widely known |
| Validation | Zod | One schema checks each request, with clear error messages |
| Auth | JWT in an **httpOnly cookie**, passwords hashed with bcrypt | JavaScript on the page can't read the token, which gives some protection against XSS |
| Time | **Luxon** (on both frontend and backend) | Clean timezone API: `DateTime.fromISO(x, { zone })` |
| PDF | `pdfkit` (server-side) | The owner downloads a timestamped sales PDF |
| Frontend | React + Vite + React Router | Fast dev server, simple routing |
| Server state | TanStack Query (React Query) | Caching, loading and error states, **auto-refresh every 60 s** |
| Forms | react-hook-form + Zod | Validation before the request is sent (the server validates again) |
| Styling | Tailwind CSS with our colour theme | Fast, consistent UI |
| Charts | Recharts | Analytics charts |
| Deploy | Atlas (DB) + Render (API) + Vercel (frontend) | All have free tiers |

---

## 2. Folder structure

```
GrowwPilot/
├── server/
│   ├── src/
│   │   ├── config/          env.js (reads and validates env vars), db.js
│   │   ├── models/          one file per collection
│   │   ├── middleware/      auth, requireRole, tenantContext, validate, errorHandler
│   │   ├── modules/         one folder per feature:
│   │   │   └── <feature>/   <feature>.routes.js, .controller.js, .service.js, .schemas.js
│   │   ├── utils/           time.js, money.js, phone.js, AppError.js, stateMachine.js
│   │   ├── scripts/seed.js
│   │   ├── app.js           (builds the Express app)
│   │   └── server.js        (connects to the DB and starts listening)
│   ├── .env.example
│   └── package.json
├── client/
│   ├── src/
│   │   ├── api/             axios client and React Query hooks for each feature
│   │   ├── components/ui/   Button, Input, Select, Modal, Table, Badge, EmptyState, Spinner...
│   │   ├── features/        admin, dashboard, appointments, leads, customers,
│   │   │                    catalog, team, checkout, attendance, analytics
│   │   ├── layouts/         AdminLayout, AppLayout (sidebar and branch switcher)
│   │   ├── routes/          router.jsx, ProtectedRoute.jsx
│   │   └── lib/             time.js, money.js, constants.js
│   ├── .env.example
│   └── package.json
├── IMPLEMENTATION_PLAN.md
└── README.md
```

**Layering on the backend:** `routes → controller → service → model`
- **routes** wire up the URL and middleware.
- **controller** reads the request and sends the response.
- **service** holds the business logic and queries.

Keeping the logic in services makes it easy to test and to explain.

---

## 3. Data model (collections)

| Collection | Key fields | Important indexes |
|---|---|---|
| **Organization** | name, slug, ownerName, contactEmail, contactPhone, city, plan, status (`active` / `inactive`) | unique `slug` |
| **Branch** | orgId, name, address, city, **timezone**, openTime, closeTime, **defaultServiceMinutes** (used when a service has no duration), status | `orgId` |
| **User** | orgId (null for Super Admin), role (`SUPER_ADMIN` / `OWNER` / `FRONT_DESK`), name, email, phone, passwordHash, **allBranches** (true for the primary owner), **branchIds[]**, status | unique `email` |
| **Staff** | orgId, branchId, name, role (Stylist / Beautician / ...), phone, email, status (`active` / `inactive` / `archived`), `scheduleVersion` (used for booking locks), *salary fields reserved for future* | `orgId + branchId` |
| **Attendance** | orgId, branchId, staffId, date (`"2026-09-28"` in branch time), status (`present` / `absent` / `leave`), checkInAt, checkOutAt, markedBy | unique `staffId + date` |
| **Service** | orgId, name, category, **durationMinutes (optional)**, price (paise), branchIds[] (empty = all branches), status (`active` / `disabled`) | `orgId` |
| **Combo** | orgId, name, serviceIds[], comboPrice (paise), branchIds[], status | `orgId` |
| **Customer** | orgId, name, **phone (normalised)**, email?, dob?, notes, preferredStaffId? | **unique `orgId + phone`** (blocks duplicates) |
| **Lead** | orgId, branchId, name, phone, source, interestedServiceId, assignedToUserId, status, nextFollowUpAt, notes[] ({text, by, at}), customerId?, appointmentId?, createdAt | `orgId + status`, `orgId + nextFollowUpAt` |
| **Appointment** | orgId, branchId, customerId, customerSnapshot {name, phone}, **items[]** (see below), comboId?, startAt, endAt, totalPrice, status, statusHistory[], source (`phone` / `walk-in` / `lead`), leadId?, notes, createdBy | `orgId + branchId + startAt`, `items.staffId + items.startAt` |
| **Invoice** | orgId, branchId, **appointmentId**, customerId, invoiceNumber, lines[] (snapshot), subtotal, discount, total, **payments[] {method, amount, reference}**, paidAt, createdBy | **unique `appointmentId`** (blocks double checkout) |

**Appointment items (for multiple services in one booking):**

```js
items: [
  { serviceId, serviceName, staffId, staffName, startAt, endAt, durationMinutes, price },
  { serviceId, serviceName, staffId, staffName, startAt, endAt, durationMinutes, price },
]
```

- By default the items run **back to back with the same stylist**. The front desk can change the stylist on any single item.
- When a **combo** is booked, it expands into its services and the combo price is stored as the appointment price.

**Why snapshots?** If "Haircut" is later renamed or its price changes, last month's appointment should still say "Haircut ₹500".

---

## 4. Key business logic (short explanations)

### 4.1 Booking conflict and concurrency (the most important part)

**Overlap rule:** a new booking conflicts with an existing one when `existing.start < new.end` **and** `existing.end > new.start`. Back-to-back bookings (one ends at 2:45, the next starts at 2:45) are allowed.

**The problem:** two receptionists click "Book Rahul, 4:00 PM" at the same moment. If both run "check for overlap, then save", both checks pass and both bookings get saved.

**Our fix: a MongoDB transaction plus a per-stylist lock:**
1. Start a transaction.
2. **Touch** each selected stylist's Staff document (`$inc: { scheduleVersion: 1 }`). MongoDB will not let two open transactions change the same document, so the second one fails with a *write conflict*.
3. Check for overlapping appointments. If any exist, return `409 "Slot already booked"`.
4. Insert the appointment and commit.

Mongoose's `session.withTransaction()` retries the losing transaction automatically. On the retry it **now sees the first booking** and returns the 409 error.

Result: **the first booking to commit wins** and the second receptionist gets a clear error, which is exactly what change #6 asks for.

The frontend never decides conflicts. It only shows free slots to help the receptionist. The server always decides.

### 4.2 Keeping availability fresh (change #6)

- The day board and slot picker refetch every **60 seconds** (React Query `refetchInterval: 60000`) and also refetch whenever the browser tab regains focus.
- When a booking gets a 409 error, the UI refetches immediately and shows: *"This slot was just booked by another desk. Please pick another time."*
- Real-time push using WebSockets is listed as a bonus phase.

### 4.3 Durations and "running late" (change #8)

- Service duration is **optional**. If it is missing, the branch's `defaultServiceMinutes` is used (for example 30). The front desk can also change the expected duration while booking.
- The duration actually used is **saved on the appointment item**, so later calculations don't change if the service is edited.
- **Running late:** the current time is past `start + duration` and the appointment is still not Completed or Cancelled.
- **Waiting:** the customer is marked Arrived, but service hasn't started 10+ minutes after the slot time.
- **Possible no-show:** still Booked 15+ minutes after the start time.

### 4.4 Status rules

**Appointment**

```
Booked → Arrived → In Service → Completed
Booked or Arrived → Cancelled
```

- Only **Booked** appointments can be edited or rescheduled.
- Only **Completed** appointments can be checked out.

**Lead**

```
New → Contacted → Interested   (forward moves only; skipping ahead is allowed)
any open status → Lost
```

- "Appointment Booked" can **only** be set by the Convert to Appointment flow.

### 4.5 Checkout and split payment (change #9)

1. **Subtotal** = the appointment's price.
2. **Discount** is a flat amount or a percentage, and must be between 0 and the subtotal, so the total can **never go negative**.
3. **Total** = subtotal minus discount.
4. **Payments** is a list of `{method: CASH | UPI | CARD, amount}`. There is an "+ Add payment method" button, every amount must be greater than 0, and **the amounts must add up to exactly the total**.
   - Example: ₹1,530 = ₹1,000 Card + ₹500 UPI + ₹30 Cash.
5. There is a **unique index on `invoice.appointmentId`**, so the same appointment can't be paid twice.
6. Revenue is the sum of invoice totals. Cancelled appointments never get an invoice, so they **never count as revenue**.
7. The invoice view (and its print or PDF) lists the split payments.

### 4.6 Customer metrics are calculated, not stored

Total visits, total spend and last visit are calculated when needed from the Appointment and Invoice records, using a MongoDB aggregation. We never keep separate counters that could drift out of sync.

### 4.7 Duplicate customers

- Phone numbers are normalised before saving: spaces and `+91` are removed, leaving 10 digits.
- A unique index on `orgId + phone` makes duplicates impossible.
- When a lead is converted and its phone number matches an existing customer, we **link to that customer** and the UI says *"Existing customer found: Priya S. The booking will be linked to her profile."*

### 4.8 Checks that stop another salon's IDs being used in a request

When a request refers to other records (customerId, staffId, serviceId, branchId), the service first loads each one **with `orgId` in the filter**. If any of them isn't found, the request is rejected.

The staff member must also belong to the booking's branch. This blocks the attack "put Salon B's staffId into Salon A's booking request."

---

## 5. Colour theme (light mode)

| Token | Colour | Used for |
|---|---|---|
| `bg` | White `#FFFFFF` | Page background |
| `surface` | Grey `#F7F7F5` | Cards, table header rows |
| `border` | Grey `#E5E5E0` | Dividers, input borders |
| `ink` | Black `#111111` | Main text |
| `muted` | Grey `#6B6B6B` | Secondary text |
| `gold` | Golden `#C9A227` | Primary buttons and active nav item (use **black text** on gold for readability) |
| `yellow` | Yellow `#FACC15` / soft `#FEF9C3` | Highlights, "Arrived" badge, selected rows |
| `orange` | Orange `#EA7A1A` | Warnings: running late, overdue follow-up |
| `brown` | Brown `#6B4226` | Sidebar, headings, "Completed" badge |
| `danger` | Red `#DC2626` | Error messages only (a small exception to the palette, so errors are always recognisable) |

---

## 6. Core phases (1 to 15)

Each phase has three parts:
- a **goal**
- **what to build**
- **done when**: a checklist you can verify before committing

The suggested commit messages are there to give your git history a clear shape.

---

### Phase 1: Backend setup and MongoDB connection

**Goal:** an Express server that connects to MongoDB Atlas and has a solid base.

**Build:**
- `server/` with `npm init`, ES modules, and nodemon for development.
- Install: express, mongoose, dotenv, zod, cors, helmet, cookie-parser, morgan, express-rate-limit.
- `config/env.js`: reads `.env` and **stops the server at startup** if a required variable is missing (checked with Zod).
- `config/db.js`: connects with Mongoose.
- `utils/AppError.js`, plus a central `errorHandler` middleware. Every error returns the same shape: `{ error: { code, message, details? } }`.
- A `validate(schema)` middleware that checks body, query and params with Zod.
- A `GET /api/health` route.
- `.env.example` containing `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `PORT`, and a root `.gitignore` that includes `.env`.

**Done when:**
- `npm run dev` starts the server.
- `/api/health` returns `{ ok: true, db: "connected" }`.
- An unknown route returns a clean 404 JSON response.

**Suggested commit:** `chore(server): express + mongoose setup with env validation and error handling`

---

### Phase 2: Frontend setup and interface plan

**Goal:** a React app with the theme, routing, layouts and API client ready, and every screen planned.

**Build:**
- `client/` with Vite + React. Install react-router-dom, @tanstack/react-query, axios, react-hook-form, zod, @hookform/resolvers, luxon, lucide-react, a toast library, and tailwindcss.
- Tailwind theme tokens from section 5.
- UI kit in `components/ui/`: Button, Input, Select, Textarea, Modal, Drawer, Table, Badge, Card, EmptyState, Spinner, ConfirmDialog, PageHeader.
- `api/client.js`: axios with `withCredentials: true`, and it turns server errors into readable messages.
- Layouts:
  - `AdminLayout` for the Super Admin.
  - `AppLayout`: a sidebar whose menu depends on the user's role, plus a **branch switcher** for owners with more than one branch.
- **Screen map** (placeholder pages for now):

| Route | Who can open it | Screen |
|---|---|---|
| `/login` | everyone | One login page that redirects based on role |
| `/admin/salons`, `/admin/salons/new`, `/admin/salons/:id` | Super Admin | Salon list and search, onboarding form, salon detail and activate/deactivate |
| `/app/dashboard` | Owner | KPIs, Salon Pulse, Requires Attention |
| `/app/analytics` | Owner | Demand analytics and PDF export |
| `/app/branches` | Owner | Branch management |
| `/app/team` | Owner | Staff, front desk accounts, branch owners |
| `/app/catalog` | Owner | Services and combos |
| `/app/today` | Owner, Front Desk | **Day board**: stylist columns × time rows |
| `/app/appointments`, `/app/appointments/new` | Owner, Front Desk | List with filters, booking form |
| `/app/customers`, `/app/customers/:id` | Owner, Front Desk | Customer list and profile |
| `/app/leads` | Owner, Front Desk | Lead list, filters, convert |
| `/app/checkout/:appointmentId` | Owner, Front Desk | Checkout and split payment |
| `/app/attendance` | Owner, Front Desk | Staff attendance for the day |
| `/app/settings/salary` | Owner | *Placeholder: "Staff salary: coming soon"* |

**Done when:**
- Every route renders a placeholder inside the correct layout.
- The theme shows correctly and the layout works on mobile width.

**Suggested commit:** `chore(client): vite + react setup, theme, ui kit, layouts and route map`

---

### Phase 3: Database schemas and a small seed

**Goal:** every Mongoose model with its indexes, plus a small seed so later phases have data to work with.

**Build:**
- All models from section 3, including the indexes and the `items[]` sub-schema.
- `utils/phone.js` (normalise), `utils/money.js` (rupees ↔ paise), `utils/time.js` (branch-local ↔ UTC conversion using Luxon).
- `scripts/seed.js` (the first, small version):
  - 1 Super Admin
  - 2 organizations, each with 1–2 branches (one in a different timezone, to test UTC handling)
  - 1 owner and 1 front desk user per salon
  - a few staff and services
- `npm run seed` wipes the database and reseeds it. **It refuses to run when `NODE_ENV=production`** unless a flag is passed.

**Done when:**
- The seed runs and the collections and indexes are visible in Atlas.
- Inserting a duplicate customer phone in the same org fails, while the same phone in a different org works.

**Suggested commit:** `feat(server): mongoose models, indexes, utils and initial seed`

---

### Phase 4: Authentication, roles and tenant isolation

**Goal:** secure login and a tenant scope that the server enforces everywhere.

**Build:**
- `POST /api/auth/login` checks the password with bcrypt and sets an httpOnly JWT cookie.
  - The token holds only `{ userId }`.
  - Login is rate-limited.
- `POST /api/auth/logout` and `GET /api/auth/me`.
- `auth` middleware:
  - Verifies the token and loads the user from the DB on each request, so deactivations take effect immediately.
  - Rejects the request if the user is inactive **or their organization is inactive**.
- `tenantContext` middleware builds `req.ctx = { userId, role, orgId, allowedBranchIds, activeBranchId }`.
  - `activeBranchId` comes from an `X-Branch-Id` header, and **the server checks it is in `allowedBranchIds`**.
  - Front desk users are **always** locked to their own branch.
- `requireRole('OWNER')`, `requireRole('OWNER', 'FRONT_DESK')` and so on, on every route.
- A small helper that every service uses: `scoped(ctx, extra)` returns `{ orgId: ctx.orgId, ...extra }`. Use `findOne({ _id, orgId })`, **never** `findById(id)` on its own.
- Frontend:
  - Login page.
  - `ProtectedRoute` (redirects to the login page when not logged in, and to the role's home page when the role doesn't match).
  - Logout button.
  - The branch switcher sends `X-Branch-Id`.

**Done when:**
- The Super Admin, owner and front desk each land on their own home page.
- A front desk token calling an owner-only API gets 403.
- Requesting Salon B's record ID while logged in as Salon A gets 404.
- Deactivating a salon logs out its users on their next request.

**Suggested commit:** `feat(auth): jwt cookie auth, RBAC middleware and tenant scoping`

---

### Phase 5: Super Admin area

**Goal:** a small but complete platform admin area.

**Build:**
- `GET /api/admin/orgs`: list with search (name, city, owner email) and a status filter.
- `POST /api/admin/orgs`: onboarding. In **one transaction** it creates:
  - the Organization (name, owner name, email/phone, city, plan, status)
  - the first Branch (city and timezone)
  - the primary Owner user (`allBranches: true`) with a temporary password
- `PATCH /api/admin/orgs/:id/status` activates or deactivates a salon.
- `GET /api/admin/orgs/:id`: metadata and counts (branches, staff, customers).
- UI screens:
  - table with search and status badges
  - onboarding form with validation
  - detail page with an activate/deactivate button and a confirm dialog
  - a "Copy owner login details" button after onboarding

**Done when:**
- A newly onboarded salon's owner can log in.
- A deactivated salon's owner cannot log in.

**Suggested commit:** `feat(admin): salon onboarding, listing and activation`

---

### Phase 6: Owner setup: branches, team, services and combos

**Goal:** the owner can set up the whole salon without help (change #3).

**Build:**
- **Branches:** create, edit and archive. Fields: name, address, city, timezone, opening and closing hours, default service minutes.
  - A branch can only be archived if it has no future bookings. Otherwise, show which bookings block it.
- **Staff:** create, edit, activate/deactivate and archive, with name, role, phone/email and branch.
  - Deactivating a staff member who has **future** bookings shows those bookings and asks for confirmation. They also appear in Requires Attention.
  - Past appointments keep the staff member's name (snapshot).
- **Front desk accounts:** create, edit, reset password and deactivate. Each is linked to one branch.
- **Branch owners:** the primary owner can create owners limited to chosen branches.
- **Services:** add, edit and disable. Duration is **optional**. The service can be offered at all branches or only some.
  - A disabled service disappears from booking but **still shows on old appointments** (snapshot).
- **Combos:** choose 2 or more services and set a combo price.
- A "Need help?" link to support contact details (the AI chatbot comes later, in a bonus phase).

**Done when:**
- The owner can set up a new branch completely (staff, desk user, services) from the UI.
- The front desk cannot reach any of these APIs (403).
- Disabling a service doesn't change any existing appointment.

**Suggested commit:** `feat(owner): branch, staff, front-desk, service and combo management`

---

### Phase 7: Scheduling engine (backend only)

**Goal:** the booking logic, kept separate from the UI and tested on its own.

**Build** (in `modules/appointments/scheduling.service.js`):
- `buildItems(branch, services|combo, startLocal, staffChoices)`:
  - Works out each item's duration (service duration, otherwise the branch default, otherwise the value the front desk typed).
  - Chains the items back to back.
  - Converts times to UTC.
  - Snapshots names and prices.
- `assertWithinOpeningHours(branch, items)`.
- `assertStaffBookable(items)`: each staff member must be active, belong to this branch, and not be marked absent that day.
- `findConflicts(session, items, excludeAppointmentId?)` uses the overlap rule from section 4.1.
- `bookWithLock(ctx, payload)` wraps everything in `withTransaction`:
  1. lock the staff documents
  2. check for conflicts
  3. insert the appointment
- `stateMachine.js`: a map of allowed transitions, plus `assertTransition(from, to)`.
- `GET /api/availability?date=&staffId=&duration=` returns the free start times in 15-minute steps for the branch's day.
- Tests (recommended even this early): Vitest or Jest with `mongodb-memory-server` running as a replica set. Test:
  - overlap (the 2:00–2:45 vs 2:30–3:15 example from the PDF)
  - back-to-back bookings are allowed
  - **two bookings fired at the same time with `Promise.all`, where exactly one succeeds**
  - invalid status jumps are rejected
  - Kolkata vs Dubai branch time conversion

**Done when:** all of those tests pass.

**Suggested commit:** `feat(scheduling): conflict detection with transactional staff locks, availability, state machine`

---

### Phase 8: Appointments (front desk)

**Goal:** the full appointment workflow in the UI.

**Build:**
- APIs:
  - create (uses `bookWithLock`)
  - list with filters: **date, status, staff**, plus search by customer name or phone
  - get one
  - edit and reschedule (only while Booked; uses the same lock and conflict check, ignoring the appointment's own current slot)
  - `PATCH /status`: changes status using the state machine and logs it in `statusHistory`
  - cancel, with an optional reason
- **Booking form:**
  1. Search for the customer by phone, or add a new one inline.
  2. Choose services (several) **or** a combo.
  3. Choose a stylist (the same stylist is filled in for all items, with a per-item "change stylist" option).
  4. Choose a date, then a **free slot** from the availability API.
  5. Review the total price and duration.
  6. Confirm.
- **Day board** (`/app/today`):
  - One column per stylist, time running down the page, appointment blocks coloured by status.
  - One-click buttons: Arrived → Start → Complete → Checkout.
  - Refreshes every 60 seconds.
- **List view:** table with filters. Filters are kept in the URL query string so the page survives a refresh.
- 409 conflict → a clear message, then the slots are refreshed.
- README note on the UX choice: *the day board is the receptionist's home screen because it answers "who is free right now" at a glance; the list view is for searching and filtering.*

**Done when:**
- Booking Rahul for 2:30 PM while he is already booked 2:00–2:45 shows "Rahul is already booked from 2:00 PM to 2:45 PM".
- Every filter changes the results.
- Jumping from Booked straight to Completed is blocked.

**Suggested commit:** `feat(appointments): booking with multi-service/combo, day board, list, reschedule, status flow`

---

### Phase 9: Customer CRM

**Goal:** customer records and a useful profile page.

**Build:**
- APIs:
  - create (normalises the phone; a duplicate returns 409 with a link to the existing customer)
  - edit
  - list with search by **name or phone**, with pagination
- **Profile page:**
  - basic info and preferred stylist
  - **Upcoming** and **Past** appointment tabs
  - **total visits** (count of Completed appointments), **total spend** (sum of invoice totals), **last visit**, all calculated with an aggregation
  - a "Book again" button that opens the booking form with this customer and their preferred stylist filled in
- Customers belong to the organization, so the same customer is recognised at every branch.

**Done when:**
- The profile numbers match the records.
- Adding a customer with an existing phone points you to the existing record instead of creating a duplicate.

**Suggested commit:** `feat(customers): customer CRM with derived visit and spend metrics`

---

### Phase 10: Lead CRM and conversion to appointment

**Goal:** leads from first contact through to a booked appointment.

**Build:**
- APIs:
  - create and edit leads with every field from section 9 of the PDF
  - `PATCH /status` (lead state machine)
  - `POST /notes` (adds to the timeline, with author and time)
  - set `nextFollowUpAt`
  - list with filters for **status, source, assigned employee**, plus search by name or phone
- Sources: Instagram, Facebook, Google, WhatsApp, Website, Phone, Walk-in, Referral.
- **Convert to Appointment** (`POST /api/leads/:id/convert`). **One transaction** does all of this:
  1. Find the customer by `orgId + phone`: **link** to them if they exist, otherwise **create** them.
  2. Book using the same `bookWithLock` logic (full conflict protection).
  3. Set the lead to `Appointment Booked` and save `customerId` and `appointmentId` on it.

  If any step fails, **nothing is saved**.
- UI:
  - lead table with filter chips
  - side drawer with details, the notes timeline and a follow-up picker
  - a "Convert" button that opens the booking form pre-filled with the lead's service, and shows a notice if an existing customer was matched
- Overdue follow-ups are highlighted in orange.

**Done when:**
- Converting a lead whose phone number already exists links to that customer and creates no duplicate.
- A conflicting slot makes the whole conversion fail without leaving any half-saved records.

**Suggested commit:** `feat(leads): lead CRM, notes, follow-ups and transactional convert-to-appointment`

---

### Phase 11: Checkout, split payments and invoice

**Goal:** get paid correctly and keep a traceable record.

**Build:**
- `POST /api/invoices` with `{ appointmentId, discount, payments[] }`. The server:
  - checks the appointment is Completed and not already invoiced
  - recalculates the subtotal **on the server** (it never trusts a price sent by the client)
  - checks the discount limits and that the payments add up exactly
  - saves the invoice with line snapshots
  - creates an invoice number such as `GP-AND-000123`
- Checkout screen:
  - service lines
  - discount (₹ or %)
  - a live total
  - payment rows with "+ Add payment method"
  - a "Remaining: ₹30" indicator, with the Pay button enabled only when the remaining amount is ₹0
- Invoice view (printable) that shows the **payment split**.
- The customer profile's spend and the dashboard revenue update right away (both are calculated from invoices).

**Done when:**
- ₹1,530 paid as 1,000 + 500 + 30 works.
- A payment of 1,000 + 500 (₹30 short) is rejected.
- A discount greater than the subtotal is rejected.
- Checking out the same appointment twice is rejected.

**Suggested commit:** `feat(checkout): invoice with discount validation and split payments`

---

### Phase 12: Staff attendance (front desk) and salary placeholder

**Goal:** the front desk runs the daily staff roster (change #2).

**Build:**
- `/app/attendance`: today's list of branch staff with Present / Absent / Leave buttons and check-in/check-out times.
- `PUT /api/attendance` is an upsert keyed on `staffId + date`.
- Absent or on-leave staff are **hidden from booking** and **left out of availability**.
- If a stylist who already has bookings is marked absent, a "Reassign" item appears in Requires Attention.
- Owner view: a monthly attendance summary for each staff member.
- **Salary placeholder:** a "Salary & payouts: coming soon" section on the staff detail page and a settings page. The Staff schema has reserved fields.

**Done when:**
- Marking a stylist absent removes them from today's slot picker.

**Suggested commit:** `feat(attendance): daily staff attendance with booking integration; salary placeholder`

---

### Phase 13: Owner dashboard, Requires Attention and Salon Pulse

**Goal:** answer the owner's question: *"Is my salon doing fine, and what needs my attention?"*

**Build** (all values come from `GET /api/dashboard`, calculated live and filtered by branch):
- **KPIs:**
  - Today's Revenue (invoices paid today, in branch time)
  - Today's Appointments
  - Customers Served (distinct customers with a Completed appointment today)
  - Open Leads (New, Contacted or Interested)
  - Lead Conversion Rate (Appointment Booked ÷ all leads, last 30 days)
- **Requires Attention**: a list ranked by urgency, where each row has a one-click action:
  - appointments **running late** or **waiting** (section 4.3)
  - possible no-shows
  - **overdue lead follow-ups**
  - **new leads not contacted for more than 24 hours**
  - bookings assigned to absent or inactive staff
  - completed appointments **not yet checked out** (money not collected)
- **Salon Pulse** (the open-requirement feature). One card at the top shows a verdict:
  - 🟢 *Doing well*, 🟡 *Keep an eye*, or 🔴 *Needs action*

  The verdict is based on 3 simple signals:
  1. **Revenue vs usual:** today so far compared with the average of the same weekday over the last 4 weeks, up to the same time of day.
  2. **Chairs filled:** booked stylist-minutes as a percentage of available stylist-minutes today.
  3. **Attention count:** the number of urgent items above.

  Every signal shows a one-line reason, for example *"Revenue is 18% below a usual Monday by this time."*
- README: explain the product reasoning. The owner wants **one verdict plus a short to-do list**, not ten reports.

**Done when:**
- Every number changes when the underlying data changes (for example, a checkout raises revenue).
- Nothing is hard-coded.

**Suggested commit:** `feat(dashboard): live KPIs, requires-attention list and salon pulse`

---

### Phase 14: Demand analytics and sales PDF export

**Goal:** show which branches, time slots and stylists are most in demand (change #7).

**Build** (`GET /api/analytics?from=&to=&branchId=`, using MongoDB aggregations):
- **Branch demand:** bookings, revenue and average ticket size per branch.
- **Slot demand:** a heatmap of bookings by weekday × hour, in branch-local time.
- **Stylist demand:** bookings, revenue and utilisation % per stylist.
- **Service demand:** the top services by count and by revenue.
- **Lead sources:** leads and conversion rate per source.
- **Payment mix:** the Cash / UPI / Card split.
- UI: a date range picker, a branch filter and Recharts charts.
- **Export PDF:** `GET /api/analytics/export.pdf` builds the PDF with pdfkit.
  - Contents: title, salon, branch, date range, and a **"Generated on 28 Sep 2026, 4:05 PM IST"** stamp, followed by the tables above.
  - File name: `GrowwPilot_Sales_<Salon>_<YYYY-MM-DD_HHmm>.pdf`. The owner downloads it and emails it to the sales team (sending the email automatically is a bonus).

**Done when:**
- The charts change with the filters.
- The downloaded PDF matches what's on screen and has the timestamp.

**Suggested commit:** `feat(analytics): demand analytics and timestamped sales PDF export`

---

### Phase 15: Full seed, UI polish, README and deployment

**Goal:** a product an evaluator understands within 2 minutes.

**Build:**
- **Full seed:**
  - 2 salons, 3 branches in total
  - 8 staff, 10 services, 2 combos
  - 13 customers, 9 leads (all statuses and sources, some overdue)
  - about 100 appointments spread over past, today and future, in every status, some with several services, some already paid with split payments
  - Today's appointments are generated **relative to the current time**, so the dashboard always looks alive.
- **Polish:** loading skeletons, empty states with a clear next action, success toasts, form validation messages, confirm dialogs for destructive actions, and responsive checks at phone, tablet and desktop widths.
- **Security pass:**
  - no secrets in the repo
  - `.env.example` files are complete
  - CORS is limited to the client's URL
  - helmet is on
  - error messages don't leak stack traces in production
- **Deploy:**
  - Atlas: create a DB user and allow access from Render.
  - Render: host the API and set its env vars.
  - Vercel: host the client, with a **rewrite from `/api/*` to the Render URL**, so the auth cookie is first-party and there are no cross-site cookie problems.
  - Run the seed against production once, deliberately, using the flag.
- **README** (every item from PDF section 26C):
  - overview
  - architecture
  - ER diagram (Mermaid)
  - setup
  - assumptions
  - product and UX decisions
  - technical decisions (UTC, locking, snapshots, paise)
  - trade-offs
  - known limitations
  - AI Usage
  - future scope
  - **demo credentials**
- **Isolation smoke test:** log in as Salon A and try Salon B's IDs in the URL, the request body and the `X-Branch-Id` header. Every attempt should fail. Record this in the README.

**Done when:**
- The deployed app works end to end: onboard → login → book → conflict → lead → convert → customer history → checkout → dashboard.

**Suggested commit:** `chore: full seed, UI polish, README and deployment config`

---

## 7. Bonus phases (after deployment)

These are ordered roughly by value. Pick whichever ones you like, and redeploy after each.

| # | Phase | Short description |
|---|---|---|
| 16 | **Automated test suite** | Extend the Phase 7 tests: API integration tests with supertest for auth, isolation (cross-tenant IDs), checkout and conversion; a few Playwright E2E tests of the main flow |
| 17 | **Walk-in Quick Add** | One button on the day board: phone, service, "first free stylist" → booked for *now* and marked Arrived |
| 18 | **Audit trail** | `AuditLog` collection: who did what and when (booking, cancel, status change, discount, deactivations). Viewer for the owner |
| 19 | **Polished day/week calendar** | Drag to reschedule (still checked by the server), week view, colour legend |
| 20 | **Staff free/busy view** | A timeline of each stylist's free gaps today and this week |
| 21 | **Real-time sync** | Socket.IO: a new booking instantly updates every open day board in that branch (replaces the 60 s polling) |
| 22 | **Retention and rebooking** | Customers who haven't come back within their usual gap, shown as a "Win back" list with one-click booking |
| 23 | **WhatsApp workflow (simulated)** | Pre-filled `wa.me` links for booking confirmations, reminders and follow-ups, with a message log |
| 24 | **Before/after images** | Upload photos to an appointment (Cloudinary or S3) and show them on the customer profile |
| 25 | **Email the sales PDF** | Send the analytics PDF to a saved list of sales team emails (Resend or Nodemailer) |
| 26 | **GrowwPilot AI help chatbot** | An in-app assistant that answers "how do I…" questions about the product (Claude API), plus a support contact form |
| 27 | **Staff salary module** | Fixed pay plus commission per service, a monthly payout sheet based on attendance and completed services |
| 28 | **Customer-facing reminders / no-show tracking** | A No-show status, no-show rate per customer, reminder scheduling |

> Note: two items from the PDF's bonus list, **multiple branches** and **Front Desk RBAC**, are part of the core plan here, because the agreed changes require them.

---

## 8. Assumptions (correct any that are wrong)

1. **Customers are shared across all branches of a salon**, and duplicates are prevented per salon by phone number.
2. **Services and combos are defined once per salon**, and each can be limited to certain branches. The price is the same at every branch; per-branch pricing is future scope.
3. **A lead's "assigned employee" is a login user** (owner or front desk), because those are the people who make follow-up calls. Stylists have no login.
4. **The front desk does not see revenue analytics or the PDF export.** They see the day board plus operational screens. The owner sees everything.
5. **Only the primary owner** can create branches, services, combos and other owners. Branch owners manage staff, front desk users and operations for their own branches.
6. **"Delete" means archive** for branches, staff, services and users that have any history.
7. **The AI chatbot and support** are a "Need help?" contact link for now, with the chatbot built in bonus phase 26.
