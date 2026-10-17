import sharp from 'sharp';
import { IdempotencyRecord, InventorySku } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { canEditProduct, findSku } from '../skus/skus.service.js';
import { imageStore } from './imageStore.js';

// ---------------------------------------------------------------------------
// Product photos (Phase 8): up to 4 per product, one main. JPEG, PNG or WebP up to 2 MB each.
// Each upload is checked to really be an image, then saved as a 1000 px picture and a 240 px thumbnail.
// Anyone who can see stock can see photos; adding or removing them follows the rule for editing the product.
// ---------------------------------------------------------------------------

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const SIZES = { full: 1000, thumb: 240 };

async function assertCanChangePhotos(ctx, sku) {
  assertCan(ctx, 'inventory.editProducts', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
  if (!(await canEditProduct(ctx, sku))) {
    throw new AppError(403, 'PERMISSION_DENIED', 'This product is also used at other branches. Ask the business owner to change its photos.');
  }
}

// Makes the two sizes. Fails clearly if the file isn't really a picture (whatever its name says).
async function resize(file) {
  let image;
  try {
    image = sharp(file.buffer, { failOn: 'error' }).rotate(); // rotate: respect the phone's orientation
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
  } catch {
    throw new AppError(400, 'UNSUPPORTED_IMAGE', `${file.originalname} isn’t a JPEG, PNG or WebP picture`);
  }
  const make = (size) => image.clone().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const [full, thumb] = await Promise.all([make(SIZES.full), make(SIZES.thumb)]);
  return { full, thumb };
}

// Adds photos. The files are saved first; the product is then updated in a transaction (at most 4 photos).
// If that doesn't go through (too many, or the same request twice), the new files are removed again.
export async function addImages(ctx, id, files, key) {
  const sku = await findSku(ctx, id);
  await assertCanChangePhotos(ctx, sku);
  if (!files?.length) throw new AppError(400, 'VALIDATION_ERROR', 'Choose at least one picture');

  // The same request again (double click, retry): give back the first answer without saving anything new
  if (await IdempotencyRecord.exists({ orgId: ctx.orgId, key })) return runOnce(ctx, { key, operation: 'inventory.images.add' }, async () => null);
  if (sku.images.length + files.length > MAX_IMAGES) {
    throw new AppError(400, 'TOO_MANY_IMAGES', `A product can have ${MAX_IMAGES} photos; ${sku.name} already has ${sku.images.length}`);
  }

  const saved = [];
  try {
    for (const file of files) {
      const { full, thumb } = await resize(file);
      const metadata = { orgId: String(ctx.orgId), skuId: String(sku._id) };
      const fileId = await imageStore.save(full.data, { filename: `${sku.code}.webp`, contentType: 'image/webp', metadata });
      saved.push(fileId);
      const thumbId = await imageStore.save(thumb.data, { filename: `${sku.code}-thumb.webp`, contentType: 'image/webp', metadata });
      saved.push(thumbId);
      file.stored = { fileId, thumbId, width: full.info.width, height: full.info.height };
    }

    const result = await runOnce(ctx, { key, operation: 'inventory.images.add' }, async (session) => {
      const fresh = await InventorySku.findOne(scoped(ctx, { _id: sku._id })).session(session);
      if (fresh.images.length + files.length > MAX_IMAGES) throw new AppError(400, 'TOO_MANY_IMAGES', `A product can have ${MAX_IMAGES} photos`);
      const hasMain = fresh.images.some((i) => i.isMain);
      files.forEach((file, i) => {
        fresh.images.push({ ...file.stored, isMain: !hasMain && i === 0, originalName: file.originalname, uploadedBy: { id: ctx.userId, name: ctx.userName } });
      });
      await fresh.save({ session });
      await recordInventoryAction(
        ctx,
        { action: 'inventory.photos_added', branchId: ctx.activeBranchId, summary: `Added ${files.length} photo${files.length === 1 ? '' : 's'} to ${fresh.name} (${fresh.code})`, link: `/app/inventory?tab=products&product=${fresh._id}` },
        session
      );
      return { images: fresh.toObject().images };
    });

    // Another identical request won at the same moment: our copies aren't used
    const kept = new Set((result?.images ?? []).flatMap((i) => [String(i.fileId), String(i.thumbId)]));
    await Promise.all(saved.filter((fileId) => !kept.has(String(fileId))).map((fileId) => imageStore.remove(fileId)));
    return result;
  } catch (err) {
    await Promise.all(saved.map((fileId) => imageStore.remove(fileId)));
    throw err;
  }
}

function findImage(sku, imageId) {
  const image = sku.images.find((i) => String(i._id) === String(imageId));
  if (!image) throw new AppError(404, 'NOT_FOUND', 'Photo not found');
  return image;
}

export async function setMainImage(ctx, id, imageId, key) {
  const sku = await findSku(ctx, id);
  await assertCanChangePhotos(ctx, sku);
  findImage(sku, imageId);
  return runOnce(ctx, { key, operation: 'inventory.images.main' }, async (session) => {
    const fresh = await InventorySku.findOne(scoped(ctx, { _id: sku._id })).session(session);
    for (const image of fresh.images) image.isMain = String(image._id) === String(imageId);
    await fresh.save({ session });
    return { images: fresh.toObject().images };
  });
}

// Removing a photo is logged. If it was the main one, the next photo becomes the main one.
export async function removeImage(ctx, id, imageId, key) {
  const sku = await findSku(ctx, id);
  await assertCanChangePhotos(ctx, sku);
  const image = findImage(sku, imageId);
  const result = await runOnce(ctx, { key, operation: 'inventory.images.remove' }, async (session) => {
    const fresh = await InventorySku.findOne(scoped(ctx, { _id: sku._id })).session(session);
    const gone = fresh.images.id(imageId);
    if (!gone) throw new AppError(404, 'NOT_FOUND', 'Photo not found');
    gone.deleteOne();
    if (!fresh.images.some((i) => i.isMain) && fresh.images.length > 0) fresh.images[0].isMain = true;
    await fresh.save({ session });
    await recordInventoryAction(
      ctx,
      { action: 'inventory.photo_removed', branchId: ctx.activeBranchId, summary: `Removed a photo of ${fresh.name} (${fresh.code})${image.originalName ? `: ${image.originalName}` : ''}`, link: `/app/inventory?tab=products&product=${fresh._id}` },
      session
    );
    return { images: fresh.toObject().images };
  });
  // The files go once the product no longer points at them
  await Promise.all([imageStore.remove(image.fileId), imageStore.remove(image.thumbId)]);
  return result;
}

// One photo, for showing. Checked twice: the product belongs to my salon, and so does the file.
export async function openImage(ctx, id, imageId, size) {
  assertCan(ctx, 'inventory.view', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
  const sku = await findSku(ctx, id);
  const image = findImage(sku, imageId);
  const fileId = size === 'thumb' ? image.thumbId : image.fileId;
  if (!(await imageStore.belongsTo(fileId, ctx.orgId))) throw new AppError(404, 'NOT_FOUND', 'Photo not found');
  return { stream: imageStore.stream(fileId), etag: `"${fileId}"` };
}

// ---------------------------------------------------------------------------
// Bulk upload: files named by product code ("SKU-000012.jpg", "SKU-000012-2.png") are matched to products.
// The screen shows the matches first, then uploads each product's files.
// ---------------------------------------------------------------------------

// "sku-000012_2.JPG" -> "SKU-000012" (a "-2" / "_2" / " (2)" ending numbers extra photos of the same product)
export function codeFromFileName(fileName) {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').trim().toUpperCase();
  return base.replace(/(\s*\(\d+\)|[-_ ]\d{1,2})$/, '');
}

export async function matchBulkFiles(ctx, fileNames) {
  assertCan(ctx, 'inventory.editProducts', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
  const wanted = fileNames.map((name) => ({ fileName: name, code: codeFromFileName(name) }));
  // A file whose whole name is a code (e.g. a code that itself ends in -12) wins over the shortened guess
  const exactCodes = fileNames.map((name) => name.replace(/\.[a-z0-9]+$/i, '').trim().toUpperCase());
  const skus = await InventorySku.find(scoped(ctx, { code: { $in: [...wanted.map((w) => w.code), ...exactCodes] } })).select('name code images').lean();
  const skuByCode = Object.fromEntries(skus.map((s) => [s.code, s]));

  const perSku = {};
  const files = wanted.map((w, i) => {
    const sku = skuByCode[exactCodes[i]] ?? skuByCode[w.code];
    if (!sku) return { fileName: w.fileName, status: 'NO_MATCH', message: `No product has the code ${w.code}` };
    const count = (perSku[sku._id] = (perSku[sku._id] ?? sku.images.length) + 1);
    if (count > MAX_IMAGES) return { fileName: w.fileName, status: 'TOO_MANY', skuId: sku._id, skuName: sku.name, code: sku.code, message: `${sku.name} would have more than ${MAX_IMAGES} photos` };
    return { fileName: w.fileName, status: 'MATCH', skuId: sku._id, skuName: sku.name, code: sku.code };
  });
  return { files, matched: files.filter((f) => f.status === 'MATCH').length };
}
