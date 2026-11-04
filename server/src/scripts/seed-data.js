// The fixed demo data used by seed.js: names, services, prices, leads.
// Prices are in rupees here; seed.js turns them into paise.

export const GLAMOUR_CUSTOMERS = [
  ['Priya Sharma', '9876543210'], ['Amit Verma', '9123456780'], ['Pooja Mehta', '9820011001'], ['Sneha Kapoor', '9820011003'],
  ['Karan Malhotra', '9820011004'], ['Meera Nair', '9820011007'], ['Isha Patel', '9820011011'],
];

// Priya's phone also exists at Glamour Studio: allowed, because it's a different salon
export const DESERT_ROSE_CUSTOMERS = [['Priya Sharma', '9876543210'], ['Aisha Rahman', '9123400001']];

// [name, category, minutes (null = branch default), price in ₹, offered at (branch names, [] = all)]
export const GLAMOUR_SERVICES = [
  ['Haircut', 'Hair', 45, 500, []],
  ['Beard Trim', 'Grooming', null, 200, []],
  ['Hair Colour', 'Hair', 90, 2500, []],
  ['Hair Spa', 'Hair', 60, 1500, []],
  ['Facial', 'Skin', 60, 1200, ['Andheri']],
];

export const DESERT_ROSE_SERVICES = [
  ['Haircut', 'Hair', 30, 800, []],
  ['Blow Dry', 'Hair', 30, 600, []],
];

// Leads: [name, phone, branch, source, status, created (hours ago), next follow-up (hours from now, null = none), interested in, note]
// Covers every status; one follow-up is overdue. Pooja becomes a customer with a booking (see seed.js).
export const LEADS = [
  ['Tara Singh', '9811100003', 'Andheri', 'Instagram', 'NEW', 2, 24, 'Hair Colour', 'Saw our balayage reel'],
  ['Sana Khan', '9811100005', 'Andheri', 'WhatsApp', 'CONTACTED', 96, -20, 'Facial', 'Asked for weekend slots'],
  ['Neel Chopra', '9811100008', 'Andheri', 'Walk-in', 'LOST', 290, null, 'Haircut', 'Found it too far from office'],
  ['Pooja Mehta', '9820011001', 'Andheri', 'Google', 'APPOINTMENT_BOOKED', 70, null, 'Facial', 'Booked a facial'],
  ['Kunal Bhatt', '9811100014', 'Bandra', 'Referral', 'INTERESTED', 80, 26, 'Hair Spa', null],
  ['Sophia Lee', '9811100018', 'Dubai Marina', 'Facebook', 'INTERESTED', 70, 40, 'Blow Dry', 'Wedding on the 15th'],
];
