import * as Y from "yjs";
import type { editor as monacoTypes } from "monaco-editor";
import type { Awareness } from "y-protocols/awareness";

/**
 * Custom Monaco ↔ Yjs binding that replaces y-monaco.
 *
 * Handles:
 *  1. Local edits → Y.Text (via model.onDidChangeContent)
 *  2. Remote edits → Monaco model (via ytext.observe)
 *  3. Cursor/selection awareness (via awareness + decorations)
 *
 * Uses a simple boolean mutex to prevent echo loops between
 * the two directions.
 */

type Disposable = { dispose(): void };

export class MonacoYjsBinding {
  private ytext: Y.Text;
  private model: monacoTypes.ITextModel;
  private editor: monacoTypes.IStandaloneCodeEditor;
  private awareness: Awareness | null;

  private mutex = true; // true = free, false = locked
  private disposables: Disposable[] = [];
  private decorationCollection: monacoTypes.IEditorDecorationsCollection | null = null;
  private isDestroyed = false;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    ytext: Y.Text,
    model: monacoTypes.ITextModel,
    editor: monacoTypes.IStandaloneCodeEditor,
    awareness: Awareness | null = null,
  ) {
    this.ytext = ytext;
    this.model = model;
    this.editor = editor;
    this.awareness = awareness;

    // --- Initial sync: set model content to match Y.Text ---
    const ytextValue = ytext.toString();
    if (model.getValue() !== ytextValue) {
      model.setValue(ytextValue);
    }

    // --- 1. Local edits → Y.Text ---
    const modelChangeDisposable = model.onDidChangeContent((event) => {
      if (!this.mutex) return; // skip if we're applying remote changes
      this.mutex = false;
      try {
        const doc = ytext.doc;
        if (!doc) return;
        doc.transact(() => {
          // Apply changes from right-to-left so offsets stay valid
          const sortedChanges = [...event.changes].sort(
            (a, b) => b.rangeOffset - a.rangeOffset,
          );
          for (const change of sortedChanges) {
            if (change.rangeLength > 0) {
              ytext.delete(change.rangeOffset, change.rangeLength);
            }
            if (change.text) {
              ytext.insert(change.rangeOffset, change.text);
            }
          }
        }, this); // origin = this binding instance
      } finally {
        this.mutex = true;
      }

      // Broadcast typing indicator via awareness
      if (awareness) {
        awareness.setLocalStateField("isTyping", true);
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
          if (!this.isDestroyed && awareness) {
            awareness.setLocalStateField("isTyping", false);
          }
        }, 1000);
      }
    });
    this.disposables.push(modelChangeDisposable);

    // --- 2. Remote edits → Monaco model (Y.Text observer) ---
    this._ytextObserver = this._ytextObserver.bind(this);
    ytext.observe(this._ytextObserver);

    // --- 3. Cursor/selection awareness ---
    if (awareness) {
      // Track local cursor position → broadcast via awareness
      const cursorDisposable = editor.onDidChangeCursorSelection(() => {
        if (editor.getModel() !== model) return;
        const sel = editor.getSelection();
        if (!sel) return;

        let anchor = model.getOffsetAt(sel.getStartPosition());
        let head = model.getOffsetAt(sel.getEndPosition());
        // Detect RTL selection direction
        if (
          sel.getDirection() === 1 /* SelectionDirection.RTL */
        ) {
          const tmp = anchor;
          anchor = head;
          head = tmp;
        }

        awareness.setLocalStateField("selection", {
          anchor: Y.createRelativePositionFromTypeIndex(ytext, anchor),
          head: Y.createRelativePositionFromTypeIndex(ytext, head),
        });
      });
      this.disposables.push(cursorDisposable);

      // Render remote cursors when awareness changes
      this._onAwarenessChange = this._onAwarenessChange.bind(this);
      awareness.on("change", this._onAwarenessChange);

      // Create decorations collection (modern API, replaces deprecated deltaDecorations)
      this.decorationCollection = editor.createDecorationsCollection([]);
    }
  }

  /** Handle remote Y.Text changes → apply to Monaco model */
  private _ytextObserver(event: Y.YTextEvent) {
    if (!this.mutex) return; // skip if we caused this change
    this.mutex = false;
    try {
      let index = 0;
      for (const op of event.delta) {
        if (op.retain !== undefined) {
          index += op.retain;
        } else if (op.insert !== undefined) {
          const text = op.insert as string;
          const pos = this.model.getPositionAt(index);
          this.model.applyEdits([
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text,
            },
          ]);
          index += text.length;
        } else if (op.delete !== undefined) {
          const pos = this.model.getPositionAt(index);
          const endPos = this.model.getPositionAt(index + op.delete);
          this.model.applyEdits([
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: "",
            },
          ]);
        }
      }
    } finally {
      this.mutex = true;
    }
    this._renderRemoteCursors();
  }

  /** Render remote user cursors/selections as editor decorations */
  private _onAwarenessChange() {
    this._renderRemoteCursors();
  }

  private _renderRemoteCursors() {
    if (!this.awareness || !this.decorationCollection || this.isDestroyed) return;
    const doc = this.ytext.doc;
    if (!doc) return;

    const newDecorations: monacoTypes.IModelDeltaDecoration[] = [];

    this.awareness.getStates().forEach((state, clientID) => {
      if (clientID === doc.clientID) return;
      const sel = state.selection as
        | { anchor: Y.RelativePosition; head: Y.RelativePosition }
        | undefined;
      if (!sel?.anchor || !sel?.head) return;

      const anchorAbs = Y.createAbsolutePositionFromRelativePosition(
        sel.anchor,
        doc,
      );
      const headAbs = Y.createAbsolutePositionFromRelativePosition(
        sel.head,
        doc,
      );
      if (!anchorAbs || !headAbs) return;
      if (anchorAbs.type !== this.ytext || headAbs.type !== this.ytext) return;

      let startIdx: number, endIdx: number;
      let afterContentClassName: string | null = null;
      let beforeContentClassName: string | null = null;

      if (anchorAbs.index < headAbs.index) {
        startIdx = anchorAbs.index;
        endIdx = headAbs.index;
        afterContentClassName = `yRemoteSelectionHead yRemoteSelectionHead-${clientID}`;
      } else {
        startIdx = headAbs.index;
        endIdx = anchorAbs.index;
        beforeContentClassName = `yRemoteSelectionHead yRemoteSelectionHead-${clientID}`;
      }

      const start = this.model.getPositionAt(startIdx);
      const end = this.model.getPositionAt(endIdx);

      newDecorations.push({
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        options: {
          className: `yRemoteSelection yRemoteSelection-${clientID}`,
          afterContentClassName,
          beforeContentClassName,
          stickiness: 1, // NeverGrowsWhenTypingAtEdges
        },
      });
    });

    this.decorationCollection.set(newDecorations);
  }

  destroy() {
    this.isDestroyed = true;

    // Clear typing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }

    // Dispose Monaco listeners
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    // Remove Y.Text observer
    this.ytext.unobserve(this._ytextObserver);

    // Remove awareness listener
    if (this.awareness) {
      this.awareness.off("change", this._onAwarenessChange);
    }

    // Clear decorations
    if (this.decorationCollection) {
      this.decorationCollection.clear();
      this.decorationCollection = null;
    }
  }
}
