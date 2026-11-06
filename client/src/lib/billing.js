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

// A rule's rate and input tax credit, in words: "5% without ITC"
export const ITC_LABEL = { WITHOUT_ITC: 'without ITC', WITH_ITC: 'with ITC' };
export const ITC_OPTIONS = [
  { value: 'WITHOUT_ITC', label: 'Without ITC (no credit on purchases)' },
  { value: 'WITH_ITC', label: 'With ITC (credit on purchases)' },
];

// A tax rule in a list of choices: "Salon services · SAC 999721 · 5% without ITC"
export function ruleLabel(group) {
  const rule = group.current;
  const code = group.kind === 'PRODUCT' ? 'HSN' : 'SAC';
  return rule ? `${group.name} · ${code} ${rule.code} · ${percentLabel(rule.rateBps)} ${ITC_LABEL[rule.itcType]}` : `${group.name} (not approved for today)`;
}

// The tax rows on a bill: IGST on a sale to another state, otherwise CGST and SGST
export function taxRows(taxSummary = []) {
  return taxSummary.flatMap((t) =>
    t.igst
      ? [{ key: `i${t.rateBps}`, label: `IGST ${percentLabel(t.rateBps)}`, amount: t.igst }]
      : [
          { key: `c${t.rateBps}`, label: `CGST ${percentLabel(t.rateBps / 2)}`, amount: t.cgst },
          { key: `s${t.rateBps}`, label: `SGST ${percentLabel(t.rateBps / 2)}`, amount: t.sgst },
        ]
  );
}
