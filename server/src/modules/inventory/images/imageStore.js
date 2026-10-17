import mongoose from 'mongoose';
import { env } from '../../../config/env.js';

// ---------------------------------------------------------------------------
// The image store: one small interface for keeping product photos, whatever is behind it.
//   save(buffer, { filename, contentType, metadata }) -> id
//   stream(id) -> a readable stream of the file
//   remove(id)
// Chosen with IMAGE_STORAGE. Today: MongoDB GridFS (bucket "inventory_images"). A Cloudinary store can be
// added here later without touching the screens or the rest of the code.
// ---------------------------------------------------------------------------

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'inventory_images' });
}

const gridfsStore = {
  save(buffer, { filename, contentType, metadata }) {
    return new Promise((resolve, reject) => {
      const upload = bucket().openUploadStream(filename, { metadata: { ...metadata, contentType } });
      upload.on('error', reject);
      upload.on('finish', () => resolve(upload.id));
      upload.end(buffer);
    });
  },
  stream(id) {
    return bucket().openDownloadStream(new mongoose.Types.ObjectId(String(id)));
  },
  async remove(id) {
    try {
      await bucket().delete(new mongoose.Types.ObjectId(String(id)));
    } catch (err) {
      if (!/FileNotFound|not found/i.test(err.message)) throw err; // already gone is fine
    }
  },
  // Is this file in the store, and does it belong to this salon? (the tenant check for every read)
  async belongsTo(id, orgId) {
    const [file] = await bucket().find({ _id: new mongoose.Types.ObjectId(String(id)), 'metadata.orgId': String(orgId) }).limit(1).toArray();
    return Boolean(file);
  },
};

const STORES = { gridfs: gridfsStore };

export const imageStore = STORES[env.IMAGE_STORAGE];
