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
  updateCurrentUser: (userData: Partial<User>) => void;
  refreshUser: () => Promise<void>;
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
      const response = await apiClient.post('/auth/login', { email: email.trim().toLowerCase(), password });
      const { access_token, user: userData } = response.data;
      const normalizedUser = normalizeUser(userData);
      
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('user', JSON.stringify(normalizedUser));
      
      setIsAuthenticated(true);
      setUser(normalizedUser);
    } catch (error: any) {
      let errorMessage = 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.';
      if (error.response?.data?.detail) {
        if (typeof error.response.data.detail === 'string') {
          errorMessage = error.response.data.detail;
        } else if (Array.isArray(error.response.data.detail)) {
          errorMessage = error.response.data.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(', ');
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Kết nối đến máy chủ quá thời gian chờ (Timeout). Vui lòng kiểm tra lại mạng hoặc thử lại sau.';
      } else if (error.code === 'ERR_NETWORK' || !error.response) {
        errorMessage = 'Không thể kết nối đến máy chủ Backend (Port 8000). Vui lòng đảm bảo dịch vụ Backend đang hoạt động.';
      } else if (error.response?.status === 502 || error.response?.status === 504) {
        errorMessage = 'Máy chủ Backend đang khởi động lại hoặc không phản hồi (502/504). Vui lòng thử lại sau giây lát.';
      } else if (error.response?.status === 401) {
        errorMessage = 'Email hoặc mật khẩu không chính xác.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    const token = localStorage.getItem('access_token');
    
    // 1. Instantly purge credentials and state on client (0ms optimistic logout)
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);

    // 2. Notify backend in background with short 2.5s timeout (non-blocking fire-and-forget)
    if (token) {
      apiClient.post('/auth/logout', null, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 2500,
      }).catch((err) => {
        console.debug('Background logout notification completed or ignored:', err.message);
      });
    }

    // 3. Guarantee immediate redirect to /login
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  };

  const updateCurrentUser = (userData: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return null;
      const next: User = {
        ...prev,
        ...userData,
        name: userData.display_name || userData.name || prev.name,
      };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  const refreshUser = async () => {
    try {
      const me = await apiClient.get('/auth/me');
      const normalized = normalizeUser(me.data);
      localStorage.setItem('user', JSON.stringify(normalized));
      setUser(normalized);
    } catch (err) {
      console.error('Failed to refresh user', err);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, updateCurrentUser, refreshUser, isLoading }}>
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
