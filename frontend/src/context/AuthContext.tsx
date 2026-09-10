import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi } from '../api/client';
import { ensureIdentity, savePrivateKey, loadPrivateKey, wrapDeviceIdentityKey, unwrapDeviceIdentityKey } from '../crypto/e2e';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, avatar?: string, about?: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('gtext:token'));
  const [loading, setLoading] = useState(true);
  const bootIdRef = useRef(0);

  useEffect(() => {
    const bootId = ++bootIdRef.current;
    const stored = localStorage.getItem('gtext:token');
    if (!stored) {
      setLoading(false);
      return;
    }

    const boot = async () => {
      try {
        const me = await authApi.me();
        if (bootId !== bootIdRef.current) return;
        const localKey = loadPrivateKey(me.email);
        setUser(localKey ? { ...me, privateKey: localKey } : me);
        setToken(stored);
      } catch {
        if (bootId !== bootIdRef.current) return;
        if (localStorage.getItem('gtext:token') === stored) {
          localStorage.removeItem('gtext:token');
          setToken(null);
          setUser(null);
        }
      } finally {
        if (bootId === bootIdRef.current) setLoading(false);
      }
    };

    boot();
  }, []);

  const persist = useCallback((nextToken: string, nextUser: User) => {
    bootIdRef.current += 1;
    if (nextUser.privateKey) {
      savePrivateKey(nextUser.email, nextUser.privateKey as JsonWebKey);
    }
    localStorage.setItem('gtext:token', nextToken);
    setUser(nextUser);
    setToken(nextToken);
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login({ email, password });
    persist(data.token, data.user);

    const attachPrivateKey = (privateKey: JsonWebKey, extra?: Partial<User>) => {
      persist(data.token, { ...data.user, ...extra, privateKey });
    };

    const backupProtectedKey = async (privateKey: JsonWebKey, publicKey?: string) => {
      try {
        const protectedKey = await wrapDeviceIdentityKey(privateKey, password, email);
        const updated = await authApi.updateProfile({ protectedKey, publicKey });
        setUser((prev) => ({ ...updated, privateKey: prev?.privateKey || privateKey }));
      } catch {
        // Keep the signed-in session even if key backup fails.
      }
    };

    const localKey = loadPrivateKey(email);
    if (localKey) {
      attachPrivateKey(localKey);
      if (!data.user.protectedKey) {
        void backupProtectedKey(localKey, data.user.publicKey);
      }
      return;
    }

    if (data.user.protectedKey) {
      const recoveredJwk = await unwrapDeviceIdentityKey(data.user.protectedKey, password, email);
      if (recoveredJwk) {
        attachPrivateKey(recoveredJwk);
        return;
      }
    }

    const identity = await ensureIdentity(email);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', identity.privateKey);
    attachPrivateKey(privateKeyJwk, { publicKey: identity.publicKey });
    void backupProtectedKey(privateKeyJwk, identity.publicKey);
  }, [persist]);

  const register = useCallback(async (username: string, email: string, password: string, avatar?: string, about?: string) => {
    const identity = await ensureIdentity(email);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', identity.privateKey);
    const protectedKey = await wrapDeviceIdentityKey(privateKeyJwk, password, email);
    const data = await authApi.register({
      username,
      email,
      password,
      publicKey: identity.publicKey,
      protectedKey,
      avatar,
      about,
    });
    persist(data.token, { ...data.user, privateKey: privateKeyJwk, publicKey: identity.publicKey, protectedKey });
  }, [persist]);

  const logout = useCallback(() => {
    bootIdRef.current += 1;
    if (user?.email) {
      localStorage.removeItem(`gtext:privateKey:${user.email.toLowerCase()}`);
    }
    localStorage.removeItem('gtext:token');
    setToken(null);
    setUser(null);
    setLoading(false);
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
