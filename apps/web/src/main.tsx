import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { AppAuthProvider } from './lib/auth.js';
import { FeedbackProvider } from './components/FeedbackProvider.js';
import './styles.css';
import { startFeedbackDiagnostics } from './lib/feedbackDiagnostics.js';

const stopFeedbackDiagnostics = startFeedbackDiagnostics();
if (import.meta.hot) import.meta.hot.dispose(stopFeedbackDiagnostics);

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.user;
      delete event.request;
      delete event.breadcrumbs;
      delete event.extra;
      if (event.message) event.message = 'Application error';
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((exception) => ({
          type: [
            'TypeError',
            'RangeError',
            'ReferenceError',
            'SyntaxError',
            'URIError',
            'AbortError'
          ].includes(exception.type ?? '')
            ? exception.type
            : 'Error',
          value: 'Application error'
        }));
      }
      return event;
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppAuthProvider>
      <BrowserRouter>
        <FeedbackProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </FeedbackProvider>
      </BrowserRouter>
    </AppAuthProvider>
  </React.StrictMode>
);
