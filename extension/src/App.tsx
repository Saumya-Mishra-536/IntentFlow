import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthPage from './pages/AuthPage';
import AuthCallback from './pages/AuthCallback';
import Dashboard from './pages/Dashboard';
import WorkflowPage from './pages/WorkflowPage';
import PromptDetailPage from './pages/PromptDetailPage';
import WorkflowQueuePage from './pages/WorkflowQueuePage';
import { useEffect, useState } from 'react';
import { extension_auth } from './lib/auth';
import { useExtensionAnalytics } from './hooks/use-extension-analytics';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsAuth(extension_auth.get_auth_status());
    setLoading(false);
  }, []);

  if (loading) {
    return <div className="flex h-dvh w-full items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>;
  }

  return isAuth ? <>{children}</> : <Navigate to="/" replace />;
}

function App() {
  useExtensionAnalytics();

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/auth-callback" element={<AuthCallback />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/visualization/:sessionId"
          element={
            <ProtectedRoute>
              <WorkflowPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/visualization/:sessionId/prompts/:promptId"
          element={
            <ProtectedRoute>
              <PromptDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/visualization/:sessionId/queue"
          element={
            <ProtectedRoute>
              <WorkflowQueuePage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </HashRouter>
  );
}

export default App;
