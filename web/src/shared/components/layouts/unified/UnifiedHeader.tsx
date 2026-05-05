import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Moon, Sun, MessageSquare, Plus, Globe } from 'lucide-react';
import { AccountMembership, auth_storage, create_domain, DomainSummary } from '@/shared/lib/auth';
import { NewCampaignDialog } from '@/shared/components/new-campaign-dialog';
import { toast } from 'sonner';

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setDark(next);
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} className="h-8 w-8">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

interface UnifiedHeaderProps {
  breadcrumbs?: { label: string; href?: string }[];
  memberships?: AccountMembership[];
  activeTenantId?: string;
  onSwitchAccount?: (tenant_id: string) => Promise<void>;
  domains?: DomainSummary[];
  selectedDomainId?: string;
  onDomainChange?: (domain_id?: string) => void;
  onRefreshData?: () => Promise<void>;
}

export function UnifiedHeader({
  breadcrumbs = [],
  memberships = [],
  activeTenantId,
  onSwitchAccount,
  domains = [],
  selectedDomainId,
  onDomainChange,
  onRefreshData,
}: UnifiedHeaderProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [switching, setSwitching] = useState(false);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [domainUrl, setDomainUrl] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);
  const isChatPage = /\/(graph|list)$/.test(location.pathname);

  const chatOpen = searchParams.get('chat') !== '0';
  const toggleChat = () => {
    if (chatOpen) {
      searchParams.set('chat', '0');
    } else {
      searchParams.delete('chat');
    }
    setSearchParams(searchParams, { replace: true });
  };

  const handleSwitchAccount = async (tenant_id: string) => {
    if (!onSwitchAccount || !tenant_id || tenant_id === activeTenantId) return;
    setSwitching(true);
    try {
      await onSwitchAccount(tenant_id);
    } finally {
      setSwitching(false);
    }
  };

  const handleAddDomain = async () => {
    const access_token = auth_storage.get_access_token();
    if (!access_token) {
      toast.error('Sign in again to add a domain');
      return;
    }
    const value = domainUrl.trim();
    if (!value) {
      toast.error('Domain URL is required');
      return;
    }

    setDomainSaving(true);
    try {
      await create_domain(access_token, value);
      toast.success('Domain added');
      setAddDomainOpen(false);
      setDomainUrl('');
      if (onRefreshData) {
        await onRefreshData();
      } else {
        window.location.reload();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add domain');
    } finally {
      setDomainSaving(false);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />

      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1.5">
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {!isLast && <BreadcrumbSeparator />}
              </span>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1">
        {domains.length ? (
          <select
            className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-xs"
            value={selectedDomainId ?? domains[0]?.domain_id ?? ''}
            onChange={(event) => onDomainChange?.(event.target.value || undefined)}
            title="Switch domain scope"
          >
            {domains.map((domain) => (
              <option key={domain.domain_id} value={domain.domain_id}>
                {domain.display_domain || domain.normalized_domain}
              </option>
            ))}
          </select>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setAddDomainOpen(true)}
        >
          <Globe className="h-3.5 w-3.5" />
          Add Domain
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setNewCampaignOpen(true)}
          disabled={domains.length === 0}
          title={domains.length === 0 ? 'Add a domain first' : 'Create campaign'}
        >
          <Plus className="h-3.5 w-3.5" />
          New Campaign
        </Button>

        {memberships.length > 1 ? (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            onChange={(event) => void handleSwitchAccount(event.target.value)}
            value={activeTenantId ?? memberships[0]?.tenant_id ?? ''}
            disabled={switching}
          >
            {memberships.map((membership) => (
              <option key={membership.tenant_id} value={membership.tenant_id}>
                {membership.name}
              </option>
            ))}
          </select>
        ) : null}

        {isChatPage && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleChat}
            className={`h-8 w-8 transition-colors ${chatOpen ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary' : 'text-muted-foreground'}`}
            title={chatOpen ? 'Hide Chat History' : 'Show Chat History'}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="sr-only">Toggle chat history</span>
          </Button>
        )}
        <ThemeToggle />
      </div>

      <Dialog open={addDomainOpen} onOpenChange={setAddDomainOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Add a domain to use in campaign creation and context scraping.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="header-domain-url">Domain URL</Label>
            <Input
              id="header-domain-url"
              placeholder="https://example.com"
              value={domainUrl}
              onChange={(event) => setDomainUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleAddDomain();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddDomainOpen(false)} disabled={domainSaving}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddDomain()} disabled={domainSaving || !domainUrl.trim()}>
              {domainSaving ? 'Adding…' : 'Add Domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewCampaignDialog open={newCampaignOpen} onOpenChange={setNewCampaignOpen} domains={domains} />
    </header>
  );
}
