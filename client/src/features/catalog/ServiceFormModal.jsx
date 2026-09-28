import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useSaveService, useSetServiceStatus } from '../../api/catalog';
import { isValidRupees, toPaise } from '../../lib/money';
import { Button, Input, Modal } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

const CATEGORY_SUGGESTIONS = ['Hair', 'Skin', 'Nails', 'Grooming', 'Spa', 'Makeup'];

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  category: z.string().trim(),
  // Optional: empty means "use the branch default"
  durationMinutes: z
    .string()
    .refine((v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 5), 'Whole minutes, at least 5'),
  price: z.string().refine(isValidRupees, 'Enter a price like 500 or 499.50'),
  branchIds: z.array(z.string()),
});

export default function ServiceFormModal({ service, onClose }) {
  const { user } = useAuth();
  const saveService = useSaveService();
  const setStatus = useSetServiceStatus();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: service?.name ?? '',
      category: service?.category ?? '',
      durationMinutes: service?.durationMinutes ? String(service.durationMinutes) : '',
      price: service ? String(service.price / 100) : '',
      branchIds: service?.branchIds ?? [],
    },
  });

  function onSubmit(values) {
    saveService.mutate(
      {
        _id: service?._id,
        ...values,
        durationMinutes: values.durationMinutes.trim() === '' ? null : Number(values.durationMinutes),
        price: toPaise(values.price), // the server stores money as paise
      },
      {
        onSuccess: () => {
          toast.success(service ? 'Service updated' : 'Service added');
          onClose();
        },
      }
    );
  }

  function toggleStatus() {
    const status = service.status === 'active' ? 'disabled' : 'active';
    setStatus.mutate(
      { _id: service._id, status },
      {
        onSuccess: () => {
          toast.success(status === 'disabled' ? `${service.name} can no longer be booked` : `${service.name} can be booked again`);
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
      title={service ? `Edit ${service.name}` : 'Add service'}
      footer={
        <>
          {service && (
            <Button variant="ghost" className="mr-auto" onClick={toggleStatus} loading={setStatus.isPending}>
              {service.status === 'active' ? 'Disable' : 'Enable'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" loading={saveService.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" error={errors.name?.message} {...register('name')} />
        <Input label="Category" list="service-categories" {...register('category')} />
        <datalist id="service-categories">
          {CATEGORY_SUGGESTIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Input label="Price (₹)" inputMode="decimal" error={errors.price?.message} {...register('price')} />
        <Input
          label="Duration in minutes (optional)"
          type="number"
          hint="Leave empty to use the branch default"
          error={errors.durationMinutes?.message}
          {...register('durationMinutes')}
        />
        <div className="sm:col-span-2">
          <Controller
            name="branchIds"
            control={control}
            render={({ field }) => (
              <CheckboxList label="Offered at" allLabel="All branches" items={user.branches} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        {saveService.isError && <p className="text-sm text-danger sm:col-span-2">{saveService.error.message}</p>}
      </form>
    </Modal>
  );
}
