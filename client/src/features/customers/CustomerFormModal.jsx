import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useSaveCustomer } from '../../api/customers';
import { useStaff } from '../../api/staff';
import { isValidPhone } from '../../lib/phone';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().refine(isValidPhone, 'Enter a valid 10-digit mobile number'),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  dob: z.string(),
  preferredStaffId: z.string(),
  notes: z.string(),
});

// Add a customer (customer = null) or edit one. onSaved gets the saved customer.
export default function CustomerFormModal({ customer, onClose, onSaved }) {
  const saveCustomer = useSaveCustomer();
  const staff = (useStaff().data ?? []).filter((s) => s.status === 'active');
  const [existing, setExisting] = useState(null); // the customer who already has this phone

  // The current preferred stylist may work at another branch, so make sure they're in the list
  const preferred = customer?.preferredStaffId;
  const staffOptions = staff.map((s) => ({ value: s._id, label: s.name }));
  if (preferred && !staffOptions.some((o) => o.value === preferred._id)) staffOptions.push({ value: preferred._id, label: preferred.name });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      dob: customer?.dob ? customer.dob.slice(0, 10) : '', // "1995-05-12T00:00:00Z" -> "1995-05-12"
      preferredStaffId: preferred?._id ?? '',
      notes: customer?.notes ?? '',
    },
  });

  function onSubmit(values) {
    setExisting(null);
    saveCustomer.mutate(
      { _id: customer?._id, ...values },
      {
        onSuccess: (saved) => {
          toast.success(customer ? 'Customer updated' : `Added ${saved.name}`);
          onSaved?.(saved);
          onClose();
        },
        onError: (err) => {
          if (err.code === 'CUSTOMER_EXISTS') setExisting(err.details.customer);
          else toast.error(err.message);
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? `Edit ${customer.name}` : 'Add customer'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={saveCustomer.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" error={errors.name?.message} {...register('name')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />

        {/* Same phone already belongs to someone: point to them instead of creating a duplicate */}
        {existing && (
          <div className="rounded-lg border border-orange bg-orange/10 p-3 text-sm sm:col-span-2">
            This phone already belongs to <strong>{existing.name}</strong>.{' '}
            <Link to={`/app/customers/${existing._id}`} onClick={onClose} className="font-medium underline">
              Open {existing.name}’s profile
            </Link>
          </div>
        )}

        <Input label="Email (optional)" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="Date of birth (optional)" type="date" {...register('dob')} />
        <div className="sm:col-span-2">
          <Select label="Preferred stylist (optional)" placeholder="No preference" options={staffOptions} {...register('preferredStaffId')} />
        </div>
        <div className="sm:col-span-2">
          <Textarea label="Notes (optional)" placeholder="e.g. allergic to ammonia, likes short hair" {...register('notes')} />
        </div>
      </form>
    </Modal>
  );
}
