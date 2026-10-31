import type { MotionHost } from './types';

const depthColorCache = new Map<string, Promise<string>>();
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

export function prewarmDepthColors(state: MotionHost): void {
  for (const element of Array.from(state.surface.children)) {
    if (element.tagName !== 'PIECE' || element.classList.contains('xiangqi-motion-piece')) continue;
    const piece = element as HTMLElement;
    const backgroundImage = computedBackgroundImage(piece);
    if (backgroundUrl(backgroundImage)) void depthColor(backgroundImage, piece);
  }
}

export function depthColor(backgroundImage: string, piece: HTMLElement): Promise<string> {
  const url = backgroundUrl(backgroundImage);
  if (!url) return Promise.resolve(fallbackDepthColor(piece));
  const cached = depthColorCache.get(url);
  if (cached) return cached;

  const ImageConstructor = piece.ownerDocument.defaultView?.Image;
  if (!ImageConstructor) return Promise.resolve(fallbackDepthColor(piece));

  const result = new Promise<string>(resolve => {
    const image = new ImageConstructor();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth || 128;
        const naturalHeight = image.naturalHeight || 128;
        const scale = Math.min(1, 128 / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * scale));
        const height = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas rendering context unavailable');
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let weight = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] / 255;
          if (alpha === 0) continue;
          red += pixels[index] * alpha;
          green += pixels[index + 1] * alpha;
          blue += pixels[index + 2] * alpha;
          weight += alpha;
        }

        if (weight === 0) throw new Error('Piece asset contains no visible pixels');
        const average = [red, green, blue].map(channel => Math.round(channel / weight));
        resolve(`#${average.map(channel => channel.toString(16).padStart(2, '0')).join('')}`);
      } catch (_) {
        resolve(fallbackDepthColor(piece));
      }
    };
    image.onerror = () => resolve(fallbackDepthColor(piece));
    image.src = url;
  });

  depthColorCache.set(url, result);
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
