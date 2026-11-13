import { sidewallColors, sidewallMaterial } from './material';
import type { MotionHost } from './types';

const materialCache = new Map<string, Promise<ReturnType<typeof sidewallMaterial>>>();
const contactShadows = new WeakMap<HTMLElement, HTMLElement>();
const shadowPieces = new WeakMap<Element, HTMLElement>();
const shadowLayers = new WeakMap<HTMLElement, HTMLElement>();

// Contact shadows belong to the board plane, outside each transformed piece's
// stacking context. Keep one companion per DOM piece, including fading pieces.
export function contactShadowFor(root: HTMLElement): HTMLElement {
  let shadow = contactShadows.get(root);
  if (!shadow) {
    shadow = span('xiangqi-piece-shadow');
    shadow.append(span('xiangqi-motion-shadow-contact'));
    shadow.setAttribute('aria-hidden', 'true');
    contactShadows.set(root, shadow);
    shadowPieces.set(shadow, root);
  }
  const board = root.parentElement;
  if (board) {
    let layer = shadowLayers.get(board);
    if (!layer) {
      layer = span('xiangqi-shadow-layer');
      layer.setAttribute('aria-hidden', 'true');
      shadowLayers.set(board, layer);
      board.append(layer);
    }
    if (shadow.parentElement !== layer) layer.append(shadow);
  }
  syncXiangqiShadowPosition(root);
  return shadow;
}

export function syncXiangqiShadowPosition(root: HTMLElement): void {
  const shadow = contactShadows.get(root);
  if (!shadow) return;
  shadow.style.transform = root.style.transform;
  shadow.style.visibility = root.style.visibility;
  shadow.style.opacity = root.style.opacity;
  shadow.classList.toggle('fading', root.classList.contains('fading'));
  shadow.classList.toggle(
    'xiangqi-last-move-destination',
    root.classList.contains('xiangqi-last-move-destination'),
  );
}

export function syncXiangqiShadows(state: MotionHost): void {
  const board = state.surface;
  for (const child of Array.from(board.children)) {
    if (child.tagName === 'PIECE') {
      const root = child as HTMLElement;
      contactShadowFor(root).dataset.key = state.key(root);
    }
  }
  const layer = shadowLayers.get(board);
  if (layer)
    for (const child of Array.from(layer.children))
      if (shadowPieces.get(child)?.parentElement !== board) child.remove();
}

export function prewarmMaterials(state: MotionHost): void {
  for (const element of Array.from(state.surface.children)) {
    if (element.tagName !== 'PIECE' || element.classList.contains('xiangqi-motion-piece')) continue;
    const piece = element as HTMLElement;
    const backgroundImage = computedBackgroundImage(piece);
    if (backgroundUrl(backgroundImage)) void pieceMaterial(backgroundImage, piece);
  }
}

export function pieceMaterial(
  backgroundImage: string,
  piece: HTMLElement,
): Promise<ReturnType<typeof sidewallMaterial>> {
  const url = backgroundUrl(backgroundImage);
  const fallback = () => sidewallMaterial([fallbackDepthColor(piece)]);
  if (!url) return Promise.resolve(fallback());
  const rotation =
    parseFloat(
      piece.ownerDocument.defaultView?.getComputedStyle(piece).getPropertyValue('--board-face-rotation') ||
        '0',
    ) || 0;
  const key = `${url}/${rotation}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const ImageConstructor = piece.ownerDocument.defaultView?.Image;
  if (!ImageConstructor) return Promise.resolve(fallback());
  const result = new Promise<ReturnType<typeof sidewallMaterial>>(resolve => {
    const image = new ImageConstructor();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const size = 256;
        const canvas = piece.ownerDocument.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas rendering context unavailable');
        context.translate(size / 2, size / 2);
        context.rotate((rotation * Math.PI) / 180);
        context.drawImage(image, -size / 2, -size / 2, size, size);
        resolve(sidewallMaterial(sidewallColors(context.getImageData(0, 0, size, size).data, size)));
      } catch (_) {
        resolve(fallback());
      }
    };
    image.onerror = () => resolve(fallback());
    image.src = url;
  });
  materialCache.set(key, result);
  return result;
}

export function computedBackgroundImage(piece: HTMLElement): string {
  const style = piece.ownerDocument.defaultView?.getComputedStyle(piece);
  return style?.getPropertyValue('--xiangqi-piece-image').trim() || style?.backgroundImage || '';
}

function backgroundUrl(backgroundImage: string): string | undefined {
  const match = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
  return match?.[1];
}

function fallbackDepthColor(piece: HTMLElement): string {
  const pieceSet = document.body.dataset.pieceSet;
  const red = piece.classList.contains('white');
  if (pieceSet === 'xiangqi-wudang') return red ? '#99554c' : '#313a3a';
  return '#8f5b3d';
}

export function span(className: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  return element;
}

export function contactShadow(root: HTMLElement): HTMLElement | undefined {
  return contactShadows.get(root);
}
