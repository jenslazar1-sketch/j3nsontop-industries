/* One loaded APK, shared by every screen.
 *
 * A module-level store rather than Context because the analysed object holds a
 * multi-megabyte Uint8Array: keeping it outside the React tree means navigating
 * between tabs re-renders the views without ever copying the payload. */
import { useSyncExternalStore } from 'react';
import type { PickedFile } from './files';

export interface Analysis {
  size: number;
  zip: any;
  manifest: any;
  facts: {
    package: string | null;
    versionName: string | null;
    versionCode: string | null;
    minSdk: string | null;
    targetSdk: string | null;
    compileSdk: string | null;
    application: string | null;
    debuggable: boolean;
    permissions: string[];
    features: Array<{ name: string; required: boolean }>;
    activities: string[];
  };
  dexStats: Array<{ name: string; size: number; classes: number; strings: number }>;
  certs: any[];
  libs: Array<{
    abi: string; name: string; size: number;
    machine: string | null; is64: boolean | null;
    needed: string[]; soname: string | null; error: string | null;
  }>;
  shape: {
    entries: number; total: number; compressed: number;
    dexCount: number; dexBytes: number; libCount: number; libBytes: number;
    resBytes: number; assetBytes: number; abis: string[];
    biggest: Array<{ name: string; size: number }>;
  };
  vr: any;
  vrVerdict: { level: string; text: string } | null;
  tamper: any;
  errors: string[];
}

export interface State {
  file: PickedFile | null;
  analysis: Analysis | null;
  busy: boolean;
  error: string | null;
  elapsedMs: number;
}

let state: State = { file: null, analysis: null, busy: false, error: null, elapsedMs: 0 };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

export function setState(patch: Partial<State>) {
  Object.assign(state, patch);
  emit();
}

export function clear() {
  state = { file: null, analysis: null, busy: false, error: null, elapsedMs: 0 };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function snapshot() { return state; }

export function useApk(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
