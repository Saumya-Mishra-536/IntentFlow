import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { UnifiedDashboardLayout } from '@/shared/components/layouts/unified/UnifiedDashboardLayout';
import { useProjectData, ProjectUser } from '@/shared/hooks/use-project-data';
import { AccountMembership, CampaignWithTree, DomainSummary, OnboardingContext } from '@/shared/lib/auth';
import { Loader2 } from 'lucide-react';

// ─── Outlet context type — available to all child pages ──────────────────────
export interface AppLayoutContext {
    user: ProjectUser;
    projectsData: CampaignWithTree[];
    selectedDomainId?: string;
    domains: DomainSummary[];
    memberships: AccountMembership[];
    onboardingContext: OnboardingContext | null;
    setSelectedDomainId: (domain_id?: string) => void;
    switchAccountAndReload: (tenant_id: string) => Promise<void>;
    reloadProjectData: () => Promise<void>;
    handleLogout: () => Promise<void>;
}

// ─── Auto-generate breadcrumbs from the current URL ──────────────────────────
function useBreadcrumbs(pathname: string, projectsData: CampaignWithTree[]) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return [{ label: 'Dashboard' }];

    const crumbs: { label: string; href?: string }[] = [{ label: 'Dashboard', href: '/' }];

    if (parts[0] === 'campaign' && parts[1]) {
        const project = projectsData.find(p => p.project.id === parts[1]);
        const name = project?.project.name ?? 'Campaign';
        crumbs.push({ label: name, href: `/campaign/${parts[1]}/list` });
        if (parts[2]) crumbs.push({ label: parts[2].charAt(0).toUpperCase() + parts[2].slice(1) });
    }

    return crumbs;
}

// ─── Root protected layout — mounts once, Outlet swaps content ───────────────
export default function AppLayout() {
    const location = useLocation();
    const [selectedDomainId, setSelectedDomainIdState] = useState<string | undefined>(() => {
        if (typeof window === 'undefined') return undefined;
        const stored = window.localStorage.getItem('ai_seo_selected_domain_id');
        return stored || undefined;
    });
    const { loading, user, projectsData, domains, memberships, onboardingContext, switchAccountAndReload, reloadProjectData, handleLogout } = useProjectData(selectedDomainId);

    const noPadding = /\/campaign\/[^/]+(\/graph|\/list)?$/.test(location.pathname);
    const breadcrumbs = useBreadcrumbs(location.pathname, projectsData);

    const normalizedSelectedDomainId = useMemo(() => {
        if (!domains.length) return undefined;
        if (selectedDomainId && domains.some((domain) => domain.domain_id === selectedDomainId)) {
            return selectedDomainId;
        }
        return domains[0]?.domain_id;
    }, [domains, selectedDomainId]);

    useEffect(() => {
        if (normalizedSelectedDomainId !== selectedDomainId) {
            setSelectedDomainIdState(normalizedSelectedDomainId);
        }
        if (typeof window !== 'undefined') {
            if (normalizedSelectedDomainId) window.localStorage.setItem('ai_seo_selected_domain_id', normalizedSelectedDomainId);
            else window.localStorage.removeItem('ai_seo_selected_domain_id');
        }
    }, [normalizedSelectedDomainId, selectedDomainId]);

    const setSelectedDomainId = (domain_id?: string) => {
        setSelectedDomainIdState(domain_id);
        if (typeof window !== 'undefined') {
            if (domain_id) window.localStorage.setItem('ai_seo_selected_domain_id', domain_id);
            else window.localStorage.removeItem('ai_seo_selected_domain_id');
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) return <Navigate to="/sign-in" replace />;
    if (onboardingContext?.needs_onboarding && user.app_role !== 'admin') return <Navigate to="/onboarding" replace />;
    if (location.pathname === '/' && projectsData.length === 0 && user.app_role !== 'admin') return <Navigate to="/workspace" replace />;
    // Redirect admin users landing on the root path to the admin dashboard
    if (user.app_role === 'admin' && location.pathname === '/') return <Navigate to="/admin" replace />;

    const context: AppLayoutContext = {
        user,
        projectsData,
        selectedDomainId: normalizedSelectedDomainId,
        domains,
        memberships,
        onboardingContext,
        setSelectedDomainId,
        switchAccountAndReload,
        reloadProjectData,
        handleLogout,
    };

    return (
        <UnifiedDashboardLayout
            campaigns={projectsData.map(p => p.project)}
            domains={domains}
            memberships={memberships}
            activeTenantId={onboardingContext?.active_account?.tenant_id}
            onSwitchAccount={switchAccountAndReload}
            onRefreshData={reloadProjectData}
            selectedDomainId={normalizedSelectedDomainId}
            onDomainChange={setSelectedDomainId}
            userEmail={user.email}
            appRole={user.app_role}
            onLogout={handleLogout}
            breadcrumbs={breadcrumbs}
            noPadding={noPadding}
        >
            <Outlet context={context} />
        </UnifiedDashboardLayout>
    );
}
