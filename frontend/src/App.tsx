import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './features/auth/pages/login-page';
import AuthCallbackPage from './features/auth/pages/auth-callback-page';
import AppLayout from './features/core/pages/app-layout';
import DashboardPage from './features/core/pages/dashboard-page';
import CampaignListPage from './features/campaign/pages/campaign-list-page';
import CampaignGraphPage from './features/campaign/pages/campaign-graph-page';
import { Toaster } from 'sonner';

// Functional Auth Guard
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  return token ? <>{children}</> : <Navigate to="/login" replace />;
};

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="dark" richColors />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* App Routes */}
        <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="campaigns" element={<CampaignListPage />} />
          <Route path="campaigns/:id" element={<CampaignGraphPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
