import mongoose from 'mongoose';
import { oid } from '../../../utils/scoped.js';

// Product photos are kept in MongoDB GridFS (bucket "inventory_images").
function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'inventory_images' });
}

export const imageStore = {
  save(buffer, { filename, contentType, metadata }) {
    return new Promise((resolve, reject) => {
      const upload = bucket().openUploadStream(filename, { metadata: { ...metadata, contentType } });
      upload.on('error', reject);
      upload.on('finish', () => resolve(upload.id));
      upload.end(buffer);
    });
  },
  stream(id) {
    return bucket().openDownloadStream(oid(id));
  },
  async remove(id) {
    try {
      await bucket().delete(oid(id));
    } catch (err) {
      if (!/FileNotFound|not found/i.test(err.message)) throw err; // already gone is fine
    }
  },
  // Is this file in the store, and does it belong to this salon? (the tenant check for every read)
  async belongsTo(id, orgId) {
    const [file] = await bucket().find({ _id: oid(id), 'metadata.orgId': String(orgId) }).limit(1).toArray();
    return Boolean(file);
  },
};
