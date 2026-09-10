import axios from 'axios';
import { AuthResponse, ChatMessage, Conversation, User } from '../types';

// Dynamically determine API URL based on current environment and hostname
const getApiUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    if (/^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host)) {
      return `http://${host}:5000`;
    }
    return 'https://gtext-backend-3r0k.onrender.com';
  }
  return 'https://gtext-backend-3r0k.onrender.com';
};

export const API_URL = getApiUrl();

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 18000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gtext:token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  register: (payload: {
    username: string;
    email: string;
    password: string;
    publicKey?: string;
    protectedKey?: string;
    avatar?: string;
    about?: string;
  }) => api.post<AuthResponse>('/auth/register', payload).then((r) => r.data),
  login: (payload: { email: string; password: string; publicKey?: string; protectedKey?: string }) =>
    api.post<AuthResponse>('/auth/login', payload).then((r) => r.data),
  me: () => api.get<{ user: User }>('/auth/me').then((r) => r.data.user),
  updateProfile: (payload: { username?: string; avatar?: string; about?: string; publicKey?: string; protectedKey?: string }) =>
    api.put<{ user: User }>('/auth/profile', payload).then((r) => r.data.user),
};

export const userApi = {
  search: (q: string) => api.get<{ users: User[] }>('/users/search', { params: { q } }).then((r) => r.data.users),
  report: (payload: { targetUserId: string; conversationId?: string; reason: string }) =>
    api.post('/users/report', payload).then((r) => r.data),
};

export const chatApi = {
  conversations: () =>
    api.get<{ conversations: Conversation[] }>('/chat/conversations').then((r) => r.data.conversations),
  startDirect: (userId: string, wrappedKeys: Record<string, string>) =>
    api.post<{ conversation: Conversation }>('/chat/direct', { userId, wrappedKeys }).then((r) => r.data.conversation),
  createGroup: (payload: {
    name: string;
    participantIds: string[];
    wrappedKeys: Record<string, string>;
    avatar?: string;
  }) => api.post<{ conversation: Conversation }>('/chat/groups', payload).then((r) => r.data.conversation),
  messages: (conversationId: string, params?: { limit?: number; before?: string }) =>
    api
      .get<{ messages: ChatMessage[] }>(`/chat/conversations/${conversationId}/messages`, { params })
      .then((r) => r.data.messages),
  addMember: (conversationId: string, userId: string, wrappedKey?: string) =>
    api
      .post<{ conversation: Conversation }>(`/chat/conversations/${conversationId}/members`, { userId, wrappedKey })
      .then((r) => r.data.conversation),
  removeMember: (conversationId: string, userId: string) =>
    api
      .delete<{ conversation: Conversation }>(`/chat/conversations/${conversationId}/members/${userId}`)
      .then((r) => r.data.conversation),
  promoteAdmin: (conversationId: string, userId: string) =>
    api
      .patch<{ conversation: Conversation }>(`/chat/conversations/${conversationId}/admins/${userId}`)
      .then((r) => r.data.conversation),
};

export const adminApi = {
  stats: () => api.get('/admin/stats').then((r) => r.data.stats),
  users: (q = '') => api.get('/admin/users', { params: { q } }).then((r) => r.data.users as User[]),
  block: (id: string, blocked: boolean) =>
    api.patch(`/admin/users/${id}/block`, { blocked }).then((r) => r.data.user as User),
  reports: () => api.get('/admin/reports').then((r) => r.data.reports),
  updateReport: (id: string, status: string) =>
    api.patch(`/admin/reports/${id}`, { status }).then((r) => r.data.report),
  activity: () => api.get('/admin/activity').then((r) => r.data),
};
