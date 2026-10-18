// Labels and small helpers for bills and payments (the server does all the money maths).

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];
export const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label]));

// Status badge for a bill: Draft, Paid, Part paid or Unpaid
export function billBadge(invoice) {
  if (invoice.status === 'DRAFT') return { label: 'Draft', tone: 'neutral' };
  if (invoice.status === 'VOID') return { label: 'Void', tone: 'neutral' };
  return SETTLEMENT[invoice.settlementStatus] ?? SETTLEMENT.UNPAID;
}
export const SETTLEMENT = {
  PAID: { label: 'Paid', tone: 'brown' },
  PARTIALLY_PAID: { label: 'Part paid', tone: 'orange' },
  UNPAID: { label: 'Unpaid', tone: 'danger' },
};

// 1800 -> "18%", 1250 -> "12.5%"
export const percentLabel = (bps) => `${bps / 100}%`;

export const GST_RATE_OPTIONS = [0, 500, 1200, 1800, 2800, 4000].map((bps) => ({ value: String(bps), label: percentLabel(bps) }));

// GST state codes (the first two digits of a GSTIN)
export const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory'],
].map(([value, label]) => ({ value, label: `${label} (${value})` }));

// A fresh Idempotency-Key for one money change (a double click or retry with the same key happens only once)
export const newRequestKey = () => crypto.randomUUID();
