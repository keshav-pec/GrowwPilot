import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../../config/env.js';
import { ConsentEvent, Customer, Organization } from '../../../models/index.js';
import { escapeHtml } from '../../mail/html.js';
import { reevaluateCustomer } from '../engine/reevaluate.js';

// The unsubscribe link at the bottom of every offer email: CLIENT_ORIGIN/api/public/unsubscribe/<token>.
// token = the salon id and customer id, plus a signature made with a key derived from JWT_SECRET. It is checked
// without a database lookup and can't be guessed or changed (another customer's id breaks the signature).
// Pressing Unsubscribe turns off offer emails only; WhatsApp and SMS permission stay as they are.

const KEY = crypto.createHmac('sha256', env.JWT_SECRET).update('email-unsubscribe-v1').digest();
const sign = (payload) => crypto.createHmac('sha256', KEY).update(payload).digest().subarray(0, 16);

export function unsubscribeToken(orgId, customerId) {
  const payload = Buffer.concat([Buffer.from(String(orgId), 'hex'), Buffer.from(String(customerId), 'hex')]);
  return `${payload.toString('base64url')}.${sign(payload).toString('base64url')}`;
}

export function unsubscribeUrl(orgId, customerId) {
  return `${env.CLIENT_ORIGIN}/api/public/unsubscribe/${unsubscribeToken(orgId, customerId)}`;
}

// { orgId, customerId } or null when the link is broken or forged
export function readToken(token) {
  const [data, signature] = String(token ?? '').split('.');
  if (!data || !signature) return null;
  const payload = Buffer.from(data, 'base64url');
  const given = Buffer.from(signature, 'base64url');
  if (payload.length !== 24 || given.length !== 16 || !crypto.timingSafeEqual(given, sign(payload))) return null;
  return { orgId: payload.subarray(0, 12).toString('hex'), customerId: payload.subarray(12).toString('hex') };
}

async function find(token) {
  const ids = readToken(token);
  if (!ids) return null;
  const customer = await Customer.findOne({ _id: ids.customerId, orgId: ids.orgId }).select('marketing').lean();
  if (!customer) return null;
  const org = await Organization.findById(ids.orgId).select('name').lean();
  return { ...ids, customer, salonName: org?.name ?? 'the salon', status: customer.marketing?.EMAIL?.status ?? 'UNKNOWN' };
}

// What the link's page shows: INVALID, ALREADY (opted out before) or ASK (the Unsubscribe button)
export async function unsubscribeState(token) {
  const found = await find(token);
  if (!found) return { state: 'INVALID' };
  return { state: found.status === 'OPTED_OUT' ? 'ALREADY' : 'ASK', salonName: found.salonName };
}

// The customer pressed Unsubscribe: Email -> Opted out, with a history row. Pressing again changes nothing.
export async function unsubscribe(token) {
  const found = await find(token);
  if (!found) return { state: 'INVALID' };
  if (found.status === 'OPTED_OUT') return { state: 'ALREADY', salonName: found.salonName };

  const { orgId, customerId, status: from } = found;
  const now = new Date();
  const changed = await mongoose.connection.transaction(async (session) => {
    const result = await Customer.updateOne(
      { _id: customerId, orgId, 'marketing.EMAIL.status': { $in: from === 'UNKNOWN' ? ['UNKNOWN', null] : [from] } },
      { $set: { 'marketing.EMAIL': { status: 'OPTED_OUT', source: 'CUSTOMER_REQUEST', noticeVersion: null, evidence: 'Email unsubscribe link', changedAt: now, changedBy: null } } },
      { session }
    );
    if (result.modifiedCount !== 1) return false; // changed a moment ago (pressed twice)
    await ConsentEvent.create(
      [{ orgId, customerId, channel: 'EMAIL', from, to: 'OPTED_OUT', source: 'CUSTOMER_REQUEST', customerAsked: true, note: 'Email unsubscribe link', actorId: null, actorName: 'Customer', actorRole: 'Customer (email link)' }],
      { session }
    );
    return true;
  });
  if (changed) {
    // Offers follow straight away (channels on the list; every channel opted out -> open tasks closed)
    await reevaluateCustomer(orgId, customerId).catch((err) => console.error('Unsubscribe: re-check of offers failed:', err));
  }
  return { state: changed ? 'DONE' : 'ALREADY', salonName: found.salonName };
}

// The small page the link opens. A page with a button (not an instant change), because email scanners open links.
export function unsubscribePage({ state, salonName }) {
  const salon = escapeHtml(salonName);
  const content = {
    INVALID: { title: 'This link isn’t valid', text: 'It may have been copied only in part. If you still get emails you don’t want, reply to one of them and ask the salon to stop.' },
    ASK: { title: `Stop offer emails from ${salon}?`, text: 'You won’t get birthday or anniversary offers by email any more. Messages on WhatsApp or SMS, if you allowed them, are not affected.', button: true },
    ALREADY: { title: 'You’re unsubscribed', text: `${salon} won’t send you offer emails.` },
    DONE: { title: 'You’re unsubscribed', text: `${salon} won’t send you offer emails any more. You can allow them again at the salon at any time.` },
  }[state];
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${content.title}</title></head>
<body style="margin:0;background:#f7f7f5;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <main style="max-width:440px;margin:48px auto;padding:24px;background:#ffffff;border:1px solid #e5e5e0;border-radius:12px;">
    <h1 style="margin:0 0 12px;font-size:20px;color:#6b4226;">${content.title}</h1>
    <p style="margin:0 0 20px;line-height:1.5;">${content.text}</p>
    ${content.button ? '<form method="post"><button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#c9a227;color:#111111;font-size:15px;font-weight:600;cursor:pointer;">Unsubscribe</button></form>' : ''}
  </main>
</body>
</html>`;
}
