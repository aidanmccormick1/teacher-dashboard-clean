import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import {
  openFeedbackForError,
  recordFeedbackError,
  snapshotFeedbackDiagnostics
} from '../lib/feedbackDiagnostics.js';

type ErrorBoundaryState = {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
};

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
    errorInfo: null,
    copied: false
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    recordFeedbackError('react_error_boundary', error);
    this.setState({ error, errorInfo });
  }

  private copyReport = async () => {
    const report = JSON.stringify(snapshotFeedbackDiagnostics(), null, 2);

    await navigator.clipboard?.writeText(report).catch(() => undefined);
    this.setState({ copied: true });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="crash-page">
        <section className="crash-card">
          <p className="eyebrow">Something broke</p>
          <h1>The app hit a snag.</h1>
          <p>
            Your work should still be saved if it already reached the server. Try reloading, or copy
            the report so we can fix the exact screen.
          </p>
          <p>Please report this issue so we can investigate the affected page.</p>
          <div className="profile-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => window.location.assign('/today')}
            >
              Go to Today
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => openFeedbackForError('The app stopped unexpectedly on this page.')}
            >
              Report issue
            </button>
            <button className="secondary" type="button" onClick={() => void this.copyReport()}>
              Copy report
            </button>
          </div>
          {this.state.copied ? <p className="notice success">Error report copied.</p> : null}
        </section>
      </main>
    );
  }
}
