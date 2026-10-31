import { showAnalysisKeyboardHelp } from './analysisDialogs';
import type { AnalysisNode, AnalysisTree } from './analysisTreeView';

/** Keyboard navigation belongs to the shared workspace, independent of its rules adapter. */
export function bindAnalysisKeyboard<N extends AnalysisNode>(
  tree: () => AnalysisTree<N>,
  activePath: () => string,
  navigate: (path: string) => void,
): void {
  const listener = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],dialog'))
      return;
    if (event.key === '?') {
      event.preventDefault();
      showAnalysisKeyboardHelp();
      return;
    }
    const model = tree();
    const path = activePath();
    let node: AnalysisNode = model.nodeAtPath(path);
    let destination: string | undefined;
    if (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (path) {
        const siblings = model.parentNode(path).children;
        const index = siblings.findIndex(sibling => sibling.path === path);
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        destination = siblings[(index + direction + siblings.length) % siblings.length].path;
      }
    } else if (event.key === 'ArrowLeft') destination = model.parentNode(path).path;
    else if (event.key === 'ArrowRight') destination = node.children[0]?.path;
    else if (event.key === 'Home') destination = '';
    else if (event.key === 'End') {
      while (node.children.length) node = node.children[0];
      destination = node.path;
    }
    if (destination === undefined || destination === path) return;
    event.preventDefault();
    navigate(destination);
  };
  document.addEventListener('keydown', listener);
  window.addEventListener('pagehide', () => document.removeEventListener('keydown', listener), {
    once: true,
  });
}
