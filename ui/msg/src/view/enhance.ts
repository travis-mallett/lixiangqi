import { escapeHtml } from 'lib/index';
import { licon } from 'lib/licon';
import { linkReplace, newLineRegex, expandMentions } from 'lib/richText';

import { messageLinks } from '../links';
import { scroller } from './scroller';
export { isMoreThanText } from 'lib/richText';

const teamMessageRegex =
  /You received this because you are subscribed to messages of the team (<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>[^<]*<\/a>)\.$/;

const expandGameIds = (html: string) =>
  html.replace(
    /(\s#)([\w]{8})($|[^\w-])/g,
    (_: string, bulkStart: string, id: string, suffix: string) =>
      ' ' + linkReplace('/' + id, '#' + id, !bulkStart) + suffix,
  );

const expandTeamMessage = (html: string) =>
  html.replace(teamMessageRegex, (original, anchor: string, url: string) => {
    const team = new URL(url);
    if (team.host !== window.location.host || !/^\/team\/[\w-]+$/.test(team.pathname)) return original;
    return (
      anchor +
      ' <form action="' +
      team.pathname +
      '/subscribe" class="unsub" method="post"><button type="submit" class="button button-empty button-thin button-red">Unsubscribe from these messages</button></form>'
    );
  });

export function enhance(str: string) {
  const plain = (s: string) => expandGameIds(expandMentions(escapeHtml(s)));
  let end = 0;
  let html = '';
  for (const match of messageLinks(str)) {
    html += plain(str.slice(end, match.index)) + linkReplace(escapeHtml(match.url), escapeHtml(match.text));
    end = match.lastIndex;
  }
  return expandTeamMessage(html + plain(str.slice(end))).replace(newLineRegex, '<br>');
}

type Expandable = {
  element: HTMLElement;
  link: Link;
};
type Link = {
  type: LinkType;
  src: string;
  opts: any;
};
type LinkType = 'game';

const domain = window.location.host;
const gameRegex = new RegExp(
  `(?:https?://)${domain}/(?:embed/)?(?:game/)?(\\w{8})(?:(?:/(white|black))|\\w{4}|)(?:(?:#)(\\d+))?$`,
);
const notGames = new Set([
  'training',
  'analysis',
  'insights',
  'practice',
  'features',
  'password',
  'streamer',
  'timeline',
]);

export function expandLpvs(el: HTMLElement) {
  const expandables: Expandable[] = [];

  el.querySelectorAll('a:not(.text)').forEach((a: HTMLAnchorElement) => {
    const link = parseLink(a);
    if (link)
      expandables.push({
        element: a,
        link,
      });
  });

  expandGames(expandables);
}

function expandGames(games: Expandable[]): void {
  if (games.length < 3) games.forEach(expandGame);
  else
    games.forEach(game => {
      game.element.title = 'Click to expand';
      game.element.classList.add('text');
      game.element.setAttribute('data-icon', licon.Expand);
      game.element.addEventListener('click', e => {
        if (e.button === 0) {
          e.preventDefault();
          expandGame(game);
        }
      });
    });
}

const expandGame = async (exp: Expandable) => {
  const $lpv = $('<div>');
  const wrapper = exp.element.parentElement?.parentElement;
  if (!wrapper) return;
  const backup = wrapper.cloneNode(true);
  wrapper.classList.add('has-embed');
  $(exp.element).replaceWith($('<div>').prepend($lpv));
  try {
    await site.asset.loadEsm('bits.lpv', {
      init: { el: $lpv[0] as HTMLElement, url: exp.link.src, lpvOpts: exp.link.opts },
    });
  } catch (_) {
    $(wrapper).replaceWith(backup);
  }
  scroller.auto();
};

function parseLink(a: HTMLAnchorElement): Link | undefined {
  const [id, orientation, initialPly] = Array.from(a.href.match(gameRegex) || []).slice(1);
  if (id && !notGames.has(id))
    return {
      type: 'game',
      src: `/embed/game/${id}`,
      opts: {
        orientation,
        initialPly,
      },
    };
  return undefined;
}
