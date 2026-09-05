import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { TripDetailPage } from "./pages/TripDetailPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
