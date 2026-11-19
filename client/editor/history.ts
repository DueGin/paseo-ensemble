// Undo and redo over draft snapshots, for every edit in the team editor (typing, pickers, chips, AI edits, a proposal
// arriving). Typing in one field within a second is one step.
import { useCallback, useReducer, useRef } from "react";

const LIMIT = 200;
const GROUP_MS = 1000;

interface State<T> {
  past: T[];
  present: T;
  future: T[];
  group: string | null;
  at: number;
}

export interface History<T> {
  value: T;
  canUndo: boolean;
  canRedo: boolean;
  /** Records `next`; edits with the same `group` in quick succession merge into one step. */
  edit(next: T, group?: string): T;
  undo(): T | null;
  redo(): T | null;
  /** Starts over from `value`, forgetting the steps. */
  reset(value: T): void;
  /** Swaps the present value without a step: the same team, as the server wrote it. */
  replace(value: T): void;
  /** The latest value, also between renders. */
  current(): T;
}

export function useHistory<T>(initial: T): History<T> {
  const state = useRef<State<T>>({ past: [], present: initial, future: [], group: null, at: 0 });
  const [, render] = useReducer((count: number) => count + 1, 0);

  const edit = useCallback((next: T, group?: string) => {
    const now = Date.now();
    const s = state.current;
    if (next === s.present) return next;
    const merge = group !== undefined && group === s.group && now - s.at < GROUP_MS;
    state.current = { past: merge ? s.past : [...s.past, s.present].slice(-LIMIT), present: next, future: [], group: group ?? null, at: now };
    render();
    return next;
  }, []);

  const undo = useCallback(() => {
    const s = state.current;
    if (!s.past.length) return null;
    const previous = s.past[s.past.length - 1]!;
    state.current = { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future], group: null, at: 0 };
    render();
    return previous;
  }, []);

  const redo = useCallback(() => {
    const s = state.current;
    if (!s.future.length) return null;
    const next = s.future[0]!;
    state.current = { past: [...s.past, s.present], present: next, future: s.future.slice(1), group: null, at: 0 };
    render();
    return next;
  }, []);

  const reset = useCallback((value: T) => {
    state.current = { past: [], present: value, future: [], group: null, at: 0 };
    render();
  }, []);

  const replace = useCallback((value: T) => {
    state.current = { ...state.current, present: value, group: null, at: 0 };
    render();
  }, []);

  const current = useCallback(() => state.current.present, []);
  const s = state.current;
  return { value: s.present, canUndo: s.past.length > 0, canRedo: s.future.length > 0, edit, undo, redo, reset, replace, current };
}
