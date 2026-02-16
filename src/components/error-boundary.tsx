'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen flex items-center justify-center bg-[#050508]">
          <div className="text-center p-8">
            <div className="text-4xl mb-4">V</div>
            <h2 className="text-lg text-white/80 mb-2">Something went wrong</h2>
            <p className="text-sm text-white/40 mb-4">Vinegar encountered an error.</p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="px-4 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-400 text-sm hover:bg-amber-500/30 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
