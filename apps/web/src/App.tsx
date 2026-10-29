import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext';
import { Layout, RequireAuth } from './components/Layout';
import { AuditLogPage } from './pages/AuditLogPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { ImportPage } from './pages/products/ImportPage';
import { NewProductPage } from './pages/products/NewProductPage';
import { ProductPage } from './pages/products/ProductPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { DailyReportPage } from './pages/reports/DailyReportPage';
import { LowStockPage } from './pages/reports/LowStockPage';
import { BillingPage } from './pages/sales/BillingPage';
import { ReceiptPage } from './pages/sales/ReceiptPage';
import { SalePage } from './pages/sales/SalePage';
import { SalesPage } from './pages/sales/SalesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StorePage } from './pages/StorePage';
import { StoresPage } from './pages/StoresPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/stores" element={<StoresPage />} />
              <Route path="/stores/:storeId" element={<StorePage />} />
              <Route path="/stores/:storeId/products" element={<ProductsPage />} />
              <Route path="/stores/:storeId/products/new" element={<NewProductPage />} />
              <Route path="/stores/:storeId/products/import" element={<ImportPage />} />
              <Route path="/stores/:storeId/products/:productId" element={<ProductPage />} />
              <Route path="/stores/:storeId/billing" element={<BillingPage />} />
              <Route path="/stores/:storeId/sales" element={<SalesPage />} />
              <Route path="/stores/:storeId/sales/:saleId" element={<SalePage />} />
              <Route path="/stores/:storeId/sales/:saleId/receipt" element={<ReceiptPage />} />
              <Route path="/stores/:storeId/reports/daily" element={<DailyReportPage />} />
              <Route path="/stores/:storeId/reports/low-stock" element={<LowStockPage />} />
              <Route path="/stores/:storeId/audit" element={<AuditLogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/stores" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
