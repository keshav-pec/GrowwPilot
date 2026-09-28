import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { CheckCircle2, Copy } from 'lucide-react';
import { useCreateOrg } from '../../api/admin';
import { PLANS, TIMEZONES } from '../../lib/constants';
import { isValidPhone } from '../../lib/phone';
import { Button, Card, Input, PageHeader, Select } from '../../components/ui';

const schema = z.object({
  name: z.string().trim().min(2, 'Salon name is required'),
  city: z.string().trim().min(2, 'City is required'),
  plan: z.string(),
  ownerName: z.string().trim().min(2, 'Owner name is required'),
  ownerEmail: z.email('Enter a valid email'),
  ownerPhone: z.string().refine((v) => v.trim() === '' || isValidPhone(v), 'Enter a valid 10-digit mobile number'),
  branchName: z.string().trim().min(2, 'Branch name is required'),
  branchAddress: z.string(),
  timezone: z.string(),
});

const defaultValues = {
  name: '',
  city: '',
  plan: 'trial',
  ownerName: '',
  ownerEmail: '',
  ownerPhone: '',
  branchName: '',
  branchAddress: '',
  timezone: 'Asia/Kolkata',
};

export default function NewSalonPage() {
  const navigate = useNavigate();
  const createOrg = useCreateOrg();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  // After onboarding: show the owner's login details once
  if (createOrg.isSuccess) {
    const { org, ownerEmail, temporaryPassword } = createOrg.data;
    const loginText = `GrowwPilot login for ${org.name}\nURL: ${window.location.origin}/login\nEmail: ${ownerEmail}\nTemporary password: ${temporaryPassword}`;

    async function copyDetails() {
      try {
        await navigator.clipboard.writeText(loginText);
        toast.success('Login details copied');
      } catch {
        toast.error('Could not copy. Please select the text and copy it.');
      }
    }

    return (
      <>
        <PageHeader title="Salon onboarded" />
        <Card className="max-w-lg">
          <div className="mb-4 flex items-center gap-2 text-brown">
            <CheckCircle2 size={22} />
            <p className="font-semibold">{org.name} is ready</p>
          </div>
          <p className="mb-2 text-sm text-muted">
            Share these login details with the owner. The password is shown only once.
          </p>
          <pre className="mb-4 whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm">{loginText}</pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copyDetails}>
              <Copy size={16} /> Copy owner login details
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/admin/salons/${org._id}`)}>
              View salon
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                createOrg.reset();
                reset(defaultValues);
              }}
            >
              Onboard another
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Onboard a salon" subtitle="Creates the salon, its first branch and the owner's login." />

      <form onSubmit={handleSubmit((values) => createOrg.mutate(values))} className="flex max-w-3xl flex-col gap-4" noValidate>
        <Card title="Salon">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Salon name" error={errors.name?.message} {...register('name')} />
            <Input label="City" error={errors.city?.message} {...register('city')} />
            <Select label="Plan" options={PLANS} {...register('plan')} />
          </div>
        </Card>

        <Card title="Owner">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Owner name" error={errors.ownerName?.message} {...register('ownerName')} />
            <Input label="Owner email" type="email" hint="Used to log in" error={errors.ownerEmail?.message} {...register('ownerEmail')} />
            <Input label="Owner phone (optional)" error={errors.ownerPhone?.message} {...register('ownerPhone')} />
          </div>
        </Card>

        <Card title="First branch">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Branch name" placeholder="e.g. Andheri" error={errors.branchName?.message} {...register('branchName')} />
            <Select label="Timezone" options={TIMEZONES} {...register('timezone')} />
            <div className="sm:col-span-2">
              <Input label="Address (optional)" {...register('branchAddress')} />
            </div>
          </div>
        </Card>

        {createOrg.isError && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{createOrg.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button type="submit" loading={createOrg.isPending}>
            Onboard salon
          </Button>
          <Button variant="secondary" onClick={() => navigate('/admin/salons')}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
