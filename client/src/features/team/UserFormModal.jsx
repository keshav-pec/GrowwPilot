import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useResetPassword, useSaveUser, useSetUserStatus } from '../../api/users';
import { isValidPhone } from '../../lib/phone';
import { Button, Input, Modal, Select } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

const baseSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.email('Enter a valid email'),
  phone: z.string().refine((v) => v.trim() === '' || isValidPhone(v), 'Enter a valid 10-digit mobile number'),
});

// Front desk: one branch. Branch owner: one or more branches.
const schemas = {
  FRONT_DESK: baseSchema.extend({ branchId: z.string().min(1, 'Choose a branch') }),
  OWNER: baseSchema.extend({ branchIds: z.array(z.string()).min(1, 'Choose at least one branch') }),
};

const LABEL = { FRONT_DESK: 'front desk account', OWNER: 'branch owner' };

// Add or edit a login (front desk or branch owner). New logins get a temporary password.
export default function UserFormModal({ role, account, onClose, onCredentials }) {
  const { user, activeBranchId } = useAuth();
  const saveUser = useSaveUser();
  const setStatus = useSetUserStatus();
  const resetPassword = useResetPassword();

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
    },
  });

  function onSubmit({ name, email, phone, branchId, branchIds }) {
    const branches = role === 'FRONT_DESK' ? [branchId] : branchIds;
    const values = account
      ? { _id: account._id, name, phone, branchIds: branches } // email is the login: not editable
      : { role, name, email, phone, branchIds: branches };

    saveUser.mutate(values, {
      onSuccess: (data) => {
        if (account) {
          toast.success('Saved');
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

        {role === 'FRONT_DESK' ? (
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

        {saveUser.isError && <p className="text-sm text-danger sm:col-span-2">{saveUser.error.message}</p>}
      </form>
    </Modal>
  );
}
