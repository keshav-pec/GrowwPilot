# GrowwPilot: core design

The rules the whole app follows. Features have their own notes: [Billing](BILLING_PLAN.md), [Payroll](PAYROLL_PLAN.md), [Inventory](INVENTORY_PLAN.md), [Birthday & Anniversary Offers](OCCASION_OFFERS_PLAN.md), [Email](EMAIL_PLAN.md).

## How the data is organised

```
GrowwPilot (platform)
└── Organization (one salon brand)       ← the tenant: every record carries orgId
    ├── Branch (a location, with its own timezone)
    │   ├── Staff, Front Desk users, Attendance
    │   └── Appointments, Invoices, Leads
    ├── Services and Combos               (shared catalogue, each can be limited to some branches)
    └── Customers                         (shared across branches: one person = one record per salon)
```

## Five core rules

1. **Tenant isolation lives on the server.** `orgId` and the allowed branches come from the logged-in user, never from the URL or request body. Every query includes `orgId`; another salon's record is simply not found (404).
2. **All times are stored in UTC.** Each branch has a timezone. "Today" always means today in that branch's time.
3. **Money is stored as whole paise.** ₹1,530.50 is `153050`, so there are no rounding errors.
4. **History is never destroyed.** "Delete" means archive. Appointments and bills keep snapshots of the service name, price and stylist at the moment of booking.
5. **Status changes follow fixed rules** (`utils/stateMachine.js`).

## Booking conflicts

A new booking conflicts when `existing.start < new.end` and `existing.end > new.start`. Back-to-back bookings are allowed.

Two desks can book the same stylist at the same moment, so the check and the save run in one MongoDB transaction:

1. Touch each chosen stylist's Staff document (`$inc: { scheduleVersion: 1 }`). MongoDB won't let two open transactions change the same document, so the second one gets a write conflict.
2. Check for overlaps; if any, return `409`.
3. Save and commit.

The losing transaction is retried automatically, now sees the first booking, and returns the 409. The screen only shows free slots to help; the server always decides.

Live screens refresh every 60 seconds and when the tab regains focus. After a 409 the slots reload and the page says *"This slot was just booked by another desk."*

## Durations and warnings

- A service's duration is optional; the branch's `defaultServiceMinutes` is used when it's missing. The duration used is saved on the appointment.
- **Running late:** past start + duration and not yet Completed or Cancelled.
- **Waiting:** Arrived, but service hasn't started 10+ minutes after the slot time.
- **Possible no-show:** still Booked 15+ minutes after the start time.

## Status rules

```
Appointment:  Booked → Arrived → In Service → Completed
              Booked or Arrived → Cancelled
Lead:         New → Contacted → Interested (skipping ahead is allowed)
              any open status → Lost
```

Only Booked appointments can be edited or rescheduled, and only Completed ones checked out. "Appointment Booked" on a lead is set only by Convert to Appointment.

## Customers

- Phone numbers are cleaned before saving (`+91 98765 43210` = `9876543210`), and a unique index on `orgId + phone` blocks duplicates.
- Converting a lead whose phone matches a customer links to that customer.
- Visits, spend and last visit are calculated when needed, never stored.

## Ids in requests

Every id in a request (customer, stylist, service, branch) is loaded with `orgId` in the filter first, and a stylist must belong to the booking's branch. Another salon's id can't be slipped into a request.

## Colours

| Token | Colour | Used for |
|---|---|---|
| `bg` | White `#FFFFFF` | Page background |
| `surface` | Grey `#F7F7F5` | Cards, table headers |
| `border` | Grey `#E5E5E0` | Dividers, input borders |
| `ink` | Black `#111111` | Main text |
| `muted` | Grey `#6B6B6B` | Secondary text |
| `gold` | Golden `#C9A227` | Primary buttons, active menu item (black text on gold) |
| `yellow` | Yellow `#FACC15` / soft `#FEF9C3` | Highlights, "Arrived" badge |
| `orange` | Orange `#EA7A1A` | Warnings: running late, overdue |
| `brown` | Brown `#6B4226` | Sidebar, headings, "Completed" badge |
| `danger` | Red `#DC2626` | Error messages only |
