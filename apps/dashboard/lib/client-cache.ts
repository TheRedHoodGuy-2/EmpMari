/**
 * Client-side in-memory cache shared across all tabs/components.
 * Avoids re-fetching the same data (card-db, groups, people) when
 * switching tabs or mounting multiple components in the same session.
 *
 * Usage:
 *   const cards = await clientCache.getCardDb();
 *   const groups = await clientCache.getGroups();
 *   const people = await clientCache.getPeople();
 */

type CardDb = {
  card_id: string; name: string; series: string | null; tier: string | null;
  stars: number | null; image_url: string | null; description: string | null;
  event: string | null; wishlist_count: number; owner_names: string; scraped_at: string | null;
};

type Group = { group_id: string; name: string | null };

type Person = {
  id: string; jid: string; number: string; display_name: string | null;
  gcs: string[]; last_seen: string | null;
};

const TTL = 10 * 60 * 1000; // 10 minutes

function makeSlot<T>() {
  let data: T | null = null;
  let fetchedAt = 0;
  let inflight: Promise<T> | null = null;

  return {
    async get(fetcher: () => Promise<T>, bust = false): Promise<T> {
      if (!bust && data && Date.now() - fetchedAt < TTL) return data;
      // Deduplicate concurrent callers — only one fetch in flight at a time
      if (!inflight) {
        inflight = fetcher().then(result => {
          data = result;
          fetchedAt = Date.now();
          inflight = null;
          return result;
        }).catch(err => {
          inflight = null;
          throw err;
        });
      }
      return inflight;
    },
    invalidate() { data = null; fetchedAt = 0; },
  };
}

const cardDbSlot  = makeSlot<CardDb[]>();
const groupsSlot  = makeSlot<Group[]>();
const peopleSlot  = makeSlot<Person[]>();

export const clientCache = {
  async getCardDb(bust = false): Promise<CardDb[]> {
    return cardDbSlot.get(async () => {
      const res = await fetch(`/api/card-db${bust ? '?bust=1' : ''}`);
      if (!res.ok) throw new Error(`card-db fetch failed: ${res.status}`);
      return res.json() as Promise<CardDb[]>;
    }, bust);
  },

  async getGroups(bust = false): Promise<Group[]> {
    return groupsSlot.get(async () => {
      const res = await fetch(`/api/groups${bust ? '?bust=1' : ''}`);
      if (!res.ok) throw new Error(`groups fetch failed: ${res.status}`);
      return res.json() as Promise<Group[]>;
    }, bust);
  },

  async getPeople(bust = false): Promise<Person[]> {
    return peopleSlot.get(async () => {
      const res = await fetch(`/api/people${bust ? '?bust=1' : ''}`);
      if (!res.ok) throw new Error(`people fetch failed: ${res.status}`);
      return res.json() as Promise<Person[]>;
    }, bust);
  },

  /** Call after a scrape completes so next getCardDb() re-fetches. */
  invalidateCardDb() { cardDbSlot.invalidate(); },
  invalidateGroups()  { groupsSlot.invalidate(); },
  invalidatePeople()  { peopleSlot.invalidate(); },
};
