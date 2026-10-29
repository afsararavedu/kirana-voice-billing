import type { UiLanguage } from '@kirana/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorText } from '../components/ErrorText';

function useSubmit(action: (form: FormData) => Promise<void>) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action(new FormData(e.currentTarget));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { error, busy, onSubmit } = useSubmit(async (f) => {
    await login({ email: String(f.get('email')), password: String(f.get('password')) });
    navigate('/stores');
  });
  if (user) return <Navigate to="/stores" replace />;

  return (
    <section className="card narrow">
      <h1>{t('auth.loginTitle')}</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          {t('auth.email')}
          <input name="email" type="email" autoComplete="email" dir="ltr" required />
        </label>
        <label>
          {t('auth.password')}
          <input name="password" type="password" autoComplete="current-password" dir="ltr" required />
        </label>
        <ErrorText error={error} />
        <button type="submit" disabled={busy}>
          {t('auth.submitLogin')}
        </button>
      </form>
      <p>
        <Link to="/register">{t('auth.noAccount')}</Link>
      </p>
    </section>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const { error, busy, onSubmit } = useSubmit(async (f) => {
    await register({
      email: String(f.get('email')),
      password: String(f.get('password')),
      displayName: String(f.get('displayName')),
      uiLanguage: i18n.language as UiLanguage,
    });
    navigate('/stores');
  });
  if (user) return <Navigate to="/stores" replace />;

  return (
    <section className="card narrow">
      <h1>{t('auth.registerTitle')}</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          {t('auth.displayName')}
          <input name="displayName" autoComplete="name" dir="auto" maxLength={80} required />
        </label>
        <label>
          {t('auth.email')}
          <input name="email" type="email" autoComplete="email" dir="ltr" required />
        </label>
        <label>
          {t('auth.password')}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            minLength={12}
            maxLength={128}
            required
            aria-describedby="pw-hint"
          />
          <small id="pw-hint">{t('auth.passwordHint')}</small>
        </label>
        <ErrorText error={error} />
        <button type="submit" disabled={busy}>
          {t('auth.submitRegister')}
        </button>
      </form>
      <p>
        <Link to="/login">{t('auth.haveAccount')}</Link>
      </p>
    </section>
  );
}
