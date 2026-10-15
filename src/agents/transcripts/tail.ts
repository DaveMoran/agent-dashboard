import { stat } from "node:fs/promises";

export interface TailLine {
  text: string;
  offset: number;
}

export interface TailResult {
  lines: TailLine[];
  reset: boolean;
  bytesRead: number;
  changed: boolean;
}

/** Index after the first `\n`, or -1 when there is none. */
export function firstLineBoundary(bytes: Uint8Array): number {
  const i = bytes.indexOf(10);
  return i === -1 ? -1 : i + 1;
}

export class FileTail {
  readonly path: string;
  private offset = 0;
  private pending: Uint8Array = new Uint8Array(0);
  private size = -1;
  private mtimeMs = -1;

  constructor(path: string) {
    this.path = path;
  }

  async read(options?: { fromOffset?: number }): Promise<TailResult> {
    let st;
    try {
      st = await stat(this.path);
      if (!st.isFile()) throw new Error("not a regular file");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`unreadable: ${this.path}: ${msg}`);
    }

    let reset = false;
    if (st.size < this.offset) {
      this.offset = 0;
      this.pending = new Uint8Array(0);
      reset = true;
    }

    const fromOffset = options?.fromOffset;
    if (!reset && fromOffset === undefined && st.size === this.offset && st.mtimeMs === this.mtimeMs) {
      return { lines: [], reset: false, bytesRead: 0, changed: false };
    }

    let start = fromOffset ?? this.offset;
    if (fromOffset !== undefined) this.pending = new Uint8Array(0);
    if (start > st.size) start = st.size;

    let fresh: Uint8Array;
    try {
      fresh = start < st.size ? await Bun.file(this.path).slice(start, st.size).bytes() : new Uint8Array(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`unreadable: ${this.path}: ${msg}`);
    }

    const pendingLen = this.pending.length;
    const all = new Uint8Array(pendingLen + fresh.length);
    all.set(this.pending, 0);
    all.set(fresh, pendingLen);
    const baseOffset = start - pendingLen;

    const last = all.lastIndexOf(10);
    const lines: TailLine[] = [];
    if (last === -1) {
      this.pending = all;
    } else {
      const decoder = new TextDecoder();
      let lineStart = 0;
      while (lineStart <= last) {
        const nl = all.indexOf(10, lineStart);
        let end = nl;
        if (end > lineStart && all[end - 1] === 13) end -= 1;
        if (end > lineStart) {
          lines.push({
            text: decoder.decode(all.subarray(lineStart, end)),
            offset: baseOffset + lineStart,
          });
        }
        lineStart = nl + 1;
      }
      this.pending = all.slice(last + 1);
    }

    this.offset = st.size;
    this.size = st.size;
    this.mtimeMs = st.mtimeMs;
    return { lines, reset, bytesRead: fresh.length, changed: true };
  }
}
