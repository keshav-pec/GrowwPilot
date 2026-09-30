// The assistant's knowledge: one entry per help topic.
//
// audiences:  who the steps are for. PRIMARY_OWNER (sees every branch), BRANCH_OWNER (some branches), FRONT_DESK
// keywords:   words that point to this topic. A phrase counts when ALL its words are in the question.
//             Each word is worth 1 point; a leading "*" makes a single strong word worth 2 points.
// answer:     the reply. "for" gives a different reply to a specific audience.
// denied:     the reply for someone OUTSIDE the audiences (they learn who can do it, not how).
// link:       a button that opens the right screen.
// general:    a broad topic (e.g. "booking"). On a tie it loses to a specific one (e.g. "cancel a booking").
// Placeholders: {name} (first name), {branch} (selected branch), {salon} (salon name)

const OWNERS = ['PRIMARY_OWNER', 'BRANCH_OWNER'];
const EVERYONE = ['PRIMARY_OWNER', 'BRANCH_OWNER', 'FRONT_DESK'];

export const KNOWLEDGE = [
  // ---------------------------------------------------------------- small talk
  {
    id: 'greeting',
    title: 'Hello',
    audiences: EVERYONE,
    keywords: ['*hi', '*hello', '*hey', 'good morning', 'good evening'],
    answer: 'Hi {name}! I’m the GrowwPilot assistant. Ask me how to do anything in the app, like booking, checkout or leads.',
  },
  {
    id: 'thanks',
    title: 'Thanks',
    audiences: EVERYONE,
    keywords: ['*thanks', '*thank', '*great', '*awesome', '*cool'],
    answer: 'Happy to help, {name}! Ask me anything else whenever you need.',
  },
  {
    id: 'capabilities',
    title: 'What I can help with',
    audiences: EVERYONE,
    keywords: ['what can you do', 'who are you', 'help', 'what you know'],
    answer: 'I know how every screen in GrowwPilot works, and I answer for your role.',
    for: {
      FRONT_DESK: 'I can help with everything you do at {branch}: booking and rescheduling, the day board, customers, leads, checkout and split payments, and staff attendance.',
      PRIMARY_OWNER: 'I can help with the dashboard, analytics and the sales PDF, your team, services, combos and branches, plus everything the front desk does.',
      BRANCH_OWNER: 'I can help with the dashboard, analytics, your staff and front desk logins, plus everything the front desk does at your branches.',
    },
  },
  {
    id: 'support',
    title: 'Talking to a person',
    audiences: EVERYONE,
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
    keywords: ['*checkout', 'split payment', 'take payment', 'collect money', 'card and cash', 'upi', 'part payment', 'pay bill'],
    answer:
      'When a service is **Completed**, click **Checkout** on its block. Add a payment row for each method with **+ Add payment method** (for example ₹1,000 card + ₹500 UPI + ₹30 cash); the **Rest** button fills in what’s left. The **Pay** button only works when *Remaining* is exactly ₹0.',
    link: { label: 'Day board', to: '/app/today' },
  },
  {
    id: 'discount',
    title: 'Giving a discount',
    audiences: EVERYONE,
    keywords: ['*discount', 'percent off', 'reduce price', 'lower price', '*offer'],
    answer:
      'On the checkout page, choose **₹** or **%** next to *Discount* and type the amount. The total updates straight away. A discount can’t be more than the bill, so the total never goes below ₹0.',
  },
  {
    id: 'invoice',
    title: 'Printing or finding an invoice',
    audiences: EVERYONE,
    keywords: ['*invoice', 'print bill', 'reprint', '*receipt', 'save pdf invoice'],
    answer:
      'After paying you land on the invoice. Click **Print / save as PDF**. To find it later, click the **Paid ✓** badge on the Day board, or open the appointment and click **View invoice**. An appointment can only be paid once.',
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
      FRONT_DESK: 'Your account works in **{branch}** only, so you always see its bookings, staff and leads. If you need to work at another branch, ask your owner to change your branch in **Team → Front desk logins**.',
    },
  },
  {
    id: 'password',
    title: 'Passwords',
    audiences: EVERYONE,
    keywords: ['*password', 'forgot password', 'reset password', 'change password', 'cant login', 'cannot login', 'locked out'],
    answer: 'Owners reset front desk passwords in **Team → Front desk logins**: click the person, then **Reset password**. A new temporary password is shown once to share with them.',
    for: {
      FRONT_DESK: 'Please ask your salon owner. They can reset your password in **Team → Front desk logins** and give you a new temporary password.',
      PRIMARY_OWNER: 'You can reset front desk and branch owner passwords in **Team** (click the person, then **Reset password**; the new temporary password is shown once). To change your own password, contact GrowwPilot support with the **Need help?** link.',
    },
  },
  {
    id: 'logged-out',
    title: 'Getting logged out',
    audiences: EVERYONE,
    keywords: ['logged out', '*logout', 'log out', 'session ended', 'kicked out', 'sign out', '*deactivated'],
    answer:
      'You’re logged out when your session ends, when your account is deactivated, or when the salon is deactivated. Log in again; if it says your account or salon is deactivated, contact your owner or GrowwPilot support.',
  },

  // ---------------------------------------------------------------- owner: insight
  {
    id: 'dashboard',
    title: 'The dashboard and Salon Pulse',
    audiences: OWNERS,
    keywords: ['*dashboard', 'salon pulse', '*pulse', '*kpi', 'doing well', 'needs action', 'keep eye', 'chairs filled'],
    answer:
      'The **Dashboard** answers *“is my salon doing fine?”* for the selected branch.\n- **Salon Pulse** gives one verdict (Doing well / Keep an eye / Needs action) from 3 signals: revenue vs a usual same weekday by this time, chairs filled today, and how many urgent items are waiting.\n- The tiles show today’s revenue, appointments, customers served, open leads and lead conversion.\n- Everything is live and refreshes every minute.',
    denied: 'The dashboard is only for owners, because it shows revenue. For today’s work at {branch}, the **Day board** shows everything that’s happening.',
    link: { label: 'Dashboard', to: '/app/dashboard' },
  },
  {
    id: 'attention',
    title: 'Requires attention',
    audiences: OWNERS,
    keywords: ['requires attention', 'needs attention', '*todo', '*urgent'],
    answer:
      'The **Requires attention** list on the dashboard shows what needs someone now, most urgent first: customers waiting or not showing up, bills not collected, bookings whose stylist is absent or inactive, overdue lead follow-ups and new leads nobody contacted in 24 hours. Each row has a one-click button (Open, Checkout, Reassign or Open lead).',
    denied: 'That list is on the owner’s dashboard. On the **Day board** you’ll see the same warnings (orange rings) for today’s bookings.',
    link: { label: 'Dashboard', to: '/app/dashboard' },
  },
  {
    id: 'analytics',
    title: 'Analytics and the sales PDF',
    audiences: OWNERS,
    keywords: ['*analytics', '*report', 'sales pdf', 'export pdf', 'download pdf', 'busiest time', 'best stylist', 'popular service', 'payment mix', '*heatmap'],
    answer:
      'Open **Analytics**, choose a date range (or Last 7 days / Last 30 days / This month) and a branch. You’ll see branch demand, the busiest times (a weekday × hour heatmap), stylist and service demand, lead sources and the payment mix. **Export PDF** downloads the same numbers with a “Generated on …” time stamp, ready to email to your sales team.',
    denied: 'Analytics and the sales PDF are only for owners, because they show revenue. Please ask your owner if you need a report.',
    link: { label: 'Analytics', to: '/app/analytics' },
  },
  {
    id: 'revenue',
    title: 'How revenue is counted',
    audiences: OWNERS,
    keywords: ['*revenue', 'how revenue', 'service value', 'total sales', '*earnings', '*income'],
    answer:
      '**Revenue** is the total of invoices paid in the period, so cancelled or unpaid bookings never count. **Service value** in Analytics is the list price of completed services, before discounts and combo prices. That’s why the two can differ.',
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
    id: 'front-desk-login',
    title: 'Front desk logins',
    audiences: OWNERS,
    keywords: ['front desk login', 'receptionist account', 'add receptionist', 'new front desk', 'desk account', 'add user'],
    answer:
      'Go to **Team → Front desk logins → Add front desk**, enter their name and email and pick their branch. A temporary password is shown once, with a **Copy login details** button. Click a person later to **Reset password** or **Deactivate** them (they’re logged out on their next click).',
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
    title: 'Staff salary',
    audiences: OWNERS,
    keywords: ['*salary', '*payroll', '*commission', '*payout'],
    answer: 'Staff salary and payouts are coming soon: fixed pay plus commission per service, with a monthly payout sheet from attendance and completed services.',
    denied: 'Salary is an owner feature, and it’s coming soon.',
  },
];

// Shown when the question doesn't match anything, and when the chat opens
export const STARTER_QUESTIONS = {
  PRIMARY_OWNER: ['What does Salon Pulse mean?', 'How do I add a new service?', 'How do I export the sales PDF?', 'How do I add a front desk login?'],
  BRANCH_OWNER: ['What does Salon Pulse mean?', 'How do I add a stylist?', 'How do I export the sales PDF?', 'How do I reset a front desk password?'],
  FRONT_DESK: ['How do I book an appointment?', 'How do I take a split payment?', 'How do I convert a lead?', 'How do I mark a stylist absent?'],
};
