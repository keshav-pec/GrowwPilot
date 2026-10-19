import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSaveSku } from '../../../api/inventory/skus';
import { useSuppliers } from '../../../api/inventory/suppliers';
import { BASE_UNITS, SKU_TYPES, STOCK_UNITS, WAYS_OF_USE, isMeasured, newRequestKey } from '../../../lib/inventory';
import { isValidRupees, toPaise } from '../../../lib/money';
import { GST_RATE_OPTIONS } from '../../../lib/billing';
import { Button, Input, Modal, Select } from '../../../components/ui';

const whole = z.string().trim().refine((v) => v === '' || /^\d+$/.test(v), 'Use a whole number');
const toNumber = (v) => (v === '' ? null : Number(v));

const schema = z
  .object({
    name: z.string().trim().min(2, 'Name is required'),
    category: z.string().trim().min(1, 'Category is required'),
    stockUnit: z.string().trim().min(1, 'Stock unit is required'),
    wayOfUse: z.string(),
    baseUnit: z.string(),
    unitsPerStockUnit: whole,
    openingWhole: whole,
    openingLoose: whole,
    brand: z.string(),
    barcodes: z.string(),
    type: z.string(),
    code: z.string().trim().refine((v) => v === '' || /^[A-Za-z0-9-]{2,30}$/.test(v), 'Use letters, numbers and dashes only'),
    reorderPoint: whole,
    reorderQty: whole,
    preferredSupplierId: z.string(),
    unitCost: z.string().refine((v) => v.trim() === '' || isValidRupees(v), 'Enter an amount like 450 or 450.50'),
    // Selling to customers (retail products)
    sellPrice: z.string().refine((v) => v.trim() === '' || isValidRupees(v), 'Enter a price like 450 or 450.50'),
    taxRateBps: z.string(),
    hsnCode: z.string().trim().refine((v) => v === '' || /^\d{4,8}$/.test(v), 'HSN code is 4 to 8 digits'),
  })
  .superRefine((v, ctx) => {
    if (v.wayOfUse !== 'SERVICE_MEASURED') return;
    if (!v.unitsPerStockUnit || Number(v.unitsPerStockUnit) < 1) {
      ctx.addIssue({ code: 'custom', path: ['unitsPerStockUnit'], message: 'How much is in one, e.g. 1000' });
    } else if (v.openingLoose && Number(v.openingLoose) >= Number(v.unitsPerStockUnit)) {
      ctx.addIssue({ code: 'custom', path: ['openingLoose'], message: 'Less than one full one' });
    }
  });

// Add a product (only the basics are asked; the rest is under "More details"), or edit one.
// `product` is the product page data when editing. `reorderOnly`: the person may only set this branch's
// reorder levels (the product is also used at other branches).
export default function ProductFormModal({ product, categories = [], canSeeCosts, reorderOnly = false, onClose, onSaved }) {
  const sku = product?.sku;
  const saveSku = useSaveSku();
  const suppliers = useSuppliers().data ?? [];
  const [key] = useState(newRequestKey); // one per form: a double click saves once
  const [moreOpen, setMoreOpen] = useState(reorderOnly);

  // Measured products are counted in ml / g; reorder levels are shown in whole stock units (bottles)
  const per = isMeasured(sku) ? sku.unitsPerStockUnit : 1;
  const levelText = (qty) => (qty == null ? '' : String(Math.round(qty / per)));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: sku?.name ?? '',
      category: sku?.category ?? '',
      stockUnit: sku?.stockUnit ?? 'bottle',
      wayOfUse: sku?.wayOfUse ?? 'FINISH',
      baseUnit: sku?.baseUnit ?? 'ml',
      unitsPerStockUnit: sku && isMeasured(sku) ? String(sku.unitsPerStockUnit) : '',
      openingWhole: '',
      openingLoose: '',
      brand: sku?.brand ?? '',
      barcodes: sku?.barcodes.join(', ') ?? '',
      type: sku?.type ?? 'PROFESSIONAL',
      code: '',
      reorderPoint: levelText(product?.branch.reorderPoint),
      reorderQty: levelText(product?.branch.reorderQty),
      preferredSupplierId: product?.branch.preferredSupplierId ?? '',
      unitCost: '',
      sellPrice: sku?.sellPrice != null ? String(sku.sellPrice / 100) : '',
      taxRateBps: sku?.taxRateBps != null ? String(sku.taxRateBps) : '',
      hsnCode: sku?.hsnCode ?? '',
    },
  });

  const wayOfUse = watch('wayOfUse');
  const stockUnit = watch('stockUnit') || 'unit';
  const baseUnit = watch('baseUnit');
  const measured = wayOfUse === 'SERVICE_MEASURED';
  const retail = watch('type') === 'RETAIL';
  const hint = WAYS_OF_USE.find((w) => w.value === wayOfUse)?.hint;

  function onSubmit(v) {
    const unitsPer = measured ? Number(v.unitsPerStockUnit) : 1;
    const level = (text) => (text === '' ? null : Number(text) * unitsPer);
    const reorder = { reorderPoint: level(v.reorderPoint), reorderQty: level(v.reorderQty), preferredSupplierId: v.preferredSupplierId || null };

    let values;
    if (reorderOnly) {
      values = { _id: sku._id, version: sku.version, ...reorder };
    } else {
      const details = {
        name: v.name,
        category: v.category,
        stockUnit: v.stockUnit,
        wayOfUse: v.wayOfUse,
        ...(measured ? { baseUnit: v.baseUnit, unitsPerStockUnit: unitsPer } : sku ? { baseUnit: null, unitsPerStockUnit: 1 } : {}),
        brand: v.brand,
        barcodes: v.barcodes.split(',').map((b) => b.trim()).filter(Boolean),
        type: v.type,
        sellPrice: v.sellPrice.trim() ? toPaise(v.sellPrice) : null,
        taxRateBps: v.taxRateBps === '' ? null : Number(v.taxRateBps),
        hsnCode: v.hsnCode,
        ...reorder,
      };
      if (sku) {
        values = { _id: sku._id, version: sku.version, ...details };
      } else {
        const openingQty = (toNumber(v.openingWhole) ?? 0) * unitsPer + (measured ? (toNumber(v.openingLoose) ?? 0) : 0);
        values = {
          ...details,
          ...(v.code && { code: v.code }),
          ...(openingQty > 0 && { openingQty }),
          ...(openingQty > 0 && v.unitCost.trim() && { openingUnitCost: toPaise(v.unitCost) }),
        };
      }
    }

    saveSku.mutate(
      { key, ...values },
      {
        onSuccess: (data) => {
          toast.success(sku ? 'Saved' : `${data.sku.name} added`);
          onSaved?.(data.sku);
          onClose();
        },
      }
    );
  }

  const title = reorderOnly ? `Reorder levels for ${sku.name}` : sku ? `Edit ${sku.name}` : 'Add product';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={saveSku.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {reorderOnly && (
          <p className="text-sm text-muted sm:col-span-2">
            Other branches also use this product, so only the business owner can change its details. You can set when this branch should order more.
          </p>
        )}

        {!reorderOnly && (
          <>
            <Input label="Name" placeholder="e.g. Loreal Shampoo 1 L" error={errors.name?.message} {...register('name')} />
            <Input label="Category" placeholder="e.g. Hair care" list="inventory-categories" error={errors.category?.message} {...register('category')} />
            <datalist id="inventory-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Input label="Stock unit" hint="What you count it in" list="inventory-units" error={errors.stockUnit?.message} {...register('stockUnit')} />
            <datalist id="inventory-units">
              {STOCK_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <Select label="Way of use" options={WAYS_OF_USE} {...register('wayOfUse')} />
            {hint && <p className="-mt-2 text-xs text-muted sm:col-span-2">{hint}</p>}

            {measured && (
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface p-3 sm:col-span-2">
                <Input
                  label={`How much is in one ${stockUnit}`}
                  inputMode="numeric"
                  placeholder="e.g. 1000"
                  error={errors.unitsPerStockUnit?.message}
                  {...register('unitsPerStockUnit')}
                />
                <Select label="Measured in" options={BASE_UNITS} {...register('baseUnit')} />
              </div>
            )}

            {!sku &&
              (measured ? (
                <div className="grid grid-cols-2 gap-4 sm:col-span-2">
                  <Input label={`Opening stock: full ${stockUnit}s`} inputMode="numeric" placeholder="Optional" error={errors.openingWhole?.message} {...register('openingWhole')} />
                  <Input label={`Plus an open one (${baseUnit})`} inputMode="numeric" placeholder="Optional" error={errors.openingLoose?.message} {...register('openingLoose')} />
                </div>
              ) : (
                <Input
                  label={`Opening stock (${stockUnit}s)`}
                  inputMode="numeric"
                  placeholder="Optional"
                  hint="What you have in the store now"
                  error={errors.openingWhole?.message}
                  {...register('openingWhole')}
                />
              ))}
          </>
        )}

        {!reorderOnly && (
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            className="flex items-center gap-1 text-sm font-medium text-brown sm:col-span-2"
          >
            {moreOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} More details
          </button>
        )}

        {moreOpen && (
          <>
            {!reorderOnly && (
              <>
                <Input label="Brand (optional)" {...register('brand')} />
                <Select label="Type" options={SKU_TYPES} {...register('type')} />
                <Input label="Barcodes (optional)" hint="Scan or type; separate several with commas" {...register('barcodes')} />
                {!sku && <Input label="Own code (optional)" placeholder="Made automatically" error={errors.code?.message} {...register('code')} />}
                {retail && (
                  <>
                    <Input
                      label={`Selling price per ${stockUnit} (₹)`}
                      inputMode="decimal"
                      placeholder="Not for sale"
                      hint={measured ? 'Products measured in ml or g can’t be sold on bills' : 'Lets the front desk add it to bills'}
                      error={errors.sellPrice?.message}
                      {...register('sellPrice')}
                    />
                    <Select label="GST rate" options={[{ value: '', label: 'Salon default for products' }, ...GST_RATE_OPTIONS]} {...register('taxRateBps')} />
                    <Input label="HSN code (optional)" inputMode="numeric" placeholder="e.g. 3305" error={errors.hsnCode?.message} {...register('hsnCode')} />
                  </>
                )}
              </>
            )}
            <Input
              label={`Order more at or below (${stockUnit}s)`}
              inputMode="numeric"
              placeholder="Not set"
              error={errors.reorderPoint?.message}
              {...register('reorderPoint')}
            />
            <Input label={`How many to order (${stockUnit}s)`} inputMode="numeric" placeholder="Not set" error={errors.reorderQty?.message} {...register('reorderQty')} />
            <Select label="Usual supplier (this branch)" placeholder="None" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} {...register('preferredSupplierId')} />
            {!sku && canSeeCosts && (
              <Input
                label={`Cost per ${stockUnit} (₹, optional)`}
                inputMode="decimal"
                hint="What you paid for the opening stock. Only owners see costs."
                error={errors.unitCost?.message}
                {...register('unitCost')}
              />
            )}
          </>
        )}

        {saveSku.isError && <p className="text-sm text-danger sm:col-span-2">{saveSku.error.message}</p>}
      </form>
    </Modal>
  );
}
