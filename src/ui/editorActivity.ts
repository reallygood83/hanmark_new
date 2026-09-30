import { EditorView, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, MarkdownView } from "obsidian";

/**
 * One source of "the cursor moved or the text changed" for the toolbar state, the
 * status bar, and the preview's follow mode (R-028). Obsidian has no workspace event
 * for selection changes, so a CodeMirror update listener is registered once and
 * fans out to subscribers, each with its own delay.
 */
export interface EditorActivity {
  /** The Markdown view whose editor changed (null for other editors, such as canvas cards). */
  view: MarkdownView | null;
  path: string | null;
  docChanged: boolean;
  selectionSet: boolean;
  focusChanged: boolean;
}

export type EditorActivityListener = (activity: EditorActivity) => void;

interface Subscription {
  listener: EditorActivityListener;
  delay: number;
  timer: number | null;
  pending: EditorActivity | null;
}

function merge(previous: EditorActivity | null, next: EditorActivity): EditorActivity {
  if (!previous || previous.view !== next.view) return next;
  return {
    ...next,
    docChanged: previous.docChanged || next.docChanged,
    selectionSet: previous.selectionSet || next.selectionSet,
    focusChanged: previous.focusChanged || next.focusChanged
  };
}

export class EditorActivityHub {
  private readonly subscriptions = new Set<Subscription>();

  /** Register with `Plugin.registerEditorExtension`. */
  readonly extension = EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
    const info = update.state.field(editorInfoField, false);
    this.emit({
      view: info instanceof MarkdownView ? info : null,
      path: info?.file?.path ?? null,
      docChanged: update.docChanged,
      selectionSet: update.selectionSet,
      focusChanged: update.focusChanged
    });
  });

  /** Calls `listener` at most once per `delayMs` quiet period, with the flags of all merged updates. */
  subscribe(listener: EditorActivityListener, delayMs = 0): () => void {
    const subscription: Subscription = { listener, delay: delayMs, timer: null, pending: null };
    this.subscriptions.add(subscription);
    return () => {
      if (subscription.timer !== null) window.clearTimeout(subscription.timer);
      this.subscriptions.delete(subscription);
    };
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      if (subscription.timer !== null) window.clearTimeout(subscription.timer);
    }
    this.subscriptions.clear();
  }

  private emit(activity: EditorActivity): void {
    for (const subscription of this.subscriptions) {
      if (subscription.delay <= 0) {
        subscription.listener(activity);
        continue;
      }
      subscription.pending = merge(subscription.pending, activity);
      if (subscription.timer !== null) window.clearTimeout(subscription.timer);
      subscription.timer = window.setTimeout(() => {
        subscription.timer = null;
        const pending = subscription.pending;
        subscription.pending = null;
        if (pending && this.subscriptions.has(subscription)) subscription.listener(pending);
      }, subscription.delay);
    }
  }
}
