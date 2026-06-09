import { create } from 'zustand';
import api from '../lib/api';

export const useAuthStore = create((set) => ({
  user: null,
  token: localStorage.getItem('token'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user });
  },

  register: async (email, password, name) => {
    const { data } = await api.post('/auth/register', { email, password, name });
    localStorage.setItem('token', data.token);
    set({ token: data.token, user: data.user });
  },

  loadUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data });
    } catch {
      localStorage.removeItem('token');
      set({ token: null, user: null });
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },
}));
