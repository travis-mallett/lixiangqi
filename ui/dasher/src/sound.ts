import { h, type VNode } from 'snabbdom';

import { throttle } from 'lib/async';
import { isSafari } from 'lib/device';
import { licon } from 'lib/licon';
import { bind, dataIcon, onInsert } from 'lib/view';
import { cmnToggleWrap } from 'lib/view/cmn-toggle';

import { PaneCtrl } from './interfaces';
import { header } from './util';

export class SoundCtrl extends PaneCtrl {
  private page: 'main' | 'music' = 'main';

  render = (): VNode => (this.page === 'music' ? this.renderMusic() : this.renderMain());

  private readonly renderMain = (): VNode =>
    h('div.sub.sound', [
      header(i18n.site.sound, this.closeSound),
      h('div.content.force-ltr', [
        h('input', {
          attrs: {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.01,
            value: site.sound.getVolume(),
            orient: 'vertical',
            style: isSafari({ below: '18' }) ? 'appearance: slider-vertical' : '',
          },
          hook: onInsert<HTMLInputElement>(input => {
            const setVolume = throttle(150, this.volume);
            $(input).on('input', () => setVolume(parseFloat(input.value)));
          }),
        }),
        h('div.settings', [
          h('div.subs', [
            h(
              'button.sub.music-entry',
              {
                attrs: { ...dataIcon(licon.GreaterThan), type: 'button' },
                hook: bind('click', this.openMusic),
              },
              [h('span', i18n.site.backgroundMusic), h('small', this.selectedMusicName())],
            ),
          ]),
          h('div.selector.categories', [
            cmnToggleWrap({
              id: 'sound-soundEffects',
              name: i18n.site.soundEffects,
              checked: site.sound.isSoundEnabled(),
              change: enabled => this.setCategory('soundEffects', enabled),
              redraw: this.redraw,
            }),
          ]),
        ]),
      ]),
    ]);

  private readonly renderMusic = (): VNode =>
    h('div.sub.sound.music', [
      header(i18n.site.backgroundMusic, this.closeMusic),
      h('div.music-content', [
        h('div.music-toggle', [
          cmnToggleWrap({
            id: 'sound-backgroundMusic',
            name: i18n.site.backgroundMusic,
            checked: site.sound.isMusicEnabled(),
            change: enabled => this.setCategory('backgroundMusic', enabled),
            redraw: this.redraw,
          }),
        ]),
        h(
          'div.selector.music-tracks',
          this.root.data.appearance.musicSets.map(track =>
            h(
              'button.music-track',
              {
                key: track.key,
                attrs: {
                  ...dataIcon(licon.Checkmark),
                  type: 'button',
                  'aria-pressed': String(this.root.data.appearance.current.musicSet === track.key),
                  'aria-label': `${track.name}. ${track.attribution}`,
                },
                class: { active: this.root.data.appearance.current.musicSet === track.key },
                hook: bind('click', () => this.root.appearance.selectMusicSet(track.key)),
              },
              [
                h('span.music-track__name', track.name),
                h('span.music-track__info', {
                  attrs: {
                    ...dataIcon(licon.InfoCircle),
                    title: track.attribution,
                    'aria-hidden': 'true',
                  },
                }),
              ],
            ),
          ),
        ),
      ]),
    ]);

  private readonly selectedMusicName = (): string =>
    this.root.data.appearance.musicSets.find(
      track => track.key === this.root.data.appearance.current.musicSet,
    )?.name ??
    this.root.data.appearance.musicSets[0]?.name ??
    '';

  private readonly openMusic = (): void => {
    this.page = 'music';
    this.redraw();
  };

  private readonly closeMusic = (): void => {
    this.page = 'main';
    this.redraw();
  };

  private readonly closeSound = (): void => {
    this.page = 'main';
    this.close();
  };

  private readonly setCategory = (category: SoundCategory, enabled: boolean) => {
    if (category === 'backgroundMusic') site.sound.setMusicEnabled(enabled);
    else site.sound.setSoundEnabled(enabled);
    if (category === 'soundEffects' && enabled) site.sound.play('genericNotify');
  };

  private readonly volume = (v: number) => {
    site.sound.setVolume(v);
    // Preview the shared volume using the current accessibility mode.
    site.sound.sayOrPlay('move', 'knight F 7');
  };
}
