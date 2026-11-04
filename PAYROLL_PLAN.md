# Payroll

Salary, commission and monthly payroll. Who can do what is in the [README](README.md#1-what-it-does); there is no separate "payroll admin" role, and the server enforces every rule.

## Ways to pay someone

| Option on screen | Code | Needs |
|---|---|---|
| Fixed monthly salary | `FIXED` | monthly amount |
| Monthly salary + commission | `FIXED_COMMISSION` | monthly amount, commission % |
| Commission only | `COMMISSION` | commission % |
| Per day worked | `DAILY` | day rate |
| Per hour worked | `HOURLY` | hour rate |
| Per service done | `ASSIGNMENT` | amount per service |
| A mix | `HYBRID` | any two or more of the above |

A pay setup has a start date. A change creates a new setup from a new date; the old one stays in history. Money is in whole paise, commission in basis points (10% = 1000). Front desk members are paid a monthly salary, per day or per hour only.

## Commission

- Earned when a service is completed and its bill is fully paid, on what the customer actually paid, without GST. Bill discounts are shared across the services.
- Rate order: a special rate for that service (0% = none), then the person's normal %.
- Each line keeps its rate, so later changes never touch past earnings. Lines can't be edited, and the same service on the same bill can't earn twice.
- A combo's price is shared across its services by their normal prices. Two stylists on one bill each earn on their own service.
- Pay set up with a past start date catches up on bills already paid since that date.

## Monthly payroll

- One payroll per branch per month, worked out from pay setups, attendance, commission and per-service pay, plus bonuses and deductions. Drafts are worked out again whenever something that changes pay happens.
- **Must fix before locking:** no pay setup for someone still working, attendance not marked for per-day or per-hour staff, a present day without times for per-hour staff, pay below zero.
- **Reminders only:** attendance not marked for others, finished services not paid.
- **Lock month** from the month's last day. A locked month never changes (its amounts are fingerprinted); corrections go into a later month.

Rules in use:

- Monthly salary isn't cut for absences; an owner adds a deduction if needed.
- When a pay setup covers part of a month, monthly salary is split by calendar days.
- Per-day pay counts days marked present (leave is unpaid). Per-hour pay counts check-in to check-out.
- Early in a month (1st–7th) the screen opens on last month.

## Payments and advances

- Payments only against a locked month: full or part, cash, UPI or bank transfer. A double click records once.
- Can't pay more than is owed, unless the business owner ticks an override and gives a reason.
- A mistaken payment is cancelled with a reason and stays in the history.
- Payslip PDF per person; before locking it's marked DRAFT.
- Advances are taken back monthly as deductions (₹10,000 at ₹3,000/month = 3,000 + 3,000 + 3,000 + 1,000), and can be stopped from a month on.
- Staff who have left stay in the payroll for any month they're owed pay.

## Front desk members

A team member is either **Service staff** (can be booked) or **Front desk** (paid, never booked, linked to their login). Their pay is for owners only: front desk logins can't see it, not even their own. A stylist can move to the front desk only once their upcoming bookings are reassigned and their pay has no commission or per-service parts. Owners switch between Staff and Front desk in Pay setup and Monthly payroll; the month is still locked for the whole branch at once.

## Activity log

Every change goes in an activity log that can't be edited: who, what, when, before and after.
