import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useSaveBranch } from '../../api/branches';
import { TIMEZONES } from '../../lib/constants';
import { Button, Input, Modal, Select } from '../../components/ui';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Branch name is required'),
    city: z.string().trim(),
    address: z.string().trim(),
    timezone: z.string(),
    openTime: z.string().min(1, 'Required'),
    closeTime: z.string().min(1, 'Required'),
    defaultServiceMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(480),
  })
  .refine((b) => b.openTime < b.closeTime, { message: 'Must be after opening time', path: ['closeTime'] });

// Add a branch (branch = null) or edit one
export default function BranchFormModal({ branch, onClose }) {
  const saveBranch = useSaveBranch();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: branch?.name ?? '',
      city: branch?.city ?? '',
      address: branch?.address ?? '',
      timezone: branch?.timezone ?? 'Asia/Kolkata',
      openTime: branch?.openTime ?? '10:00',
      closeTime: branch?.closeTime ?? '20:00',
      defaultServiceMinutes: branch?.defaultServiceMinutes ?? 30,
    },
  });

  function onSubmit(values) {
    saveBranch.mutate(
      { _id: branch?._id, ...values },
      {
        onSuccess: () => {
          toast.success(branch ? 'Branch updated' : 'Branch added');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={branch ? `Edit ${branch.name}` : 'Add branch'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="branch-form" loading={saveBranch.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="branch-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Branch name" error={errors.name?.message} {...register('name')} />
        <Input label="City" {...register('city')} />
        <div className="sm:col-span-2">
          <Input label="Address" {...register('address')} />
        </div>
        <Input label="Opens at" type="time" error={errors.openTime?.message} {...register('openTime')} />
        <Input label="Closes at" type="time" error={errors.closeTime?.message} {...register('closeTime')} />
        <Select label="Timezone" options={TIMEZONES} {...register('timezone')} />
        <Input
          label="Default service time (min)"
          type="number"
          hint="Used when a service has no duration"
          error={errors.defaultServiceMinutes?.message}
          {...register('defaultServiceMinutes')}
        />
        {saveBranch.isError && <p className="text-sm text-danger sm:col-span-2">{saveBranch.error.message}</p>}
      </form>
    </Modal>
  );
}
