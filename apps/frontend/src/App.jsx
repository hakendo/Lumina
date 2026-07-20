import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { Wordmark } from './components/ui';
import Mascot from './components/Mascot';
import { applyOrgTheme } from './lib/theme';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ReportBuilder = lazy(() => import('./pages/ReportBuilder'));
const Datasets = lazy(() => import('./pages/Datasets'));
const PublicReport = lazy(() => import('./pages/PublicReport'));
const ReportView = lazy(() => import('./pages/ReportView'));
const Explore = lazy(() => import('./pages/Explore'));
const Admin = lazy(() => import('./pages/Admin'));
const OrgAdmin = lazy(() => import('./pages/OrgAdmin'));
const Profile = lazy(() => import('./pages/Profile'));
const Changelog = lazy(() => import('./pages/Changelog'));

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen paper-bg gap-3">
      <Wordmark />
      <p className="text-ink-faint text-sm">Cargando…</p>
    </div>
  );
}

export default function App() {
  const { token, loadUser, user } = useAuthStore();

  useEffect(() => {
    if (token) loadUser();
  }, [token]);

  // Repinta los tokens visuales (color/tipografía) apenas cambie el tema de
  // la org activa: primer load, cambio de org (switchOrg recarga la página,
  // pero esto también cubre la sesión ya montada) o guardado en Apariencia.
  useEffect(() => {
    applyOrgTheme(user?.orgTheme);
  }, [user?.orgTheme]);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/public/:slug" element={<PublicReport />} />
          <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/report/:id" element={<RequireAuth><ReportBuilder /></RequireAuth>} />
          {/* Sin RequireAuth: Puppeteer entra con ?token= para el export PDF */}
          <Route path="/report/:id/view" element={<ReportView />} />
          <Route path="/datasets" element={<RequireAuth><Datasets /></RequireAuth>} />
          <Route path="/explore" element={<RequireAuth><Explore /></RequireAuth>} />
          {/* El rol se valida dentro de Admin (frontend) y en cada endpoint /admin (backend) */}
          <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
          <Route path="/org/admin" element={<RequireAuth><OrgAdmin /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/changelog" element={<RequireAuth><Changelog /></RequireAuth>} />
        </Routes>
        <Mascot />
      </Suspense>
    </BrowserRouter>
  );
}
