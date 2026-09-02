import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/client';
import { ensureIdentity, savePrivateKey } from '../crypto/e2e';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, avatar?: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('gtext:token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const boot = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await authApi.me();
        setUser(me);
      } catch {
        localStorage.removeItem('gtext:token');
        setToken(null);
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, [token]);

  const persist = useCallback((nextToken: string, nextUser: User) => {
    if (nextUser.privateKey) {
      savePrivateKey(nextUser.email, nextUser.privateKey as Parameters<typeof savePrivateKey>[1]);
    }
    localStorage.setItem('gtext:token', nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const identity = await ensureIdentity(email);
    const privateKey = await crypto.subtle.exportKey('jwk', identity.privateKey);
    const data = await authApi.login({ email, password, publicKey: identity.publicKey, privateKey });
    persist(data.token, data.user);
  }, [persist]);

  const register = useCallback(async (username: string, email: string, password: string, avatar?: string) => {
    const identity = await ensureIdentity(email);
    const privateKey = await crypto.subtle.exportKey('jwk', identity.privateKey);
    const data = await authApi.register({
      username,
      email,
      password,
      publicKey: identity.publicKey,
      privateKey,
      avatar,
    });
    persist(data.token, data.user);
  }, [persist]);

  const logout = useCallback(() => {
    if (user?.email) {
      localStorage.removeItem(`gtext:privateKey:${user.email.toLowerCase()}`);
    }
    localStorage.removeItem('gtext:token');
    setToken(null);
    setUser(null);
  }, [user]);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, updateUser: setUser }),
    [user, token, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
