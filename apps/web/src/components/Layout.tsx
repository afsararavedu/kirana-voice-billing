import { useTranslation } from 'react-i18next';
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Layout() {
  const { t } = useTranslation();
  const { user, logout, changeLanguage } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <header className="topbar no-print">
        <Link to="/" className="brand">
          {t('app.title')}
        </Link>
        {user && (
          <nav className="nav">
            <NavLink to="/stores">{t('nav.stores')}</NavLink>
            <NavLink to="/settings">{t('nav.settings')}</NavLink>
          </nav>
        )}
        <div className="topbar-end">
          <LanguageSwitcher onChange={changeLanguage} />
          {user && (
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              {t('nav.logout')}
            </button>
          )}
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p role="status">{t('common.loading')}</p>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
