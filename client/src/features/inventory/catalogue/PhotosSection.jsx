import { useRef } from 'react';
import toast from 'react-hot-toast';
import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { imageUrl, useAddImages, useRemoveImage, useSetMainImage } from '../../../api/inventory/images';
import { newRequestKey } from '../../../lib/inventory';
import { Badge, Button } from '../../../components/ui';

const MAX = 4;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// A product's photos (up to 4, one main) on its product page. Adding and removing follows the rule for
// editing the product; everyone who sees stock sees the photos.
export default function PhotosSection({ sku, canEdit }) {
  const inputRef = useRef(null);
  const addImages = useAddImages();
  const setMain = useSetMainImage();
  const removeImage = useRemoveImage();
  const images = sku.images ?? [];

  async function pick(e) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    const bad = files.find((file) => !TYPES.includes(file.type) || file.size > 2 * 1024 * 1024);
    if (bad) return toast.error(`${bad.name}: use a JPEG, PNG or WebP of at most 2 MB`);
    if (images.length + files.length > MAX) return toast.error(`A product can have ${MAX} photos`);
    // One photo per request, so big uploads never hit a size limit on the way
    for (const file of files) {
      try {
        await addImages.mutateAsync({ key: newRequestKey(), skuId: sku._id, files: [file] });
      } catch (err) {
        return toast.error(err.message);
      }
    }
    toast.success(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
  }

  const act = (mutation, imageId, done) =>
    mutation.mutate({ key: newRequestKey(), skuId: sku._id, imageId }, { onSuccess: () => toast.success(done), onError: (err) => toast.error(err.message) });

  if (images.length === 0 && !canEdit) return <p className="text-sm text-muted">No photos.</p>;

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {images.map((image) => (
          <div key={image._id} className="group relative overflow-hidden rounded-lg border border-border bg-surface">
            <a href={imageUrl(sku._id, image._id, 'full')} target="_blank" rel="noreferrer">
              <img src={imageUrl(sku._id, image._id)} alt={sku.name} loading="lazy" className="aspect-square w-full object-cover" />
            </a>
            {image.isMain && (
              <span className="absolute left-1 top-1">
                <Badge tone="gold">Main</Badge>
              </span>
            )}
            {canEdit && (
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                {!image.isMain ? (
                  <button type="button" aria-label="Make main photo" className="rounded p-1 text-white hover:bg-white/20" onClick={() => act(setMain, image._id, 'Main photo changed')}>
                    <Star size={14} />
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" aria-label="Remove photo" className="rounded p-1 text-white hover:bg-white/20" onClick={() => act(removeImage, image._id, 'Photo removed')}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {canEdit && images.length < MAX && (
        <>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => inputRef.current?.click()} loading={addImages.isPending}>
            <ImagePlus size={14} /> Add photos
          </Button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={pick} />
          <p className="mt-1 text-xs text-muted">Up to {MAX} photos, JPEG, PNG or WebP, 2 MB each.</p>
        </>
      )}
    </div>
  );
}
