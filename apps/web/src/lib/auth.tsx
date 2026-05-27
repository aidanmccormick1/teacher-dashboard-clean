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
};

const DEV_SESSION_KEY = 'teacheros_dev_session';
const PILOT_SESSION_KEY = 'teacheros_pilot_session';
const PILOT_TOKEN = 'teacher-dashboard-pilot-2026';
const PILOT_EMAIL = 'teacher.test@example.com';
const AuthContext = createContext<AuthState | null>(null);

function DevAuthProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(DEV_SESSION_KEY);
    if (!raw) {
      setIsLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { userId: string; email: string | null };
      setUserId(parsed.userId);
      setEmail(parsed.email);
    } catch {
      window.localStorage.removeItem(DEV_SESSION_KEY);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'dev',
      isLoaded,
      isSignedIn: Boolean(userId),
      isPilot: false,
      userId,
      email,
      getToken: async () => null,
      signOut: async () => {
        setUserId(null);
        setEmail(null);
        window.localStorage.removeItem(DEV_SESSION_KEY);
      },
      signInPilot: () => {
        throw new Error('signInPilot is unavailable in local dev mode');
      },
      signInDev: (nextUserId, nextEmail) => {
        setUserId(nextUserId);
        setEmail(nextEmail);
        window.localStorage.setItem(
          DEV_SESSION_KEY,
          JSON.stringify({ userId: nextUserId, email: nextEmail })
        );
      }
    }),
    [email, isLoaded, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkAuthBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useClerkUser();
  const [isPilot, setIsPilot] = useState(false);

  useEffect(() => {
    setIsPilot(window.localStorage.getItem(PILOT_SESSION_KEY) === 'true');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'clerk',
      isLoaded,
      isSignedIn: isPilot || Boolean(isSignedIn),
      isPilot,
      userId: isPilot ? 'pilot-teacher-demo' : (userId ?? null),
      email: isPilot ? PILOT_EMAIL : (user?.primaryEmailAddress?.emailAddress ?? null),
      getToken: async () => (isPilot ? PILOT_TOKEN : ((await getToken()) ?? null)),
      signOut: async () => {
        setIsPilot(false);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        await signOut();
      },
      signInPilot: () => {
        setIsPilot(true);
        window.localStorage.setItem(PILOT_SESSION_KEY, 'true');
      },
      signInDev: () => {
        throw new Error('signInDev is unavailable in Clerk mode');
      }
    }),
    [getToken, isLoaded, isPilot, isSignedIn, signOut, user?.primaryEmailAddress?.emailAddress, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppAuthProvider({ children }: PropsWithChildren) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return <DevAuthProvider>{children}</DevAuthProvider>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  );
}

export function useAppAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAppAuth must be used inside AppAuthProvider');
  }
  return context;
}
