import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiClient } from '../services/apiClient.ts';

export type Role = 'ADMIN' | 'WAREHOUSE MANAGER' | 'VIEWER';

export interface User {
  id?: string;
  name: string;
  email: string;
  role: Role;
  display_name?: string;
  is_active?: boolean;
  is_verified?: boolean;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRole = (role: string | undefined): Role => {
  const normalized = (role || 'VIEWER').toUpperCase();
  if (normalized === 'ADMIN') return 'ADMIN';
  if (normalized === 'WAREHOUSE MANAGER') return 'WAREHOUSE MANAGER';
  return 'VIEWER';
};

const normalizeUser = (raw: any): User => ({
  ...raw,
  name: raw?.display_name || raw?.name || raw?.email || 'User',
  email: raw?.email || '',
  role: normalizeRole(raw?.role),
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !!localStorage.getItem('access_token'));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => !localStorage.getItem('access_token'));

  // Re-hydrate session on mount by validating token with BE
  useEffect(() => {
    const checkSession = async () => {
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const me = await apiClient.get('/auth/me');
          const normalized = normalizeUser(me.data);
          localStorage.setItem('user', JSON.stringify(normalized));
          setUser(normalized);
          setIsAuthenticated(true);
        } catch (error) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
          setUser(null);
          setIsAuthenticated(false);
        }
      }
      setIsLoading(false);
    };
    checkSession();
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { access_token, user: userData } = response.data;
      const normalizedUser = normalizeUser(userData);
      
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('user', JSON.stringify(normalizedUser));
      
      setIsAuthenticated(true);
      setUser(normalizedUser);
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || 'Invalid credentials';
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (localStorage.getItem('access_token')) {
        await apiClient.post('/auth/logout');
      }
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
