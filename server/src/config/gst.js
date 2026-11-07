// Fixed lists for GST setup.

// How a salon is registered. Only the first two can be used; the others show as "Not supported".
export const GST_SCHEMES = ['UNREGISTERED', 'REGULAR', 'COMPOSITION', 'QRMP'];
export const SUPPORTED_GST_SCHEMES = ['UNREGISTERED', 'REGULAR'];

export const GST_SETUP_STATUSES = ['NOT_ACTIVE', 'ACTIVE'];
export const FILING_FREQUENCIES = ['MONTHLY'];

// A tax rule is a draft until the business owner approves it. An approved rule's rate and code never change.
export const TAX_RULE_STATUSES = ['DRAFT', 'APPROVED'];
export const ITC_TYPES = ['WITHOUT_ITC', 'WITH_ITC']; // can input tax credit be claimed against this supply?

// SAC (services) and HSN (products) codes
export const TAX_CODE_REGEX = /^\d{4,8}$/;

// The ready-made rule a salon starts with. It is a draft: the owner checks it and approves it.
// Standard salon services are 5% without input tax credit from 22 Sep 2025.
export const STARTER_RULE = { name: 'Salon services', kind: 'SERVICE', code: '999721', rateBps: 500, itcType: 'WITHOUT_ITC', from: '2025-09-22' };

// Where to fix a problem found during setup or on a bill
export const GST_SETUP_LINK = '/app/gst?tab=settings';
export const CATALOG_LINK = '/app/catalog';
export const PRODUCTS_LINK = '/app/inventory?tab=products';

// Entries in the permanent tax record. A bill or a taxed advance adds a plus entry. A credit note, a void, an advance
// used on a bill (its tax was already paid), or an advance given back or reversed adds a minus entry.
export const TAX_ENTRY_TYPES = ['BILL_ISSUED', 'CREDIT_NOTE', 'BILL_VOIDED', 'ADVANCE_RECEIVED', 'ADVANCE_USED', 'ADVANCE_REFUNDED', 'ADVANCE_REVERSED'];

// Where a GSTR-1 revision stands. Exported never means Filed: filing is recorded by hand, with proof.
export const RETURN_STATUSES = ['NEEDS_FIXING', 'READY', 'APPROVED', 'EXPORTED', 'REJECTED', 'FILED'];
// A correction after filing: GSTR-1A before GSTR-3B is filed, otherwise a later-period amendment for review
export const ADJUSTMENT_ROUTES = ['GSTR_1A', 'LATER_AMENDMENT'];
export const ADJUSTMENT_STATUSES = ['DRAFT', 'EXPORTED', 'FILED', 'NEEDS_REVIEW'];

// The official unit codes for Table 12. NA is for services.
export const UNIT_CODES = ['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS'];
// What a salon's own word for a unit usually means. Only a suggestion on screen: the owner confirms it.
export const UNIT_SUGGESTIONS = { bottle: 'BTL', tube: 'TUB', tub: 'TUB', box: 'BOX', piece: 'PCS', pcs: 'PCS', pack: 'PAC', packet: 'PAC', kit: 'SET', set: 'SET', can: 'CAN', roll: 'ROL', pair: 'PRS', bag: 'BAG', litre: 'LTR', ml: 'MLT', kg: 'KGS', g: 'GMS', gram: 'GMS' };

// What a purchase is used for decides its input tax credit
export const PURCHASE_USES = ['NO_ITC_SERVICES', 'RESALE', 'MIXED', 'OTHER'];
// Bills and GSTR-2B rows compared. NOT_CHECKED: no GSTR-2B imported for that month yet.
export const MATCH_STATUSES = ['MATCHED', 'MISSING_IN_2B', 'MISSING_IN_BOOKS', 'AMOUNT_MISMATCH', 'DUPLICATE', 'REVIEW_REQUIRED', 'NOT_CHECKED'];
// A small rounding gap between a bill and GSTR-2B still counts as a match, in each of taxable, IGST, CGST and SGST
export const MATCH_TOLERANCE_PAISE = 100;
export const WORKSHEET_STATUSES = ['DRAFT', 'APPROVED', 'FILED'];
