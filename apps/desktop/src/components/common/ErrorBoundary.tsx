import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocale } from "../../i18n";

type State = { error: Error | null };

/**
 * Last-resort guard: a render error shows a message with a way back instead of a blank
 * window. Unsaved draft edits that broke rendering are not autosaved (an invalid draft is
 * never flushed), so reloading returns to the last saved project state.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const vi = useLocale.getState().locale === "vi";
    return (
      <div className="error-boundary" role="alert">
        <h2>{vi ? "Màn hình gặp lỗi hiển thị" : "Something went wrong on this screen"}</h2>
        <p>
          {vi
            ? "Thay đổi chưa lưu gây lỗi sẽ không được ghi. Tải lại để về trạng thái đã lưu gần nhất."
            : "The unsaved change that caused it was not saved. Reload to return to the last saved state."}
        </p>
        <pre>{this.state.error.message}</pre>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          {vi ? "Tải lại" : "Reload"}
        </button>
      </div>
    );
  }
}
