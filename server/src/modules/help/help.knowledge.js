// The assistant's knowledge: one entry per help topic.
//
// audiences:  who the steps are for. PRIMARY_OWNER (sees every branch), BRANCH_OWNER (some branches), FRONT_DESK, INVENTORY
// addon:      the topic belongs to a paid add-on (e.g. 'inventory'); salons without it are told so
// keywords:   words that point to this topic. A phrase counts when ALL its words are in the question.
//             Each word is worth 1 point; a leading "*" makes a single strong word worth 2 points.
// answer:     the reply. "for" gives a different reply to a specific audience.
// denied:     the reply for someone OUTSIDE the audiences (they learn who can do it, not how).
// link:       a button that opens the right screen (link.audiences: only for some of the topic's audiences).
// hidden:     kept here but never answered (the screen is switched off)
// general:    a broad topic (e.g. "booking"). On a tie it loses to a specific one (e.g. "cancel a booking").
// Placeholders: {name} (first name), {branch} (selected branch), {salon} (salon name)

const OWNERS = ['PRIMARY_OWNER', 'BRANCH_OWNER'];
const EVERYONE = ['PRIMARY_OWNER', 'BRANCH_OWNER', 'FRONT_DESK'];
// Inventory add-on: inventory logins only see inventory, so they join these lists only
const ALL = [...EVERYONE, 'INVENTORY'];
const STOCK_KEEPERS = [...OWNERS, 'INVENTORY'];

export const KNOWLEDGE = [
  // ---------------------------------------------------------------- small talk
  {
    id: 'greeting',
    title: 'Hello',
    audiences: ALL,
    keywords: ['*hi', '*hello', '*hey', 'good morning', 'good evening'],
    answer: 'Hi {name}! I’m the GrowwPilot assistant. Ask me how to do anything in the app, like booking, checkout or attendance.',
  },
  {
    id: 'thanks',
    title: 'Thanks',
    audiences: ALL,
    keywords: ['*thanks', '*thank', '*great', '*awesome', '*cool'],
    answer: 'Happy to help, {name}! Ask me anything else whenever you need.',
  },
  {
    id: 'capabilities',
    title: 'What I can help with',
    audiences: ALL,
    keywords: ['what can you do', 'who are you', 'help', 'what you know'],
    answer: 'I know how every screen in GrowwPilot works, and I answer for your role.',
    for: {
      FRONT_DESK: 'I can help with everything you do at {branch}: booking and rescheduling, the day board, customers, checkout and split payments, and staff attendance.',
      PRIMARY_OWNER: 'I can help with the dashboard, analytics and the sales PDF, your team, services, combos and branches, plus everything the front desk does.',
      BRANCH_OWNER: 'I can help with the dashboard, analytics, your staff and front desk logins, plus everything the front desk does at your branches.',
      INVENTORY: 'I can help with stock at {branch}: products, issuing and finishing bottles, write-offs, purchase orders, deliveries and stock counts.',
    },
  },
  {
    id: 'support',
    title: 'Talking to a person',
    audiences: ALL,
    keywords: ['*support', 'talk to human', 'contact team', 'real person', 'email support', 'call someone'],
    answer: 'You can reach the GrowwPilot team any time with the **Need help?** link at the bottom of the sidebar (it emails support@growwpilot.com).',
  },

  // ---------------------------------------------------------------- appointments
  {
    id: 'book',
    title: 'Booking an appointment',
    general: true,
    audiences: EVERYONE,
    keywords: ['new booking', 'make booking', 'create booking', 'add booking', '*booking', 'schedule customer'],
    answer:
      'To book an appointment:\n1. Open the **Day board** and click **New booking**.\n2. Find the customer by phone or name, or click **New customer**.\n3. Tick one or more services, or switch to **Combo**.\n4. Choose a stylist and a date, then pick a free time.\n5. Check the summary and click **Confirm booking**.',
    link: { label: 'New booking', to: '/app/appointments/new' },
  },
  {
    id: 'slot-taken',
    title: 'When a slot was just taken',
    audiences: EVERYONE,
    keywords: ['already booked', 'slot taken', 'another desk', 'double booking', 'double booked', 'conflict', 'clash', 'slot not available'],
    answer:
      'If two desks book the same stylist at the same moment, the first one to save wins. The other sees *“This slot was just booked by another desk. Please pick another time.”* The free times refresh by themselves and everything you entered is kept, so just pick another time and confirm again.',
  },
  {
    id: 'reschedule',
    title: 'Rescheduling or editing a booking',
    audiences: EVERYONE,
    keywords: ['*reschedule', 'change time', 'edit booking', 'change booking', 'move booking', 'change date', 'different time'],
    answer:
      'Open the appointment (click it on the Day board or in Appointments) and click **Edit / reschedule**. You can change the time, services or stylist. Only appointments that are still **Booked** can be changed, and the new time is checked for clashes just like a new booking.',
    link: { label: 'Appointments', to: '/app/appointments' },
  },
  {
    id: 'cancel',
    title: 'Cancelling a booking',
    audiences: EVERYONE,
    keywords: ['*cancel', 'delete booking', 'remove booking'],
    answer:
      'Open the appointment and click **Cancel booking**. You can add a reason (optional). A booking can be cancelled while it’s Booked or Arrived; the time becomes free again straight away. Cancelled bookings never count as revenue.',
  },
  {
    id: 'status-flow',
    title: 'Moving a booking along',
    audiences: EVERYONE,
    keywords: ['mark arrived', '*arrived', 'start service', 'complete service', 'change status', '*status', 'mark complete', 'mark completed'],
    answer:
      'Each booking moves in order: **Mark arrived → Start → Complete → Checkout**. Use the gold button on the booking block on the Day board. Steps can’t be skipped (a booking can’t go from Booked straight to Completed), and a booking can only be cancelled before the service starts.',
    link: { label: 'Day board', to: '/app/today' },
  },
  {
    id: 'day-board',
    title: 'Reading the day board',
    audiences: EVERYONE,
    keywords: ['day board', 'dayboard', '*colour', '*color', 'no show', 'running late', 'waiting', 'orange'],
    answer:
      'The Day board has one column per stylist and time running down the page.\n- White = Booked, yellow = Arrived, gold = In service, brown = Completed.\n- An **orange ring** means something needs you: *Possible no-show* (still Booked 15+ min after the start), *Waiting* (arrived but not started after 10 min) or *Running late* (past the planned end).\n- It refreshes every minute and jumps to the current time.',
    link: { label: 'Day board', to: '/app/today' },
  },
  {
    id: 'walk-in',
    title: 'A walk-in customer',
    audiences: EVERYONE,
    keywords: ['*walkin', 'walk in', 'no appointment', 'came without'],
    answer:
      'Click **New booking**, add or find the customer, pick the service and a stylist, choose the nearest free time today, and set **How did they book?** to *Walk-in*. Then click **Mark arrived** on the Day board when they sit down.',
    link: { label: 'New booking', to: '/app/appointments/new' },
  },
  {
    id: 'combo-booking',
    title: 'Booking a combo',
    audiences: EVERYONE,
    keywords: ['book combo', 'combo booking', 'package booking', 'book package'],
    answer:
      'In the booking form, step 2, switch from **Services** to **Combo** and choose one. Its services are added back to back and the booking uses the combo’s special price.',
  },
  {
    id: 'multi-service',
    title: 'Several services or stylists in one booking',
    audiences: EVERYONE,
    keywords: ['multiple services', 'more than one service', 'two services', 'different staff', 'change staff', 'another staff', '*duration', 'how long', 'minutes'],
    answer:
      'Tick several services in step 2; they run back to back. In the **Review** box you can change the stylist or the minutes for any single service. A service with no fixed duration uses the branch’s default time.',
  },

  // ---------------------------------------------------------------- customers
  {
    id: 'customer-add',
    title: 'Adding a customer',
    audiences: EVERYONE,
    keywords: ['add customer', 'new customer', 'create customer', 'register customer', 'duplicate customer', 'same phone'],
    answer:
      'Go to **Customers → Add customer**, or click **New customer** inside the booking form. One phone number = one customer: if the phone already exists you’ll see *“This phone already belongs to …”* with a link to open that profile, so no duplicates are created.',
    link: { label: 'Customers', to: '/app/customers' },
  },
  {
    id: 'customer-profile',
    title: 'Customer history and spend',
    audiences: EVERYONE,
    keywords: ['customer history', 'customer profile', 'total spend', '*visits', 'last visit', 'book again', 'preferred staff'],
    answer:
      'Open **Customers** and click a name. The profile shows total visits, total spend and the last visit (always calculated from real appointments and invoices), plus upcoming and past appointments from every branch. **Book again** opens the booking form with the customer and their preferred stylist already filled in.',
    link: { label: 'Customers', to: '/app/customers' },
  },

  // ---------------------------------------------------------------- leads
  {
    id: 'lead-add',
    hidden: true,
    title: 'Adding and following up leads',
    general: true,
    audiences: EVERYONE,
    keywords: ['*lead', 'add lead', 'follow up', '*followup', 'instagram enquiry', 'lead status', '*enquiry'],
    answer:
      'Go to **Leads → Add lead** and fill in the name, phone, source, the service they’re interested in, who follows up, and the next follow-up time. Open a lead to add notes to its timeline, move it along (**New → Contacted → Interested**, or **Lost**) and change the follow-up. Overdue follow-ups show in orange, and the **Overdue follow-ups** chip lists them.',
    link: { label: 'Leads', to: '/app/leads' },
  },
  {
    id: 'lead-convert',
    hidden: true,
    title: 'Converting a lead into an appointment',
    audiences: EVERYONE,
    keywords: ['convert lead', '*convert', 'lead appointment', 'lead to booking'],
    answer:
      'Open the lead and click **Convert to appointment**. The booking form opens with their service ticked, and tells you if the phone already belongs to a customer (the booking is then linked to that profile). Click **Book and convert lead**. It all saves together: if the slot is taken, nothing is saved and the lead stays as it was.',
    link: { label: 'Leads', to: '/app/leads' },
  },

  // ---------------------------------------------------------------- checkout
  {
    id: 'checkout',
    title: 'Checkout and split payments',
    audiences: EVERYONE,
    keywords: ['*checkout', 'split payment', 'take payment', 'collect money', 'card and cash', 'upi', 'part payment', 'pay bill', 'pay later', '*due', 'record payment'],
    answer:
      'When a service is **Completed**, click **Checkout** on its block. This opens a draft bill. Add a payment row for each method with **+ Add payment method** (for example ₹1,000 card + ₹500 UPI + ₹30 cash); the **Rest** button fills in what’s left. Click **Issue & pay**: the bill gets its number and is locked. Paying less is fine: the rest shows as *due*, and **Record payment** on the bill takes it later. Bills with money due are listed under **Bills** (filter *Money still due*) and on the dashboard.',
    link: { label: 'Bills', to: '/app/bills' },
  },
  {
    id: 'discount',
    title: 'Giving a discount',
    audiences: EVERYONE,
    keywords: ['*discount', 'percent off', 'reduce price', 'lower price', '*offer'],
    answer:
      'On the checkout page, choose **₹** or **%** and type the amount, either next to one service or as a *Bill discount* for everything. The total (and GST, if your salon is registered) updates straight away. The front desk can give up to the salon’s limit (10% unless an owner changed it in **Billing settings**); above that, click **Ask owner to approve**, and the bill can be issued once an owner approves it. Only owners can change a price, and they give a reason.',
  },
  {
    id: 'invoice',
    title: 'Printing or finding an invoice',
    audiences: EVERYONE,
    keywords: ['*invoice', 'print bill', 'reprint', '*receipt', 'save pdf invoice'],
    answer:
      'After issuing you land on the bill. Click **Print / save as PDF**. To find it later, open **Bills** and search by bill number, customer name or phone, or click the **Paid ✓** / **Due** badge on the Day board. An appointment is only ever billed once.',
  },

  {
    id: 'product-sale',
    title: 'Selling products',
    audiences: EVERYONE,
    keywords: ['*sell product', 'retail', 'new sale', 'add product to bill', 'product sale', 'sell shampoo', 'barcode bill'],
    answer:
      'With the Inventory add-on, click **Add product** on the checkout page, or **New sale** on the **Bills** page for products only. Search or scan the barcode; the list shows how many are in the store, and a bill can’t be issued with more than there is. The stock goes down when the bill is issued. Only retail products with a selling price (set by an owner in Inventory) can be sold.',
    link: { label: 'Bills', to: '/app/bills' },
  },
  {
    id: 'refund',
    title: 'Refunds and returns',
    audiences: EVERYONE,
    keywords: ['*refund', '*return product', 'money back', 'credit note', 'customer returned', 'give money back', 'void bill', 'cancel bill', 'reverse payment'],
    answer:
      'Open the bill and click **Refund / return**. Tick what comes back, say how many and (for products) whether they can be sold again, or choose **Part of the amount** to refund only some of a line’s value (₹525 off a ₹1,050 haircut), and give a reason. The front desk’s request goes to an owner, who approves or turns it down. Approving gives the money back, makes a credit note on GST bills, puts sellable products back in the store and takes back the stylist’s commission (in the same share for part of the amount). Owners can also **Void** a bill with no money on it, or **Reverse** a payment that was recorded by mistake.',
  },
  {
    id: 'advance',
    title: 'Customer advances',
    audiences: EVERYONE,
    keywords: ['*advance', 'deposit', 'paid in advance', 'pay ahead', 'use advance', 'extra money'],
    answer:
      'On the customer’s profile, click **Take advance** for money paid ahead (for example a bridal deposit). At checkout, the advance shows in the payment box: type how much to use. If a customer pays more than the bill, tick **Keep the extra as an advance**. Plain advances can be used at any branch. Once GST setup is active you can also choose **For named services**: see *Advances for named services*. Owners can **Give back** unused money from the customer’s profile.',
  },

  {
    id: 'gst-advance',
    title: 'Advances for named services',
    audiences: EVERYONE,
    keywords: ['advance for named services', '*voucher', 'receipt voucher', 'refund voucher', 'tax on advance', 'gst on advance', 'advance tax', 'package advance', 'give back advance', 'advance under another gstin'],
    answer:
      'When GST setup is active, **Take advance** can be **For named services**. Choose the services and the app works out the tax from their approved rule, so nobody picks a rate. The customer gets a numbered **receipt voucher**. When the money is used on a later bill, the tax already paid is used up, so it isn’t taxed twice, and tax is added only on any extra amount. It can only be used at branches on the same GSTIN and state. If the money is for a bill already issued, record the payment on that bill instead: the bill already has the tax. An owner can **give back** unused money, which takes its tax back with a numbered refund voucher. Your tax person should confirm that plain advances, which aren’t taxed when received, are right for your salon.',
  },

  {
    id: 'cash-drawer',
    hidden: true,
    title: 'Cash drawer (daily cash closing)',
    audiences: EVERYONE,
    keywords: ['*cash drawer', 'cash closing', 'close the day', 'close cash', 'float', 'petty cash', 'count cash', 'cash short', 'day end'],
    answer:
      'Open **Cash drawer** in the menu. In the morning, count the drawer and click **Open cash day** with that float. Cash payments and cash refunds are added by themselves; add **petty cash** in or out with what it was for. At closing, type the cash you counted: the screen shows if the drawer is short or over (say why), then click **Close cash day**. A closed day can’t be changed; an owner can add an adjustment with a reason.',
    link: { label: 'Cash drawer', to: '/app/cash' },
  },
  {
    id: 'dues',
    title: 'Dues (money customers owe)',
    audiences: EVERYONE,
    keywords: ['*dues', 'owed', 'outstanding', 'pending payment', 'who owes', 'unpaid bills', 'ageing'],
    answer:
      'Open **Bills** and click **Dues**. It shows every bill with money still owed, grouped by age (0–30, 31–60, 61–90 and over 90 days), and per customer. Click a bill to take the payment with **Record payment**. A customer’s profile also has a **Bills & payments** tab with what they owe.',
    link: { label: 'Dues', to: '/app/dues' },
  },
  {
    id: 'billing-reports',
    title: 'Billing reports and bill PDFs',
    audiences: EVERYONE,
    keywords: ['billing report', 'gst report', 'collections', 'sales report', 'csv', 'download report', 'send bill', 'whatsapp bill', 'bill pdf', 'share bill'],
    answer:
      'Owners: open **Bills → Reports** for sales by day, GST collected, discounts, collections, dues, advances, retail, cash closing and sales by staff, each downloadable as CSV. The front desk sees today’s collections. On any bill, **PDF** downloads it and **Send to customer** makes a link (valid 30 days) you can copy or send on WhatsApp.',
    link: { label: 'Bills', to: '/app/bills' },
  },

  {
    id: 'gst-settings',
    title: 'GST and billing settings',
    audiences: OWNERS,
    keywords: ['*gst', 'tax invoice', 'billing settings', 'bill prefix', 'bill number', 'cgst', 'sgst', 'tax rate'],
    answer:
      'Open **Bills → Billing settings** (the business owner changes them) for the front desk discount limit and each branch’s bill prefix (numbers look like AND/26-27/00001 and start again every 1 April). GSTINs are kept in **GST → Settings**, with the date each one starts. Until GST setup is active, this page also holds whether the salon is **GST registered**, whether menu prices include GST and the default rates, and a service or product can have its own rate. **Please have your tax adviser check the rates and codes.**',
    link: { label: 'Billing settings', to: '/app/settings/billing' },
  },

  {
    id: 'gst-setup',
    title: 'GST setup: registrations, tax rules and activating',
    audiences: OWNERS,
    keywords: ['gst setup', 'gstin', 'activate gst', 'tax rule', 'approve rule', 'sac code', 'hsn', 'start month', 'gst registration', 'change gstin', 'test bill', 'composition', 'qrmp'],
    answer:
      'Open **GST → Settings** (the business owner changes it; branch owners can look). 1. Choose **Regular**, check the start month and press **Save**. Your branch GSTINs move over, and ready-made tax rules are added and linked to every service and product for sale: services at 5% without ITC from 22 Sep 2025, products at 18%. 2. Check the **GSTINs** and the **tax rules** with your GST practitioner, and edit a rule if needed. 3. Press **Activate**: it approves the rules. From then on each bill uses the rule for its date, and old bills never change. An approved rule can’t change; a new rate is a new dated row. You can try a **test bill** any time after that. Composition and QRMP aren’t supported.',
    link: { label: 'GST setup', to: '/app/gst?tab=settings' },
  },

  {
    id: 'gst-record',
    title: 'The tax record, sales register and nightly check',
    audiences: OWNERS,
    keywords: ['*nightly', 'tax record', 'sales register', 'output tax', 'gst overview', 'gst menu', 'nightly check', 'gst difference', 'tax entry', 'credit note in gst', 'gst csv'],
    answer:
      'Open **GST** in the menu. **Overview** shows a month’s output tax for one GSTIN or all of them, and anything that needs attention. **Sales & Returns** lists every bill, credit note, voided bill and advance entry of the month with its tax: click a row to open it, or download a CSV for your accountant. **Advances** shows what was taken, used and left, with tax, for each GSTIN. **Purchases & ITC** is for supplier bills and credit, and **Returns** is where you prepare GSTR-1 and the GSTR-3B working sheet. Each issued bill gets a permanent entry saved together with the bill. It is never changed: a refund or a void adds a new minus entry. Every night the app compares bills with the record and lists any difference, with a link to the bill. Branch owners see this for their own branches only if the business owner switches it on in Billing settings.',
    link: { label: 'GST', to: '/app/gst' },
  },

  {
    id: 'gstr-1',
    title: 'Preparing and filing GSTR-1',
    audiences: OWNERS,
    keywords: ['*gstr-1', '*gstr1', 'prepare return', 'gst return', 'rebuild return', 'approve return', 'export json', '*arn', 'record filing', 'month locked', 'portal rejected', 'unit code', 'uqc', 'table 12', 'table 13'],
    answer:
      'Open **GST → Returns**, choose a GSTIN and click **Prepare** for a month. The app reads your tax record up to that moment and lists anything to fix, each with a link to the bill, service or product. Fix it there (nobody types over the totals), then **Rebuild**: this makes a new revision and keeps the old one. **Approve** locks that revision, and **Download file** gives you the file to upload on the GST portal. Downloaded doesn’t mean filed: check the portal’s preview and file there. If the portal turns it down, click **Portal rejected it** and paste what it said. Once it’s filed, click **Record filing** and enter the ARN, the date and the proof. The month then locks, and shows as manually confirmed. Each figure shows the bills behind it.',
    link: { label: 'Returns', to: '/app/gst?tab=returns' },
  },

  {
    id: 'gst-correction',
    title: 'Correcting a month already filed',
    audiences: OWNERS,
    keywords: ['*gstr-1a', '*gstr1a', 'adjustment case', 'filed month', 'correct filed', 'amendment', 'bill left out', 'void filed bill', 'gstr-3b filed'],
    answer:
      'A filed month can’t be changed, so a bill in it can’t be voided. Open the return and click **Create adjustment case**. If a bill was left out and GSTR-3B for that month isn’t filed yet, the case makes a **GSTR-1A** file with only that bill: upload and file it on the portal, then record its ARN and proof. Once you’ve recorded GSTR-3B as filed on its working sheet, GSTR-1A closes, and the case goes to your tax person as an amendment in a later month. To give money back on a filed bill, use **Refund / return**: its credit note counts in the current month and nothing filed changes.',
    link: { label: 'Returns', to: '/app/gst?tab=returns' },
  },

  {
    id: 'gst-purchases',
    title: 'Purchases, GSTR-2B and input tax credit',
    audiences: OWNERS,
    keywords: ['*itc', '*gstr-2b', '*gstr2b', 'input tax credit', 'purchase bill', 'supplier bill', 'import 2b', 'supplier gstin', 'missing in 2b', 'missing in books', 'amount mismatch', 'claim credit'],
    answer:
      'Open **GST → Purchases & ITC** and choose the month. **Add bill** for each supplier bill, and say how the goods are used. **Import GSTR-2B** with the file from the portal, and the same file twice isn’t counted again. Each row then shows **Matched**, **Missing in 2B**, **Missing in books**, **Amount mismatch**, **Duplicate** or **Needs review**. A match alone never claims credit: click a row, look at the suggestion and **decide** with a reason. A purchase used only for 5%-without-ITC services gets ₹0. Stock for resale and mixed use need your own decision, so please check with your tax person. Credit can only be claimed on a bill that matches GSTR-2B.',
    link: { label: 'Purchases & ITC', to: '/app/gst?tab=purchases' },
  },

  {
    id: 'gstr-3b',
    title: 'The GSTR-3B working sheet',
    audiences: OWNERS,
    keywords: ['*gstr-3b', '*gstr3b', '*working sheet', 'worksheet', 'portal figures', 'output tax and credit', 'pay gst', 'file 3b'],
    answer:
      'Open **GST → Returns** and click **Working sheet** for a month. It puts output tax from your tax record and your approved credit into the 3.1, 3.2 and Table 4 rows, and each figure opens what is behind it. Type in **the portal’s figures** to see any differences beside yours: nothing changes your figures, and a difference tells you where to fix it. Then **Approve**, and pay and file on the GST portal, and **Record filing** with the ARN and proof. That locks the month’s purchases and closes GSTR-1A. The app doesn’t know whether the tax was paid, and doesn’t work out interest, late fees or ledger balances, so what you pay comes from the portal.',
    link: { label: 'Returns', to: '/app/gst?tab=returns' },
  },

  {
    id: 'gst-igst',
    title: 'Place of supply, IGST and business customers',
    audiences: ['PRIMARY_OWNER', 'BRANCH_OWNER', 'FRONT_DESK'],
    keywords: ['igst', 'place of supply', 'another state', 'interstate', 'customer gstin', 'business customer', 'b2b', 'can’t be issued', 'no approved tax rule'],
    answer:
      'Once GST setup is active, a bill’s **place of supply** is the branch’s state, which gives CGST and SGST. An owner can choose another state on the draft bill, and the bill then has **IGST** instead. For a business customer, add their **GSTIN** in the customer’s details and it prints on their bills. If a bill says it **can’t be issued yet**, a service or product has no approved tax rule, or the branch has no GSTIN for today: an owner needs to fix that, because the app never issues a bill with the tax left out.',
    link: { label: 'Bills', to: '/app/bills' },
  },

  // ---------------------------------------------------------------- attendance
  {
    id: 'attendance',
    title: 'Marking staff attendance',
    audiences: EVERYONE,
    keywords: ['*attendance', 'mark present', 'check in', 'check out', 'staff leave', 'on leave', '*absent'],
    answer:
      'Open **Attendance**, pick the day, and click **Present**, **Absent** or **Leave** for each stylist. Use **Check in now** / **Check out now** for times. Absent or on-leave stylists are hidden from booking for that day. If they already have bookings you’ll get a warning so someone reassigns them.',
    for: {
      PRIMARY_OWNER: 'Open **Attendance** to mark stylists Present, Absent or Leave for any day (with check-in and check-out times). Absent stylists can’t be booked that day. The **Monthly summary** tab shows present, absent and leave days per stylist.',
      BRANCH_OWNER: 'Open **Attendance** to mark stylists Present, Absent or Leave for any day (with check-in and check-out times). Absent stylists can’t be booked that day. The **Monthly summary** tab shows present, absent and leave days per stylist.',
    },
    link: { label: 'Attendance', to: '/app/attendance' },
  },
  {
    id: 'reassign',
    title: 'Reassigning a booking to another stylist',
    audiences: EVERYONE,
    keywords: ['*reassign', 'stylist absent booking', 'stylist sick', 'replace staff', 'give booking to'],
    answer:
      'Open the booking and click **Edit / reschedule**, then choose another stylist (and time, if needed) and save. Owners also see these bookings in **Requires attention** on the dashboard, with a **Reassign** button.',
  },

  // ---------------------------------------------------------------- account
  {
    id: 'branch-switch',
    title: 'Working in a branch',
    audiences: EVERYONE,
    keywords: ['switch branch', 'change branch', 'other branch', 'branch switcher', 'different branch'],
    answer: 'Use the branch picker at the top right. Every screen then shows that branch.',
    for: {
      FRONT_DESK: 'Your account works in **{branch}** only, so you always see its bookings and staff. If you need to work at another branch, ask your owner to change your branch in **Team → Front desk logins**.',
    },
  },
  {
    id: 'password',
    title: 'Passwords',
    audiences: ALL,
    keywords: ['*password', 'forgot password', 'reset password', 'change password', 'cant login', 'cannot login', 'locked out'],
    answer:
      'Forgot your own password? On the login page click **Forgot password?** and we’ll email you a link (it works once, for 1 hour). For your team: **Team → Front desk logins**, click the person, then **Email a password link** (they choose their own password, link valid 48 hours) or **Reset password** (a temporary password shown once to share). If there’s no **Forgot password?** link, email is off.',
    for: {
      FRONT_DESK: 'On the login page click **Forgot password?** and we’ll email you a link to choose a new one (it works once, for 1 hour; check spam too). No link there, or no email? Please ask your salon owner: they can reset your password in **Team → Front desk logins**.',
      INVENTORY: 'On the login page click **Forgot password?** and we’ll email you a link to choose a new one (it works once, for 1 hour). No link there, or no email? Please ask your salon owner: they can reset your password in **Team → Inventory logins**.',
      PRIMARY_OWNER:
        'Your own password: on the login page click **Forgot password?** and we’ll email you a link (it works once, for 1 hour). Your team: in **Team**, click the person, then **Email a password link** (they choose their own, valid 48 hours) or **Reset password** (a temporary password shown once). Either way they’re logged out on their other devices. No **Forgot password?** link means email is off (see **Email** in the menu).',
    },
  },
  {
    id: 'email-bill',
    title: 'Emailing a bill',
    audiences: EVERYONE,
    keywords: ['email bill', 'email invoice', 'bill by email', 'mail bill', 'email receipt', 'email pdf', 'send bill email'],
    answer:
      'Open the issued bill and click **Email bill**. It goes to the customer’s email (you can type another one) with the bill attached as a PDF, from your salon’s name; replies go to your salon’s contact email. The bill then shows *Email queued*, *Email sent* or *Email not sent* with the reason. No **Email bill** button means email is off: use **Send to customer** for a link instead.',
  },
  {
    id: 'email-not-received',
    title: 'Why didn’t my customer get the email?',
    audiences: EVERYONE,
    keywords: ['didnt email', 'email not received', 'no email', 'email failed', 'email not sent', 'email spam', 'email bounced', 'not receiving email', 'email not arrived', 'email not come'],
    answer:
      'Open the offer or the bill: it says *Email queued* (waiting to go out), *Email sent* (Gmail accepted it) or *Email not sent* with the reason. Usual reasons: the address is wrong (fix it on the customer’s profile, then send again), the customer withdrew permission or unsubscribed (offers only), or the daily email limit was reached (it goes out later by itself). *Email sent* but not there? Ask them to look in their spam or promotions folder.',
    for: {
      PRIMARY_OWNER:
        'Open the offer or the bill to see *Email queued*, *Email sent* or *Email not sent* with the reason; **Email → Recent emails** lists them all, with filters. Usual reasons: a wrong address (fix it, then send again), permission withdrawn or unsubscribed (offers only), the daily limit (it goes out later by itself), or a setup problem shown on the **Email** page. *Email sent* but not there? Ask them to check spam or promotions.',
      BRANCH_OWNER:
        'Open the offer or the bill to see *Email queued*, *Email sent* or *Email not sent* with the reason; **Email → Recent emails** lists your branches’ emails. Usual reasons: a wrong address (fix it, then send again), permission withdrawn or unsubscribed (offers only), or the daily limit (it goes out later by itself). *Email sent* but not there? Ask them to check spam or promotions.',
    },
    link: { to: '/app/settings/email', label: 'Recent emails', audiences: OWNERS },
  },
  {
    id: 'email-setup',
    title: 'Setting up email',
    audiences: ['PRIMARY_OWNER'],
    keywords: ['email not set up', 'set up email', 'email setup', 'email setting', 'test email', 'email limit', 'daily email limit', '*gmail', 'apps script'],
    answer:
      'Open **Email** in the menu. It says whether email is on, how much of today’s limit is used (about 90 emails a day for the whole app on a free Gmail account), and has **Send test email**. While email is *Off*, offer emails open on your own device, and bills and passwords can’t be emailed.',
    denied: 'Only the main owner of {salon} can check how email is working. If emails aren’t arriving, ask them to open **Email** in the menu.',
    link: { to: '/app/settings/email', label: 'Email' },
  },
  {
    id: 'logged-out',
    title: 'Getting logged out',
    audiences: ALL,
    keywords: ['logged out', '*logout', 'log out', 'session ended', 'kicked out', 'sign out', '*deactivated'],
    answer:
      'You’re logged out when your session ends, when your account is deactivated, or when the salon is deactivated. Log in again; if it says your account or salon is deactivated, contact your owner or GrowwPilot support.',
  },

  // ---------------------------------------------------------------- owner: insight
  {
    id: 'dashboard',
    title: 'The dashboard',
    audiences: OWNERS,
    keywords: ['*dashboard', '*kpi', 'net sales today'],
    answer:
      'The **Dashboard** answers *“is my salon doing fine?”* for the selected branch.\n- The tiles show today’s net sales and appointments.\n- **Requires attention** lists what needs someone now.\n- Everything is live and refreshes every minute.',
    denied: 'The dashboard is only for owners, because it shows revenue. For today’s work at {branch}, the **Day board** shows everything that’s happening.',
    link: { label: 'Dashboard', to: '/app/dashboard' },
  },
  {
    id: 'attention',
    title: 'Requires attention',
    audiences: OWNERS,
    keywords: ['requires attention', 'needs attention', '*todo', '*urgent'],
    answer:
      'The **Requires attention** list on the dashboard shows what needs someone now, most urgent first: customers waiting or not showing up, visits not billed, and bookings whose stylist is absent or inactive. Each row has a one-click button (Open, Checkout or Reassign).',
    denied: 'That list is on the owner’s dashboard. On the **Day board** you’ll see the same warnings (orange rings) for today’s bookings.',
    link: { label: 'Dashboard', to: '/app/dashboard' },
  },
  {
    id: 'analytics',
    title: 'Analytics and the sales PDF',
    audiences: OWNERS,
    keywords: ['*analytics', '*report', 'sales pdf', 'export pdf', 'download pdf', 'busiest time', 'best stylist', 'popular service', '*heatmap'],
    answer:
      'Open **Analytics**, choose a date range (or Last 7 days / Last 30 days / This month) and a branch. You’ll see branch demand, the busiest times (a weekday × hour heatmap), and stylist and service demand. **Export PDF** downloads the same numbers with a “Generated on …” time stamp, ready to email to your sales team.',
    denied: 'Analytics and the sales PDF are only for owners, because they show revenue. Please ask your owner if you need a report.',
    link: { label: 'Analytics', to: '/app/analytics' },
  },
  {
    id: 'revenue',
    title: 'How revenue is counted',
    audiences: OWNERS,
    keywords: ['*revenue', 'how revenue', 'service value', 'total sales', '*earnings', '*income'],
    answer:
      '**Net sales** (shown as revenue) is what bills issued in the period were worth after discounts and refunds, without GST, so cancelled bookings, unbilled visits and voided bills never count. Money actually collected is shown separately. **Service value** in Analytics is the list price of completed services, before discounts and combo prices. That’s why the two can differ.',
    denied: 'Revenue figures are only shown to owners.',
  },

  // ---------------------------------------------------------------- owner: setup
  {
    id: 'staff',
    title: 'Adding or deactivating stylists',
    audiences: OWNERS,
    keywords: ['add staff', 'new staff', 'hire', 'remove staff', 'deactivate staff', 'staff left', 'archive staff', 'edit staff'],
    answer:
      'Go to **Team → Staff → Add staff** (for the branch selected at the top). Click a stylist to edit them, **Deactivate** or **Archive**. If they still have upcoming bookings you’ll see those first and can confirm; they then appear in **Requires attention** to reassign. Past appointments always keep their name.',
    denied: 'Only owners can add or remove stylists. Please ask your salon owner. You can still mark attendance for {branch} in **Attendance**.',
    link: { label: 'Team', to: '/app/team' },
  },
  {
    id: 'front-desk-pay',
    title: 'Paying front desk staff',
    audiences: OWNERS,
    keywords: ['front desk salary', 'front desk pay', 'receptionist salary', 'pay receptionist', 'pay front desk', 'reception salary', 'front desk member'],
    answer:
      'First add them in **Team → Staff → Add staff** with the type **Front desk** (you can link their front desk login). They are never booked. Then open **Payroll → Pay setup → Front desk**, click them and choose a **monthly salary**, **per day** or **per hour** (no commission). They appear in the **Front desk** section of **Monthly payroll**, and are paid, get payslips and advances like everyone else.',
    denied: 'Front desk pay is handled by the owners. Please ask your salon owner.',
    link: { label: 'Pay setup', to: '/app/payroll?tab=setup&group=front-desk' },
  },
  {
    id: 'front-desk-login',
    title: 'Front desk logins',
    audiences: OWNERS,
    keywords: ['front desk login', 'receptionist account', 'add receptionist', 'new front desk', 'desk account', 'add user'],
    answer:
      'Go to **Team → Front desk logins → Add front desk**, enter their name and email and pick their branch. With email on, leave **Email them a link to set their password** ticked and they get an email to choose their own; otherwise a temporary password is shown once, with a **Copy login details** button. Click a person later to **Reset password** or **Deactivate** them (they’re logged out on their next click).',
    denied: 'Only owners create front desk logins. Please ask your salon owner.',
    link: { label: 'Team', to: '/app/team?tab=front-desk' },
  },
  {
    id: 'branch-owner',
    title: 'Branch owners',
    audiences: ['PRIMARY_OWNER'],
    keywords: ['branch owner', 'add owner', 'another owner', 'manager login', 'partner access'],
    answer:
      'Go to **Team → Branch owners → Add branch owner** and tick the branches they manage. They can run those branches (staff, front desk logins, bookings, dashboard) but can’t change branches, services or combos.',
    denied: 'Only the main owner of {salon} can add other owners.',
    link: { label: 'Team', to: '/app/team?tab=owners' },
  },
  {
    id: 'services',
    title: 'Services and prices',
    audiences: ['PRIMARY_OWNER'],
    keywords: ['add service', 'new service', 'change price', 'edit service', 'service price', 'disable service', '*menu', '*catalog', '*catalogue'],
    answer:
      'Go to **Services & combos → Add service**. Enter the name, price and (optionally) the duration; if you leave the duration empty, each branch’s default time is used. Choose which branches offer it. **Disable** hides it from booking, but old appointments keep their original name and price.',
    denied: 'Only the main owner of {salon} can change services and prices.',
    link: { label: 'Services & combos', to: '/app/catalog' },
  },
  {
    id: 'combos',
    title: 'Combos',
    audiences: ['PRIMARY_OWNER'],
    keywords: ['*combo', 'create combo', 'add combo', 'package deal', '*bundle'],
    answer:
      'Go to **Services & combos → Combos → Add combo**, tick 2 or more services and set the combo price. The form shows what the services cost separately and how much the customer saves.',
    denied: 'Only the main owner of {salon} creates combos. To book one, switch to **Combo** in step 2 of the booking form.',
    link: { label: 'Combos', to: '/app/catalog?tab=combos' },
  },
  {
    id: 'branches',
    title: 'Branches and opening hours',
    audiences: ['PRIMARY_OWNER'],
    keywords: ['add branch', 'new branch', 'opening hours', 'closing time', '*timezone', 'archive branch', 'branch hours'],
    answer:
      'Go to **Branches → Add branch** and set the name, address, timezone, opening and closing times, and the default service time. Click a branch to edit it. **Archive** is blocked while the branch still has upcoming bookings, and you can’t archive your only branch.',
    denied: 'Only the main owner of {salon} manages branches and opening hours.',
    link: { label: 'Branches', to: '/app/branches' },
  },
  {
    id: 'salary',
    title: 'Setting or changing someone’s pay',
    audiences: EVERYONE,
    keywords: ['*salary', '*payroll', '*commission', 'staff salary', 'change pay', 'set pay', 'pay setup', 'staff pay', '*raise', '*increment', '*wage', 'per day pay', 'hourly pay'],
    answer:
      'Open **Payroll → Pay setup** and click the person. Click **Set up pay** or **Change pay**, choose how they’re paid (monthly salary, salary + commission, commission only, per day, per hour, per service, or a mix), enter the amounts and the start date, then **Save**. The old pay stays in their history, and every change goes in the **Activity log**.',
    for: {
      BRANCH_OWNER:
        'Open **Payroll → Pay setup** and click the person (you can only see your own branches). Click **Set up pay** or **Change pay**, choose how they’re paid, enter the amounts and the start date, then **Save**. The change is logged and the business owner is notified.',
      FRONT_DESK:
        'Open **Staff pay**, click the person and click **Request a change**. Choose how they’re paid, the amounts, the start date and a reason, then **Send for approval**. Nothing changes until an owner approves it; you’ll see the answer in the bell at the top.',
    },
    link: { label: 'Pay setup', to: '/app/payroll' },
  },
  {
    id: 'commission',
    title: 'How commission is worked out',
    audiences: OWNERS,
    keywords: ['*commission', 'commission earned', 'commission earn', 'commission worked', 'commission calculated', '*special', 'special rate', 'set rate', 'service rate', 'commission service'],
    answer:
      'Commission is earned when a service is **completed and paid**, on what the customer actually paid (a bill discount is shared across its services). The rate is the person’s **special rate for that service** if they have one, otherwise their normal % from their pay setup. Open **Payroll**, click the person to see **Commission earned** each month and to **Add a service rate**. A rate change only counts from the next bill.',
    denied: 'Owners see the commission each person earned. You can see someone’s commission % and special service rates in **Staff pay**.',
    link: { label: 'Payroll', to: '/app/payroll' },
  },
  {
    id: 'monthly-payroll',
    title: 'Monthly payroll, bonuses and locking the month',
    audiences: OWNERS,
    keywords: ['monthly payroll', 'month payroll', 'lock month', 'lock payroll', '*lock', '*bonus', '*deduction', 'things check', 'salary sheet', 'how much pay', 'export payroll'],
    answer:
      'Open **Payroll → Monthly payroll** and pick the month. It works out everyone’s pay from their pay setup, attendance and commission. Fix anything marked **Must fix** (e.g. no pay setup, attendance not marked for per-day staff), click a person to add a **bonus or deduction** with a reason, then **Lock month** from its last day. A locked month can’t change: corrections go into a later month. **Export** downloads a spreadsheet.',
    denied: 'Monthly payroll is for owners. You can see how each person is paid in **Staff pay**.',
    link: { label: 'Monthly payroll', to: '/app/payroll?tab=month' },
  },
  {
    id: 'salary-payments',
    title: 'Paying salaries, payslips and advances',
    audiences: OWNERS,
    keywords: ['*salary', 'pay salary', 'salary paid', 'salary payment', '*payslip', 'salary slip', '*advance', 'still owed', 'paid staff'],
    answer:
      'First **lock** the month in **Payroll → Monthly payroll**. Then click a person and **Record payment** (cash, UPI or bank transfer, all or part of it). Click **Payslip** for a PDF of their pay and the payments made. A payment entered by mistake can be cancelled with a reason. To give an **advance**, open the person in **Pay setup** and click **Give an advance**: it is taken back from their pay each month automatically.',
    denied: 'Salaries, payslips and advances are handled by the owners.',
    link: { label: 'Monthly payroll', to: '/app/payroll?tab=month' },
  },
  {
    id: 'pay-requests',
    title: 'Approving pay change requests',
    audiences: OWNERS,
    keywords: ['approve pay', 'pay request', 'approve request', 'salary request', 'approve salary', '*approval', '*approve'],
    answer:
      'When the front desk asks to change someone’s pay, you get a message in the **bell** at the top. Open **Payroll → Requests**, check what was asked and why, then click **Approve** or **Don’t approve** (you can add a note). The front desk sees your answer.',
    denied: 'Pay change requests are approved by the owner of your branch. You can send one from **Staff pay → Request a change**, and you’ll see the answer in the bell.',
    link: { label: 'Requests', to: '/app/payroll?tab=requests' },
  },
  {
    id: 'activity-log',
    title: 'Activity log and notifications',
    audiences: OWNERS,
    keywords: ['activity log', '*activity', 'who changed', '*notifications', '*bell', 'audit'],
    answer:
      'Every pay change and request is written to **Payroll → Activity log**: who did it, when, and what changed. Nothing in the log can be edited. The **bell** at the top shows requests waiting for you and the answers to your own requests.',
    for: {
      BRANCH_OWNER:
        'Every pay change and request at your branches is written to **Payroll → Activity log**: who did it, when, and what changed. The **bell** at the top shows requests waiting for you and the answers to your own requests.',
    },
    denied: 'The activity log is for owners. Your **bell** at the top shows the answers to your pay change requests.',
    link: { label: 'Activity log', to: '/app/payroll?tab=activity' },
  },

  // ---------------------------------------------------------------- birthday & anniversary offers
  {
    id: 'occasions-setup',
    title: 'Setting up birthday and anniversary offers',
    audiences: OWNERS,
    keywords: ['*occasion', 'occasion offer', 'switch occasion', 'set up birthday offer', 'setup birthday offer', 'anniversary offer setup', 'birthday campaign', 'anniversary campaign', 'quick setup birthday', 'switch on birthday', 'enable birthday offer', 'branch birthday offer'],
    answer:
      'Open **Occasion offers** in the menu (Settings) and click **Quick setup**: 1) switch on **Birthday & Anniversary Offers**, 2) check the Birthday and Anniversary offers (% or ₹ off, maximum, minimum spend and the services that count), 3) **Publish**. Offers then go out by themselves every month, from 01:00 on the 1st, for the whole month. Editing a live offer makes a new version; offers already given keep their terms.',
    for: {
      BRANCH_OWNER:
        'The business owner switches the feature on and sets the offers for all branches. You can add a **This branch only** campaign for your branch under **Occasion offers → Add campaign**; it replaces the all-branches offer for your branch’s customers.',
    },
    denied: 'Birthday and anniversary offers are set up by the owners.',
    link: { label: 'Occasion offers', to: '/app/settings/occasions' },
  },
  {
    id: 'occasions-dates',
    title: 'Adding birthdays and anniversaries',
    audiences: EVERYONE,
    keywords: ['add birthday', 'birthday month', 'add anniversary', 'anniversary date', 'wedding anniversary', 'date of birth', 'import birthday', 'birthday day', 'customer birthday'],
    answer:
      'Open the customer, click **Edit**, and open **Optional details**: pick the **month** of their birthday or wedding anniversary, and the day if you know it. The year is never asked. A customer added in their birthday month gets this month’s offer straight away.',
    for: {
      PRIMARY_OWNER:
        'Open the customer, click **Edit**, and open **Optional details**: pick the month (and the day if you know it). The year is never asked. To fill many at once, use **Occasion offers → Import dates**: download the template, fill in months and days, upload it, and you’ll see every row before anything is saved.',
      BRANCH_OWNER:
        'Open the customer, click **Edit**, and open **Optional details**: pick the month (and the day if you know it). To fill many of your branch’s customers at once, use **Occasion offers → Import dates**.',
    },
    link: { label: 'Customers', to: '/app/customers' },
  },
  {
    id: 'occasions-permission',
    title: 'Permission to send offers',
    audiences: EVERYONE,
    keywords: ['*consent', 'messaging permission', 'whatsapp permission', 'sms permission', 'opt in', 'opt out', 'stop message', 'record permission', 'withdraw permission'],
    answer:
      'Open the customer and the **Messages & permission** tab. Click **Record permission** for WhatsApp, SMS or Email, read the wording to the customer, tick the box and choose how they gave it. **Withdraw** works straight away. “Not recorded” counts as no. A customer without permission can still use their offer in the salon; you just can’t message them about it.',
    for: {
      FRONT_DESK:
        'Open the customer and the **Messages & permission** tab. Click **Record permission**, read the wording to the customer, tick the box, tick **Customer asked for this** and choose how they gave it. **Withdraw** works straight away. Without permission they can still use their offer in the salon.',
    },
    link: { label: 'Customers', to: '/app/customers' },
  },
  {
    id: 'occasions-list',
    title: 'The occasion list: who to contact',
    audiences: EVERYONE,
    keywords: ['occasion list', 'customer occasions', 'who to contact', 'send birthday offer', 'send anniversary offer', 'birthday list', 'birthday this month', 'birthday whatsapp', 'call birthday customer', 'no answer'],
    answer:
      'Open **Occasion offers** in the menu. **Action required** lists who to contact this month. Click a customer: **Send offer** (only if they allowed messages) opens WhatsApp or SMS with the message ready, or the app sends the email for you (*Email queued*, then *Email sent*, or *Email not sent* with the reason, and you can send again). Campaigns set to **Send automatically by email** email customers on their own (they show *Emailed automatically*); customers who allow only WhatsApp or SMS stay on your list. One offer message per customer every 7 days. **Record call** for calls (no answer twice closes it as unreachable), **Create booking** to book them, and **Assigned to** to share the work.',
    link: { label: 'Occasion offers', to: '/app/occasions' },
  },
  {
    id: 'occasions-checkout',
    title: 'Using a birthday or anniversary offer at checkout',
    audiences: EVERYONE,
    keywords: ['*birthday', '*anniversary', 'apply offer', 'offer checkout', 'use offer', 'birthday discount', 'anniversary discount'],
    answer:
      'At checkout, the **Available occasion offer** box shows the customer’s offer with the discount and the new amount. Click **Apply offer**. It comes off the services that count, before GST, and shows as “Birthday offer” on the bill. One offer per bill, and other discounts are off while it’s on. It is used only when you issue the bill; voiding the bill in the same month gives it back.',
    link: { label: 'Day board', to: '/app/today' },
    general: true,
  },
  {
    id: 'occasions-cant-apply',
    title: 'Why an offer can’t be applied',
    audiences: EVERYONE,
    keywords: ['offer cant apply', 'cant apply offer', 'offer not working', 'offer not eligible', 'offer redeemed elsewhere', 'offer expired', 'offer greyed', 'offer not showing'],
    answer:
      'The checkout box says why: **Add ₹… of eligible services** (the minimum spend isn’t reached), **No eligible service on this bill** (none of the services count; combo services never do), **expired** (the month is over), **redeemed on invoice …** (already used on another bill), or **Remove the other discounts** (an offer doesn’t mix with other discounts). If another desk used it a moment earlier, the offer is taken off your bill: check the total and issue again.',
  },
  {
    id: 'occasions-reports',
    title: 'Occasion offer reports',
    audiences: OWNERS,
    keywords: ['*birthday', '*anniversary', 'occasion report', 'birthday report', 'anniversary report', 'offer report', 'offers used', 'associated sales'],
    answer:
      'Open **Occasion offers → Reports**: offers issued, customers contacted, linked bookings and offers used, the steps from eligible to used, discounts given and associated sales (the bills that used an offer; not a profit claim), by branch and by staff. Pick a month or dates and filters, then **Download CSV**.',
    denied: 'Occasion offer reports are for the owners. The front desk sees this month’s counts on the Today page.',
    link: { label: 'Occasion reports', to: '/app/occasions/reports' },
  },

  // ---------------------------------------------------------------- inventory add-on
  {
    id: 'inventory-setup',
    title: 'Setting up inventory',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['set up inventory', 'setup inventory', 'start inventory', 'inventory setup', 'add product', 'import product', '*csv', 'upload product', 'product spreadsheet', 'new product'],
    answer:
      'Open **Inventory**. The first time, a short setup guide opens:\n1. Check **Main store** and add stations (chairs or areas) if you hand products to them.\n2. Add your products: **upload a spreadsheet (CSV)** from the template, or add them one by one. Only name, category, stock unit and way of use are needed.\n3. **Check before saving**: fix or leave out rows marked ❌; duplicates are flagged.\n4. Done. Later you can import more from **Products → Import**.',
    denied: 'Inventory is set up by the owners and the inventory login.',
    link: { label: 'Inventory', to: '/app/inventory?tab=products' },
  },
  {
    id: 'inventory-finish',
    title: 'Marking a bottle finished',
    addon: 'inventory',
    audiences: ALL,
    keywords: ['mark finished', '*finished', 'bottle finished', 'finish bottle', 'empty bottle', 'bottle empty', 'replace bottle', 'finish replace', 'used up'],
    answer:
      'In **Inventory → Overview**, click **Mark finished** (or **Finished** next to the hand-out). Pick who had it, check the amount, and keep **Issue a replacement** ticked to hand out a new one in the same step. If the store has none left, the finish is still saved and the product shows on **Need to order**.',
    for: {
      FRONT_DESK:
        'In **Inventory → Overview**, click **Mark finished**, pick who had it and save. (Your owner can switch this off in Inventory settings; it is on by default.) If you may also issue stock, tick **Issue a replacement** to hand out a new one in the same step.',
    },
    link: { label: 'Inventory', to: '/app/inventory?tab=overview' },
  },
  {
    id: 'inventory-no-deduction',
    title: 'Why a service didn’t take stock',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['didnt deduct', 'not deducted', 'didnt take stock', 'stock not taken', 'service didnt', 'stock not reduced', 'recipe not working', 'why stock', 'stock didnt change', '*exception'],
    answer:
      'Stock is taken a moment after a visit is marked **Completed**, using the service’s recipe. If nothing was taken, check:\n- The service has a **recipe** (Inventory → Recipes) that was in use at that time.\n- The product is set to be taken **per service** (finish-mode products are only linked, never taken per service).\n- The visit was **Completed**, not cancelled.\n- If stock was short, it waits under **Services that couldn’t take their stock** on the Overview: restock, then **Post now**. A failed one has **Retry**.',
    denied: 'The owners and the inventory login look after automatic stock use. Please tell them which visit it was.',
    link: { label: 'Overview', to: '/app/inventory?tab=overview' },
  },
  {
    id: 'inventory-issue',
    title: 'Issuing a product',
    addon: 'inventory',
    audiences: ALL,
    keywords: ['issue product', '*issue', 'hand out', 'give bottle', 'give product', 'product staff', 'stock staff'],
    answer:
      'In **Inventory → Overview**, click **Issue product**, find the product (or scan it), choose the store, who gets it (salon floor, a station or a stylist) and how many. It moves from the store to **In use**; it is used up only when someone marks it finished.',
    for: {
      FRONT_DESK: 'If your owner has switched it on for the front desk, use **Inventory → Issue product**. Otherwise ask the inventory login or an owner to issue it.',
    },
    link: { label: 'Inventory', to: '/app/inventory?tab=overview' },
  },
  {
    id: 'inventory-write-off',
    title: 'Broken, lost or expired stock',
    addon: 'inventory',
    audiences: ALL,
    keywords: ['write off', 'damaged product', 'broken bottle', 'lost bottle', 'expired product', 'adjust stock', 'report problem', '*spilled', 'stock wrong'],
    answer:
      'Use **Adjust stock** on the Overview (or **Write off** next to a hand-out): choose the product, where it is, how many and why. A lost bottle is “Lost”, not finished. Above your limit, add a note and an owner approves it before stock changes.',
    for: {
      FRONT_DESK: 'Click **Report a problem** in Inventory: say what happened and how many. The owner and the inventory login are told and take care of it; you’ll see what they did.',
    },
    link: { label: 'Inventory', to: '/app/inventory?tab=overview' },
  },
  {
    id: 'inventory-order',
    title: 'Ordering and receiving stock',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['purchase order', 'order stock', '*reorder', 'need order', '*supplier', 'receive delivery', 'delivery arrived', 'order product'],
    answer:
      'In **Inventory → Purchasing**, open **Need to order** for products at their reorder level (stock already on approved orders is counted), tick them and click **Create draft orders**. Send the order; it may need an owner’s approval. When the delivery comes, open the order and click **Receive delivery**: only what arrived goes into the store, and part deliveries are fine.',
    denied: 'Purchase orders are handled by the owners and the inventory login.',
    link: { label: 'Purchasing', to: '/app/inventory?tab=purchasing' },
  },
  {
    id: 'inventory-count',
    title: 'Counting stock',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['stock count', 'count stock', '*stocktake', 'stock take', 'physical count'],
    answer:
      'Open **Inventory → Stock count** and click **Start a stock count**. Type what you find in each store and for each hand-out, give a reason for every difference, then **send for review**. An owner approves, and the differences are posted as corrections.',
    denied: 'Stock counts are done by the owners and the inventory login.',
    link: { label: 'Stock count', to: '/app/inventory?tab=count' },
  },
  {
    id: 'inventory-recipes',
    title: 'Service recipes',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['*recipe', 'service use product', 'product per service', 'colour per service', 'how much product'],
    answer:
      'In **Inventory → Recipes**, open a service and click **Change recipe**: add the products it uses and how much (you type the amounts). A recipe can be for all branches or just this one. Each change is a new version from now (or a later time); past services keep what they used.',
    for: { INVENTORY: 'You can see every recipe in **Inventory → Recipes**. Only the owners change them.' },
    denied: 'Service recipes are set by the owners.',
    link: { label: 'Recipes', to: '/app/inventory?tab=recipes' },
  },
  {
    id: 'inventory-reports',
    title: 'Inventory reports',
    addon: 'inventory',
    audiences: STOCK_KEEPERS,
    keywords: ['inventory report', 'stock report', 'export stock', 'stock value', '*wastage', 'product use report', 'download stock'],
    answer:
      'Open **Inventory → Reports**, pick a report (stock summary, low stock, use by product, waste, purchasing…) and the dates, then click **Download CSV** to open it in Excel. Costs are shown only to owners.',
    denied: 'Inventory reports are for the owners and the inventory login.',
    link: { label: 'Reports', to: '/app/inventory?tab=reports' },
  },
];

// Shown when the question doesn't match anything, and when the chat opens
export const STARTER_QUESTIONS = {
  PRIMARY_OWNER: ['What does Requires attention show?', 'How do I add a new service?', 'How do I export the sales PDF?', 'How do I add a front desk login?'],
  BRANCH_OWNER: ['What does Requires attention show?', 'How do I add a stylist?', 'How do I export the sales PDF?', 'How do I reset a front desk password?'],
  FRONT_DESK: ['How do I book an appointment?', 'How do I take a split payment?', 'How do I add a new customer?', 'How do I mark a stylist absent?'],
  INVENTORY: ['How do I set up inventory?', 'How do I mark a bottle finished?', 'Why didn’t a service deduct stock?', 'How do I receive a delivery?'],
};
