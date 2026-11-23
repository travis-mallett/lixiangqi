import { attributesModule, classModule, h, init, type VNode } from 'snabbdom';

import { userLink } from 'lib/view/userLink';
import { json } from 'lib/xhr';

type Player = LightUserNoId & { group?: boolean };
interface Profile extends LightUserNoId {
  id: string;
  username: string;
  picture?: string;
  profile?: { flag?: string };
  perfs?: { xiangqi?: { rank?: string; rating?: number; prov?: boolean } };
}

// Match the native PlayerName directory. Batch visible identities in a single public API request.
const cache = new Map<string, { profile?: Profile; until: number }>();
const pending = new Map<string, Set<(profile?: Profile) => void>>();
const queued = new Set<string>();
let frame: number | undefined;
function lookup(id: string, ready: (profile?: Profile) => void) {
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return ready(hit.profile);
  const callbacks = pending.get(id);
  if (callbacks) {
    callbacks.add(ready);
    return;
  }
  pending.set(id, new Set([ready]));
  queued.add(id);
  if (frame === undefined) frame = requestAnimationFrame(flush);
}
async function flush() {
  frame = undefined;
  const ids = [...queued].slice(0, 100);
  ids.forEach(id => queued.delete(id));
  if (queued.size) frame = requestAnimationFrame(flush);
  let profiles: Profile[] = [];
  try {
    profiles = await json<Profile[]>('/api/users', { method: 'POST', body: ids.join(',') });
  } catch {
    /* Keep the supplied identity available offline. */
  }
  const found = new Map(profiles.map(p => [p.id, p]));
  for (const id of ids) {
    const profile = found.get(id);
    cache.delete(id);
    cache.set(id, { profile, until: Date.now() + (profile ? 300000 : 30000) });
    if (cache.size > 512) cache.delete(cache.keys().next().value!);
    const callbacks = pending.get(id);
    pending.delete(id);
    callbacks?.forEach(fn => fn(profile));
  }
}

export function playerElement(user: Player | string, alias?: string): HTMLElement {
  const supplied = typeof user === 'string' ? { name: user } : user;
  const el = document.createElement('span');
  el.className = 'msg-player user-link';
  const render = (profile?: Profile) => {
    const p = profile ?? supplied;
    el.replaceChildren();
    if (p.patron || p.patronColor) {
      const wing = document.createElement('icon');
      wing.className = 'line patron paco' + (p.patronColor ?? 1);
      if (p.patronColor) wing.style.color = 'var(--c-patron-' + p.patronColor + ')';
      el.append(wing);
    }
    el.append([p.title, alias ?? profile?.username ?? supplied.name].filter(Boolean).join(' '));
    const rank = profile?.perfs?.xiangqi?.rank;
    if (rank) el.append(' (' + rank + ')');
    const image = (cls: string, src: string) => {
      const img = document.createElement('img');
      img.className = cls;
      img.alt = '';
      img.src = src;
      el.append(img);
    };
    if (p.flair) image('uflair', site.asset.flairSrc(p.flair));
    const flag = profile?.profile?.flag;
    if (flag && /^[a-z0-9_-]+$/i.test(flag)) image('flag', site.asset.url('flags/' + flag + '.webp'));
  };
  render();
  if (!supplied.group) lookup(supplied.name.toLowerCase(), render);
  return el;
}
export function playerName(user: Player | string, alias?: string): VNode {
  const name = typeof user === 'string' ? user : user.name;
  return h('span.msg-player-slot', {
    key: name + (alias ?? ''),
    hook: { insert: v => v.elm!.appendChild(playerElement(user, alias)) },
  });
}

const patchProfileLink = init([attributesModule, classModule]);

export function playerProfileLink(name: string): VNode {
  return h('span', {
    key: name,
    hook: {
      insert(vnode) {
        const host = vnode.elm as HTMLElement;
        const link = patchProfileLink(host.appendChild(document.createElement('a')), userLink({ name }));
        lookup(name.toLowerCase(), profile => {
          const perf = profile?.perfs?.xiangqi;
          patchProfileLink(
            link,
            userLink({
              ...profile,
              name: profile?.username ?? name,
              flag: profile?.profile?.flag,
              rank: perf?.rank,
              rating: perf?.rating,
              provisional: perf?.prov,
            }),
          );
        });
      },
    },
  });
}

export function loadAvatar(el: HTMLElement, id: string) {
  lookup(id.toLowerCase(), profile => {
    if (!profile?.picture) return;
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'msg-avatar-photo';
    img.onload = () => el.append(img);
    img.src = profile.picture;
  });
}

// Signal Desktop AxoTokens.Avatar, A100 through A210.
export function avatarColor(id: string) {
  let hash = 0;
  for (const char of id.toLowerCase()) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return 'msg-avatar-' + (hash % 12);
}
