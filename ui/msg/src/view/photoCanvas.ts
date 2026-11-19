// The hue stops, brush widths and text treatments follow Signal Desktop MediaEditor.
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type TextStyle = 'plainText' | 'highlight' | 'outline';
export type Layer =
  | { kind: 'marker'; points: Point[]; color: string; width: number; highlight: boolean }
  | { kind: 'text'; at: Point; text: string; size: number; color: string; style: TextStyle; ink: string }
  | { kind: 'sticker'; at: Point; image: HTMLCanvasElement | HTMLImageElement; size: number };
type Frame = { image: HTMLCanvasElement; layers: Layer[] };

export function hue(v: number) {
  if (v <= 7) return `hsl(0 50% ${(50 * v) / 7}%)`;
  if (v >= 95) return `hsl(0 0% ${Math.min(100, 50 + 20 * (v - 95))}%)`;
  return `hsl(${(338 * (v - 7)) / 88} 100% 50%)`;
}

function bitmap(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function draw(ctx: CanvasRenderingContext2D, l: Layer) {
  ctx.save();
  if (l.kind === 'marker') {
    ctx.lineCap = l.highlight ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = l.highlight ? 0.5 : 1;
    ctx.strokeStyle = ctx.fillStyle = l.color;
    ctx.lineWidth = l.width;
    const p = l.points[0];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const at of l.points) ctx.lineTo(at.x, at.y);
    if (l.points.length === 1) ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
  } else if (l.kind === 'sticker') {
    ctx.drawImage(l.image, l.at.x - l.size / 2, l.at.y - l.size / 2, l.size, l.size);
  } else {
    ctx.font = 'bold ' + l.size + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = l.text.split('\n'),
      height = l.size * 1.2;
    lines.forEach((line, i) => {
      const y = l.at.y + (i - (lines.length - 1) / 2) * height;
      if (l.style === 'highlight') {
        const width = ctx.measureText(line).width + l.size * 0.18;
        ctx.fillStyle = l.color;
        ctx.fillRect(l.at.x - width / 2, y - height / 2, width, height);
      } else if (l.style === 'outline') {
        ctx.strokeStyle = l.color;
        ctx.lineJoin = 'round';
        ctx.lineWidth = l.size * 0.11;
        ctx.strokeText(line, l.at.x, y);
      }
      ctx.fillStyle = l.style === 'plainText' ? l.color : l.ink;
      ctx.fillText(line, l.at.x, y);
    });
  }
  ctx.restore();
}

export class PhotoCanvas {
  readonly canvas = document.createElement('canvas');
  private readonly frames: Frame[];
  private index = 0;
  constructor(img: HTMLImageElement) {
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const image = bitmap(img.naturalWidth * scale, img.naturalHeight * scale);
    image.getContext('2d')!.drawImage(img, 0, 0, image.width, image.height);
    this.frames = [{ image, layers: [] }];
    this.paint();
  }
  get frame() {
    return this.frames[this.index];
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index + 1 < this.frames.length;
  }
  step(n: number) {
    this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + n));
    this.paint();
  }
  paint(layers = this.frame.layers) {
    const c = this.canvas,
      img = this.frame.image;
    if (c.width !== img.width) c.width = img.width;
    if (c.height !== img.height) c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    layers.forEach(l => draw(ctx, l));
  }
  commit(layers: Layer[], image = this.frame.image) {
    this.frames.splice(++this.index, Infinity, { image, layers });
    this.paint();
  }
  crop(r: Rect) {
    const c = bitmap(r.w, r.h);
    c.getContext('2d')!.drawImage(this.canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    this.commit([], c);
  }
  rotate() {
    const c = bitmap(this.canvas.height, this.canvas.width),
      ctx = c.getContext('2d')!;
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(this.canvas, 0, 0);
    this.commit([], c);
  }
  hit(p: Point) {
    const layers = this.frame.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.kind === 'marker') continue;
      const w =
        layer.kind === 'text'
          ? Math.max(...layer.text.split('\n').map(t => t.length)) * layer.size * 0.35
          : layer.size / 2;
      const h = layer.kind === 'text' ? layer.size * 0.6 * layer.text.split('\n').length : layer.size / 2;
      if (Math.abs(p.x - layer.at.x) <= w && Math.abs(p.y - layer.at.y) <= h) return i;
    }
    return -1;
  }
}
