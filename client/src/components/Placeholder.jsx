import { Construction } from 'lucide-react';
import { EmptyState, PageHeader } from './ui';

// Stand-in page until the real screen is built.
export default function Placeholder({ title, subtitle, phase, message }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={Construction}
        title="Coming soon"
        message={message || `This screen will be built in Phase ${phase}.`}
      />
    </>
  );
}
