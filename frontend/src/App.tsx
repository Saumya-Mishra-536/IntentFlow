import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import AppLayout from './features/core/pages/app-layout';
import DashboardPage from './features/core/pages/dashboard-page';
import CampaignListPage from './features/campaign/pages/campaign-list-page';
import CampaignGraphPage from './features/campaign/pages/campaign-graph-page';
import { Toaster } from 'sonner';

// Temporary Mock Auth Guard
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  // In a real app, check AuthContext here
  const isAuthenticated = true; // Mocking auth for now
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" theme="dark" richColors />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<div className="min-h-screen bg-black flex items-center justify-center text-white">Login Page (Coming Soon)</div>} />

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
