// Paid add-ons the Super Admin can switch on per salon (Organization.addons.<name>).
// More add-ons (and plan-based billing) can be added to this list later.
export const ADDONS = ['inventory'];

// The add-ons that are switched on for a salon, e.g. ['inventory']
export function enabledAddons(org) {
  return ADDONS.filter((name) => org?.addons?.[name]?.enabled);
}
