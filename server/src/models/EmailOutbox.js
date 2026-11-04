import mongoose from 'mongoose';
import { ref } from './fields.js';

export const EMAIL_KINDS = ['TEST', 'OCCASION_OFFER', 'PASSWORD', 'BILL'];
export const EMAIL_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'];
const EMAIL_ROUTES = ['APPS_SCRIPT', 'SMTP', 'LOG']; // LOG = email is off (development): printed, not sent

// One email the app sends. Written in the same transaction as whatever caused it, sent in the background
// (modules/mail/outbox.js) with retries. Attachments are not stored: a bill PDF is rebuilt when it is sent.
// Rows are removed 180 days after they were queued.
const emailOutboxSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch'),
    kind: { type: String, enum: EMAIL_KINDS, required: true },
    priority: { type: Number, min: 1, max: 5, required: true }, // 1 = password emails ... 5 = automatic offers
    to: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    fromName: { type: String, required: true },
    replyTo: String,
    headers: { type: Object, default: undefined }, // extra headers (SMTP only), e.g. List-Unsubscribe
    attachment: { type: new mongoose.Schema({ type: { type: String, enum: ['INVOICE'] }, id: ref('Invoice') }, { _id: false }), default: undefined },
    ref: { offerId: ref('OfferIssue'), invoiceId: ref('Invoice'), userId: ref('User') },
    dedupeKey: { type: String, required: true }, // queueing the same email twice does nothing
    status: { type: String, enum: EMAIL_STATUSES, default: 'PENDING' },
    via: { type: String, enum: EMAIL_ROUTES },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lockedUntil: Date,
    lastError: String, // in plain words, for the owner
    errorKind: String, // QUOTA, BAD_ADDRESS... (modules/mail/errors.js)
    errorDetail: String, // the technical message, for whoever sets up email
    sentAt: Date,
    createdBy: { id: ref('User'), name: String },
  },
  { timestamps: true, collection: 'email_outbox' }
);

emailOutboxSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true });
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1, priority: 1 }); // the mailer's "what's due"
emailOutboxSchema.index({ orgId: 1, createdAt: -1 }); // the salon's recent emails
emailOutboxSchema.index({ status: 1, sentAt: -1 }); // the daily limit (sent in the last 24 hours)
emailOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export default mongoose.model('EmailOutbox', emailOutboxSchema);
