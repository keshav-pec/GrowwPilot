# Birthday & Anniversary Offers

What it does and who can do what is in the [README](README.md#1-what-it-does).

## How it's built

- **Server:** `server/src/modules/occasions/`, with small files per area (`settings`, `customers`, `campaigns`, `engine`, `worklist`, `outreach`, `checkout`, `reports`) and `permissions.js`. Models are in `server/src/models/occasions/`.
- **Client:** `client/src/features/occasions/` and `client/src/api/occasions.js`.
- **Routes:** `/api/occasions/...`. The salon and role always come from the login.
- **Month window:** worked out in the issuing branch's time zone.
- **Every change** runs with an idempotency key, writes an `occasions.*` activity row, and has its permission checked on the server.

## Rules in use

- **Home branch for older customers:** the branch of their latest appointment, otherwise the first branch. The front desk sees offers of its own branch only.
- **Every day is a working day** for follow-up times.
- **No mixing:** while an offer is on a bill, manual discounts are off and combo-priced lines don't count.
- **Turning the feature off** hides the list and stops new offers. Offers already given can still be used until month end.
- **Calls don't count** towards the 7-day message limit; only "Send offer" does.
- **Message ending:** "Reply or call {salon_phone} to book".
- **Emergency withdraw:** only customers already contacted get a "tell the customer" task.
- **Consent wording version** starts at `v1`; changing the wording in Settings raises it.
- **WhatsApp and SMS** are sent by staff from their own phone. Email is sent by the app when email is on (see [Email](EMAIL_PLAN.md)).
