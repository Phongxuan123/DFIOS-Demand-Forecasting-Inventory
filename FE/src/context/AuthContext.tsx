import React, { createContext, useContext, useState, type ReactNode } from 'react';

export type Role = 'ADMIN' | 'WAREHOUSE MANAGER' | 'VIEWER';

export interface User {
  name: string;
  email: string;
  role: Role;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setMockUser: (user: User) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const MOCK_USERS: Record<string, User> = {
  'admin@dfios.com': { name: 'Marcus Brody', email: 'admin@dfios.com', role: 'ADMIN' },
  'manager@dfios.com': { name: 'Sarah Jenkins', email: 'manager@dfios.com', role: 'WAREHOUSE MANAGER' },
  'viewer@dfios.com': { name: 'Leah Vance', email: 'viewer@dfios.com', role: 'VIEWER' }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true); // Default true for easier dev
  const [user, setUser] = useState<User | null>(MOCK_USERS['manager@dfios.com']); // Default role
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    // Simulate API call to backend
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        setIsLoading(false);
        if (MOCK_USERS[email] && password === 'admin') {
          setIsAuthenticated(true);
          setUser(MOCK_USERS[email]);
          resolve();
        } else if (email === 'admin@dfios.com' && password === 'admin') { // fallback
          setIsAuthenticated(true);
          setUser(MOCK_USERS['admin@dfios.com']);
          resolve();
        } else {
          reject(new Error('Invalid credentials. Try admin@dfios.com / admin'));
        }
      }, 1000);
    });
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUser(null);
  };

  const setMockUser = (newUser: User) => {
    setUser(newUser);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, setMockUser, isLoading }}>
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
