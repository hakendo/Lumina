import axios from 'axios';

const api = axios.create({ baseURL: '/api/' });

// Token efímero para el render de PDF (Puppeteer). Vive solo en memoria:
// nunca se escribe en localStorage para evitar fijación de sesión vía URL.
let memoryToken = null;
export function setMemoryToken(token) {
  memoryToken = token;
}

api.interceptors.request.use((config) => {
  // No pisar un Authorization explícito (el reto MFA usa un token temporal propio)
  if (config.headers.Authorization) return config;
  const token = memoryToken || localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => {
    if (typeof r.data === 'string' && (r.data.includes('<!doctype') || r.data.includes('<!DOCTYPE'))) {
      return Promise.reject(new Error('Respuesta inesperada del servidor'));
    }
    return r;
  },
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      const hadToken = !!localStorage.getItem('token');
      localStorage.removeItem('token');
      if (hadToken && window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
