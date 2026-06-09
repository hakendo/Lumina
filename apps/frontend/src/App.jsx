import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ReportBuilder from './pages/ReportBuilder';
import Datasets from './pages/Datasets';
import PublicReport from './pages/PublicReport';
import Explore from './pages/Explore';

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { token, loadUser } = useAuthStore();

  useEffect(() => {
    if (token) loadUser();
  }, [token]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/public/:slug" element={<PublicReport />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/report/:id" element={<RequireAuth><ReportBuilder /></RequireAuth>} />
        <Route path="/datasets" element={<RequireAuth><Datasets /></RequireAuth>} />
        <Route path="/explore" element={<RequireAuth><Explore /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
