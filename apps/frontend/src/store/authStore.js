import { create } from 'zustand';
import api from '../lib/api';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  // Reto MFA pendiente tras login: { token, setup } — setup=true cuando el
  // admin exige MFA y el usuario aún no lo configuró.
  pendingMfa: null,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.mfaRequired || data.mfaSetupRequired) {
      set({ pendingMfa: { token: data.mfaToken, setup: !!data.mfaSetupRequired } });
      return { mfa: true, setup: !!data.mfaSetupRequired };
    }
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user, pendingMfa: null });
    return { mfa: false };
  },

  // Segundo paso del login (MFA ya activo)
  verifyMfa: async (code) => {
    const { pendingMfa } = get();
    const { data } = await api.post('/auth/mfa/verify', { code }, {
      headers: { Authorization: `Bearer ${pendingMfa.token}` },
    });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user, pendingMfa: null });
  },

  // Genera secreto + QR. Usa el token de reto si viene del login obligatorio,
  // o la sesión normal si es activación voluntaria.
  setupMfa: async () => {
    const { pendingMfa } = get();
    const config = pendingMfa ? { headers: { Authorization: `Bearer ${pendingMfa.token}` } } : {};
    const { data } = await api.post('/auth/mfa/setup', {}, config);
    return data; // { secret, otpauth, qr }
  },

  enableMfa: async (code) => {
    const { pendingMfa } = get();
    const config = pendingMfa ? { headers: { Authorization: `Bearer ${pendingMfa.token}` } } : {};
    const { data } = await api.post('/auth/mfa/enable', { code }, config);
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user, pendingMfa: null });
  },

  disableMfa: async (code) => {
    await api.post('/auth/mfa/disable', { code });
    set((s) => ({ user: s.user ? { ...s.user, mfaEnabled: false } : null }));
  },

  // Refleja en la sesión actual el themeConfig recién guardado desde
  // Mi Org → Apariencia, sin esperar al próximo /auth/me.
  setOrgTheme: (orgTheme) => {
    set((s) => ({ user: s.user ? { ...s.user, orgTheme } : null }));
  },

  cancelMfa: () => set({ pendingMfa: null }),

  loadUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data });
    } catch {
      localStorage.removeItem('token');
      set({ token: null, user: null });
    }
  },

  // Cambia la org activa: emite nuevo JWT con el contexto de la org elegida.
  switchOrg: async (orgId) => {
    const { data } = await api.post('/auth/switch-org', { orgId });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user });
    // Recarga la página para limpiar cualquier estado de datos de la org anterior
    window.location.reload();
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null, pendingMfa: null });
  },
}));
