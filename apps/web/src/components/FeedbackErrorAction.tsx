import { openFeedbackForError } from '../lib/feedbackDiagnostics.js';

export function FeedbackErrorAction({
  description = 'I could not complete an action on this page.'
}: {
  description?: string;
}) {
  return (
    <button
      type="button"
      className="secondary"
      data-feedback-component="report-issue"
      onClick={() => openFeedbackForError(description)}
    >
      Report issue
    </button>
  );
}
