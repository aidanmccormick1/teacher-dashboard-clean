import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useAppAuth } from '../lib/auth.js';

function CardNumber({ children }: { children: ReactNode }) {
  return <span className="note-card-number">{children}</span>;
}

export function LandingPage() {
  const auth = useAppAuth();
  const appTarget = auth.isSignedIn ? '/today' : '/login';
  const appLabel = 'Open TeacherDesk';

  return (
    <main className="landing-page note-page">
      <nav className="landing-nav note-nav" aria-label="TeacherDesk website navigation">
        <Link className="landing-brand brand-lockup" to="/">
          <span>TeacherDesk</span>
          <small>Calico EDU</small>
        </Link>
        <span className="note-nav-message">A calmer way to teach the day.</span>
        <div className="note-nav-actions">
          <Link to="/login">Sign in</Link>
          <Link className="landing-nav-cta" to={appTarget}>
            {appLabel}
          </Link>
        </div>
      </nav>

      <div className="note-stack" aria-label="How TeacherDesk helps teachers stay on track">
        <section className="note-card note-card-intro" id="start">
          <CardNumber>01</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">TeacherDesk</p>
            <h1>Know what you’re teaching next.</h1>
            <p className="note-lede">
              TeacherDesk keeps track of your classes, lessons, and where each period left off.
            </p>
            <div className="landing-actions">
              <Link className="button-link" to={appTarget}>
                Import your schedule
              </Link>
              <Link className="note-text-link" to={appTarget}>
                {appLabel} <span>→</span>
              </Link>
            </div>
          </div>
          <div className="note-preview next-class-preview" aria-label="Example next class">
            <span className="note-preview-label">Your next class</span>
            <strong>
              Period 3 <i>·</i> US History
            </strong>
            <div className="note-preview-rule" />
            <p>
              You stopped at <b>Source Analysis</b>
            </p>
            <p className="note-next-line">
              Next: <b>Primary Source Activity</b>
            </p>
          </div>
          <a className="note-scroll-cue" href="#classes">
            Scroll to flip through the day <span>↓</span>
          </a>
        </section>

        <section className="note-card note-card-classes" id="classes">
          <CardNumber>02</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">Same course, real classes</p>
            <h2>Every class moves differently.</h2>
            <p className="note-lede">
              You might teach the same course three times. That doesn’t mean every class stays in
              the same place.
            </p>
          </div>
          <div className="period-list" aria-label="Period progress example">
            <div>
              <span>Period 1</span>
              <strong>Lesson 8</strong>
              <em className="on-track">On track</em>
            </div>
            <div className="period-current">
              <span>Period 3</span>
              <strong>Lesson 7</strong>
              <em className="behind">1 class behind</em>
            </div>
            <div>
              <span>Period 5</span>
              <strong>Lesson 9</strong>
              <em className="ahead">Ahead</em>
            </div>
          </div>
          <span className="note-scribble">Same plan. Different days.</span>
        </section>

        <section className="note-card note-card-resume" id="resume">
          <CardNumber>03</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">The handoff</p>
            <h2>Pick up where you left off.</h2>
          </div>
          <div className="resume-note">
            <header>
              <span>US History</span>
              <b>Period 3</b>
            </header>
            <div>
              <small>Last class</small>
              <p>Finished source analysis.</p>
            </div>
            <div className="resume-today">
              <small>Today</small>
              <p>Start with the primary source activity.</p>
            </div>
            <div>
              <small>After class</small>
              <p>Mark where you stopped.</p>
            </div>
          </div>
        </section>

        <section className="note-card note-card-plan" id="plan">
          <CardNumber>04</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">One plan, many periods</p>
            <h2>Plan once. Teach every class.</h2>
            <p className="note-lede">
              Create the course once, then connect the actual classes you teach.
            </p>
          </div>
          <div className="course-connection" aria-label="US History connected to three periods">
            <div className="course-chip">
              <span>Course</span>
              <strong>US History</strong>
            </div>
            <div className="connection-line" aria-hidden="true" />
            <div className="connection-periods">
              <span>Period 1</span>
              <span>Period 3</span>
              <span>Period 5</span>
            </div>
            <p>Each class follows the same course while keeping its own progress.</p>
          </div>
        </section>

        <section className="note-card note-card-calendar" id="calendar">
          <CardNumber>05</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">Start with your real year</p>
            <h2>Your school year, already organized.</h2>
            <p className="note-lede">
              Import your schedule and school calendar. Then your schedule connects directly to what
              you’re teaching.
            </p>
          </div>
          <div className="calendar-note">
            <div className="calendar-top">
              <b>September</b>
              <span>2026</span>
            </div>
            <div className="calendar-days">
              <span>M</span>
              <span>T</span>
              <span>W</span>
              <span>T</span>
              <span>F</span>
              <i>7</i>
              <i>8</i>
              <i className="marked">9</i>
              <i>10</i>
              <i>11</i>
            </div>
            <div className="calendar-tags">
              <span>Classes</span>
              <span>Meeting times</span>
              <span>Breaks</span>
              <span>Days off</span>
            </div>
          </div>
        </section>

        <section className="note-card note-card-day" id="day">
          <CardNumber>06</CardNumber>
          <div className="note-card-copy">
            <p className="eyebrow">The point of it all</p>
            <h2>Open it. Know what’s next.</h2>
          </div>
          <div className="day-agenda">
            <header>
              <span>Monday</span>
              <small>Your teaching day</small>
            </header>
            <div>
              <time>8:00</time>
              <p>
                <b>Period 1</b>
                <span>Lesson 8</span>
              </p>
            </div>
            <div className="agenda-next">
              <time>10:15</time>
              <p>
                <b>Period 3</b>
                <span>Resume Lesson 7</span>
              </p>
            </div>
            <div>
              <time>1:20</time>
              <p>
                <b>Period 5</b>
                <span>Lesson 9</span>
              </p>
            </div>
          </div>
          <div className="note-card-footer">
            <Link className="button-link" to={appTarget}>
              {appLabel}
            </Link>
            <span>Teach your day with less guesswork.</span>
          </div>
        </section>
      </div>
    </main>
  );
}
