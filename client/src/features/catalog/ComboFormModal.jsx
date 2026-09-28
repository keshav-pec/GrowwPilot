import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useSaveCombo, useSetComboStatus } from '../../api/catalog';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { Button, Input, Modal } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  serviceIds: z.array(z.string()).min(2, 'Choose at least 2 services'),
  comboPrice: z.string().refine(isValidRupees, 'Enter a price like 999 or 999.50'),
  branchIds: z.array(z.string()),
});

// services: the salon's active services, to choose from
export default function ComboFormModal({ combo, services, onClose }) {
  const { user } = useAuth();
  const saveCombo = useSaveCombo();
  const setStatus = useSetComboStatus();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: combo?.name ?? '',
      serviceIds: combo?.serviceIds.map((s) => s._id) ?? [],
      comboPrice: combo ? String(combo.comboPrice / 100) : '',
      branchIds: combo?.branchIds ?? [],
    },
  });

  // Live "separately it would cost ₹X" so the owner can see the saving
  const [chosenIds, comboPrice] = useWatch({ control, name: ['serviceIds', 'comboPrice'] });
  const separately = services.filter((s) => chosenIds.includes(s._id)).reduce((sum, s) => sum + s.price, 0);
  const saving = isValidRupees(comboPrice) ? separately - toPaise(comboPrice) : null;

  function onSubmit(values) {
    saveCombo.mutate(
      { _id: combo?._id, ...values, comboPrice: toPaise(values.comboPrice) },
      {
        onSuccess: () => {
          toast.success(combo ? 'Combo updated' : 'Combo added');
          onClose();
        },
      }
    );
  }

  function toggleStatus() {
    const status = combo.status === 'active' ? 'disabled' : 'active';
    setStatus.mutate(
      { _id: combo._id, status },
      {
        onSuccess: () => {
          toast.success(`${combo.name} ${status === 'disabled' ? 'disabled' : 'enabled'}`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={combo ? `Edit ${combo.name}` : 'Add combo'}
      footer={
        <>
          {combo && (
            <Button variant="ghost" className="mr-auto" onClick={toggleStatus} loading={setStatus.isPending}>
              {combo.status === 'active' ? 'Disable' : 'Enable'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="combo-form" loading={saveCombo.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="combo-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Input label="Combo name" error={errors.name?.message} {...register('name')} />
        </div>
        <Controller
          name="serviceIds"
          control={control}
          render={({ field }) => (
            <CheckboxList
              label="Services"
              items={services.map((s) => ({ _id: s._id, name: `${s.name} · ${formatMoney(s.price)}` }))}
              value={field.value}
              onChange={field.onChange}
              error={errors.serviceIds?.message}
            />
          )}
        />
        <Controller
          name="branchIds"
          control={control}
          render={({ field }) => (
            <CheckboxList label="Offered at" allLabel="All branches" items={user.branches} value={field.value} onChange={field.onChange} />
          )}
        />
        <Input label="Combo price (₹)" inputMode="decimal" error={errors.comboPrice?.message} {...register('comboPrice')} />
        <div className="self-end pb-2 text-sm text-muted">
          Separately: {formatMoney(separately)}
          {saving > 0 && <span className="ml-2 font-medium text-brown">Saves {formatMoney(saving)}</span>}
        </div>
        {saveCombo.isError && <p className="text-sm text-danger sm:col-span-2">{saveCombo.error.message}</p>}
      </form>
    </Modal>
  );
}
