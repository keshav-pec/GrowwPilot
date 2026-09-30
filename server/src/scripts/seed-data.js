// The fixed demo data used by seed.js: names, services, prices, leads.
// Prices are in rupees here; seed.js turns them into paise.

export const GLAMOUR_CUSTOMERS = [
  ['Priya Sharma', '9876543210'], ['Amit Verma', '9123456780'], ['Pooja Mehta', '9820011001'], ['Rohit Jain', '9820011002'],
  ['Sneha Kapoor', '9820011003'], ['Karan Malhotra', '9820011004'], ['Ananya Iyer', '9820011005'], ['Meera Nair', '9820011007'],
  ['Kavita Joshi', '9820011009'], ['Isha Patel', '9820011011'],
];

// Priya's phone also exists at Glamour Studio: allowed, because it's a different salon
export const DESERT_ROSE_CUSTOMERS = [
  ['Priya Sharma', '9876543210'], ['Aisha Rahman', '9123400001'], ['Daniel Thomas', '9123400002'],
];

// [name, category, minutes (null = branch default), price in ₹, offered at (branch names, [] = all)]
export const GLAMOUR_SERVICES = [
  ['Haircut', 'Hair', 45, 500, []],
  ['Beard Trim', 'Grooming', null, 200, []],
  ['Hair Colour', 'Hair', 90, 2500, []],
  ['Hair Spa', 'Hair', 60, 1500, []],
  ['Facial', 'Skin', 60, 1200, ['Andheri']],
  ['Manicure', 'Nails', 45, 700, ['Bandra']],
  ['Pedicure', 'Nails', 45, 800, ['Bandra']],
];

export const DESERT_ROSE_SERVICES = [
  ['Haircut', 'Hair', 30, 800, []],
  ['Manicure', 'Nails', 45, 1000, []],
  ['Blow Dry', 'Hair', 30, 600, []],
];

// Leads: [name, phone, branch, source, status, created (hours ago), next follow-up (hours from now, null = none), interested in, note]
// Covers every status and every source; one follow-up is overdue.
export const LEADS = [
  ['Tara Singh', '9811100003', 'Andheri', 'Instagram', 'NEW', 2, 24, 'Hair Colour', 'Saw our balayage reel'],
  ['Sana Khan', '9811100005', 'Andheri', 'WhatsApp', 'CONTACTED', 96, -20, 'Facial', 'Asked for weekend slots'],
  ['Leela Das', '9811100006', 'Andheri', 'Website', 'INTERESTED', 120, 30, 'Hair Spa', 'Wants a price for 3 sessions'],
  ['Harsh Vora', '9811100007', 'Andheri', 'Phone', 'CONTACTED', 30, 20, 'Beard Trim', null],
  ['Neel Chopra', '9811100008', 'Andheri', 'Walk-in', 'LOST', 290, null, 'Haircut', 'Found it too far from office'],
  ['Kunal Bhatt', '9811100014', 'Bandra', 'Referral', 'INTERESTED', 80, 26, 'Pedicure', null],
  ['Sophia Lee', '9811100018', 'Dubai Marina', 'Facebook', 'INTERESTED', 70, 40, 'Blow Dry', 'Wedding on the 15th'],
  // These two become customers with appointments (see seed.js)
  ['Pooja Mehta', '9820011001', 'Andheri', 'Instagram', 'APPOINTMENT_BOOKED', 70, null, 'Facial', 'Booked a facial'],
  ['Rohit Jain', '9820011002', 'Andheri', 'Google', 'APPOINTMENT_BOOKED', 190, null, 'Haircut', 'Came in for a haircut'],
];
