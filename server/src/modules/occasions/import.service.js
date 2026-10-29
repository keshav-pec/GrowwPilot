import { Customer } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { MONTH_NAMES, dayFitsMonth, maskPhone } from '../../config/occasions.js';
import { assertCan } from './permissions.js';
import { customerScope } from './settings.service.js';
import { occasionDateChanges } from './customers.service.js';

// Spreadsheet import of birthdays and anniversaries (owners):
//   1. download the template: one row per customer (ID, name, masked phone, the months saved now)
//   2. fill in months and days, upload: every row is checked first (checkOnly), then the good rows are saved
// Rows are matched by customer ID only, never by phone. An empty month leaves what is saved alone.
// Importing never turns on messaging permission.

const MONTH_WORDS = {
  ...Object.fromEntries(
    MONTH_NAMES.flatMap((name, i) => [
      [name.toLowerCase(), i + 1],
      [name.slice(0, 3).toLowerCase(), i + 1],
    ])
  ),
  sept: 9,
};

// "11", "Nov", "November" -> 11; "" -> null; anything else -> NaN
export function parseMonth(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (value === '') return null;
  if (/^\d{1,2}$/.test(value)) {
    const n = Number(value);
    return n >= 1 && n <= 12 ? n : NaN;
  }
  return MONTH_WORDS[value] ?? NaN;
}

// Checks one occasion's two cells. Returns { date } ({ month, day } or undefined = leave alone) or { problem }.
export function parseOccasionCells(monthText, dayText, label) {
  const month = parseMonth(monthText);
  const dayValue = String(dayText ?? '').trim();
  if (Number.isNaN(month)) return { problem: `${label} month “${String(monthText).trim()}” isn’t a month (use 1–12 or a month name)` };
  if (month === null) return dayValue ? { problem: `${label} day given without a month` } : { date: undefined };
  if (dayValue === '') return { date: { month, day: null } };
  const day = /^\d{1,2}$/.test(dayValue) ? Number(dayValue) : NaN;
  if (!dayFitsMonth(month, day)) return { problem: `${label} day “${dayValue}” isn’t a day in ${MONTH_NAMES[month - 1]}` };
  return { date: { month, day } };
}

const isObjectId = (text) => /^[a-f\d]{24}$/i.test(text);

// GET /api/occasions/import/template — a report table for toCsv
export async function importTemplate(ctx) {
  assertCan(ctx, 'occasions.importDates');
  const customers = await Customer.find(customerScope(ctx)).select('name phone occasions').sort({ name: 1 }).lean();
  return {
    columns: [
      { key: 'customer_id', label: 'customer_id' },
      { key: 'name', label: 'name' },
      { key: 'phone', label: 'phone' },
      { key: 'birthday_month', label: 'birthday_month' },
      { key: 'birthday_day', label: 'birthday_day' },
      { key: 'anniversary_month', label: 'anniversary_month' },
      { key: 'anniversary_day', label: 'anniversary_day' },
    ],
    rows: customers.map((c) => ({
      customer_id: String(c._id),
      name: c.name,
      phone: maskPhone(c.phone),
      birthday_month: c.occasions?.birthday?.month ? MONTH_NAMES[c.occasions.birthday.month - 1] : '',
      birthday_day: c.occasions?.birthday?.day ?? '',
      anniversary_month: c.occasions?.anniversary?.month ? MONTH_NAMES[c.occasions.anniversary.month - 1] : '',
      anniversary_day: c.occasions?.anniversary?.day ?? '',
    })),
  };
}

// Checks every row. Returns { checked: [{ row, customer, set, words }], rejected: [{ row, ...cells, reason }], unchanged }
async function checkRows(ctx, rows) {
  const ids = [...new Set(rows.map((r) => String(r.customer_id ?? '').trim()).filter(isObjectId))];
  const customers = await Customer.find(customerScope(ctx, { _id: { $in: ids } })).select('name occasions').lean();
  const byId = new Map(customers.map((c) => [String(c._id), c]));
  const firstRowOf = new Map();
  const now = new Date();

  const checked = [];
  const rejected = [];
  let unchanged = 0;
  rows.forEach((cells, i) => {
    const row = i + 2; // the header is line 1
    const id = String(cells.customer_id ?? '').trim();
    const reject = (reason) => rejected.push({ row, ...cells, reason });

    if (!id) return reject('customer_id is empty');
    if (!isObjectId(id)) return reject(`customer_id “${id}” isn’t a customer ID from the template`);
    const customer = byId.get(id);
    if (!customer) return reject(ctx.isPrimaryOwner ? 'No customer with this ID' : 'No customer with this ID at your branches');
    if (firstRowOf.has(id)) return reject(`Same customer as row ${firstRowOf.get(id)}`);
    firstRowOf.set(id, row);

    const birthday = parseOccasionCells(cells.birthday_month, cells.birthday_day, 'Birthday');
    const anniversary = parseOccasionCells(cells.anniversary_month, cells.anniversary_day, 'Anniversary');
    const problems = [birthday.problem, anniversary.problem].filter(Boolean);
    if (problems.length > 0) return reject(problems.join('; '));

    const { set, words } = occasionDateChanges(customer, { birthday: birthday.date, anniversary: anniversary.date }, { source: 'IMPORTED', userId: ctx.userId, now });
    if (words.length === 0) unchanged += 1;
    else checked.push({ row, customer, set, words });
  });
  return { checked, rejected, unchanged };
}

// POST /api/occasions/import — { rows, checkOnly }. checkOnly: nothing is saved, the screen shows what would happen.
// Otherwise the good rows are saved together and the bad ones come back for the rejection file.
export async function importDates(ctx, { rows, checkOnly }, key) {
  assertCan(ctx, 'occasions.importDates');
  const { checked, rejected, unchanged } = await checkRows(ctx, rows);
  const summary = { total: rows.length, toSave: checked.length, unchanged, rejected, saved: 0 };
  if (checkOnly || checked.length === 0) return { ...summary, checkOnly };
  if (!key) throw new AppError(400, 'VALIDATION_ERROR', 'Missing Idempotency-Key header');

  return runOnce(ctx, { key, operation: 'occasions.import' }, async (session) => {
    // Only where the dates are still what we checked, so a change made meanwhile isn't overwritten
    const unchangedSince = (customer, field) => ({ [`occasions.${field}.updatedAt`]: customer.occasions?.[field]?.updatedAt ?? null });
    const ops = checked.map(({ customer, set }) => ({
      updateOne: {
        filter: { _id: customer._id, orgId: ctx.orgId, ...unchangedSince(customer, 'birthday'), ...unchangedSince(customer, 'anniversary') },
        update: { $set: set },
      },
    }));
    const result = await Customer.bulkWrite(ops, { session, ordered: false });
    const saved = result.modifiedCount;
    await logActivity(
      ctx,
      { action: 'occasions.dates_imported', summary: `Imported birthdays and anniversaries from a spreadsheet: ${saved} customer${saved === 1 ? '' : 's'} updated, ${rejected.length} row${rejected.length === 1 ? '' : 's'} rejected` },
      session
    );
    return { ...summary, saved, skippedChanged: checked.length - saved, checkOnly: false };
  });
}
