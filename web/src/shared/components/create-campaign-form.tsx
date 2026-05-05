import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { ai_chat_provider, auth_storage, create_campaign, DomainSummary, link_campaign_chat_thread } from '@/shared/lib/auth';
import { toast } from 'sonner';

interface CreateCampaignFormProps {
  domains: DomainSummary[];
  onCancel?: () => void;
  onSuccess?: () => void;
}

import chatgptLogo from '/chatgpt.svg';
import claudeLogo from '/claude.svg';
import geminiLogo from '/gemini-light.svg';
import perplexityLogo from '/perplexity.svg';
import grokLogo from '/grok-(xai).svg';

const provider_options: Array<{ id: ai_chat_provider; label: string; logo: string }> = [
  { id: 'chatgpt', label: 'ChatGPT', logo: chatgptLogo },
  { id: 'claude', label: 'Claude', logo: claudeLogo },
  { id: 'gemini', label: 'Gemini', logo: geminiLogo },
  { id: 'perplexity', label: 'Perplexity', logo: perplexityLogo },
  { id: 'grok', label: 'Grok', logo: grokLogo },
];

export function CreateCampaignForm({ domains, onCancel, onSuccess }: CreateCampaignFormProps) {
  const navigate = useNavigate();
  const [domain_id, set_domain_id] = useState(domains[0]?.domain_id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [target_location, set_target_location] = useState('');
  const [industry_tag, set_industry_tag] = useState('');
  const [business_type, set_business_type] = useState('');
  const [primary_goal, set_primary_goal] = useState('');
  const [start_provider, set_start_provider] = useState<ai_chat_provider | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start_provider) {
      toast.error('Select a provider to start with');
      return;
    }
    if (!domain_id) {
      toast.error('Select a domain');
      return;
    }
    setLoading(true);
    try {
      const token = auth_storage.get_access_token();
      if (!token) throw new Error('No access token');
      const created = await create_campaign(token, {
        domain_id,
        name,
        description: description.trim() || undefined,
        target_location: target_location.trim() || undefined,
        industry_tag: industry_tag.trim() || undefined,
        business_type: business_type.trim() || undefined,
        primary_goal: primary_goal.trim() || undefined,
      });
      await link_campaign_chat_thread(token, created.id, undefined, { chat_provider: start_provider });
      toast.success('Campaign created successfully');
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = '/';
      }
    } catch (error) {
      toast.error('Failed to create campaign');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    } else {
      navigate(-1);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="domain_id">Domain</Label>
        <select
          id="domain_id"
          value={domain_id}
          onChange={(e) => set_domain_id(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          required
        >
          <option value="" disabled>Select domain</option>
          {domains.map((domain) => (
            <option key={domain.domain_id} value={domain.domain_id}>
              {domain.normalized_domain}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proj-name">Campaign Name</Label>
        <Input
          id="proj-name"
          placeholder="e.g. My SaaS Blog"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="proj-desc">Description (optional)</Label>
        <Input
          id="proj-desc"
          placeholder="Brief description..."
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target-location">Target Location</Label>
          <Input
            id="target-location"
            placeholder="e.g. US, UK, Global"
            value={target_location}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set_target_location(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="industry-tag">Industry</Label>
          <Input
            id="industry-tag"
            placeholder="e.g. SaaS, E-commerce"
            value={industry_tag}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set_industry_tag(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="business-type">Business Type</Label>
          <Input
            id="business-type"
            placeholder="e.g. B2B, B2C, Agency"
            value={business_type}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set_business_type(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="primary-goal">Primary Goal</Label>
          <Input
            id="primary-goal"
            placeholder="e.g. Lead Gen, Brand Awareness"
            value={primary_goal}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set_primary_goal(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Start with provider</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {provider_options.map((provider) => {
            const is_selected = start_provider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => set_start_provider(provider.id)}
                className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition-colors ${is_selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background hover:bg-muted/40'}`}
                aria-pressed={is_selected}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded bg-background">
                  <img src={provider.logo} alt={provider.label} className="h-4 w-4 object-contain" />
                </span>
                <span className="truncate">{provider.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" type="button" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create Campaign'}
        </Button>
      </div>
    </form>
  );
}
