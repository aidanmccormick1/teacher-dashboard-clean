import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell.js';
import { useAppAuth } from './lib/auth.js';
import { ClassroomPage } from './pages/ClassroomPage.js';
import { CoursePage } from './pages/CoursePage.js';
import { CurriculumPage } from './pages/CurriculumPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { YearPlanPage } from './pages/YearPlanPage.js';
import { GuidePage } from './pages/GuidePage.js';
import { LandingPage } from './pages/LandingPage.js';
import { LessonTrackerPage } from './pages/LessonTrackerPage.js';
import { LessonWorkspacePage } from './pages/LessonWorkspacePage.js';
import { SharedLessonPage } from './pages/SharedLessonPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ManagementPage } from './pages/ManagementPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SchedulePage } from './pages/SchedulePage.js';
import { SchoolPage } from './pages/SchoolPage.js';

function RequireAuth() {
  const auth = useAppAuth();

  if (!auth.isLoaded) return <p className="muted">Loading...</p>;
  if (!auth.isSignedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/shared/lessons/:token" element={<SharedLessonPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppShell />}>
          <Route path="/welcome" element={<GuidePage />} />
          <Route path="/guide" element={<Navigate to="/welcome" replace />} />
          <Route path="/today" element={<TodayPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/management" element={<ManagementPage />} />
          <Route path="/year-plan" element={<YearPlanPage />} />
          <Route
            path="/courses"
            element={<ManagementPage initialTab="courses" hideTabNavigation />}
          />
          <Route path="/school" element={<SchoolPage />} />
          <Route path="/classroom" element={<ClassroomPage />} />
          <Route path="/curriculum" element={<CurriculumPage />} />
          <Route path="/courses/:id" element={<CoursePage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/sections/:sectionId/lessons/:lessonId" element={<LessonTrackerPage />} />
          <Route path="/lessons/:lessonId" element={<LessonWorkspacePage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
