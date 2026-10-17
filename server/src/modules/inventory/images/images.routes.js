import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError } from '../../../utils/AppError.js';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, addImages, matchBulkFiles, openImage, removeImage, setMainImage } from './images.service.js';

// Product photos. Mounted at /api/inventory/skus (after the login and add-on checks).
const router = Router();

// Files are kept in memory only while they are checked and resized (at most 4 x 2 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
  fileFilter: (req, file, done) =>
    IMAGE_TYPES.includes(file.mimetype) ? done(null, true) : done(new AppError(400, 'UNSUPPORTED_IMAGE', `${file.originalname} isn’t a JPEG, PNG or WebP picture`)),
});

// multer's own errors, in our words
function receiveImages(req, res, next) {
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'IMAGE_TOO_LARGE', 'Each photo can be at most 2 MB'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(400, 'TOO_MANY_IMAGES', `At most ${MAX_IMAGES} photos at a time`));
    next(err);
  });
}

// Which products do these file names belong to? { fileNames: ['SKU-000012.jpg', ...] }
router.post('/images/bulk-match', validate({ body: z.object({ fileNames: z.array(z.string().trim().min(1).max(200)).min(1).max(200) }) }), async (req, res) => {
  res.json(await matchBulkFiles(req.ctx, req.valid.body.fileNames));
});

router.post('/:id/images', requireIdempotencyKey, receiveImages, async (req, res) => {
  res.status(201).json(await addImages(req.ctx, req.params.id, req.files, req.idempotencyKey));
});
router.patch('/:id/images/:imageId', requireIdempotencyKey, validate({ body: z.object({ isMain: z.literal(true) }) }), async (req, res) => {
  res.json(await setMainImage(req.ctx, req.params.id, req.params.imageId, req.idempotencyKey));
});
router.delete('/:id/images/:imageId', requireIdempotencyKey, async (req, res) => {
  res.json(await removeImage(req.ctx, req.params.id, req.params.imageId, req.idempotencyKey));
});

// GET /api/inventory/skus/:id/images/:imageId?size=thumb
// A photo never changes (a new photo gets a new id), so browsers may keep it for a day.
router.get('/:id/images/:imageId', validate({ query: z.object({ size: z.enum(['full', 'thumb']).default('full') }) }), async (req, res) => {
  const { stream, etag } = await openImage(req.ctx, req.params.id, req.params.imageId, req.valid.query.size);
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('ETag', etag);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

export default router;
