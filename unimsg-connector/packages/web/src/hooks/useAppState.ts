import { useSyncExternalStore } from 'react';
import { store } from '../store';
import type { AppState } from '../store/appStore';

/** 订阅全局应用状态 */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}