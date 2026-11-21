import { json, jsonHeader, xhrHeader } from 'lib/xhr';

import {
  boardFileKind,
  boardSources,
  type BoardShape,
  type BoardSource,
  type BoardSubmission,
  type MessageBoard,
} from './boardContent';

export class DraftBoard {
  readonly key = window.crypto.randomUUID();
  readonly marks = new Map<number, BoardShape[]>();
  board?: MessageBoard;
  current = 0;
  drawing = false;
  start?: number;
  failed = false;
  private readonly abort = new AbortController();
  private readonly timer: Timeout;

  constructor(
    readonly source: BoardSource,
    private readonly redraw: () => void,
    delay: number,
  ) {
    this.timer = setTimeout(() => void this.load(), delay);
  }

  private async load() {
    const signal = this.abort.signal;
    try {
      const board = await json<MessageBoard>('/inbox/board-preview', {
        method: 'POST',
        headers: { ...jsonHeader, ...xhrHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(this.source),
        signal,
      });
      if (signal.aborted) return;
      this.board = board;
      this.current = board.start;
    } catch {
      if (signal.aborted) return;
      this.failed = true;
    }
    this.redraw();
  }

  dispose() {
    clearTimeout(this.timer);
    this.abort.abort();
  }

  submission(): BoardSubmission | undefined {
    const board = this.board;
    if (!board) return;
    return {
      source: this.source,
      start: this.start ?? board.start,
      end: board.frames[board.frames.length - 1].ply,
      marks: board.frames.flatMap(frame => {
        const shapes = this.marks.get(frame.ply);
        return shapes?.length ? [{ ply: frame.ply, fen: frame.fen, shapes }] : [];
      }),
    };
  }

  snapshot(): MessageBoard {
    const board = this.board!;
    return {
      ...board,
      inline: this.source.inline ? this.source.value : undefined,
      start: this.start ?? board.start,
      frames: board.frames.map(frame => ({
        ...frame,
        shapes: [...frame.shapes, ...(this.marks.get(frame.ply) ?? [])],
      })),
    };
  }
}

export class BoardDraft {
  readonly entries: DraftBoard[] = [];
  private readonly dismissed = new Set<string>();
  private filesReading = 0;
  private cleared = false;
  fileError = false;

  constructor(private readonly redraw: () => void) {}

  get ready() {
    return (
      this.filesReading === 0 &&
      this.entries.every(entry => entry.board || (entry.failed && entry.source.inline))
    );
  }

  get active() {
    return this.filesReading > 0 || this.entries.some(entry => entry.board || !entry.failed);
  }

  update(text: string) {
    const sources = boardSources(text);
    const present = new Set(sources.map(source => source.value));
    for (const value of this.dismissed) if (!present.has(value)) this.dismissed.delete(value);
    for (const entry of this.entries.filter(entry => entry.source.inline && !present.has(entry.source.value)))
      this.remove(entry, false);
    for (const source of sources)
      if (
        !this.dismissed.has(source.value) &&
        !this.entries.some(entry => entry.source.value === source.value)
      )
        this.add(source, 300);
  }

  takeFile = (file: File): boolean => {
    const kind = boardFileKind(file.name);
    if (!kind) return false;
    if (file.size > 16_000 || this.entries.length + this.filesReading >= 3) {
      this.fileError = true;
      this.redraw();
      return true;
    }
    this.filesReading++;
    this.fileError = false;
    this.redraw();
    void file
      .text()
      .then(value => {
        if (!this.cleared) this.add({ kind, value, inline: false }, 0);
      })
      .catch(() => {
        this.fileError = true;
      })
      .finally(() => {
        this.filesReading--;
        this.redraw();
      });
    return true;
  };

  takeLongPaste(text: string): boolean {
    if (text.length <= 8000 || this.entries.length >= 3) return false;
    const source = boardSources(text).find(source => source.value === text.trim() && source.kind === 'pgn');
    if (!source || new TextEncoder().encode(source.value).length > 16_000) return false;
    this.add({ ...source, inline: false }, 0);
    return true;
  }

  remove(entry: DraftBoard, dismiss = true) {
    const index = this.entries.indexOf(entry);
    if (index < 0) return;
    this.entries.splice(index, 1);
    entry.dispose();
    if (dismiss && entry.source.inline) this.dismissed.add(entry.source.value);
  }

  clear() {
    this.cleared = true;
    for (const entry of this.entries.splice(0)) entry.dispose();
    this.dismissed.clear();
    this.fileError = false;
  }

  private add(source: BoardSource, delay: number) {
    if (this.entries.length < 3) this.entries.push(new DraftBoard(source, this.redraw, delay));
  }
}
