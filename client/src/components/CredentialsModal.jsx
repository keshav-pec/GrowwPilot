import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';
import { Button, Modal } from './ui';

// Shows a new login's temporary password once, with a copy button
export default function CredentialsModal({ credentials, onClose }) {
  if (!credentials) return null;

  const text = `GrowwPilot login\nURL: ${window.location.origin}/login\nEmail: ${credentials.email}\nTemporary password: ${credentials.temporaryPassword}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Login details copied');
    } catch {
      toast.error('Could not copy. Please select the text and copy it.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={credentials.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button onClick={copy}>
            <Copy size={16} /> Copy login details
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-muted">Share these details with them. The password is shown only once.</p>
      <pre className="whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm">{text}</pre>
    </Modal>
  );
}
