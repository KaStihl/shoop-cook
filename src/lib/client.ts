'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Plan } from './types';

export interface StoredPlan {
  plan: Plan;
  locks: string[];
  seen: Record<string, number[]>;
}

export const slotKey = (day: number, meal: string): string => `${day}:${meal}`;
export const eur = (value: number): string => value.toLocaleString('sk-SK', { style: 'currency', currency: 'EUR' });
export const amount = (grams: number, liquid = false): string =>
  grams >= 1000 ? `${(grams / 1000).toLocaleString('sk-SK', { maximumFractionDigits: 2 })} ${liquid ? 'l' : 'kg'}` : `${Math.round(grams)} ${liquid ? 'ml' : 'g'}`;
export const dateSk = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '–');

/** localStorage-backed state; `ready` turns true once the stored value has been read on the client. */
export function useStored<T>(key: string, initial: T, revive?: (raw: unknown) => T): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(revive ? revive(JSON.parse(raw)) : (JSON.parse(raw) as T));
    } catch {
      localStorage.removeItem(key);
    }
    setReady(true);
    // `revive` is a stable module-level function at every call site, so it is not a dependency.
  }, [key]);
  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Storage full or blocked: the state still works for this session.
      }
      return resolved;
    });
  }, [key]);
  return [value, update, ready];
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init?.body ? { ...init, headers: { 'content-type': 'application/json' } } : init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Požiadavka zlyhala (${response.status}).`);
  return data;
}
