# Billing, POS & Payments

There is one checkout and one set of money records. What it does is in the [README](README.md#1-what-it-does).

## Rules

- **One invoice model.** Routes: `/api/invoices`, `/api/payments`, `/api/refunds`, `/api/advances`, `/api/cash-sessions`, `/api/billing/settings` and `/api/billing/reports`.
- **Money:** whole paise; tax rates in basis points (1800 = 18%). The server always works out prices and tax; the browser only shows a preview.
- **Every money change** runs in one transaction with an idempotency key and writes a `billing.*` activity row.
- **A bill's flow:** a draft can be changed; issuing gives it its number and locks it. Older bills keep their old numbers.

## Decisions

- **GST is optional per salon:** *GST registered* (GSTIN, tax on bills) or *Not registered* (plain bill).
- **Prices include GST by default.** Each salon can switch to "GST extra".
- **Guest bills are for products only,** when the salon switches this on. Services always need a customer.
- **"Add product" at checkout** needs the Inventory add-on. There is no second product list.

## Defaults

- Front desk discount limit: 10% of the bill; above that, the bill waits for an owner.
- Commission is earned when the bill is fully paid, without GST.
- Branch owners can approve refunds and voids; only the business owner changes GST settings.
- The front desk can close the cash drawer.
- Bills use exact paise, with no rounding to the nearest rupee.
- Every bill is CGST + SGST.
- Advances can be used at any branch of the salon.
- The default GST rate for services is 18%; each salon sets its own in Billing settings.
