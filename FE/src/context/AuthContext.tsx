/**
 * Auth state.
 *
 * R-22: re-hydration only drops the session when the server says the token is invalid (401,
 * handled by apiClient which fires `dfios:unauthorized`). A network error, timeout or 5xx on
 * /auth/me keeps the stored token and the cached user, so a slow backend never logs people out.
 * R-25: every per-account cache is cleared on login AND logout (services/session.ts).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient, toApiError } from '../services/apiClient.ts';
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearClientCaches,
  clearSession,
  getStoredUser,
  getToken,
  storeSession,
  storeUser,
} from '../services/session.ts';
import { normalizeRole, type Role } from '../auth/permissions.ts';

export type { Role } from '../auth/permissions.ts';

export interface User {
  id?: string;
  name: string;
  email: string;
  role: Role;
  display_name?: string;
  is_active?: boolean;
  is_verified?: boolean;
}

export const SESSION_EXPIRED_FLAG = 'dfios_session_expired';

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  /** Rejects with the original axios error; present it with apiErrorMessage / toApiError. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateCurrentUser: (userData: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  /** True while the stored token is being validated on first load. */
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeUser = (raw: Record<string, unknown> | null | undefined): User => {
  const r = (raw ?? {}) as Record<string, string | undefined>;
  return {
    ...(r as object),
    name: r.display_name || r.name || r.email || 'User',
    email: r.email || '',
    role: normalizeRole(r.role),
  } as User;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!getToken());
  const [user, setUser] = useState<User | null>(() => getStoredUser<User>());
  const [isLoading, setIsLoading] = useState<boolean>(() => !!getToken());

  // Validate the stored token once on mount.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await apiClient.get('/auth/me');
        if (cancelled) return;
        const normalized = normalizeUser(me.data);
        storeUser(normalized);
        setUser(normalized);
        setIsAuthenticated(true);
      } catch (err) {
        if (cancelled) return;
        // 401 -> apiClient already cleared the session and fired the unauthorized event.
        // Anything else (network, timeout, 5xx): keep the session.
        if (toApiError(err).kind === 'unauthorized') {
          setUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Forced sign-out (401 on a request that carried the current token).
  useEffect(() => {
    const onUnauthorized = () => {
      try {
        sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1');
      } catch {
        /* ignore */
      }
      setUser(null);
      setIsAuthenticated(false);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    clearClientCaches(); // never inherit the previous account's caches
    const response = await apiClient.post('/auth/login', { email: email.trim().toLowerCase(), password });
    const { access_token, user: userData } = response.data;
    const normalized = normalizeUser(userData);
    clearClientCaches();
    storeSession(access_token, normalized);
    try {
      sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
    } catch {
      /* ignore */
    }
    setUser(normalized);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    const token = getToken();
    clearSession();
    clearClientCaches();
    setIsAuthenticated(false);
    setUser(null);
    // Tell the backend, fire-and-forget. The router then redirects to /login (ProtectedRoute).
    if (token) {
      apiClient
        .post('/auth/logout', null, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 2500,
          notifyForbidden: false,
        })
        .catch(() => undefined);
    }
  }, []);

  const updateCurrentUser = useCallback((userData: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null;
      const next: User = { ...prev, ...userData, name: userData.display_name || userData.name || prev.name };
      storeUser(next);
      return next;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await apiClient.get('/auth/me');
      const normalized = normalizeUser(me.data);
      storeUser(normalized);
      setUser(normalized);
    } catch {
      /* keep the current user; a failed refresh must not change the session */
    }
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, user, login, logout, updateCurrentUser, refreshUser, isLoading }),
    [isAuthenticated, user, login, logout, updateCurrentUser, refreshUser, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
