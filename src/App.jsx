import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { BelowParProvider } from './context/BelowParContext';
import { AppSettingsProvider } from './context/AppSettingsContext';
import AppLayout from './components/layout/AppLayout';
import SplashPage from './pages/SplashPage';

// Lazy-load heavy pages to reduce initial bundle size
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const TransfersPage = lazy(() => import('./pages/TransfersPage'));
const MorePage = lazy(() => import('./pages/MorePage'));

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-grg-sage border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="h-full bg-black" />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return (
    <AppLayout>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </AppLayout>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SplashPage />} />
      <Route
        path="/dashboard"
        element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
      />
      <Route
        path="/inventory"
        element={<ProtectedRoute><InventoryPage /></ProtectedRoute>}
      />
      <Route
        path="/products"
        element={<ProtectedRoute><ProductsPage /></ProtectedRoute>}
      />
      <Route
        path="/transfers"
        element={<ProtectedRoute><TransfersPage /></ProtectedRoute>}
      />
      <Route
        path="/more"
        element={<ProtectedRoute><MorePage /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* ThemeProvider reads user.hiVizMode — must be inside AuthProvider */}
        <ThemeProvider>
          {/* AppSettingsProvider subscribes to appSettings/config once for the whole app */}
          <AppSettingsProvider>
            {/* BelowParProvider subscribes to inventory once for the whole app */}
            <BelowParProvider>
              <AppRoutes />
            </BelowParProvider>
          </AppSettingsProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
