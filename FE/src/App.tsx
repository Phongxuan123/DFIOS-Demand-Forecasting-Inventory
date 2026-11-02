import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { ForecastExplorer } from './pages/ForecastExplorer.tsx';
import { Replenishment } from './pages/Replenishment.tsx';
import { AbcXyzAnalysis } from './pages/AbcXyzAnalysis.tsx';
import { Reports } from './pages/Reports.tsx';
import { Products } from './pages/Products.tsx';
import { ModelPerformance } from './pages/ModelPerformance.tsx';
import { Settings } from './pages/Settings.tsx';
import { Login } from './pages/auth/Login.tsx';
import { ForgotPassword } from './pages/auth/ForgotPassword.tsx';
import { ActivateAccount } from './pages/auth/ActivateAccount.tsx';
import { ConfirmEmail } from './pages/auth/ConfirmEmail.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LanguageProvider, useLanguage } from './context/LanguageContext.tsx';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="auth-splash-screen">
        <div className="auth-splash-card">
          <div className="auth-splash-logo">D</div>
          <div className="auth-splash-spinner"></div>
          <p className="auth-splash-text">{t('common.loading', 'Initializing DFIOS Cockpit...')}</p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ForgotPassword />} />
            <Route path="/activate" element={<ActivateAccount />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            
            <Route path="/" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<Dashboard />} />
              <Route path="forecast-explorer" element={<ForecastExplorer />} />
              <Route path="replenishment" element={<Replenishment />} />
              <Route path="abc-xyz" element={<AbcXyzAnalysis />} />
              <Route path="reports" element={<Reports />} />
              <Route path="products" element={<Products />} />
              <Route path="model-performance" element={<ModelPerformance />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
