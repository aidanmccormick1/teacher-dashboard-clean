import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

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
    this.setState({ error, errorInfo });
  }

  private copyReport = async () => {
    const report = [
      'TeacherOS frontend error',
      `Page: ${window.location.pathname}`,
      `Message: ${this.state.error?.message ?? 'Unknown error'}`,
      '',
      this.state.errorInfo?.componentStack ?? ''
    ].join('\n');

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
            Your work should still be saved if it already reached the server. Try reloading, or copy the report so we
            can fix the exact screen.
          </p>
          <pre>{this.state.error.message}</pre>
          <div className="profile-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button className="secondary" type="button" onClick={() => window.location.assign('/')}>
              Go to dashboard
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
