# Inventory & Procurement add-on

## Key decisions

- **Paid add-on.** The Super Admin switches it on per salon. When it's off, every inventory screen and API is closed and nothing else changes.
- **One inventory login per branch,** created in Team → Inventory logins.
- **Whole numbers only.** A bottle you finish is counted in bottles. A product used by measure is counted in whole ml, g or pieces: 3 bottles of 1000 ml and 400 ml left is stored as 3400 ml and shown as "3 bottles + 400 ml".
- **Every stock change is a movement** in a history that can't be edited. Balances are never typed in; opening stock and corrections are movements too.

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
| Reports and history | Every branch | Their branches | Their branch, without costs | Limited | No |
| Inventory settings | Yes | Their branches | No | No | No |

**"Delegated"** is a switch per branch in Inventory → Settings. For the front desk, *mark finished* is on; *issue*, *transfer* and *receive* are off. Reporting a problem is always allowed. The server checks every rule on every request.

## The four ways stock is used

| Way | What happens | Typical items |
|---|---|---|
| **Finish** (`FINISH`) | Whole bottles are handed to a station or stylist ("In use") and used up when someone marks them Finished, with an optional replacement in the same step. | Shampoo, wax jars |
| **Per service, whole units** (`SERVICE_UNITS`) | A set number of units is used up each time the service is completed. | Facial kits |
| **Per service, by measure** (`SERVICE_MEASURED`) | A set number of ml, g or pieces is used up each time the service is completed; the amount can be corrected afterwards. | Hair colour, developer |
| **By hand** (`MANUAL`) | Someone records use, damage, expiry, loss, spillage or a count correction. | Anything unplanned |

## How stock is counted

- Stock is **In store** or **In use** per branch. Issuing moves it from store to in use, so the total doesn't change.
- **Available to issue** = what is in the store. "Need to order" and reorder suggestions use this number.
- A finish-mode bottle is never used up automatically. It can be linked to a service for reports only.
- Stock can never go below zero. An automatic use that can't be covered goes to an exceptions list.
- Stock value uses the moving average cost per product per branch. Stock in use still counts.
- Every movement records who reported it, separately from the stylist or station that had the product.

## Where the code is

`server/src/modules/inventory/`: `permissions.js` holds the "who can do what" rules, and `stock/stock.engine.js` is the only code that writes stock. Completing a service writes an event in the same transaction; a background job in the API process handles it and retries failures, and each service line can only take stock once.
