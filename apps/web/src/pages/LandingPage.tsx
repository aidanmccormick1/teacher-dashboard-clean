import { Link } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

const workflowSteps = [
  {
    title: 'Create one course',
    body: 'Start with what you teach, not a database record.'
  },
  {
    title: 'Add class periods',
    body: 'Attach Period 1, Period 3, and Period 5 to the same course plan.'
  },
  {
    title: 'Build the year plan',
    body: 'Organize units, lessons, and segments in a structure teachers can actually use.'
  },
  {
    title: 'Resume the right class',
    body: 'Each section remembers its own stopped-at point and carry-over note.'
  }
];

const teacherQuestions = [
  'What class do I have next?',
  'Where did Period 2 stop yesterday?',
  'Which section is ahead or behind?',
  'What lesson should I teach today?',
  'What needs to carry over tomorrow?'
];

const productPillars = [
  {
    title: 'Shared course plan',
    body: 'One year plan can power every section of the same course.'
  },
  {
    title: 'Separate period progress',
    body: 'Each class period moves independently without duplicating curriculum.'
  },
  {
    title: 'Daily teaching desk',
    body: 'Open the app and see today, next class, readiness, and setup gaps.'
  },
  {
    title: 'Practical helpers',
    body: 'Use imports and helper outputs only when they save real teacher time.'
  }
];

export function LandingPage() {
  const auth = useAppAuth();
  const appTarget = auth.isSignedIn ? '/dashboard' : '/login';
  const appLabel = auth.isSignedIn ? 'Open dashboard' : 'Try TeacherOS';

  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="TeacherOS website navigation">
        <Link className="landing-brand" to="/">
          TeacherOS
        </Link>
        <div className="landing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#why">Why it matters</a>
          <a href="#test">Pilot test</a>
          <Link to="/login">Sign in</Link>
        </div>
        <Link className="landing-nav-cta" to={appTarget}>
          {appLabel}
        </Link>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">Daily teaching desk</p>
          <h1>Know what to teach next.</h1>
          <p>
            TeacherOS connects courses, class periods, schedules, year plans, and section progress so
            teachers can move through the day without guessing where each class left off.
          </p>
          <div className="landing-actions">
            <Link className="button-link" to={appTarget}>
              {appLabel}
            </Link>
            <a className="button-link secondary" href="#how-it-works">
              See the flow
            </a>
          </div>
        </div>

        <div className="landing-product-shot" aria-label="TeacherOS product preview">
          <div className="landing-shot-top">
            <span>Monday</span>
            <strong>Daily Desk</strong>
            <em>Ready soon</em>
          </div>
          <div className="landing-shot-grid">
            <div className="landing-shot-card current">
              <span>Current period</span>
              <strong>US History</strong>
              <p>Period 3 stopped at source analysis.</p>
            </div>
            <div className="landing-shot-card">
              <span>Next class</span>
              <strong>Period 5</strong>
              <p>Lesson 8, segment 2 is next.</p>
            </div>
            <div className="landing-progress-card">
              <div>
                <span>Period 1</span>
                <strong>Lesson 8</strong>
              </div>
              <div>
                <span>Period 3</span>
                <strong>Lesson 7</strong>
              </div>
              <div>
                <span>Period 5</span>
                <strong>Lesson 9</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-question-panel" id="why">
        <div>
          <p className="eyebrow">The teacher problem</p>
          <h2>Teachers do not just plan lessons. They carry context across the whole day.</h2>
        </div>
        <div className="landing-question-list">
          {teacherQuestions.map((question) => (
            <span key={question}>{question}</span>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="landing-section-heading">
          <p className="eyebrow">How it works</p>
          <h2>One shared plan. Many real class periods. Separate progress for each section.</h2>
        </div>
        <div className="landing-workflow">
          {workflowSteps.map((step, index) => (
            <article key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-model-section">
        <div className="landing-model-copy">
          <p className="eyebrow">The core model</p>
          <h2>A course is the plan. A period is the class. Progress belongs to each period.</h2>
          <p>
            Teach US History three times a day without copying the curriculum three times. Period 1,
            Period 3, and Period 5 can share the same year plan while moving at their own pace.
          </p>
        </div>
        <div className="landing-model-board">
          <div>
            <span>Course</span>
            <strong>US History</strong>
            <p>6 units, 42 lessons, 128 segments</p>
          </div>
          <div>
            <span>Period 1</span>
            <strong>Lesson 8</strong>
            <p>On pace</p>
          </div>
          <div>
            <span>Period 3</span>
            <strong>Lesson 7</strong>
            <p>One class behind</p>
          </div>
          <div>
            <span>Period 5</span>
            <strong>Lesson 9</strong>
            <p>Ahead</p>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-heading">
          <p className="eyebrow">What it gives teachers</p>
          <h2>Powerful enough for the year. Simple enough for the next period.</h2>
        </div>
        <div className="landing-pillar-grid">
          {productPillars.map((pillar) => (
            <article key={pillar.title}>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-ai-section">
        <div>
          <p className="eyebrow">Practical helpers</p>
          <h2>AI only where it saves time.</h2>
          <p>
            TeacherOS keeps AI in the background: read a messy schedule, draft starter segments, suggest
            pacing, or clean up notes. Teachers review before anything is saved.
          </p>
        </div>
        <div className="landing-helper-list">
          <span>Import a schedule</span>
          <span>Break lessons into segments</span>
          <span>Suggest pacing after missed days</span>
          <span>Create a catch-up plan</span>
        </div>
      </section>

      <section className="landing-test-section" id="test">
        <div>
          <p className="eyebrow">Good first pilot</p>
          <h2>Start small. Prove the core idea in one afternoon.</h2>
          <p>
            Create one course, add two or three periods, add meeting times, build two lessons, and use
            Classroom Mode to mark where each period stops.
          </p>
        </div>
        <Link className="button-link" to={appTarget}>
          {appLabel}
        </Link>
      </section>

      <section className="landing-final-cta">
        <p className="eyebrow">TeacherOS</p>
        <h2>Your course plan, your periods, your next move.</h2>
        <p>
          A calmer way to manage the school year, built around the real rhythm of teaching.
        </p>
        <div className="landing-actions">
          <Link className="button-link" to={appTarget}>
            {appLabel}
          </Link>
          <Link className="button-link secondary" to="/login">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
