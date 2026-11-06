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

// Entries in the permanent tax record. A bill adds a plus entry; a credit note or a void adds a minus entry.
export const TAX_ENTRY_TYPES = ['BILL_ISSUED', 'CREDIT_NOTE', 'BILL_VOIDED'];
