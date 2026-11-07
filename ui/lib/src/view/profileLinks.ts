import { attributesModule, classModule, init, toVNode } from 'snabbdom';

import { usernamePattern } from '../username';
import { json } from '../xhr';
import { userLink } from './userLink';

interface Profile {
  id: string;
  username: string;
  title?: string;
  flair?: Flair;
  patronColor?: PatronColor;
  profile?: { flag?: string; country?: string };
  perfs?: { xiangqi?: { rank?: string } };
}

// Only plain account-name links opt in. Preserve links such as "read her profile".
export function profileLinkName(href: string, label: string, origin: string): string | undefined {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || url.search || url.hash) return;
    const match = /^\/@\/([^/]+)$/.exec(url.pathname);
    if (!match) return;
    const name = decodeURIComponent(match[1]);
    if (usernamePattern.test(name) && label.trim().replace(/^@/, '').toLowerCase() === name.toLowerCase())
      return name;
  } catch {
    // Invalid URLs and malformed escapes are not profile links.
  }
  return undefined;
}

export async function expandProfileLinks(root: ParentNode): Promise<void> {
  const links = new Map<string, HTMLAnchorElement[]>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.querySelector('img') || link.closest('pre, code')) continue;
    const name = profileLinkName(link.href, link.textContent ?? '', window.location.origin);
    if (!name) continue;
    const id = name.toLowerCase();
    if (!links.has(id)) links.set(id, []);
    links.get(id)!.push(link);
  }
  const ids = [...links.keys()];
  const patch = init([attributesModule, classModule]);
  // Match the public endpoint's limit, deduplicating repeated mentions before fetching.
  for (let offset = 0; offset < ids.length; offset += 300) {
    const profiles = await json<Profile[]>('/api/users', {
      method: 'POST',
      body: ids.slice(offset, offset + 300).join(','),
    });
    for (const profile of profiles)
      for (const link of links.get(profile.id) ?? [])
        patch(
          toVNode(link),
          userLink({
            name: profile.username,
            title: profile.title,
            flair: profile.flair,
            patronColor: profile.patronColor,
            flag: profile.profile?.flag ?? profile.profile?.country,
            rank: profile.perfs?.xiangqi?.rank,
          }),
        );
  }
}
