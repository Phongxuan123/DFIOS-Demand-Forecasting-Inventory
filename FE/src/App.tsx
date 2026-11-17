import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/layout/Layout.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './theme/ThemeContext.tsx';
import { I18nProvider, useT } from './i18n/index.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import { EmptyState } from './components/ui/states.tsx';
import { AuthSplash } from './pages/auth/AuthShell.tsx';
import { RequireRole } from './auth/RequireRole.tsx';

// Route-level code splitting: every page (and its charts) is its own chunk.
const Login = lazy(() => import('./pages/auth/Login.tsx').then((m) => ({ default: m.Login })));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.tsx').then((m) => ({ default: m.ForgotPassword })));
const ActivateAccount = lazy(() => import('./pages/auth/ActivateAccount.tsx').then((m) => ({ default: m.ActivateAccount })));
const ConfirmEmail = lazy(() => import('./pages/auth/ConfirmEmail.tsx').then((m) => ({ default: m.ConfirmEmail })));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard })));
const ForecastExplorer = lazy(() => import('./pages/ForecastExplorer.tsx').then((m) => ({ default: m.ForecastExplorer })));
const Replenishment = lazy(() => import('./pages/Replenishment.tsx').then((m) => ({ default: m.Replenishment })));
const AbcXyzAnalysis = lazy(() => import('./pages/AbcXyzAnalysis.tsx').then((m) => ({ default: m.AbcXyzAnalysis })));
const Reports = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.Reports })));
const Products = lazy(() => import('./pages/Products.tsx').then((m) => ({ default: m.Products })));
const ModelPerformance = lazy(() => import('./pages/ModelPerformance.tsx').then((m) => ({ default: m.ModelPerformance })));
const Settings = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.Settings })));
const DesignSystem = import.meta.env.DEV ? lazy(() => import('./pages/DesignSystem.tsx').then((m) => ({ default: m.DesignSystem }))) : null;

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <AuthSplash />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
};

const NotFound: React.FC = () => {
  const t = useT();
  return (
    <EmptyState
      title={t('common.state.not_found_title')}
      description={t('common.state.not_found_description')}
      action={
        <Link to="/" className="ui-btn ui-btn--secondary">
          {t('common.state.go_home')}
        </Link>
      }
    />
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <Router>
            <Suspense fallback={<AuthSplash />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ForgotPassword />} />
                <Route path="/activate" element={<ActivateAccount />} />
                <Route path="/confirm-email" element={<ConfirmEmail />} />

                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Dashboard />} />
                  <Route path="forecast-explorer" element={<ForecastExplorer />} />
                  <Route
                    path="replenishment"
                    element={
                      <RequireRole action="view:replenishment">
                        <Replenishment />
                      </RequireRole>
                    }
                  />
                  <Route path="abc-xyz" element={<AbcXyzAnalysis />} />
                  <Route path="classification" element={<Navigate to="/abc-xyz" replace />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="products" element={<Products />} />
                  <Route
                    path="model-performance"
                    element={
                      <RequireRole action="view:models">
                        <ModelPerformance />
                      </RequireRole>
                    }
                  />
                  <Route path="settings" element={<Settings />} />
                  {DesignSystem && <Route path="design-system" element={<DesignSystem />} />}
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </Router>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  </ThemeProvider>
);

export default App;
