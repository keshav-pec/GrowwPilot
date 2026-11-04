import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useResetPassword, useSaveUser, useSetUserStatus } from '../../api/users';
import { useAuthOptions, useEmailPasswordLink } from '../../api/passwords';
import { isValidPhone } from '../../lib/phone';
import { Button, Input, Modal, Select } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

const baseSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.email('Enter a valid email'),
  phone: z.string().refine((v) => v.trim() === '' || isValidPhone(v), 'Enter a valid 10-digit mobile number'),
  sendPasswordEmail: z.boolean().optional(),
});

// Front desk and inventory: one branch. Branch owner: one or more branches.
const oneBranchSchema = baseSchema.extend({ branchId: z.string().min(1, 'Choose a branch') });
const schemas = {
  FRONT_DESK: oneBranchSchema,
  INVENTORY: oneBranchSchema,
  OWNER: baseSchema.extend({ branchIds: z.array(z.string()).min(1, 'Choose at least one branch') }),
};

const LABEL = { FRONT_DESK: 'front desk account', INVENTORY: 'inventory login', OWNER: 'branch owner' };

// Add or edit a login (front desk, inventory or branch owner). New logins get a temporary password.
export default function UserFormModal({ role, account, onClose, onCredentials }) {
  const { user, activeBranchId } = useAuth();
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const resetPassword = useResetPassword();
  const emailLink = useEmailPasswordLink();
  const canEmail = Boolean(useAuthOptions().data?.passwordEmails); // email is on

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schemas[role]),
    defaultValues: {
      name: account?.name ?? '',
      email: account?.email ?? '',
      phone: account?.phone ?? '',
      branchId: account?.branchIds[0]?._id ?? activeBranchId,
      branchIds: account?.branchIds.map((b) => b._id) ?? [],
      sendPasswordEmail: true,
    },
  });

  function onSubmit({ name, email, phone, branchId, branchIds, sendPasswordEmail }) {
    const branches = role === 'OWNER' ? branchIds : [branchId];
    const values = account
      ? { _id: account._id, name, phone, branchIds: branches } // email is the login: not editable
      : { role, name, email, phone, branchIds: branches, sendPasswordEmail: canEmail && sendPasswordEmail };

    saveUser.mutate(values, {
      onSuccess: (data) => {
        if (account) {
          toast.success('Saved');
          onClose();
        } else if (data.emailed) {
          toast.success(`${name} can now log in. We’ve emailed ${data.user.email} a link to set their password.`);
          onClose();
        } else {
          onClose();
          onCredentials({ title: `${name} can now log in`, email: data.user.email, temporaryPassword: data.temporaryPassword });
        }
      },
    });
  }

  function handleReset() {
    resetPassword.mutate(account._id, {
      onSuccess: (data) => {
        onClose();
        onCredentials({ title: `New password for ${account.name}`, ...data });
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function handleEmailLink() {
    emailLink.mutate(account._id, {
      onSuccess: (data) => {
        toast.success(`We’ve emailed ${data.email} a link to set their password (valid 48 hours)`);
        onClose();
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function toggleStatus() {
    const status = account.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { _id: account._id, status },
      {
        onSuccess: () => {
          toast.success(status === 'inactive' ? `${account.name} can no longer log in` : `${account.name} can log in again`);
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
      title={account ? `Edit ${account.name}` : `Add ${LABEL[role]}`}
      footer={
        <>
          {account && (
            <div className="mr-auto flex gap-2">
              <Button variant="ghost" onClick={handleReset} loading={resetPassword.isPending}>
                Reset password
              </Button>
              {canEmail && account.status === 'active' && (
                <Button variant="ghost" onClick={handleEmailLink} loading={emailLink.isPending}>
                  Email a password link
                </Button>
              )}
              <Button variant="ghost" onClick={toggleStatus} loading={setStatus.isPending}>
                {account.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={saveUser.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" error={errors.name?.message} {...register('name')} />
        <Input
          label="Email (login)"
          type="email"
          readOnly={Boolean(account)} // readOnly (not disabled) so the form still has the value
          className={account ? 'bg-surface text-muted' : ''}
          error={errors.email?.message}
          {...register('email')}
        />
        <Input label="Phone (optional)" error={errors.phone?.message} {...register('phone')} />

        {role !== 'OWNER' ? (
          <Select
            label="Branch"
            options={user.branches.map((b) => ({ value: b._id, label: b.name }))}
            error={errors.branchId?.message}
            {...register('branchId')}
          />
        ) : (
          <div className="sm:col-span-2">
            <Controller
              name="branchIds"
              control={control}
              render={({ field }) => (
                <CheckboxList
                  label="Branches they manage"
                  items={user.branches}
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.branchIds?.message}
                />
              )}
            />
          </div>
        )}

        {!account && canEmail && (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-gold" {...register('sendPasswordEmail')} />
            <span>
              Email them a link to set their password
              <span className="block text-xs text-muted">Untick to get a temporary password to share yourself instead.</span>
            </span>
          </label>
        )}
        {saveUser.isError && <p className="text-sm text-danger sm:col-span-2">{saveUser.error.message}</p>}
      </form>
    </Modal>
  );
}
