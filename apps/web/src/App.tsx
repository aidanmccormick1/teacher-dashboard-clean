import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell.js';
import { ApiError, useApiClient } from './lib/api.js';
import { useAppAuth } from './lib/auth.js';
import { ClassroomPage } from './pages/ClassroomPage.js';
import { CoursePage } from './pages/CoursePage.js';
import { CoursesPage } from './pages/CoursesPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { YearPlanPage } from './pages/YearPlanPage.js';
import { LandingPage } from './pages/LandingPage.js';
import { LessonTrackerPage } from './pages/LessonTrackerPage.js';
import { LessonWorkspacePage } from './pages/LessonWorkspacePage.js';
import { SharedLessonPage } from './pages/SharedLessonPage.js';
import { SharedCurriculumPage } from './pages/SharedCurriculumPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SchoolPage } from './pages/SchoolPage.js';
import { SetupGuidePage } from './pages/SetupGuidePage.js';
import { SharingPage } from './pages/SharingPage.js';

function RequireAuth() {
  const auth = useAppAuth();

  if (!auth.isLoaded) return <p className="muted">Loading...</p>;
  if (!auth.isSignedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireOnboarding() {
  const auth = useAppAuth();
  const api = useApiClient();
  const [state, setState] = useState<'loading' | 'ready' | 'onboarding' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError(null);
    void api
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        setState(profile.profile?.onboarded && profile.school ? 'ready' : 'onboarding');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not check your profile.');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, auth.userId]);

  if (state === 'loading') {
    return (
      <main className="route-gate page-entry" aria-busy="true">
        <section className="card route-gate-card">
          <p className="eyebrow">TeacherDesk</p>
          <h1>Checking your workspace…</h1>
          <p className="muted">One moment while we find your setup progress.</p>
        </section>
      </main>
    );
  }

  if (state === 'onboarding') return <Navigate to="/onboarding" replace />;

  if (state === 'error') {
    return (
      <main className="route-gate page-entry">
        <section className="card route-gate-card">
          <p className="eyebrow">TeacherDesk</p>
          <h1>We could not check your workspace.</h1>
          <p className="muted">{error ?? 'Try again to continue.'}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/shared/lessons/:token" element={<SharedLessonPage />} />
      <Route path="/shared/curriculum/:token" element={<SharedCurriculumPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<RequireOnboarding />}>
          <Route element={<AppShell />}>
            <Route path="/welcome" element={<SetupGuidePage />} />
            <Route path="/guide" element={<SetupGuidePage />} />
            <Route path="/today" element={<TodayPage />} />
            <Route path="/dashboard" element={<Navigate to="/today" replace />} />
            <Route path="/year-plan" element={<YearPlanPage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/sharing" element={<SharingPage />} />
            <Route path="/school" element={<SchoolPage />} />
            <Route path="/classroom" element={<ClassroomPage />} />
            <Route path="/curriculum" element={<Navigate to="/courses" replace />} />
            <Route path="/courses/:id" element={<CoursePage />} />
            <Route path="/schedule" element={<Navigate to="/courses?import=schedule" replace />} />
            <Route path="/sections/:sectionId/lessons/:lessonId" element={<LessonTrackerPage />} />
            <Route path="/lessons/:lessonId" element={<LessonWorkspacePage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
