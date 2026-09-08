import { storage } from 'lib/storage';

import type { Tab } from './interfaces';

interface Store<A> {
  set(v: string): A;
  get(): A;
}

export interface Stores {
  tab: Store<Tab>;
}

interface Config<A> {
  key: string;
  fix(v: string | null): A;
}

const tab: Config<Tab> = {
  key: 'lobby.tab',
  fix(t: string | null): Tab {
    if (<Tab>t) return t as Tab;
    return 'pools';
  },
};
function makeStore<A>(conf: Config<A>, userId?: string): Store<A> {
  const fullKey = conf.key + ':' + (userId || '-');
  return {
    set(v: string): A {
      const t: A = conf.fix(v);
      storage.set(fullKey, String(t));
      return t;
    },
    get(): A {
      return conf.fix(storage.get(fullKey));
    },
  };
}

export function make(userId?: string): Stores {
  return {
    tab: makeStore<Tab>(tab, userId),
  };
}
