import { Resvg } from '@resvg/resvg-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { boardAssets } from '../../ui/board/src/catalog';
import { standardXiangqi } from '../../ui/board/src/definitions';
import { boardImageSvg } from '../../ui/board/src/image';
import { coordinateMove, positionFromFen } from '../../ui/board/src/position';
import type { BoardMark } from '../../ui/board/src/types';

export interface ImageFrame {
  fen: string;
  lastMove?: string;
  check?: boolean;
  delay?: number;
  glyph?: string;
  clock?: Record<string, number>;
  shapes?: { orig: string; dest?: string; brush: string }[];
}
export interface ImageRequest {
  frames: ImageFrame[];
  orientation: 'red' | 'black';
  delay?: number;
  theme?: string;
  piece?: string;
  red?: string;
  black?: string;
  size?: number;
  format: 'gif' | 'png';
}

const resources = new Map<string, string>();
const allowedAssets = new Set([
  ...boardAssets.boards.flatMap(board => Object.values(board.geometries)),
  ...boardAssets.pieceSets.flatMap(set =>
    Object.values(set.variants).flatMap(v => [v.back, ...Object.values(v.faces).flatMap(Object.values)]),
  ),
  boardAssets.shadows.rest,
]);

function asset(path: string, publicRoot: string): string {
  if (!allowedAssets.has(path)) throw new Error('Unknown board asset');
  const key = `${publicRoot}/${path}`;
  let data = resources.get(key);
  if (!data) {
    const mime = path.endsWith('.svg')
      ? 'image/svg+xml'
      : path.endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
    data = `data:${mime};base64,${readFileSync(resolve(publicRoot, path)).toString('base64')}`;
    resources.set(key, data);
  }
  return data;
}

function validate(input: ImageRequest): void {
  if (!input || !Array.isArray(input.frames) || input.frames.length < 1 || input.frames.length > 601)
    throw new Error('An image export requires 1 to 601 frames');
  if (!['red', 'black'].includes(input.orientation)) throw new Error('Invalid Xiangqi orientation');
  if (!['gif', 'png'].includes(input.format) || (input.format === 'png' && input.frames.length !== 1))
    throw new Error('Invalid export format');
  if (input.size !== undefined && (!Number.isInteger(input.size) || input.size < 180 || input.size > 720))
    throw new Error('Image width must be between 180 and 720');
  if ((input.size ?? 450) ** 2 * 1.3 * input.frames.length > 160_000_000)
    throw new Error('Image dimensions exceed the animation resource limit');
  for (const value of [input.red, input.black])
    if (value !== undefined && (typeof value !== 'string' || value.length > 200))
      throw new Error('Invalid participant label');
}

export function renderImage(input: ImageRequest, publicRoot: string): Uint8Array {
  validate(input);
  const gif = GIFEncoder();
  const hasClocks = input.frames.some(frame => frame.clock !== undefined);
  for (const frame of input.frames) {
    if (typeof frame.fen !== 'string' || frame.fen.length > 160) throw new Error('Invalid image FEN');
    const position = positionFromFen(frame.fen, standardXiangqi);
    const delay = frame.delay ?? input.delay ?? 80;
    if (!Number.isFinite(delay) || delay < 1 || delay > 6000) throw new Error('Invalid frame delay');
    if (frame.glyph !== undefined && (typeof frame.glyph !== 'string' || frame.glyph.length > 8))
      throw new Error('Invalid annotation symbol');
    if (
      frame.clock &&
      Object.entries(frame.clock).some(
        ([side, value]) => !['red', 'black'].includes(side) || !Number.isFinite(value) || value < 0,
      )
    )
      throw new Error('Invalid frame clock');
    if (frame.shapes && (!Array.isArray(frame.shapes) || frame.shapes.length > 32))
      throw new Error('Too many board marks');
    const marks: BoardMark[] = (frame.shapes ?? []).map(shape => ({
      from: shape.orig,
      to: shape.dest,
      brush: shape.brush,
    }));
    const svg = boardImageSvg(
      {
        definition: standardXiangqi,
        position: {
          ...position,
          lastMove: frame.lastMove ? coordinateMove(frame.lastMove) : undefined,
          checked: frame.check
            ? [...position.pieces]
                .filter(
                  ([, p]) => p.face === 'up' && p.role === 'general' && p.participant === position.active,
                )
                .map(([square]) => square)
            : undefined,
        },
        perspective: input.orientation,
        theme: input.theme,
        pieceSet: input.piece,
        labels: input.red || input.black ? { red: input.red ?? '', black: input.black ?? '' } : undefined,
        clocks: frame.clock ?? (hasClocks ? {} : undefined),
        marks,
        glyph: frame.glyph,
      },
      path => asset(path, publicRoot),
    );
    const image = new Resvg(svg, {
      fitTo: { mode: 'width', value: input.size ?? 450 },
      font: { loadSystemFonts: true, defaultFontFamily: 'Noto Sans' },
    }).render();
    if (input.format === 'png') return image.asPng();
    const pixels = image.pixels;
    const palette = quantize(pixels, 256);
    gif.writeFrame(applyPalette(pixels, palette), image.width, image.height, {
      palette,
      delay: delay * 10,
      repeat: 0,
    });
  }
  gif.finish();
  return gif.bytes();
}

parentPort?.on('message', (request: ImageRequest) => {
  try {
    parentPort!.postMessage({ image: renderImage(request, workerData.publicRoot) });
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : 'Image rendering failed' });
  }
});
