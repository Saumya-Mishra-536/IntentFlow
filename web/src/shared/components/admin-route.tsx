import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { auth_storage } from '../lib/auth';

export function AdminRoute({ children }: { children: ReactNode }) {
    const user = auth_storage.get_user();

    // If not logged in, redirect to login
    if (!user) {
        return <Navigate to="/sign-in" replace />;
    }

    // Unprivileged users are gracefully blocked and redirected to the home dashboard
    if (user.app_role !== 'admin') {
        return <Navigate to="/" replace />;
    }

    return <>{children}</>;
}
