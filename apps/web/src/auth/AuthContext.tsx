import type { LoginInput, RegisterInput, UiLanguage, UpdatePreferencesInput, UserDto } from '@kirana/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { setUiLanguage } from '../i18n';

interface AuthState {
  user: UserDto | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (input: UpdatePreferencesInput) => Promise<void>;
  /** Changes UI language locally, and persists it server-side when signed in. */
  changeLanguage: (lang: UiLanguage) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const adopt = useCallback(async (u: UserDto) => {
    setUser(u);
    await setUiLanguage(u.uiLanguage);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => adopt(r.user))
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) console.warn('session check failed'); // eslint-disable-line no-console
      })
      .finally(() => setLoading(false));
  }, [adopt]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (input) => adopt((await api.login(input)).user),
      register: async (input) => adopt((await api.register(input)).user),
      logout: async () => {
        await api.logout();
        setUser(null);
      },
      updatePreferences: async (input) => adopt((await api.updatePreferences(input)).user),
      changeLanguage: async (lang) => {
        await setUiLanguage(lang);
        if (user) setUser((await api.updatePreferences({ uiLanguage: lang })).user);
      },
    }),
    [user, loading, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
