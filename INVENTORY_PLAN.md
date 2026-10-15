# Inventory & Procurement add-on plan

Based on *GrowwPilot Salon CRM Inventory & Procurement PRD v1.0* (11 Oct 2026), adapted to this app's MERN stack (MongoDB + Mongoose, Express, React, Node).
Built in phases; each phase ends with a check-and-commit stop. Where this plan is silent, the PRD wins.

**Key decisions**

- **Paid add-on.** Inventory is an add-on that the Super Admin switches on per salon. When it is off, every inventory screen and API is closed, and nothing about the rest of the app changes.
- **Separate inventory login per branch.** The owner creates inventory logins in Team → Logins, the same way as front desk logins. Each inventory login belongs to exactly one branch.
- **Whole numbers only.** Every quantity is a whole number.
  - A bottle you finish is counted in bottles.
  - A product used by measure (hair colour, developer) is counted in whole ml, g or pieces. For example, 3 bottles of 1000 ml and 400 ml left over is stored as 3400 ml and shown as "3 bottles + 400 ml".
- **Same look as the rest of the app.** It uses the existing theme tokens in `client/src/index.css` (gold `#c9a227`, brown `#6b4226`, surface, border, good, danger) and the shared UI kit in `client/src/components/ui`.
- **Every stock change is a movement.** Each change is a row in a movement history that can't be edited or deleted.
  - Balances are never typed in or overwritten.
  - Opening stock is a movement too.
  - Corrections are new movements that point at the one they fix.
- **No retail selling for now.** Retail products can be tracked as stock, but checkout stays services-only.
- **Images in MongoDB for now.** Product images are stored in MongoDB (GridFS). Moving them to Cloudinary is future scope, behind a single storage switch.

---

## Who can do what

| | Business owner | Branch owner | Inventory login | Front desk | Super Admin |
|---|---|---|---|---|---|
| Switch the add-on on or off for a salon | No | No | No | No | **Yes** |
| Create inventory logins | Every branch | Their branches | No | No | No |
| See stock | Every branch | Their branches | Their branch | Their branch | No |
| Add or edit products | Yes | Products used only at their branches | Products used only at their branch | No | No |
| Issue / transfer / return | Yes | Yes | Yes | If delegated | No |
| Mark finished / replace | Yes | Yes | Yes | If delegated (on by default) | No |
| See costs and stock value | Yes | Their branches | No | No | No |
| Create purchase orders | Yes | Yes | Yes (sent for approval) | No | No |
| Approve purchase orders | Yes | Up to their limit | No | No | No |
| Receive stock | Yes | Yes | Yes | If delegated | No |
| Edit service recipes | Yes | Their branches' recipes | No (view only) | No | No |
| Use / write off / adjust stock | Yes | Up to their limit | Up to the branch limit | **Report a problem only** | No |
| Stock count | Approve | Approve (their branches) | Count | No | No |
| Reports and history | Every branch | Their branches | Their branch, without costs | Limited (stock and their own actions) | No |
| Inventory settings | Yes | Their branches | No | No | No |

- **The server enforces every rule on every request.** Hiding a button is only a convenience. If a login's role or branch changes while they are signed in, their next action is checked against the new rules.
- **"Delegated"** means a switch per branch in Inventory → Settings, set by an owner.
  - Front desk defaults follow the PRD launch defaults: *mark finished* is on; *issue*, *transfer* and *receive* are off.
  - Reporting a problem is always allowed.
- **Who did it vs who held it.** Every movement records who reported it, separately from the stylist or station that had the product.
- **Activity log and alerts.** Product, recipe, setting, write-off, approval and stock count changes go into the existing **activity log**. The business owner is notified (bell) of changes made by others.

---

## How stock moves (the four ways stock is used)

| Way | What happens | Typical items |
|---|---|---|
| **Finish** (`FINISH`) | Whole bottles are handed to a station or stylist ("In use"). They are used up only when someone marks them **Finished**, and can be replaced in the same step. | Shampoo, conditioner, wax jars |
| **Per service, whole units** (`SERVICE_UNITS`) | A set number of units is used up automatically each time the service is completed. | Facial kits, disposable caps |
| **Per service, by measure** (`SERVICE_MEASURED`) | A set number of ml, g or pieces is used up automatically each time the service is completed. The actual amount can be corrected afterwards. | Hair colour, developer |
| **By hand** (`MANUAL`) | Someone records use, damage, expiry, loss, spillage or a count correction. | Anything unplanned |

**Rules for how stock is counted:**

- **Where stock can be.** Stock is in one of two places per branch: **In store** (`STORE`) or **In use** (`IN_USE`).
  - Issuing moves stock from store to in use, so the branch total doesn't change.
  - Finishing, using, writing off or returning to a supplier lowers the total.
  - Receiving stock, or getting a usable product back, raises it.
- **Available to issue** = in store minus anything blocked. Low-stock alerts and reorder suggestions use this number, not the total that includes stock in use.
- **A finish-mode bottle is never used up automatically.** It can be *linked* to a service for reports (e.g. "washes per bottle"), but it is never taken off on each service.
- **Not enough stock is never allowed to go below zero.**
  - Issuing more than is in store is blocked.
  - An automatic service deduction that can't be covered goes to an **exceptions list** to sort out.
- **Value.** Stock value uses the moving average cost per product per branch. The cost is saved on each use, write-off and receipt. Stock in use still counts as stock value (issuing is not spending).

---

## Code layout (built the same way in every phase)

**Server**

```
server/src/
  config/addons.js                         # ADDONS = ['inventory'] (more add-ons later)
  middleware/requireAddon.js               # 403 ADDON_DISABLED when the salon doesn't have it
  middleware/idempotency.js                # shared Idempotency-Key check (lifted from payroll)
  models/inventory/                        # one file per collection, re-exported from models/index.js
  modules/inventory/
    inventory.routes.js                    # mounts every sub-router at /api/inventory
    permissions.js                         # one capability table: can(ctx, 'inventory.writeOff', {qty, value})
    serializers.js                         # strips cost fields for roles that can't see costs
    stock/        stock.engine.js          # the ONLY code that writes movements and balances
    skus/         skus.routes|controller|service|schemas.js
    locations/    settings/   setup/   imports/
    allocations/  movements/  approvals/
    recipes/      automation/  exceptions/
    suppliers/    purchasing/  receiving/  stockCounts/
    reports/      catalogue/  images/
```

**Client**

```
client/src/
  api/inventory/*.js                       # React Query hooks per area + a mutation helper that sends Idempotency-Key
  lib/inventory.js                         # unit formatting ("3 bottles + 400 ml"), human labels
  features/inventory/
    InventoryPage.jsx                      # tabs in the URL, like Payroll
    overview/ products/ setup/ import/ allocations/ movements/
    recipes/ exceptions/ purchasing/ stockCount/ reports/ settings/ catalogue/
```

**Conventions**

- **Module pattern.** Each module follows the existing `routes → controller → service → schemas` pattern.
- **Tenant and branch checks.**
  - Every inventory row has `orgId`, and branch rows also have `branchId`.
  - Every query goes through `scoped(ctx)` and the `allowedBranchIds` check.
  - Ids that belong to another salon or branch return 404.
- **Changes are safe to repeat.** Every change needs an `Idempotency-Key` header, which is unique per salon and operation. Repeating a request returns the first result.
- **Only one place writes stock.** `stock.engine.postMovement(ctx, {...}, session)`:
  - runs inside a Mongo transaction;
  - lowers balances with a conditional `$inc` that only matches when enough is left, so stock can never go below zero, even when two people act at once;
  - writes the movement header and its append-only lines;
  - records the actor, the time it happened and the time it was saved.
- **Mounting.** The router is mounted as `app.use('/api/inventory', inventoryRoutes)`, and each sub-router uses `requireAuth, tenantContext, requireAddon('inventory')`.
- **API errors** follow the PRD names: `INSUFFICIENT_AVAILABLE_STOCK`, `ALLOCATION_ALREADY_CLOSED`, `STALE_VERSION`, `RECIPE_CONFLICT`, `PERMISSION_DENIED`, `ADDON_DISABLED`.

---

## Collections (MongoDB)

| Collection | What it holds |
|---|---|
| `inventory_skus` | Product master for the whole salon: code (auto `SKU-000123`, unique per salon), name, category, brand, barcodes, type (professional / retail / disposable / general supply / reusable asset), stock unit, base unit, units per stock unit (whole number), way of use, status, version, images (Phase 8) |
| `inventory_sku_branches` | Per branch: active, reorder point, reorder quantity, preferred supplier, lead time, average cost, low-stock alert sent at |
| `inventory_locations` | Per branch: `STORE` (main store, more can be added), `IN_USE` (one per branch, built in), `STATION` (named chairs or areas that receive stock; no balance of their own) |
| `inventory_balances` | Quantity per product per location (whole number, never below zero), version. A quick lookup that can always be rebuilt from the movement history |
| `inventory_transactions` | One row per action: type, reason, actor, who held it, reference, note, happened at, saved at, idempotency key, stored result, approval, what it corrects (append-only) |
| `inventory_ledger_entries` | Signed movement lines: product, location, quantity, cost snapshot, bucket (opening / received / consumed / wasted / adjusted / returned) (append-only) |
| `inventory_allocations` and `_events` | In-use hand-outs: product, recipient (floor / station / stylist), issued, remaining, open or closed, needs handover, replaces; with their issue / finish / return / transfer history |
| `inventory_consumption_events` | Every use: way of use, appointment + service line, recipe version, quantity, corrects. Unique key per salon + branch + service line + recipe line |
| `inventory_recipes` | Per service (salon-wide or one branch): version, start and end dates, status, lines (product, quantity, deducts yes/no, take from in use first or from store) |
| `inventory_exceptions` | Automatic uses that couldn't be posted, waiting to be sorted out |
| `inventory_outbox` | Service-completed events waiting to be processed: attempts, last error, unique dedupe key |
| `inventory_suppliers` | Name, contact, terms, lead time |
| `inventory_purchase_orders` | Number, supplier, branch, lines (product, quantity, unit cost, received so far), state, expected date, created by, approved by |
| `inventory_goods_receipts` | Received lines with supplier invoice number and optional batch / expiry |
| `inventory_stock_counts` | Cut-off, lines (expected, counted, difference) for store and in use, counted by, reviewed by |
| `inventory_approvals` | What is waiting, requested by, decided by, decision, when |
| `inventory_settings` | Per branch: front desk switches, write-off and PO approval limits, setup finished at |
| `inventory_imports` | CSV preview batches (rows, problems found, status); cleared automatically after 24 h |

The audit trail reuses the existing `activity_log` (actions named `inventory.*`). Images use the GridFS bucket `inventory_images` (Phase 8).

---

## Phases

### Phase 1: Add-on switch, inventory login and permissions

**Add-on switch**
- `Organization.addons.inventory = { enabled, enabledAt, enabledBy }`. This is a general `addons` field so later add-ons (and plan-based billing) can use it.
- Super Admin turns it on or off on the salon's page. Turning it off hides inventory; all data is kept.
- `requireAddon('inventory')` middleware. The session user (`/auth/me`) now includes the salon's add-ons, so the screen knows what to show.

**Inventory login**
- New role **`INVENTORY`** in `ROLES`.
- Owners create these logins in **Team → Logins** (only shown when the add-on is on), with one branch each and a temporary password (`CredentialsModal`).
- An inventory login can't sign in while the add-on is off.
- `tenantContext` treats it like the front desk (one branch).
- Every existing router already lists its roles, so inventory logins can't reach bookings, customers, bills, payroll and so on. A test confirms this.

**Permissions**
- `modules/inventory/permissions.js` holds the table above as one capability map, with limits.
- `inventory_settings` per branch holds the front desk switches and approval limits.

**Screens**
- Sidebar entry **Inventory** (package icon) for owners, inventory logins and front desk, shown only when the add-on is on.
- An inventory login lands on `/app/inventory` and sees only Inventory (plus the bell).
- An empty Inventory page with tabs **Overview · Products · Purchasing**, and **Settings** for owners.

**Tests**
- Add-on off: 403 everywhere.
- Inventory login blocked from every non-inventory API.
- Inventory login from branch A can't reach branch B.
- Super Admin toggle.

---

### Phase 2: Products, locations and the stock engine

**Products**
- **Add product** asks only for: name, category, stock unit, way of use and opening quantity (optional).
- Everything else sits under "More details", collapsed: brand, barcode, type, base unit and units per stock unit (for measured products), reorder point and quantity, cost (owners only).
- The SKU code is made automatically (`Counter` `sku:<orgId>`).
- Barcodes are unique within the salon.

**Locations**
- Each branch gets **Main store** and **In use** automatically (and on first use for existing branches).
- Owners can add more stores and name stations (e.g. "Chair 3", "Colour bar").

**Stock engine**
- `stock.engine.postMovement` (see Code layout).
- Opening stock is posted as an `OPENING` movement with an optional cost, never by setting a balance.

**Products screen (INV-02)**
- Search by name, SKU code or barcode. A barcode scanner works like typing into the search box.
- Filter by category, way of use, status and supplier.
- Shows In store / In use / Need to order.

**Product page (INV-04)**
- Balances per location, open hand-outs, recipes (later) and the full movement history (INV-13).

**Rules**
- Deactivating a product keeps all its history.
- Changing a product's way of use is blocked while it has open hand-outs.
- Products are edited with a version check; a stale edit gets `STALE_VERSION`.

**Tests**
- AC01 (opening of 10 → store 10 plus a movement).
- AC20 (another salon's ids are refused).
- AC24 (balances match the movement history), as the first version of the check.
- Barcode and code uniqueness.

---

### Phase 3: First-time setup guide and CSV import

**Setup guide**
When the add-on is new for a branch, Inventory opens a **setup guide** instead of an empty page. It has four short steps, and each one can be skipped and resumed later:
1. **Where you keep stock.** Confirm the main store name and add stations (optional).
2. **Add your products.** Three ways:
   - **Upload a spreadsheet (CSV)**, with a **Download template** button and a filled-in example;
   - **add them one by one**;
   - **skip for now**.
3. **Check before saving.** A preview table shows each row as ✅ ready, ⚠️ warning or ❌ must fix:
   - missing name or unit;
   - a quantity that isn't a whole number;
   - an unknown way of use;
   - **duplicates** (same code, barcode or name already in the salon, or twice in the file).

   You can fix rows or leave them out, then confirm.
4. **Done.** Three tips with buttons: *Issue a product*, *Mark a bottle finished*, *Set reorder levels*.

Until setup is finished, a "Finish setting up inventory" checklist card stays on the Overview. `inventory_settings.setupCompletedAt` is saved per branch.

**CSV columns**
- **Required:** `name`, `category`, `stock_unit`, `way_of_use`.
- **Optional:** `opening_qty`, `sku_code`, `brand`, `barcode`, `type`, `base_unit`, `units_per_stock_unit`, `reorder_point`, `reorder_qty`, `unit_cost`.

**How the import works**
- The browser reads the file (`papaparse`) and sends rows as JSON, at most 2,000 rows. The import route alone allows a larger JSON body.
- `POST /api/inventory/imports/preview` saves a preview batch and returns the problems found.
- `POST /api/inventory/imports/:id/commit` creates the products and **one opening-stock movement per product**, all in one transaction and safe to repeat.
- **Nothing is guessed.** An empty cost or quantity stays empty.
- `unit_cost` is only accepted from owners. From anyone else it's ignored, with a warning.
- The same import is available later from Products → **Import**.

**Tests**
- AC29 (preview flags duplicates before anything is saved).
- A committed import posts opening movements.
- Repeating a commit doesn't double the stock.
- A front desk login can't import.

---

### Phase 4: Daily stock work: issue, finish & replace, returns, write-offs

**Overview (INV-01)**
- Shows **In store, In use, Need to order** (low stock), stock value (owners only), hand-outs waiting for handover, and recent activity.
- Big quick actions: **Issue product**, **Mark finished**, **Adjust stock**.

**Issue product (INV-05)**
- Choose a product, the store, who gets it (floor / station / stylist) and how many whole units.
- Stock moves from store to in use, and a hand-out is created.
- The branch, store and last recipient are remembered.

**In use (INV-06)**
- Open hand-outs with their age and recipient.
- Actions on each one: **Finished**, **Return unused** (back to store if it can still be used), **Move to** another stylist or station (history kept, nothing used up).

**Finish & replace (INV-07)**
- One step, aiming for under 15 seconds once the hand-out is found.
- The quantity defaults to 1, or to what's left.
- **Issue a replacement** is pre-ticked when this hand-out is usually replaced, with the product, quantity and recipient pre-filled.

How it works on the server:
- The hand-out is updated only if it is still open and has enough left, so two people finishing at once can't use more than was handed out.
- The finish is saved first. If the store has no stock left:
  - the finish stays;
  - the reply says `UNAVAILABLE`;
  - a low-stock alert and reorder prompt are raised.
- The reply also includes the remaining hand-out, the new hand-out id and updated balances. The replacement status is `ISSUED` / `UNAVAILABLE` / `NOT_REQUESTED`.

**Use and write-offs (INV-08)**
- Product, place, quantity, reason and note. Reasons: direct use, damage, expiry, loss, spillage, count correction.
- A **lost bottle** is written off as LOSS, not FINISHED.
- Above the branch limit, a note is required and the write-off waits for an owner's approval.
- The front desk can only **Report a problem**, which owners and inventory logins see as a request.
- Waste is reported separately from normal use.

**Fixing a mistaken finish**
- Done by an owner, as a correction movement that points at the original. Nothing is deleted.

**Staff leaving**
- When a stylist is made inactive or archived (`setStaffStatus`), their open hand-outs are flagged **needs handover** and owners are notified.

**Low stock**
- Uses available to issue against the reorder point.
- Alerts once per product until it is restocked (bell for owners and the branch's inventory logins).

**Tests**
- AC02–AC09, AC16, AC17.
- AC18 (front desk can't write off).
- AC25.
- AC26.
- Simultaneous finishes.
- Front desk switches.

---

### Phase 5: Service recipes and automatic use

**Service recipes (INV-09)**
- For each service: which products it uses and how much. A recipe is salon-wide or for one branch; the branch recipe wins.
- Recipes are versioned with start dates. Two active versions of the same recipe can't overlap (`RECIPE_CONFLICT`).
- Finish-mode products can be linked for reports only; the server refuses to make them deduct.
- Quantities are always entered by an owner, never suggested or made up.

**When a service is completed**
- When an appointment moves to **Completed**, one outbox event is written in the same transaction (`setAppointmentStatus`). This happens only when the add-on is on.
- Right after the save, a processor handles the event without slowing the front desk down. A retry sweep runs every few minutes.
- For each service line (each line is one "service instance"), the processor:
  - finds the recipe in effect at completion and saves the recipe version and quantities with the use;
  - takes **whole units** once per service line and recipe line;
  - takes **measured** ml/g from in-use (opened) stock first, then the store if the recipe allows.
- A unique key (salon + branch + appointment + service line + recipe line) means a repeated or replayed event never uses stock twice.
- Stock is always taken from the branch where the service happened.
- A service done by two people uses stock once, unless the recipe says otherwise.
- Cancelled bookings and no-shows use nothing.
- Combos use stock per service done.

**Exceptions list**
- If stock is short, nothing goes below zero. The line goes to **Exceptions** with the reason.
- Once restocked, an owner or inventory login picks **Post now**, or an owner picks **Dismiss** with a reason. Failed events have a **Retry** button.

**Correcting actual usage**
- For measured lines, "used 110 ml instead of 90" posts only the 20 ml difference, linked to the original.

**Tests**
- AC10–AC14.
- AC23 (editing a recipe doesn't change past uses).
- AC28 (replaying a failed event doesn't double-deduct).
- Exceptions when stock is short.
- Recipe overlap is refused.

---

### Phase 6: Suppliers, purchase orders, receiving and stock counts

**Suppliers (INV-10)**
- Name, contact, payment terms, lead time.
- Only people who can see costs see prices.

**Purchase orders (INV-11)**
- States: `DRAFT → PENDING_APPROVAL → APPROVED → ORDERED → PARTIALLY_RECEIVED / RECEIVED → CLOSED`, or `CANCELED`. Numbers look like `PO-AND-000045`.
- An order goes to approval when an inventory login creates it, or when it is above the branch owner's limit (then the business owner approves).
- **Reorder suggestions** use available-to-issue stock, reorder point, lead time and quantities already on approved orders. **Create order from suggestions** fills an order per supplier.

**Receiving (INV-12)**
- Against an order, or a direct receipt (authorized roles).
- Part deliveries are allowed. Supplier invoice number is recorded, with optional batch and expiry.
- **Only what physically arrives** increases the store and updates the average cost.
- Receiving more than was ordered needs the business owner's OK with a reason.
- **Return to supplier** is its own outgoing movement.

**Stock count**
- Start a count, which saves the expected quantities at that moment.
- Count store and in use separately, then see the differences.
- An owner reviews and approves. Approved differences post as count-correction movements, never as overwritten balances.
- The record keeps who counted, who reviewed and the reason for each difference.

**Tests**
- AC21 (part receipt posts only what arrived).
- AC22 (a count posts movements).
- AC30 (suggestions count open approved orders).
- Approval limits.
- Over-receipt rule.

---

### Phase 7: Reports, exports, README, help and full access tests

**Reports (INV-14)**
| Report | What it shows |
|---|---|
| Stock summary | Store, in use, available, on hand, on order, per product and branch |
| Low stock | Products below their reorder point, with supplier, lead time and suggested order |
| Use by product | Units and value by date, category, way of use and location |
| Station / stylist use | Finished units by recipient and station |
| Service-linked use | Recipe-based use per completed service |
| Waste and shrinkage | Damage, loss, expiry and adjustments, with cost |
| Purchasing | Supplier spend, lead times, part receipts, price changes |
| Stock value | Average cost and total value |
| Bottle efficiency | Services per finished bottle, clearly labelled **approximate** (bottle use belongs to whoever held it, not to exact services) |

**Exports**
- CSV export is built on the server, so cost columns are left out for roles that can't see costs (AC27).

**Settings (INV-15)**
- Locations, stations, reorder defaults, front desk switches, approval limits.

**Reconciliation check**
- An owner-only check that rebuilds every balance from the movement history and flags any mismatch. It runs in tests after mixed actions (AC24).

**Docs and checks**
- **README:**
  - add Inventory to "What it does", the architecture and ER diagrams, data model, tests, deployment (the add-on switch and creating the first inventory login), product decisions, limitations and future scope;
  - update the demo accounts with an inventory login.
- **Seed:** Glamour gets the add-on with sample products, a recipe and an open hand-out. Desert Rose stays without it.
- **Help assistant:** answers "how do I set up inventory?", "how do I mark a bottle finished?" and "why didn't a service deduct stock?".
- **Access test** (API level, like `frontDeskAccess.test.js`):
  - business owner, branch owner of another branch, inventory login and front desk each try every inventory action;
  - checks cost visibility and the add-on being off.
- **Isolation smoke test:** inventory ids added to the cross-salon attempts.
- **Acceptance test map:** a table in the README linking each PRD test (AC01–AC30) to its test file. AC15 (retail) is marked *not in this release*.

---

### Phase 8: Product catalogue with images

**Images**
- Each product can have up to **4 images**, one marked main, in JPEG, PNG or WebP, up to 2 MB each.
- Upload with `multer` (memory storage). `sharp` makes a 1000 px image and a 240 px thumbnail.
- Stored in MongoDB **GridFS** (bucket `inventory_images`), with a tenant check on every read.
- Served at `GET /api/inventory/skus/:id/images/:imageId?size=thumb`, with caching headers.

**Storage switch**
- `images/imageStore.js` gives one interface (`save`, `stream`, `remove`), set by `IMAGE_STORAGE=gridfs`.
- A `cloudinary` store can be added later without touching the screens.

**Catalogue screen**
- A **Catalogue** view next to Products: a grid of image cards with name, category, brand, in-store count and a low-stock badge.
- Search and filter work the same as Products. Clicking a card opens the product page.

**Other image features**
- **Add photos** on the product page.
- **Bulk image upload**: files named by SKU code are matched to products, with a preview before saving.
- **Printable catalogue**: print or save as PDF. It hides costs for roles that can't see them.

**Rules and deployment**
- Deactivated products keep their images. Deleting an image is logged.
- README and `render.yaml` get `IMAGE_STORAGE`, upload limits and a note about Atlas storage use.

**Tests**
- Upload type and size limits.
- Another salon's image is refused (404).
- A front desk login can view but not upload.
- Bulk name matching.

---

### Not in this add-on for now (and why)
- **Retail selling at checkout** (PRD retail POS, AC15): bills are services-only today. Retail products are tracked as stock only, and selling them is a later add-on step.
- **Reversing a completed service**: the app can't move an appointment out of Completed today. When it can, a `completion_reversed` event will post the opposite movements.
- **Moving stock between branches**: the data already has a branch on every row, so this can be added later (PRD: future-ready only).
- **Photo or AI catalogue import**: needs a reviewed design so it never guesses costs or quantities. CSV import covers setup.
- **Camera barcode scanning**: USB and Bluetooth scanners already work through search.
- **Cloudinary image storage**: behind the storage switch from Phase 8.
- **Plan-based billing for add-ons**: the `addons` field is ready; for now Super Admin switches it on by hand.
- **Outgoing events to other systems** (`inventory.stock_changed` and similar): in-app bell alerts for now. The outbox can publish them later.
- **Accounting ledger, supplier payments, RFID, forecasting, asset depreciation**: out of scope in the PRD.
