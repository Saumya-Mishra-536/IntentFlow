import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { CreateCampaignForm } from './create-campaign-form';
import { DomainSummary } from '@/shared/lib/auth';

interface NewCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domains: DomainSummary[];
}

export function NewCampaignDialog({ open, onOpenChange, domains }: NewCampaignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription>
            Create a new campaign to capture and analyze AI search prompts.
          </DialogDescription>
        </DialogHeader>
        <CreateCampaignForm
          domains={domains}
          onCancel={() => onOpenChange(false)}
          onSuccess={() => {
            onOpenChange(false);
            window.location.reload();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
