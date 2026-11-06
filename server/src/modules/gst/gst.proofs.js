import mongoose from 'mongoose';
import { oid } from '../../utils/scoped.js';

// Proof of filing (the portal's acknowledgement) is kept in MongoDB GridFS, bucket "gst_proofs".
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'gst_proofs' });

export const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export function saveProof(file, orgId) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(file.originalname, { metadata: { orgId: String(orgId), contentType: file.mimetype } });
    upload.on('error', reject);
    upload.on('finish', () => resolve(upload.id));
    upload.end(file.buffer);
  });
}

// The file, only if it belongs to this salon
export async function openProof(id, orgId) {
  const [file] = await bucket().find({ _id: oid(id), 'metadata.orgId': String(orgId) }).limit(1).toArray();
  return file ? { file, stream: bucket().openDownloadStream(oid(id)) } : null;
}
