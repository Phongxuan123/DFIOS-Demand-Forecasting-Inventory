import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import { AuthProvider, useAuth } from './context/AuthContext.tsx';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          
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
  );
};

export default App;
