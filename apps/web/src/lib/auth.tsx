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
  userId: string | null;
  email: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  signInDev: (userId: string, email: string | null) => void;
};

const DEV_SESSION_KEY = 'teacheros_dev_session';
const AuthContext = createContext<AuthState | null>(null);

function DevAuthProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(DEV_SESSION_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { userId: string; email: string | null };
      setUserId(parsed.userId);
      setEmail(parsed.email);
    } catch {
      window.localStorage.removeItem(DEV_SESSION_KEY);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      mode: 'dev',
      isLoaded: true,
      isSignedIn: Boolean(userId),
      userId,
      email,
      getToken: async () => null,
      signOut: async () => {
        setUserId(null);
        setEmail(null);
        window.localStorage.removeItem(DEV_SESSION_KEY);
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
    [email, userId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkAuthBridge({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useClerkUser();

  const value = useMemo<AuthState>(
    () => ({
      mode: 'clerk',
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      getToken: async () => (await getToken()) ?? null,
      signOut: async () => {
        await signOut();
      },
      signInDev: () => {
        throw new Error('signInDev is unavailable in Clerk mode');
      }
    }),
    [getToken, isLoaded, isSignedIn, signOut, user?.primaryEmailAddress?.emailAddress, userId]
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
