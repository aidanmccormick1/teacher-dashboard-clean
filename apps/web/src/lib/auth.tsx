import {
  ClerkProvider,
  useAuth as useClerkAuth,
  useUser as useClerkUser
} from '@clerk/clerk-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';

type AuthState = {
  mode: 'clerk' | 'dev';
  isLoaded: boolean;
  isSignedIn: boolean;
  isPilot: boolean;
  userId: string | null;
  email: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  signInPilot: () => void;
  signInDev: (userId: string, email: string | null) => void;
  signInWithTestToken: (token: string, username: string, email: string | null) => void;
};

const DEV_SESSION_KEY = 'teacheros_dev_session';
const RETIRED_SESSION_KEYS = ['teacheros_pilot_session', 'teacheros_test_session'];
const AuthContext = createContext<AuthState | null>(null);

function clearRetiredSessions() {
  RETIRED_SESSION_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

function DevAuthProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(DEV_SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          userId: string;
          email: string | null;
          token?: string | null;
        };
        setUserId(parsed.userId);
        setEmail(parsed.email);
        setToken(parsed.token ?? null);
      } catch {
        window.localStorage.removeItem(DEV_SESSION_KEY);
      }
    }
    setIsLoaded(true);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'dev',
      isLoaded,
      isSignedIn: Boolean(userId),
      isPilot: false,
      userId,
      email,
      getToken: async () => token,
      signOut: async () => {
        setUserId(null);
        setEmail(null);
        setToken(null);
        window.localStorage.removeItem(DEV_SESSION_KEY);
      },
      signInPilot: () => {
        throw new Error('Pilot authentication is unavailable. Sign in with Clerk instead.');
      },
      signInDev: (nextUserId, nextEmail) => {
        setUserId(nextUserId);
        setEmail(nextEmail);
        setToken(null);
        window.localStorage.setItem(
          DEV_SESSION_KEY,
          JSON.stringify({ userId: nextUserId, email: nextEmail, token: null })
        );
      },
      signInWithTestToken: (nextToken, username, nextEmail) => {
        const nextUserId = `test-account:${username}`;
        setUserId(nextUserId);
        setEmail(nextEmail);
        setToken(nextToken);
        window.localStorage.setItem(
          DEV_SESSION_KEY,
          JSON.stringify({ userId: nextUserId, email: nextEmail, token: nextToken })
        );
      }
    }),
    [email, isLoaded, token, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkAuthBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useClerkUser();

  useEffect(() => {
    // Previous versions stored a public, non-JWT pilot token. Remove it so a
    // returning visitor is prompted to obtain a valid Clerk session instead.
    clearRetiredSessions();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'clerk',
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      isPilot: false,
      userId: userId ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      getToken: async () => (await getToken()) ?? null,
      signOut: async () => {
        clearRetiredSessions();
        await signOut();
      },
      signInPilot: () => {
        throw new Error('Pilot authentication is unavailable. Sign in with Clerk instead.');
      },
      signInDev: () => {
        throw new Error('signInDev is unavailable in Clerk mode');
      },
      signInWithTestToken: () => {
        throw new Error('Tester-token authentication is unavailable. Sign in with Clerk instead.');
      }
    }),
    [getToken, isLoaded, isSignedIn, signOut, user?.primaryEmailAddress?.emailAddress, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppAuthProvider({ children }: PropsWithChildren) {
  const localDevAuthRequested =
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_DEV_AUTH === 'true' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (localDevAuthRequested) return <DevAuthProvider>{children}</DevAuthProvider>;

  // This development-instance key is public by design and matches the Clerk
  // verification key configured on the Render API. Cloudflare can override it
  // with either a test or live publishable key when the production Clerk
  // domain is ready.
  const configuredPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const developmentPublishableKey = 'pk_test_ZnVuLXdlZXZpbC0xMS5jbGVyay5hY2NvdW50cy5kZXYk';
  const publishableKey =
    configuredPublishableKey?.startsWith('pk_test_') ||
    configuredPublishableKey?.startsWith('pk_live_')
      ? configuredPublishableKey
      : developmentPublishableKey;

  if (!publishableKey) return <DevAuthProvider>{children}</DevAuthProvider>;

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

export function useAppAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAppAuth must be used inside AppAuthProvider');
  return context;
}
