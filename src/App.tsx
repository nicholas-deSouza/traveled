import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { TripDetailPage } from "./pages/TripDetailPage";
import { GroupsPage } from './pages/GroupsPage';
import { JoinGroupPage } from './pages/JoinGroupPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { PasswordPage } from './pages/PasswordPage';
import { RequireAuth } from './components/auth/RequireAuth';
import { isSupabaseConfigured } from './lib/supabase';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        {!isSupabaseConfigured && <Route path="/" element={<div className="py-12"><h1 className="font-display text-4xl">Connect your shared atlas</h1><p className="mt-3">Set up Supabase and apply the database migrations to see your trips. Follow README for local setup.</p></div>} />}
        <Route element={<RequireAuth />}>
          {isSupabaseConfigured && <Route path="/" element={<DashboardPage />} />}
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:groupId" element={<GroupDetailPage />} />
          <Route path="/trips/:tripId" element={<TripDetailPage />} />
          <Route path="/join" element={<JoinGroupPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/account/password" element={<PasswordPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
