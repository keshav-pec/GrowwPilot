// Where a GSTR-1 stands, in words. Exported never means Filed.
export const RETURN_STATUS = {
  NOT_PREPARED: { label: 'Not prepared', tone: 'neutral' },
  NEEDS_FIXING: { label: 'Needs fixing', tone: 'danger' },
  READY: { label: 'Ready to approve', tone: 'yellow' },
  APPROVED: { label: 'Approved', tone: 'gold' },
  EXPORTED: { label: 'Exported, not filed', tone: 'orange' },
  REJECTED: { label: 'Rejected by the portal', tone: 'danger' },
  FILED: { label: 'Filed, manually confirmed', tone: 'brown' },
};
export const ADJUSTMENT_STATUS = {
  DRAFT: { label: 'Draft', tone: 'yellow' },
  EXPORTED: { label: 'Exported, not filed', tone: 'orange' },
  FILED: { label: 'Filed, manually confirmed', tone: 'brown' },
  NEEDS_REVIEW: { label: 'Needs your tax person', tone: 'danger' },
};
// The GSTR-3B working sheet. Filed says nothing about money: the tax is paid on the portal.
export const WORKSHEET_STATUS = {
  DRAFT: { label: 'Sheet in draft', tone: 'yellow' },
  APPROVED: { label: 'Sheet approved, not filed', tone: 'orange' },
  FILED: { label: 'Filed, manually confirmed', tone: 'brown' },
};
