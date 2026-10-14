import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useSaveStaff, useSetStaffStatus } from '../../api/staff';
import { useUsers } from '../../api/users';
import { isValidPhone } from '../../lib/phone';
import { Button, ConfirmDialog, Input, Modal, Select } from '../../components/ui';
import BlockingBookings from '../../components/BlockingBookings';

const ROLE_SUGGESTIONS = {
  SERVICE: ['Stylist', 'Senior Stylist', 'Barber', 'Beautician', 'Nail Artist', 'Makeup Artist'],
  FRONT_DESK: ['Receptionist', 'Front Desk Executive', 'Salon Manager'],
};
const KIND_OPTIONS = [
  { value: 'SERVICE', label: 'Service staff (can be booked)' },
  { value: 'FRONT_DESK', label: 'Front desk (never booked)' },
];

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  role: z.string().trim().min(2, 'Role is required'),
  phone: z.string().refine((v) => v.trim() === '' || isValidPhone(v), 'Enter a valid 10-digit mobile number'),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  branchId: z.string().min(1, 'Choose a branch'),
  kind: z.enum(['SERVICE', 'FRONT_DESK']),
  userId: z.string(), // '' = no linked login
});

// Add a team member (staff = null) or edit one, including activate / deactivate / archive.
// Front desk members can be linked to their front desk login.
export default function StaffFormModal({ staff, onClose }) {
  const { user, activeBranchId } = useAuth();
  const saveStaff = useSaveStaff();
  const setStatus = useSetStaffStatus();
  const [needsConfirm, setNeedsConfirm] = useState(null); // { status, message, bookings }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: staff?.name ?? '',
      role: staff?.role ?? 'Stylist',
      phone: staff?.phone ?? '',
      email: staff?.email ?? '',
      branchId: staff?.branchId ?? activeBranchId,
      kind: staff?.kind ?? 'SERVICE',
      userId: staff?.userId ?? '',
    },
  });

  const kind = watch('kind');
  const branchId = watch('branchId');
  const isFrontDesk = kind === 'FRONT_DESK';

  // Front desk logins of the chosen branch
  const usersQuery = useUsers();
  const logins = (usersQuery.data ?? []).filter(
    (u) => u.role === 'FRONT_DESK' && u.branchIds.some((b) => (b._id ?? b) === branchId)
  );

  // Switching type: swap a default job title for one that fits, and drop the login link for stylists
  function changeKind(e) {
    const next = e.target.value;
    setValue('kind', next);
    const role = watch('role');
    if (!role || ROLE_SUGGESTIONS[next === 'SERVICE' ? 'FRONT_DESK' : 'SERVICE'].includes(role)) {
      setValue('role', ROLE_SUGGESTIONS[next][0]);
    }
    if (next === 'SERVICE') setValue('userId', '');
  }

  function onSubmit(values) {
    saveStaff.mutate(
      { _id: staff?._id, ...values, userId: values.kind === 'FRONT_DESK' && values.userId ? values.userId : null },
      {
        onSuccess: () => {
          toast.success(staff ? 'Staff member updated' : 'Staff member added');
          onClose();
        },
      }
    );
  }

  // If the stylist has upcoming bookings the server says so first (409), and we ask the owner to confirm
  function changeStatus(status, confirm = false) {
    setStatus.mutate(
      { _id: staff._id, status, confirm },
      {
        onSuccess: () => {
          toast.success(`${staff.name} is now ${status}`);
          onClose();
        },
        onError: (err) => {
          if (err.code === 'HAS_FUTURE_BOOKINGS') setNeedsConfirm({ status, message: err.message, bookings: err.details });
          else toast.error(err.message);
        },
      }
    );
  }

  const statusButtons = staff && (
    <div className="mr-auto flex gap-2">
      {staff.status === 'active' ? (
        <Button variant="ghost" onClick={() => changeStatus('inactive')} disabled={setStatus.isPending}>
          Deactivate
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => changeStatus('active')} disabled={setStatus.isPending}>
          {staff.status === 'archived' ? 'Restore' : 'Activate'}
        </Button>
      )}
      {staff.status !== 'archived' && (
        <Button variant="ghost" onClick={() => changeStatus('archived')} disabled={setStatus.isPending}>
          Archive
        </Button>
      )}
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={staff ? `Edit ${staff.name}` : 'Add staff member'}
        footer={
          <>
            {statusButtons}
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="staff-form" loading={saveStaff.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form id="staff-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Select label="Type" options={KIND_OPTIONS} className="sm:col-span-2" {...register('kind')} onChange={changeKind} />
          <Input label="Name" error={errors.name?.message} {...register('name')} />
          <Input label="Job title" list="staff-roles" error={errors.role?.message} {...register('role')} />
          <datalist id="staff-roles">
            {ROLE_SUGGESTIONS[kind].map((role) => (
              <option key={role} value={role} />
            ))}
          </datalist>
          <Input label="Phone (optional)" error={errors.phone?.message} {...register('phone')} />
          <Input label="Email (optional)" type="email" error={errors.email?.message} {...register('email')} />
          <Select
            label="Branch"
            options={user.branches.map((b) => ({ value: b._id, label: b.name }))}
            error={errors.branchId?.message}
            {...register('branchId')}
          />
          {isFrontDesk && !usersQuery.isPending && (
            <Select
              label="Front desk login (optional)"
              placeholder="Not linked"
              options={logins.map((u) => ({ value: u._id, label: `${u.name} (${u.email})` }))}
              hint="Links this person to the login they use at the front desk"
              {...register('userId')}
            />
          )}
          {saveStaff.isError && <p className="text-sm text-danger sm:col-span-2">{saveStaff.error.message}</p>}
          {staff && (
            <Link to={`/app/payroll?staff=${staff._id}`} className="text-sm text-gold-dark hover:underline sm:col-span-2">
              See or change {staff.name}’s pay in Payroll →
            </Link>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(needsConfirm)}
        onClose={() => setNeedsConfirm(null)}
        onConfirm={() => changeStatus(needsConfirm.status, true)}
        loading={setStatus.isPending}
        danger
        title="This stylist has upcoming bookings"
        message={
          needsConfirm && (
            <>
              <p>{needsConfirm.message}</p>
              <BlockingBookings bookings={needsConfirm.bookings} />
            </>
          )
        }
        confirmLabel={needsConfirm?.status === 'archived' ? 'Archive anyway' : 'Deactivate anyway'}
      />
    </>
  );
}
