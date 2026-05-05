import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import './App.css';
import { AdminRoute } from './shared/components/admin-route';
import { analytics_api } from './shared/lib/analytics';
import { useWebAnalytics } from './shared/hooks/use-web-analytics';

const AppLayout = lazy(() => import('./pages/app-layout'));
const AuthCallbackPage = lazy(() => import('./pages/auth-callback-page'));
const DashboardPage = lazy(() => import('./pages/dashboard-page'));
const ExtensionConnectPage = lazy(() => import('./pages/extension-connect-page'));
const OnboardingPage = lazy(() => import('./pages/onboarding-page'));
const WorkspacePage = lazy(() => import('./pages/workspace-page'));
const CampaignLayout = lazy(() => import('./pages/campaign-layout'));
const CampaignListPage = lazy(() => import('./pages/campaign-list-page'));
const SignInPage = lazy(() => import('./pages/sign-in-page'));
const AdminDashboardPage = lazy(() => import('./pages/admin-dashboard'));
const AdminUsersPage = lazy(() => import('./pages/admin-users-page'));
const AdminEventsPage = lazy(() => import('./pages/admin-events-page'));
const AdminSignalsPage = lazy(() => import('./pages/admin-signals-page'));

function RouteFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <span className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary/70" />
        Loading view...
      </span>
    </div>
  );
}

function SuspenseElement(props: { children: ReactNode }) {
  const { children } = props;
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function App() {
  useWebAnalytics();

  useEffect(() => {
    if (typeof performance === 'undefined') return;
    performance.mark('first_route_interactive');
    const app_boot = performance.getEntriesByName('app_boot_duration');
    const latest_boot = app_boot[app_boot.length - 1];
    if (!latest_boot || Math.random() >= 0.15) return;
    void analytics_api.track_event({
      event_name: 'web_perf_first_route_interactive',
      properties: {
        boot_duration_ms: Math.round(latest_boot.duration),
      },
    });
  }, []);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ── Public / standalone ── */}
        <Route path="/sign-in" element={<SuspenseElement><SignInPage /></SuspenseElement>} />
        <Route path="/auth/callback" element={<SuspenseElement><AuthCallbackPage /></SuspenseElement>} />
        <Route path="/extension/connect" element={<SuspenseElement><ExtensionConnectPage /></SuspenseElement>} />
        <Route path="/onboarding" element={<SuspenseElement><OnboardingPage /></SuspenseElement>} />

        {/* ── Protected — share one layout instance (sidebar never re-mounts) ── */}
        <Route element={<SuspenseElement><AppLayout /></SuspenseElement>}>
          <Route path="/" element={<SuspenseElement><DashboardPage /></SuspenseElement>} />
          <Route path="/workspace" element={<SuspenseElement><WorkspacePage /></SuspenseElement>} />

          {/* ── Admin Routes ── */}
          <Route path="/admin" element={<AdminRoute><SuspenseElement><AdminDashboardPage /></SuspenseElement></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><SuspenseElement><AdminUsersPage /></SuspenseElement></AdminRoute>} />
          <Route path="/admin/events" element={<AdminRoute><SuspenseElement><AdminEventsPage /></SuspenseElement></AdminRoute>} />
          <Route path="/admin/signals" element={<AdminRoute><SuspenseElement><AdminSignalsPage /></SuspenseElement></AdminRoute>} />

          {/* Campaign views share a fixed layout (chat sidebar + content outlet) */}
          <Route path="/campaign/:id" element={<SuspenseElement><CampaignLayout /></SuspenseElement>}>
            <Route path="graph" element={<Navigate to="../list" replace />} />
            <Route path="list" element={<SuspenseElement><CampaignListPage /></SuspenseElement>} />
            <Route path="prompts" element={<SuspenseElement><CampaignListPage /></SuspenseElement>} />
            <Route path="websites" element={<SuspenseElement><CampaignListPage /></SuspenseElement>} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
