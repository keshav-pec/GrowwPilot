# Payroll module plan (salary, commission, payroll)

Based on *GrowwPilot Salon CRM Salary, Commission & Payroll PRD v1.0* (10 Oct 2026), adapted to this app.
Built in parts; each part ends with a check-and-commit stop.

## Who can do what (no separate "payroll admin" role)

| | Business owner (all branches) | Branch owner | Front desk | Super Admin |
|---|---|---|---|---|
| See staff pay setup | Every branch | Their branches | Their branch (pay setup only) | No |
| Change pay setup | Yes | Their branches | **Request only**, an owner approves | No |
| Approve front desk requests | Yes | Their branches | No | No |
| Monthly payroll: review, lock the month | Every branch | Their branches | No | No |
| Record salary payments, payslips | Every branch | Their branches | No | No |
| Activity log | Every branch | Their branches | No | No |
| Notifications (bell) | Every change made by someone else | Requests to approve at their branches | Answers to their requests | No |

- Every change is written to the **activity log** (who, what, when, before and after). Nothing in the log can be edited or deleted.
- The **business owner is notified** of every pay change made by a branch owner or approved from a front desk request.
- The server enforces these rules. Hiding buttons on screen is only a convenience.

## Ways to pay someone (all supported)

| Option on screen | Code | Needs |
|---|---|---|
| Fixed monthly salary | `FIXED` | monthly amount |
| Monthly salary + commission | `FIXED_COMMISSION` | monthly amount, commission % |
| Commission only | `COMMISSION` | commission % |
| Per day worked | `DAILY` | day rate |
| Per hour worked | `HOURLY` | hour rate |
| Per service done | `ASSIGNMENT` | amount per service |
| A mix | `HYBRID` | any two or more of the above |

A pay setup has a **start date**. A change creates a new setup from a new date; the old one stays in history and is never rewritten.
Money is stored in whole paise, commission in basis points (10% = 1000).

---

## Parts

### Part 1: Roles, pay setup, approvals, activity log, notifications ✅ done
- Sidebar **Payroll** (owners) / **Staff pay** (front desk), replacing the "Salary: coming soon" placeholder.
- **Pay setup** tab: every stylist at the branch with how they are paid; open one to see current, upcoming and past setups.
- Owners change pay directly; front desk sends a request with a reason. One open request per stylist at a time.
- **Requests** tab: owners approve or reject; the front desk sees the answer.
- **Activity log** tab (owners) and a **bell** in the top bar for everyone in the salon.
- Upcoming setups (not started yet) can be edited or cancelled; a current one can be ended (e.g. someone leaves).

---

### Part 2: Commission ✅ done
- Commission is earned when a service is **completed and paid** (at checkout), on the amount actually charged, with any bill discount shared across the services. The app has no GST, so nothing is taken out.
- Only people whose pay setup includes commission earn it. Rate order: **special rate for that service** (e.g. 15% on Hair Colour; 0% = none) → the person's **normal %** from their pay setup.
  - *Decision:* the PRD's third level, a salon-wide default %, is left out because everyone who earns commission already has their own % in their pay setup, so it would never be used.
- Each commission line keeps the rate and where it came from, so later rate changes don't change past earnings. Lines can't be edited, and the same service on the same bill can't earn twice.
- Combos: the combo price is shared across its services by their normal prices. Two stylists on one bill each earn on their own service.
- Pay set up with a past start date catches up on bills already paid since that date.
- Owners see **Commission this month** in the list and **Commission earned** per month (each line linked to its bill) when they open a person. Special rates are set there too (owners), and shown read-only to the front desk.
- Not possible yet: splitting one service between two stylists (a booking has one stylist per service), refunds (the app has none).

### Part 3: Monthly payroll
- One payroll per branch per month: base pay (from the pay setup and attendance), commission, per-service pay, bonuses and deductions.
- **Things to check** list (blocking ones stop the lock): no pay setup, attendance not marked, hourly staff missing check-out, net pay below zero.
- Fixed monthly salary is **not** cut automatically for missing attendance; an owner adds a deduction if needed.
- **Lock the month** with a confirmation. After locking, nothing changes; corrections go into the next month as adjustments with a reason.

---

### Part 4: Payments, payslips, advances
- Record full or part payments (cash / UPI / bank, reference, date). Can't pay more than what's owed.
- Payslip PDF: earnings, deductions, net pay, payments made.
- Advances: money given now, taken back from later months.
- Staff who have left can still be paid what they're owed.

---

### Not in this module for now (and why)
- **Staff "My earnings" screen**: stylists don't log in to GrowwPilot today. Owners can download and share payslips instead.
- **Product commission, refunds, gift cards, memberships, packages, deposits**: the app doesn't sell products or have these yet.
- **Commission slabs and target bonuses**: after Parts 1–4.
- **PF, ESI, TDS, professional tax**: need a payroll/legal expert's review first. Owners can add these as manual deductions meanwhile.
- **Email notifications**: in-app only for now.
