import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useSaveCustomer } from '../../api/customers';
import { useServiceStaff } from '../../api/staff';
import { isValidPhone } from '../../lib/phone';
import { fromDateForm, toDateForm } from '../../lib/occasions';
import { Button, ConfirmDialog, Input, Modal, Select, Textarea } from '../../components/ui';
import OccasionDateFields from './OccasionDateFields';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().refine(isValidPhone, 'Enter a valid 10-digit mobile number'),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  homeBranchId: z.string().min(1, 'Choose a home branch'),
  preferredStaffId: z.string(),
  notes: z.string(),
});

// Add a customer (customer = null) or edit one. onSaved gets the saved customer.
export default function CustomerFormModal({ customer, onClose, onSaved }) {
  const { user, activeBranchId } = useAuth();
  const saveCustomer = useSaveCustomer();
  const staff = (useServiceStaff().data ?? []).filter((s) => s.status === 'active');
  const [existing, setExisting] = useState(null); // the customer who already has this phone
  const [confirmCorrection, setConfirmCorrection] = useState(null); // form values waiting for "confirm correction"


  // The current preferred stylist may work at another branch, so make sure they're in the list
  const preferred = customer?.preferredStaffId;
  const staffOptions = staff.map((s) => ({ value: s._id, label: s.name }));
  if (preferred && !staffOptions.some((o) => o.value === preferred._id)) staffOptions.push({ value: preferred._id, label: preferred.name });

  // Home branch: one of my branches. A customer already at another branch keeps showing it.
  const branchOptions = user.branches.map((b) => ({ value: b._id, label: b.name }));
  if (customer?.homeBranchId && !branchOptions.some((o) => o.value === customer.homeBranchId)) {
    branchOptions.push({ value: customer.homeBranchId, label: customer.homeBranchName ?? 'Another branch' });
  }

  // Birthday and anniversary: month needed, day optional, never the year
  const [birthday, setBirthday] = useState(() => toDateForm(customer?.occasions?.birthday));
  const [anniversary, setAnniversary] = useState(() => toDateForm(customer?.occasions?.anniversary));
  const hasDates = Boolean(customer?.occasions?.birthday?.month || customer?.occasions?.anniversary?.month);

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
      homeBranchId: customer?.homeBranchId ?? activeBranchId ?? '',
      preferredStaffId: preferred?._id ?? '',
      notes: customer?.notes ?? '',
    },
  });

  function onSubmit(values, { confirmOfferChange = false } = {}) {
    setExisting(null);
    saveCustomer.mutate(
      { _id: customer?._id, ...values, birthday: fromDateForm(birthday), anniversary: fromDateForm(anniversary), ...(confirmOfferChange && { confirmOfferChange }) },
      {
        onSuccess: (saved) => {
          toast.success(customer ? 'Customer updated' : `Added ${saved.name}`);
          onSaved?.(saved);
          onClose();
        },
        onError: (err) => {
          if (err.code === 'CUSTOMER_EXISTS') setExisting(err.details.customer);
          else if (err.code === 'OFFER_CHANGE_NEEDS_CONFIRM') setConfirmCorrection(values);
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
        <Select label="Home branch" hint="The branch that follows up this customer’s offers" options={branchOptions} error={errors.homeBranchId?.message} {...register('homeBranchId')} />
        <div className="sm:col-span-2">
          <Select label="Preferred stylist (optional)" placeholder="No preference" options={staffOptions} {...register('preferredStaffId')} />
        </div>

        {/* Folded away when adding a customer, so saving without dates is quick */}
        <details className="rounded-lg border border-border px-3 py-2 sm:col-span-2" open={hasDates}>
          <summary className="cursor-pointer text-sm font-medium text-brown">Optional details: birthday and anniversary</summary>
          <div className="mt-3 grid gap-4 pb-1 sm:grid-cols-2">
            <OccasionDateFields label="Birthday (optional)" value={birthday} onChange={setBirthday} />
            <OccasionDateFields label="Wedding anniversary (optional)" value={anniversary} onChange={setAnniversary} />
            <p className="text-xs text-muted sm:col-span-2">Used for birthday and anniversary month offers. The year is never asked.</p>
          </div>
        </details>
        <div className="sm:col-span-2">
          <Textarea label="Notes (optional)" placeholder="e.g. allergic to ammonia, likes short hair" {...register('notes')} />
        </div>
      </form>
      <ConfirmDialog
        open={Boolean(confirmCorrection)}
        onClose={() => setConfirmCorrection(null)}
        onConfirm={() => {
          onSubmit(confirmCorrection, { confirmOfferChange: true });
          setConfirmCorrection(null);
        }}
        title="Review and confirm correction"
        message="This change alters current-month offer eligibility. The customer’s unused offer for this month will be replaced. Review and confirm correction."
        confirmLabel="Confirm correction"
      />
    </Modal>
  );
}
