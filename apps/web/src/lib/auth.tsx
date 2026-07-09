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
const PILOT_SESSION_KEY = 'teacheros_pilot_session';
const TEST_SESSION_KEY = 'teacheros_test_session';
const PILOT_TOKEN = 'teacher-dashboard-pilot-2026';
const PILOT_EMAIL = 'teacher.test@example.com';
const AuthContext = createContext<AuthState | null>(null);

type TestSession = {
  token: string;
  username: string;
  email: string | null;
};

function DevAuthProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isPilot, setIsPilot] = useState(false);
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const pilotSession = window.localStorage.getItem(PILOT_SESSION_KEY) === 'true';
    if (pilotSession) {
      setIsPilot(true);
      setIsLoaded(true);
      return;
    }

    const rawTestSession = window.localStorage.getItem(TEST_SESSION_KEY);
    if (rawTestSession) {
      try {
        setTestSession(JSON.parse(rawTestSession) as TestSession);
      } catch {
        window.localStorage.removeItem(TEST_SESSION_KEY);
      } finally {
        setIsLoaded(true);
      }
      return;
    }

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
      isSignedIn: isPilot || Boolean(testSession) || Boolean(userId),
      isPilot,
      userId: isPilot ? 'pilot-teacher-demo' : (testSession ? `test-account:${testSession.username}` : userId),
      email: isPilot ? PILOT_EMAIL : (testSession?.email ?? email),
      getToken: async () => (isPilot ? PILOT_TOKEN : (testSession?.token ?? null)),
      signOut: async () => {
        setIsPilot(false);
        setTestSession(null);
        setUserId(null);
        setEmail(null);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        window.localStorage.removeItem(TEST_SESSION_KEY);
        window.localStorage.removeItem(DEV_SESSION_KEY);
      },
      signInPilot: () => {
        setIsPilot(true);
        setTestSession(null);
        setUserId(null);
        setEmail(null);
        window.localStorage.setItem(PILOT_SESSION_KEY, 'true');
        window.localStorage.removeItem(TEST_SESSION_KEY);
        window.localStorage.removeItem(DEV_SESSION_KEY);
      },
      signInDev: (nextUserId, nextEmail) => {
        setIsPilot(false);
        setTestSession(null);
        setUserId(nextUserId);
        setEmail(nextEmail);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        window.localStorage.removeItem(TEST_SESSION_KEY);
        window.localStorage.setItem(
          DEV_SESSION_KEY,
          JSON.stringify({ userId: nextUserId, email: nextEmail })
        );
      },
      signInWithTestToken: (token, username, nextEmail) => {
        const nextSession = { token, username, email: nextEmail };
        setIsPilot(false);
        setTestSession(nextSession);
        setUserId(null);
        setEmail(null);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        window.localStorage.removeItem(DEV_SESSION_KEY);
        window.localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(nextSession));
      }
    }),
    [email, isLoaded, isPilot, testSession, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkAuthBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useClerkUser();
  const [isPilot, setIsPilot] = useState(false);
  const [testSession, setTestSession] = useState<TestSession | null>(null);

  useEffect(() => {
    setIsPilot(window.localStorage.getItem(PILOT_SESSION_KEY) === 'true');
    const rawTestSession = window.localStorage.getItem(TEST_SESSION_KEY);
    if (!rawTestSession) return;

    try {
      setTestSession(JSON.parse(rawTestSession) as TestSession);
    } catch {
      window.localStorage.removeItem(TEST_SESSION_KEY);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'clerk',
      isLoaded,
      isSignedIn: isPilot || Boolean(testSession) || Boolean(isSignedIn),
      isPilot,
      userId: isPilot ? 'pilot-teacher-demo' : (testSession ? `test-account:${testSession.username}` : (userId ?? null)),
      email: isPilot ? PILOT_EMAIL : (testSession?.email ?? user?.primaryEmailAddress?.emailAddress ?? null),
      getToken: async () => (isPilot ? PILOT_TOKEN : (testSession?.token ?? (await getToken()) ?? null)),
      signOut: async () => {
        setIsPilot(false);
        setTestSession(null);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        window.localStorage.removeItem(TEST_SESSION_KEY);
        await signOut();
      },
      signInPilot: () => {
        setIsPilot(true);
        setTestSession(null);
        window.localStorage.setItem(PILOT_SESSION_KEY, 'true');
        window.localStorage.removeItem(TEST_SESSION_KEY);
      },
      signInDev: () => {
        throw new Error('signInDev is unavailable in Clerk mode');
      },
      signInWithTestToken: (token, username, nextEmail) => {
        const nextSession = { token, username, email: nextEmail };
        setIsPilot(false);
        setTestSession(nextSession);
        window.localStorage.removeItem(PILOT_SESSION_KEY);
        window.localStorage.setItem(TEST_SESSION_KEY, JSON.stringify(nextSession));
      }
    }),
    [getToken, isLoaded, isPilot, isSignedIn, signOut, testSession, user?.primaryEmailAddress?.emailAddress, userId]
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
