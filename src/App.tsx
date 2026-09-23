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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
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
