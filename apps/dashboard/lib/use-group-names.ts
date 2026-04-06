'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

let cache: Map<string, string> | null = null;
let loading = false;
const listeners: Set<() => void> = new Set();

async function fetchGroups() {
  if (cache || loading) return;
  loading = true;
  const { data } = await supabase.from('groups').select('group_id, name');
  cache = new Map((data ?? []).map((g: { group_id: string; name: string | null }) => [g.group_id, g.name ?? g.group_id]));
  loading = false;
  listeners.forEach(fn => fn());
}

export function useGroupNames(): (id: string) => string {
  const [, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick(t => t + 1);
    listeners.add(refresh);
    void fetchGroups();
    return () => { listeners.delete(refresh); };
  }, []);

  return (id: string) => cache?.get(id) ?? id;
}
