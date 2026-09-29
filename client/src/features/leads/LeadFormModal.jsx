import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useAuth } from '../../auth/AuthContext';
import { useAssignees, useSaveLead } from '../../api/leads';
import { useServices } from '../../api/catalog';
import { LEAD_SOURCES } from '../../lib/leads';
import { isValidPhone } from '../../lib/phone';
import { fromLocalInput, toLocalInput } from '../../lib/time';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';

const schema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().refine(isValidPhone, 'Enter a valid 10-digit mobile number'),
  source: z.string().min(1, 'Choose a source'),
  interestedServiceId: z.string(),
  assignedToUserId: z.string(),
  nextFollowUpAt: z.string(),
  note: z.string(),
});

// Add a lead (lead = null) or edit its details
export default function LeadFormModal({ lead, onClose }) {
  const { user, activeBranch } = useAuth();
  const zone = activeBranch.timezone;
  const saveLead = useSaveLead();
  const services = (useServices().data ?? []).filter((s) => s.status === 'active');
  const assignees = useAssignees().data ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: lead?.name ?? '',
      phone: lead?.phone ?? '',
      source: lead?.source ?? '',
      interestedServiceId: lead?.interestedServiceId?._id ?? '',
      assignedToUserId: lead?.assignedToUserId?._id ?? (lead ? '' : user._id), // new leads: assigned to me
      nextFollowUpAt: toLocalInput(lead?.nextFollowUpAt, zone),
      note: '',
    },
  });

  function onSubmit({ note, nextFollowUpAt, ...values }) {
    saveLead.mutate(
      {
        _id: lead?._id,
        ...values,
        nextFollowUpAt: fromLocalInput(nextFollowUpAt, zone),
        ...(lead ? {} : { note: note.trim() || undefined }),
      },
      {
        onSuccess: () => {
          toast.success(lead ? 'Lead updated' : 'Lead added');
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
      title={lead ? `Edit ${lead.name}` : 'Add lead'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={saveLead.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Name" error={errors.name?.message} {...register('name')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Select label="Source" placeholder="Where did they come from?" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} error={errors.source?.message} {...register('source')} />
        <Select label="Interested in" placeholder="Not sure yet" options={services.map((s) => ({ value: s._id, label: s.name }))} {...register('interestedServiceId')} />
        <Select label="Assigned to" placeholder="Nobody" options={assignees.map((u) => ({ value: u._id, label: u.name }))} {...register('assignedToUserId')} />
        <Input label="Next follow-up" type="datetime-local" {...register('nextFollowUpAt')} />
        {!lead && (
          <div className="sm:col-span-2">
            <Textarea label="First note (optional)" placeholder="e.g. Asked about bridal packages on Instagram" {...register('note')} />
          </div>
        )}
      </form>
    </Modal>
  );
}
