'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/assistant';

/** The Supabase (HybridLog) session, kept in sync across all open meal panels. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const auth = supabase().auth;
    void auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().auth.signInWithPassword({ email, password });
    if (err) setError(err.message === 'Invalid login credentials' ? 'Nesprávny e-mail alebo heslo.' : err.message);
    setBusy(false);
  };
  return (
    <form className="grid gap-2" onSubmit={(e) => void submit(e)}>
      <p className="text-stone-600">Prihláste sa rovnakým účtom ako v HybridLogu. Pomocník pozná váš profil a ciele odtiaľ.</p>
      <input className="input" type="email" autoComplete="email" placeholder="E-mail" required value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail" />
      <input className="input" type="password" autoComplete="current-password" placeholder="Heslo" required value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Heslo" />
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Prihlasujem…' : 'Prihlásiť sa'}</button>
      {error && <p className="text-red-700">{error}</p>}
    </form>
  );
}

