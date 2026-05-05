import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NewCampaignDialog } from '@/shared/components/new-campaign-dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from '@/shared/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';
import {
  BarChart3,
  ChevronRight,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Plus,
  Shield,
  Sparkles,
  UserCircle2,
  Users,
  Zap,
  Target,
  Globe,
} from 'lucide-react';
import { CampaignSummary, DomainSummary } from '@/shared/lib/auth';

interface UnifiedSidebarProps {
  campaigns: CampaignSummary[];
  domains: DomainSummary[];
  userEmail?: string;
  appRole?: string;
  onLogout: () => void;
}

export function UnifiedSidebar({ campaigns, domains, userEmail, appRole, onLogout }: UnifiedSidebarProps) {
  const location = useLocation();
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="bg-gradient-to-b from-sidebar via-sidebar to-sidebar/95"
      >
        {/* ── Logo / workspace header ── */}
        <SidebarHeader className="border-b border-sidebar-border/70 bg-sidebar/80 backdrop-blur">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-sm dark:from-sky-400 dark:to-cyan-400 dark:text-slate-950">
                    <FolderKanban className="size-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">Intent</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      {userEmail ?? 'Workspace'}
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {/* ── Primary nav ── */}
          <SidebarGroup>
            <SidebarGroupContent className="rounded-lg bg-sidebar-accent/20 p-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/'} tooltip="Dashboard" className="data-[active=true]:bg-sky-500/12 data-[active=true]:text-sky-700 dark:data-[active=true]:bg-sky-500/15 dark:data-[active=true]:text-sky-300">
                    <Link to="/">
                      <LayoutDashboard />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {appRole !== 'admin' && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/workspace'} tooltip="Domain" className="data-[active=true]:bg-sky-500/12 data-[active=true]:text-sky-700 dark:data-[active=true]:bg-sky-500/15 dark:data-[active=true]:text-sky-300">
                      <Link to="/workspace">
                        <Globe />
                        <span>Domain</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {appRole === 'admin' && (
                  <Collapsible
                    asChild
                    defaultOpen={location.pathname.startsWith('/admin')}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          tooltip="Admin Tools"
                          isActive={location.pathname.startsWith('/admin')}
                        >
                          <Shield />
                          <span>Admin Control</span>
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={location.pathname === '/admin'}
                            >
                              <Link to="/admin">
                                <LayoutDashboard />
                                <span>Overview</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={location.pathname === '/admin/users'}
                            >
                              <Link to="/admin/users">
                                <Users />
                                <span>Users & Leads</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={location.pathname === '/admin/events'}
                            >
                              <Link to="/admin/events">
                                <Zap />
                                <span>Analytics Events</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={location.pathname === '/admin/signals'}
                            >
                              <Link to="/admin/signals">
                                <Target />
                                <span>Intent Signals</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="bg-sidebar-border/70" />

          {/* ── Campaigns — hidden for admins ── */}
          {appRole !== 'admin' && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-[11px] tracking-wide text-sidebar-foreground/70">Campaigns</SidebarGroupLabel>
              <SidebarGroupContent className="rounded-lg bg-sidebar-accent/20 p-1">
                <SidebarMenu>
                  {campaigns.slice(0, 8).map((campaign) => (
                    <Collapsible
                      key={campaign.id}
                      asChild
                      defaultOpen={location.pathname.startsWith(`/campaign/${campaign.id}/`)}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            tooltip={campaign.name}
                            isActive={location.pathname.startsWith(`/campaign/${campaign.id}/`)}
                            className="data-[active=true]:bg-sky-500/12 data-[active=true]:text-sky-700 dark:data-[active=true]:bg-sky-500/15 dark:data-[active=true]:text-sky-300"
                          >
                            <FileText />
                            <span>{campaign.name}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location.pathname === `/campaign/${campaign.id}/list`}
                                className="data-[active=true]:bg-cyan-500/12 data-[active=true]:text-cyan-700 dark:data-[active=true]:bg-cyan-500/15 dark:data-[active=true]:text-cyan-300"
                              >
                                <Link to={`/campaign/${campaign.id}/list`}>
                                  <Sparkles />
                                  <span>Pipeline</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location.pathname === `/campaign/${campaign.id}/prompts`}
                                className="data-[active=true]:bg-cyan-500/12 data-[active=true]:text-cyan-700 dark:data-[active=true]:bg-cyan-500/15 dark:data-[active=true]:text-cyan-300"
                              >
                                <Link to={`/campaign/${campaign.id}/prompts`}>
                                  <ListOrdered />
                                  <span>Prompts</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location.pathname === `/campaign/${campaign.id}/websites`}
                                className="data-[active=true]:bg-cyan-500/12 data-[active=true]:text-cyan-700 dark:data-[active=true]:bg-cyan-500/15 dark:data-[active=true]:text-cyan-300"
                              >
                                <Link to={`/campaign/${campaign.id}/websites`}>
                                  <Globe />
                                  <span>Websites</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  ))}

                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="New Campaign"
                      className="bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/18 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/22"
                      onClick={() => setNewCampaignOpen(true)}
                    >
                      <Plus />
                      <span>New Campaign</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          <SidebarSeparator className="bg-sidebar-border/70" />

          {/* ── Tools ── */}
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] tracking-wide text-sidebar-foreground/70">Tools</SidebarGroupLabel>
            <SidebarGroupContent className="rounded-lg bg-sidebar-accent/20 p-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    disabled
                    tooltip="Analytics — Coming Soon"
                    className="opacity-50"
                  >
                    <BarChart3 />
                    <span>Analytics</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* ── User / logout footer ── */}
        <SidebarFooter className="border-t border-sidebar-border/70 bg-sidebar/80">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="pointer-events-none"
                tooltip={userEmail ?? 'Account'}
              >
                <UserCircle2 className="size-8" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{userEmail ?? 'No account'}</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Account</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onLogout} tooltip="Log out">
                <LogOut />
                <span>Log out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <NewCampaignDialog open={newCampaignOpen} onOpenChange={setNewCampaignOpen} domains={domains} />
    </>
  );
}
