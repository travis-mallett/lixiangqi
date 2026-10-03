import { h, type VNode } from 'snabbdom';

import { blurIfPrimaryClick, prop } from 'lib';
import type { Glyph, GlyphId, TreeNode } from 'lib/tree/types';
import { bind } from 'lib/view';

import type AnalyseCtrl from '../ctrl';
import { glyphs as xhrGlyphs } from './studyXhr';

interface AllGlyphs {
  move: Glyph[];
  observation: Glyph[];
  position: Glyph[];
}

const renderGlyph = (ctrl: GlyphForm, node: TreeNode) => (glyph: Glyph) =>
  h(
    'button',
    {
      hook: bind('click', e => {
        ctrl.toggleGlyph(glyph.id);
        blurIfPrimaryClick(e);
      }),
      attrs: { 'data-symbol': glyph.symbol, type: 'button' },
      class: { active: !!node.glyphs && node.glyphs.some(g => g.id === glyph.id) },
    },
    [glyph.name],
  );

export class GlyphForm {
  all = prop<AllGlyphs | null>(null);
  loading = false;
  failed = false;

  constructor(readonly root: AnalyseCtrl) {}

  loadGlyphs = async () => {
    if (this.all() || this.loading) return;
    this.loading = true;
    this.failed = false;
    try {
      this.all(await xhrGlyphs());
    } catch {
      this.failed = true;
    } finally {
      this.loading = false;
      this.root.redraw();
    }
  };

  toggleGlyph = (id: GlyphId) => {
    this.root.study!.makeChange('toggleGlyph', this.root.study!.withPosition({ id }));
    this.root.redraw();
  };
}

export const viewDisabled = (why: string): VNode => h('div.study__glyphs', [h('div.study__message', why)]);

export function view(ctrl: GlyphForm): VNode {
  const all = ctrl.all(),
    node = ctrl.root.node;

  return h(
    'div.study__glyphs' + (all ? '' : '.empty'),
    { hook: { insert: ctrl.loadGlyphs } },
    all
      ? [
          h('div.move', all.move.map(renderGlyph(ctrl, node))),
          h('div.position', all.position.map(renderGlyph(ctrl, node))),
          h('div.observation', all.observation.map(renderGlyph(ctrl, node))),
        ]
      : [
          h(
            'div.study__message',
            { attrs: { role: 'status' } },
            ctrl.failed
              ? [
                  h('p', i18n.study.glyphsFailedToLoad),
                  h(
                    'button.button',
                    {
                      attrs: { type: 'button' },
                      hook: bind('click', ctrl.loadGlyphs, ctrl.root.redraw),
                    },
                    i18n.site.retry,
                  ),
                ]
              : i18n.site.loading,
          ),
        ],
  );
}
