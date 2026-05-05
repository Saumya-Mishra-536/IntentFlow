import { SidebarInset, SidebarProvider } from '@/shared/components/ui/sidebar';
import { AccountMembership, CampaignSummary, DomainSummary } from '@/shared/lib/auth';
import { cn } from '@/shared/lib/utils';
import { UnifiedHeader } from './UnifiedHeader';
import { UnifiedSidebar } from './UnifiedSidebar';

interface UnifiedDashboardLayoutProps {
  children: React.ReactNode;
  campaigns?: CampaignSummary[];
  domains?: DomainSummary[];
  selectedDomainId?: string;
  memberships?: AccountMembership[];
  activeTenantId?: string;
  onSwitchAccount?: (tenant_id: string) => Promise<void>;
  onRefreshData?: () => Promise<void>;
  onDomainChange?: (domain_id?: string) => void;
  userEmail?: string;
  appRole?: string;
  onLogout: () => void;
  breadcrumbs?: { label: string; href?: string }[];
  noPadding?: boolean;
}

export function UnifiedDashboardLayout({
  children,
  campaigns = [],
  domains = [],
  selectedDomainId,
  memberships = [],
  activeTenantId,
  onSwitchAccount,
  onRefreshData,
  onDomainChange,
  userEmail,
  appRole,
  onLogout,
  breadcrumbs,
  noPadding = false,
}: UnifiedDashboardLayoutProps) {
  return (
    <SidebarProvider>
      <UnifiedSidebar
        campaigns={campaigns}
        domains={domains}
        userEmail={userEmail}
        appRole={appRole}
        onLogout={onLogout}
      />
      <SidebarInset>
        {/* Inner flex column fills the viewport height so the graph page can use h-full */}
        <div className="flex h-svh flex-col">
          <UnifiedHeader
            breadcrumbs={breadcrumbs}
            memberships={memberships}
            activeTenantId={activeTenantId}
            onSwitchAccount={onSwitchAccount}
            domains={domains}
            onRefreshData={onRefreshData}
            selectedDomainId={selectedDomainId}
            onDomainChange={onDomainChange}
          />
          <div
            className={cn(
              'min-h-0 flex-1',
              noPadding
                ? 'overflow-hidden'
                : 'overflow-y-auto p-4 md:p-6',
            )}
          >
            {noPadding ? (
              children
            ) : (
              <div className="animate-rise-in mx-auto flex w-full max-w-[1600px] flex-col gap-4">
                {children}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
