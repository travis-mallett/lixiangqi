import menuHover from 'lib/menuHover';

import EditorCtrl from './ctrl';
import type { Config, LichessEditor } from './interfaces';
import EditorView from './view';

export type { LichessEditor } from './interfaces';

export function initModule(config: Config): LichessEditor {
  const root = config.el ?? document.getElementById('board-editor');
  if (!root) throw new Error('Missing Xiangqi board editor root');

  let updateView = () => {};
  const ctrl = new EditorCtrl(config, () => updateView());
  const view = new EditorView(root, ctrl);
  updateView = () => view.update();
  view.mount();
  menuHover();

  return {
    getFen: () => ctrl.getFen(),
    setFen: fen => ctrl.setFen(fen),
    setOrientation: orientation => ctrl.setOrientation(orientation),
    setVariant: variant => ctrl.setVariant(variant),
    destroy: () => view.destroy(),
  };
}
