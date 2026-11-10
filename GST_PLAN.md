# GST Engine: Build Plan

Based on `GrowwPilot_GST_Engine_Technical_PRD_v1.pdf` (1 Nov 2026) and a check of the current code on 4 Nov 2026. **Phases 1 to 4 are built and committed. Phase 5 is built (7 Nov 2026), not yet committed.** **Still open: no GSTR-1 file has been uploaded to the GST portal or offline tool, no real GSTR-2B file has been read, and no official sample files were available. A GST practitioner still has to review the tax rules.**

**The goal:** a salon's bills become a correct, traceable GST record. From that record the owner can prepare GSTR-1, check purchases and input credit, and prepare a GSTR-3B working sheet. The owner still files on the GST portal.

**How we work:** 5 phases, 5 manual commits. I stop after each phase so you can check it, then you commit with the line given at the end of that phase.

---

## Words used

| Word | Meaning |
| --- | --- |
| GSTIN | The salon's 15-character GST number |
| SAC / HSN | Government codes for a service (SAC) or a product (HSN) |
| CGST + SGST / IGST | Tax on a sale within the state / tax on a sale to another state |
| Tax record | A permanent entry for each taxed event. It is never edited; a correction is a new entry |
| GSTR-1 | The monthly return listing what the salon sold |
| GSTR-2B | A read-only government statement of what suppliers reported selling to the salon |
| ITC | Input tax credit: GST paid on purchases that can reduce the GST owed |
| GSTR-3B | The monthly summary return where tax is actually paid |
| ARN | The number the GST portal gives as proof of filing |

---

## What we already have

| Area | Already in the app | Still missing |
| --- | --- | --- |
| Bills | Draft, then issued and locked. Number per branch and year. Rate, code and tax saved on each line. Discounts shared to the exact paisa. PDF | IGST, place of supply, buyer's GSTIN |
| GST settings | Registered or not, prices with or without GST, GSTIN per branch with check-digit test | Start and end dates. Changing a GSTIN overwrites the old one |
| Tax rates | A rate on each service and product, plus salon defaults (18%) | Effective dates, owner approval, blocking when a code is missing |
| Refunds | Owner approval, numbered credit notes that are never changed | Refund by units only, so half of one haircut is not possible. No IGST |
| Voided bills | Number stays and the bill is marked void | Nothing stops a void in a month already filed |
| Advances | Money kept for a customer, usable at any branch | No tax when received, no receipt voucher, no way to give back unused money |
| Packages | None. There are only plain advances | See decision 4 below |
| Purchases | Suppliers, orders and deliveries (Inventory add-on) | Supplier GSTIN, GST amounts, supplier bills |
| Reports | "GST collected" totals by rate | Returns, error checks, a link from each figure to its bill |
| Roles | Business owner, branch owner, front desk, with owner on/off switches | GST permissions |
| Building blocks | Permanent-record models, safe retries, activity log, CSV and PDF helpers, background timers | Nothing: all of these get reused |

---

## Decisions needed

I will build with my suggestion unless you choose differently. Decisions 2 and 3 should also be checked by your tax person.

| # | Question | My suggestion | Affects |
| --- | --- | --- | --- |
| 1 | The PRD asks for a separate service on PostgreSQL, shared with AutoMod CRM. AutoMod is not in this project and the app uses MongoDB. Where do we build? | A separate `gst` section inside this app, on MongoDB. Bill and tax record save together, so the PRD's message queues and "tax pending" states are not needed | All phases |
| 2 | The app's default service GST is 18%. The PRD says standard salon services are 5% without ITC from 22 Sep 2025. Which default? | New salons start with a 5% rule. Existing salons confirm it during setup. Old bills never change | Phase 1 |
| 3 | The app splits tax into two equal halves. ₹4,999 at 5% gives ₹238.04 GST today, but the PRD expects ₹238.05, which means CGST and SGST differ by 1 paisa | Follow the PRD for new bills on activated salons. The risk is that the portal may expect equal amounts, so ask your tax person and test it in Phase 4 | Phases 1, 3, 4 |
| 4 | The PRD's ₹4,999 package test assumes a packages feature. The app has none | Do not build packages here. An advance can be marked "for named services" and taxed when received. Tracking 5 haircuts, 5 trims and so on would be its own feature | Phase 3 |
| 5 | Plain advances and extra money kept at checkout are not tied to any service. Are they taxed when received? | No tax when received. They appear on the return as a warning for the owner to review. Your tax person should confirm | Phases 3, 4 |

---

## What we need from you

- **A GST practitioner** to check the tax rules and test cases before any salon goes live. The PRD requires this.
- **The practitioner's answer on the service code.** The PRD uses `99972`, which is 5 digits. The app's own example is `999721`. The return may need the full code.
- **The official GST file formats** for GSTR-1 and GSTR-2B, before Phases 4 and 5. Sample files from the GST portal's offline tool are enough.
- **A real GST portal login** to test uploading a file in Phase 4. I can't do this part. Until then, I can only check the file against the official format.

---

## Rules for every phase

- Only the three roles: business owner, branch owner, front desk. Inventory logins and the Super Admin get no GST access. An accountant gets a downloaded file.
- A salon that has not activated GST setup keeps billing exactly as it does today. Unknown errors never turn tax into zero.
- A figure that is wrong gets fixed at its source bill. Nobody types over return totals.
- "Downloaded" is never shown as "filed".
- No new bell messages, except when the nightly check finds a difference a person must fix. The main dashboard stays as it is.
- Each phase adds its tests, help topics, demo data and README lines.

---

## Phases at a glance

| Phase | Result | PRD part | PRD tests |
| --- | --- | --- | --- |
| 1 | GST setup, and correct tax on every new bill | GST-01, GST-02 quote | G01–G07, G43–G45 |
| 2 | Permanent tax record, part refunds, sales register | GST-02 posting, GST-04 | G08, G09, G14, G15, G17, G41, G42, G46 |
| 3 | Tax on advances, with no double counting | GST-03 | G10–G13 |
| 4 | GSTR-1 from review to recorded filing | GST-06, GST-07, GST-09 | G16, G18–G28, G37, G39, G40, G47, G48 |
| 5 | Purchases, ITC and GSTR-3B working sheet | GST-05, GST-08 | G29–G36 |

---

## Phase 1: GST setup and correct tax on bills

**What we build**

- **GST setup screen:** the owner picks Not registered or Regular. Composition and QRMP show "Not supported" and can't file.
- **GST registrations:** GSTIN, legal name, state, monthly filing and a start date. Each branch links to one GSTIN for any given date, and overlaps are refused. Fixing a GSTIN adds a new dated row. Current branch GSTINs move here automatically, so there is one place to edit them.
- **Start month:** the first month this salon's returns come from the app. Earlier months stay out of it.
- **Tax rules:** name, SAC or HSN code, rate, ITC type, and from/to dates. Only the business owner approves a rule, and can record who reviewed it. An approved rule can't be edited; a change is a new dated rule. Overlapping dates are refused.
- **Starter rules:** salon services at 5% without ITC from 22 Sep 2025, and products for sale at 18% with ITC, using the HSN code most products have. A GST practitioner should check both.
- **Services and products** point to a tax rule. Staff never choose a rate.
- **Save and Activate:** Save adds ready-made rules for services and products, linked to everything; Activate approves them. Test bills are there to try the tax.
- **After activation:** a line with no approved rule or code can't be issued, and the error links to the service or product to fix.
- **Bills:** the rule is chosen by the issue date and saved on the line. Rounding follows decision 3.
- **Buyer and place of supply:** a GSTIN on the customer for business bills. Place of supply defaults to the branch's state. Another state means IGST on the bill, tax table and PDF. If the place can't be worked out, the bill is blocked.
- **Number length:** GST numbers can be 16 characters at most. The app already drops the dash for 4-letter prefixes (`CNABCD/26-27/001`), so every allowed prefix fits and setup has nothing to refuse. A test holds this in place.

**Done when**

- A ₹1,050 haircut gives ₹1,000 + ₹25 CGST + ₹25 SGST.
- A ₹1,180 product with an approved 18% test rule gives ₹1,000 + ₹90 + ₹90.
- The same haircut to another state gives IGST with no CGST or SGST.
- A rate change affects new bills only. Old bills keep their saved tax.
- Not-registered and not-yet-activated salons bill as before, and all existing tests pass.

**Commit line**

```
GST Phase 1: GST setup screen, dated registrations and branch links, owner-approved tax rules, test bills and activation, bills use the rule by date, buyer GSTIN, place of supply and IGST
```

---

## Phase 2: Permanent tax record and corrections

**What we build**

- **Tax record:** one permanent entry for each issued bill, saved together with the bill, so one can't exist without the other. A retry can't create a second entry.
- **Credit notes and voids** add new minus entries. The original stays untouched. A void in a filed month gets blocked once Phase 4 adds filing.
- **Part refunds by amount:** for example ₹525 off a ₹1,050 haircut gives ₹500 taxable and ₹25 tax. A refund can't go above what is left on the line. Commission is taken back in the same share.
- **Older bills:** GST bills from the start month onward are added to the record automatically, once only.
- **GST menu** with tabs: Overview, Sales & Returns and Settings. Later phases add Advances, Purchases & ITC and Returns. Overview stays small: period, output tax and what needs attention. Each row opens the existing bill screen.
- **Permissions:** the business owner sees everything. Branch owners see their own branches' data only if switched on, because they can't open other branches' bills. The front desk sees only the tax on bills. Other salons' data is never reachable.
- **Nightly check:** compares issued bills with the tax record and lists any difference with a link to the bill.
- **"GST collected" report:** reads the tax record for activated salons, so two screens can't disagree.

**Done when**

- The same bill sent three times gives one tax entry.
- Stopping the server in the middle of issuing leaves both the bill and its tax entry, or neither.
- A half refund reverses ₹500 and ₹25 once only, even if retried, and the original bill is unchanged.
- The owner sees the bill in the sales register and can open it from there.
- Front desk and other-salon access are refused.

**Commit line**

```
GST Phase 2: permanent tax record saved with each bill, credit notes and voids as new entries, part refunds by amount, older bills added from the start month, GST menu and sales register, nightly check
```

---

## Phase 3: Tax on advances

**What we build**

- **Taking an advance:** a new choice, "for named services", which uses an approved rule. Tax is worked out when the money comes in, and the customer gets a numbered receipt voucher with a PDF.
- **Plain advances** and extra money kept at checkout stay untaxed (decision 5).
- **Using it on a later bill:** the bill links to the advance and the tax already paid is used up, so the same money is never taxed twice. Tax is added only on any extra amount.
- **Limits:** the tax used can never exceed the tax originally paid. If a bill already covers that money, the advance is refused and the desk is pointed to Record payment on that bill, so no advance tax is recorded.
- **Different GSTIN:** today advances work at any branch. A taxed advance taken under one GSTIN is refused at a branch on another GSTIN, as the PRD asks. Plain advances are unchanged. It is also refused on a bill with another place of supply, because IGST can't use up CGST and SGST.
- **Giving back unused money:** new for every advance, because until now only an unused payment could be reversed in full. Those who may approve refunds do it. Refunds and reversals add linked minus entries.
- **Advances view:** taken, used and left, with tax, for each GSTIN.

**Done when**

- Using decision 3, ₹4,999 gives ₹4,760.95 + ₹238.05 tax, recorded once.
- A later service paid from that advance adds no second tax, and ₹0 is due.
- Using more than is left is refused and earlier records stay unchanged.
- The November test (haircut + package + product) gives ₹7,229 collected, ₹6,760.95 taxable and ₹468.05 tax, each shown as its own measure.

**Commit line**

```
GST Phase 3: advances for named services taxed when received with a receipt voucher, no double tax when used on later bills, limits and GSTIN checks, unused advances can be given back
```

---

## Phase 4: GSTR-1 from review to filing record

**What we build**

- **Prepare GSTR-1:** the owner picks a GSTIN and month. The app groups all that GSTIN's branches and reads the tax record up to that moment. Two people preparing at once can't clash.
- **Return tables:** B2B, large and other B2C, credit notes, advances (Table 11), and HSN/SAC for B2B and B2C separately (Table 12). Document counts including voided bills (Table 13). The grouping rules are stored per period, because the rules change over time. Anything unsupported blocks the return.
- **Units for Table 12:** products use free text like "bottle" today, so each one maps to an official unit code. A missing one is a blocking error.
- **Trail for every figure:** each return figure links back to its tax entries. Every entry must appear exactly once or be listed as excluded.
- **Error list:** each issue says what is wrong and opens the exact bill, service or product. After the fix, Rebuild makes a new revision and keeps the old one.
- **Approve and export:** an approved revision can't change. It exports JSON, checked against a file layout kept in one place (`gstr1.format.js`), plus a review CSV and PDF. GSTN doesn't publish the layout openly, so it comes from public notes on the offline tool and still has to be proven by a real upload.
- **Status:** Exported never means Filed. A rejected upload is marked Rejected, its errors link to the source, and a new revision follows.
- **Record filing:** the owner enters the ARN, date and proof, shown as "Manually confirmed". No proof, no Filed. The month then locks.
- **After filing:** direct edits, and voids of bills in that month, are refused with "Create adjustment case". If GSTR-3B isn't filed yet, an omitted bill goes through GSTR-1A as a correction. If it is filed, the app points to a later-period amendment for review.
- **Branch owner switch:** view returns if delegated. Only the business owner approves unless that is switched on.

**Done when**

- November 2026 goes from Prepare to fix an error, Rebuild, Approve, Export and Record filing.
- Totals match the tax record with zero differences.
- Two GSTINs give two separate returns.
- A bill changed after export needs a new revision, and the old export is kept.
- Front desk is refused. Filing with no proof is refused.
- The JSON passes the official format check, and one test upload is done with your portal login. If the login isn't ready, I will say clearly that this test is still open.

**Commit line**

```
GST Phase 4: GSTR-1 preparation with Tables 11, 12 and 13, every figure traced to its bill, error list with rebuild and revisions, approval, official JSON export, recorded filing with proof, month lock and GSTR-1A corrections
```

---

## Phase 5: Purchases, ITC and GSTR-3B working sheet

**What we build**

- **Supplier GSTIN** on suppliers.
- **Purchase bills:** a new record, because the app has none today and deliveries hold only an invoice number. It stores supplier GSTIN, bill number, date, amounts, GST and how the goods are used. It can link to a delivery, but also works without the Inventory add-on. Duplicates are caught.
- **Import GSTR-2B:** upload the file for a GSTIN and month. The same file twice is recognised and not counted again. The file's layout isn't published openly, so it is read tolerantly, with a simple CSV as the fallback.
- **Matching:** Matched, Missing in 2B, Missing in books, Amount mismatch, Duplicate or Needs review, with the difference shown.
- **ITC decisions:** the app suggests an amount based on use. A purchase used only for 5%-without-ITC services gets ₹0. Stock for resale is reviewed on its own. Mixed use needs a decision. The owner approves with a reason. A match alone never claims credit.
- **Purchases & ITC grid** as in the PRD, with filters. Approve is disabled while something is unresolved.
- **GSTR-3B working sheet:** output tax from the tax record and approved ITC from purchases, placed in the 3.1, 3.2 and Table 4 rows for that period. It keeps our figures, the portal's figures and the differences apart.
- **Portal figures:** the owner enters them, and the portal's locked figures are never shown as editable. A difference points to the fix (the source bill, GSTR-1A or the ITC decision).
- **Finish:** the owner approves the sheet, then pays and files on the portal and records the ARN and proof. The app does not claim the tax was paid, and does not calculate interest, late fees or ledger balances.

**Done when**

- A ₹590 purchase with ₹90 GST, used only for salon services, matches 2B and gives ₹0 eligible and ₹90 not eligible.
- Missing, mismatched and duplicate rows each show the right status.
- The working sheet for haircut + package + product + purchase shows ₹468.05 output tax and no ₹90 credit.
- Every ITC amount claimed traces to one bill and one approved decision.

**Commit line**

```
GST Phase 5: purchase bills with supplier GSTIN, GSTR-2B import and matching, owner-approved ITC decisions, GSTR-3B working sheet compared with portal figures, recorded filing with proof
```

---

## Not in this plan

| Left out | Why |
| --- | --- |
| Direct filing through a GST provider (PRD M6, test G38) | Needs a signed partner and their test system |
| QRMP, composition, annual returns, e-invoices, e-way bills, accepting or rejecting invoices on the portal (PRD M7) | The PRD puts each in its own later release |
| Exports, SEZ, reverse charge, marketplace sales | The PRD excludes them from launch. Where they turn up, they are marked for review or blocked |
| Debit notes | Billing has no way to charge more on an issued bill, and the PRD's launch list names only credit notes |
| Packages with session tracking | See decision 4 |
| A separate service and connection to AutoMod CRM | See decision 1 |
| Separate encryption keys for each salon | The PRD asks for this, but it is a hosting-level change. The app uses its current database protection, and login checks limit access |

Everything else in the PRD's test list (47 of 48 tests) is covered by the 5 phases above. Some are adjusted by decision 1: for example, G42 becomes a test of a server stop in the middle of issuing a bill.
