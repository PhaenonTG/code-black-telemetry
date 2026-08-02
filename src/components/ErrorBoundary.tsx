import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Code Black UI crash", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="cb-crash-screen">
        <div className="cb-crash-card">
          <div className="cb-crash-title">SYSTEM FAULT</div>
          <p className="cb-crash-message">The dashboard hit an unexpected error and stopped rendering. Your Pi connection and last-known telemetry are unaffected.</p>
          <pre className="cb-crash-detail">{error.message}</pre>
          <button className="cb-crash-reload" onClick={this.handleReload}>Reload Dashboard</button>
        </div>
      </div>
    );
  }
}
