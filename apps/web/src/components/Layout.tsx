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
          <img src="/brand/waycup-logo.png" alt="" width={36} height={36} className="brand-logo" />
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
      <SiteFooter />
    </div>
  );
}

// Left-to-right isolate (LRI … PDI): keeps "© 2026 Waycup Chai" in order inside Urdu (RTL) text.
const ltr = (s: string) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);

/** Brand names stay in Latin script in every language; only the surrounding words are translated. */
export function SiteFooter() {
  const { t } = useTranslation();
  return (
    <footer className="site-footer no-print">
      <p>
        {t('footer.copyright', { notice: ltr(`© ${new Date().getFullYear()} Waycup Chai`) })}{' '}
        <a href="https://waycupchai.com" target="_blank" rel="noopener noreferrer" dir="ltr">
          waycupchai.com
        </a>
      </p>
      <p>{t('footer.developedBy', { name: ltr('ARM Gen Alpha Technologies') })}</p>
    </footer>
  );
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p role="status">{t('common.loading')}</p>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
