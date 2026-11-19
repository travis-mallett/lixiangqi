import { glyphElement, type Glyph } from './icons';
import { PhotoCanvas, hue, type Layer, type Point, type Rect, type TextStyle } from './photoCanvas';

type Tool = 'marker' | 'text' | 'crop' | 'sticker';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '') => {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
};
function button(label: string, fn: () => void, icon?: Glyph) {
  const b = el('button');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.onclick = fn;
  b.append(icon ? glyphElement(icon) : label);
  return b;
}
function choices<T extends string>(
  list: readonly T[],
  current: T,
  labels: Record<T, string>,
  icons: Record<T, Glyph>,
  set: (v: T) => void,
) {
  const wrap = el('details', 'photo-choices'),
    trigger = el('summary');
  trigger.title = labels[current];
  trigger.setAttribute('aria-label', labels[current]);
  trigger.append(glyphElement(icons[current]));
  const menu = el('div');
  for (const key of list) {
    const b = button(labels[key], () => set(key));
    b.prepend(glyphElement(icons[key]));
    b.setAttribute('aria-pressed', String(key === current));
    menu.append(b);
  }
  wrap.append(trigger, menu);
  return wrap;
}

export async function editPhoto(file: File, signal: AbortSignal): Promise<File | undefined> {
  const img = el('img');
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
    return signal.aborted ? undefined : await editor(img, file, signal);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function editor(img: HTMLImageElement, file: File, signal: AbortSignal): Promise<File | undefined> {
  const t = i18n.inbox,
    model = new PhotoCanvas(img),
    canvas = model.canvas;
  const dialog = el('dialog', 'msg-photo-editor'),
    head = el('header'),
    stage = el('section', 'msg-photo-stage'),
    surface = el('div', 'photo-surface'),
    bar = el('nav', 'photo-toolbar');
  dialog.setAttribute('aria-label', t.photoEdit);
  canvas.setAttribute('aria-label', file.name);
  stage.append(surface);
  surface.append(canvas);
  dialog.append(head, stage, bar);
  let tool: Tool | undefined,
    percent = 0,
    brush: 'pen' | 'highlighter' = 'pen',
    weight: 'thin' | 'regular' | 'medium' | 'heavy' = 'regular',
    style: TextStyle = 'plainText',
    ratio = 0;
  let crop: Rect,
    text: HTMLDivElement | undefined,
    textAt: Point,
    selected = -1;
  let result: File | undefined, drag: ((p: Point) => void) | undefined, finishDrag: (() => void) | undefined;
  const undo = button(
      t.photoUndo,
      () => {
        model.step(-1);
        reset();
      },
      'undo',
    ),
    redo = button(
      t.photoRedo,
      () => {
        model.step(1);
        reset();
      },
      'redo',
    );
  head.append(
    button(t.cancel, () => dialog.close(), 'close'),
    undo,
    redo,
  );
  const center = () => ({ x: canvas.width / 2, y: canvas.height / 2 });
  const size = () => Math.min(canvas.width, canvas.height);
  const scale = () => canvas.clientWidth / canvas.width;
  const point = (e: PointerEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / scale(), 0, canvas.width),
      y: clamp((e.clientY - r.top) / scale(), 0, canvas.height),
    };
  };
  const sync = () => {
    undo.disabled = !model.canUndo;
    redo.disabled = !model.canRedo;
  };
  function reset() {
    select(undefined);
    fit();
    sync();
  }
  function fit() {
    const factor = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    surface.style.width = canvas.width * factor + 'px';
    surface.style.height = canvas.height * factor + 'px';
    if (tool === 'text') styleText();
    if (tool === 'crop') drawCrop();
  }
  const observer = new ResizeObserver(fit);
  function clearOverlay() {
    for (const child of Array.from(surface.children)) if (child !== canvas) child.remove();
    text = undefined;
  }
  function styleText() {
    if (!text) return;
    text.style.left = (textAt.x / canvas.width) * 100 + '%';
    text.style.top = (textAt.y / canvas.height) * 100 + '%';
    text.style.fontSize = size() * 0.085 * scale() + 'px';
    text.style.color = style === 'plainText' ? hue(percent) : percent >= 95 ? '#000' : '#fff';
    text.style.background = style === 'highlight' ? hue(percent) : 'transparent';
    text.style.webkitTextStroke = style === 'outline' ? '1px ' + hue(percent) : '';
  }
  function drawCrop() {
    let box = surface.querySelector<HTMLElement>('.photo-crop');
    if (!box) {
      box = el('div', 'photo-crop');
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = el('b');
        handle.dataset.corner = corner;
        box.append(handle);
      }
      surface.append(box);
    }
    Object.assign(box.style, {
      left: (crop.x / canvas.width) * 100 + '%',
      top: (crop.y / canvas.height) * 100 + '%',
      width: (crop.w / canvas.width) * 100 + '%',
      height: (crop.h / canvas.height) * 100 + '%',
    });
  }
  function preset(r: number) {
    ratio = r;
    const w = ratio ? Math.min(canvas.width, canvas.height * r) : canvas.width;
    const h = ratio ? w / r : canvas.height;
    crop = { x: (canvas.width - w * 0.9) / 2, y: (canvas.height - h * 0.9) / 2, w: w * 0.9, h: h * 0.9 };
    drawCrop();
  }
  function select(mode?: Tool) {
    clearOverlay();
    tool = mode;
    selected = -1;
    if (mode === 'text') {
      textAt = center();
      text = el('div', 'photo-text-layer');
      text.contentEditable = 'plaintext-only';
      text.setAttribute('role', 'textbox');
      text.setAttribute('aria-label', t.photoText);
      text.setAttribute('aria-multiline', 'true');
      surface.append(text);
      styleText();
      text.focus();
    }
    if (mode === 'crop') preset(0);
    controls();
  }
  function done() {
    if (tool === 'text' && text?.innerText.trim())
      model.commit([
        ...model.frame.layers,
        {
          kind: 'text',
          at: textAt,
          text: text.innerText.trim().slice(0, 1000),
          style,
          color: hue(percent),
          size: size() * 0.085,
          ink: percent >= 95 ? '#000' : '#fff',
        },
      ]);
    if (tool === 'crop') model.crop(crop);
    reset();
  }
  const steps = { thin: 2, regular: 4, medium: 12, heavy: 24 };
  function controls() {
    bar.replaceChildren();
    sync();
    if (!tool) {
      for (const [mode, label] of [
        ['marker', t.photoMarker],
        ['text', t.photoText],
        ['crop', t.photoCrop],
        ['sticker', t.photoSticker],
      ] as const) {
        const b = button(label, () => select(mode), mode);
        b.dataset.mode = mode;
        bar.append(b);
      }
      bar.append(button(t.done, save));
      return;
    }
    if (tool === 'marker' || tool === 'text') {
      const slider = el('input', 'photo-hue');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(percent);
      slider.setAttribute('aria-label', t.photoColor);
      const color = () => {
        slider.style.setProperty('--hue', hue(percent));
        styleText();
      };
      color();
      slider.oninput = () => {
        percent = Number(slider.value);
        color();
      };
      bar.append(slider);
      if (tool === 'marker')
        bar.append(
          choices(['pen', 'highlighter'], brush, t, { pen: 'pen', highlighter: 'highlighter' }, v => {
            brush = v;
            controls();
          }),
          choices(
            ['thin', 'regular', 'medium', 'heavy'],
            weight,
            t,
            { thin: 'thin', regular: 'regular', medium: 'medium', heavy: 'heavy' },
            v => {
              weight = v;
              controls();
            },
          ),
        );
      else
        bar.append(
          choices(
            ['plainText', 'highlight', 'outline'],
            style,
            { plainText: t.regular, highlight: t.highlight, outline: t.outline },
            { plainText: 'plainText', highlight: 'highlight', outline: 'outline' },
            v => {
              style = v;
              styleText();
              controls();
              text?.focus();
            },
          ),
        );
    } else if (tool === 'crop') {
      for (const [value, label] of [
        [0, t.freeform],
        [1, t.square],
        [9 / 16, '9:16'],
      ] as const) {
        const b = button(label, () => {
          preset(value);
          controls();
        });
        b.setAttribute('aria-pressed', String(value === ratio));
        bar.append(b);
      }
      bar.append(
        button(
          t.photoRotate,
          () => {
            model.rotate();
            preset(ratio);
            fit();
            sync();
          },
          'rotate',
        ),
      );
    } else if (tool === 'sticker') {
      stickers();
      return;
    }
    bar.append(button(t.done, done));
  }
  function stickers() {
    const panel = el('div', 'photo-stickers');
    const now = new Date();
    const addSticker = (image: HTMLCanvasElement | HTMLImageElement) => {
      model.commit([...model.frame.layers, { kind: 'sticker', at: center(), size: size() * 0.34, image }]);
      reset();
      selected = model.frame.layers.length - 1;
    };
    const section = (title: string) => {
      const h = el('strong');
      h.textContent = title;
      panel.append(h);
    };
    section(t.timeSticker);
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    for (const [ink, background] of [
      ['#fff', ''],
      ['#000', ''],
      ['#000', '#ffffff99'],
      ['#fff', '#00000066'],
      ['#ff7629', '#00000099'],
    ]) {
      const sticker = el('canvas');
      sticker.width = sticker.height = 192;
      const ctx = sticker.getContext('2d')!;
      ctx.font = '500 40px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (background) {
        ctx.fillStyle = background;
        ctx.beginPath();
        ctx.roundRect(2, 62, 188, 68, 12);
        ctx.fill();
      }
      ctx.fillStyle = ink;
      ctx.fillText(time, 96, 96, 180);
      const b = button(t.timeSticker + ' · ' + time, () => addSticker(sticker));
      b.replaceChildren(sticker);
      panel.append(b);
    }
    for (const face of ['Arabic', 'Baton', 'Explorer', 'Dive']) {
      const sticker = el('canvas'),
        b = button(t.timeSticker + ' · ' + face, () => addSticker(sticker));
      sticker.width = sticker.height = 192;
      b.replaceChildren(sticker);
      b.disabled = true;
      panel.append(b);
      const load = async (part: string) => {
        const asset = el('img');
        asset.crossOrigin = 'anonymous';
        asset.src = site.asset.url('images/inbox-media/' + face + part + '.svg');
        await asset.decode();
        return asset;
      };
      void Promise.all([load(''), load('-hour'), load('-minute')])
        .then(([dial, hour, minute]) => {
          const ctx = sticker.getContext('2d')!,
            r = 96;
          ctx.drawImage(dial, 0, 0, 192, 192);
          ctx.translate(r, r);
          const offset = ['Arabic', 'Baton'].includes(face) ? 0.106 : 0;
          const thick = face === 'Dive' ? 0.095 : face === 'Explorer' ? 0.07 : 0.09;
          const hand = (image: HTMLImageElement, angle: number, length: number, width: number) => {
            ctx.save();
            ctx.rotate(angle);
            ctx.drawImage(image, (-r * width) / 2, r * (offset - length), r * width, r * length);
            ctx.restore();
          };
          hand(
            hour,
            ((now.getHours() + now.getMinutes() / 60) * Math.PI) / 6,
            face === 'Dive' ? 0.47 : 0.44,
            face === 'Arabic' ? 0.049 : thick,
          );
          hand(
            minute,
            (now.getMinutes() * Math.PI) / 30,
            face === 'Dive' ? 0.89 : 0.69,
            face === 'Arabic' ? 0.036 : thick,
          );
          if (face === 'Dive') {
            ctx.fillStyle = '#d1ffc1';
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
            ctx.fill();
          }
          b.disabled = false;
        })
        .catch(() => b.remove());
    }
    section(t.chessStickers);
    for (const side of ['r', 'b'])
      for (const role of ['K', 'A', 'B', 'N', 'R', 'C', 'P']) {
        const picture = el('img'),
          b = button(side + role, () => addSticker(picture));
        b.replaceChildren(picture);
        b.disabled = true;
        picture.crossOrigin = 'anonymous';
        picture.onload = () => {
          b.disabled = false;
        };
        picture.alt = side + role;
        picture.src = site.asset.url('piece/default-wood/' + side + role + '.svg');
        panel.append(b);
      }
    bar.append(
      panel,
      button(t.close, () => select(undefined), 'close'),
    );
  }
  function save() {
    if (!model.canUndo) {
      result = file;
      dialog.close();
      return;
    }
    canvas.toBlob(
      blob => {
        if (!dialog.open || !blob) return;
        result = new File(
          [blob],
          file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.png'),
          { type: blob.type },
        );
        dialog.close();
      },
      'image/webp',
      0.9,
    );
  }
  surface.onpointerdown = e => {
    if (drag || e.button !== 0 || e.target === text) return;
    const start = point(e);
    if (tool === 'crop') {
      const corner = (e.target as HTMLElement).dataset.corner,
        old = { ...crop };
      if (!corner && !(e.target as HTMLElement).closest('.photo-crop')) return;
      drag = p => {
        if (!corner) {
          crop.x = clamp(old.x + p.x - start.x, 0, canvas.width - old.w);
          crop.y = clamp(old.y + p.y - start.y, 0, canvas.height - old.h);
        } else {
          const left = corner.endsWith('w'),
            top = corner.startsWith('n'),
            x = left ? old.x + old.w : old.x,
            y = top ? old.y + old.h : old.y;
          const maxW = left ? x : canvas.width - x,
            maxH = top ? y : canvas.height - y;
          let w = clamp((left ? -1 : 1) * (p.x - x), Math.min(2, maxW), maxW),
            h = clamp((top ? -1 : 1) * (p.y - y), Math.min(2, maxH), maxH);
          if (ratio) {
            w = Math.min(maxW, maxH * ratio, Math.max(w, h * ratio));
            h = w / ratio;
          }
          crop = { x: left ? x - w : x, y: top ? y - h : y, w, h };
        }
        drawCrop();
      };
    } else if (tool === 'marker') {
      const stroke: Layer = {
        kind: 'marker',
        points: [start],
        color: hue(percent),
        width: (steps[weight] / scale()) * (brush === 'highlighter' ? 2 : 1),
        highlight: brush === 'highlighter',
      };
      const layers = [...model.frame.layers, stroke];
      model.paint(layers);
      drag = p => {
        stroke.points.push(p);
        model.paint(layers);
      };
      finishDrag = () => model.commit(layers);
    } else if (tool === 'text') {
      textAt = start;
      styleText();
      text?.focus();
      return;
    } else if (!tool) {
      selected = model.hit(start);
      const layer = model.frame.layers[selected];
      if (!layer || layer.kind === 'marker') return;
      const layers = model.frame.layers.slice();
      drag = p => {
        layers[selected] = { ...layer, at: { x: layer.at.x + p.x - start.x, y: layer.at.y + p.y - start.y } };
        model.paint(layers);
      };
      finishDrag = () => {
        if (layers[selected] !== layer) model.commit(layers);
      };
    } else return;
    surface.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  surface.onpointermove = e => {
    if (surface.hasPointerCapture(e.pointerId)) drag?.(point(e));
  };
  surface.onpointerup = () => {
    finishDrag?.();
    finishDrag = drag = undefined;
    sync();
  };
  surface.onpointercancel = () => {
    finishDrag = drag = undefined;
    model.paint();
  };
  surface.onwheel = e => {
    if (tool || selected < 0) return;
    const layers = model.frame.layers.slice(),
      l = layers[selected];
    if (l.kind === 'marker') return;
    e.preventDefault();
    layers[selected] = {
      ...l,
      size: clamp(l.size * Math.exp(-e.deltaY * 0.002), size() * 0.025, size() * 2),
    };
    model.commit(layers);
    sync();
  };
  dialog.oncancel = e => {
    if (tool) {
      e.preventDefault();
      reset();
    }
  };
  return new Promise(resolve => {
    const close = () => dialog.close();
    signal.addEventListener('abort', close, { once: true });
    dialog.onclose = () => {
      observer.disconnect();
      signal.removeEventListener('abort', close);
      dialog.remove();
      resolve(result);
    };
    document.body.append(dialog);
    dialog.showModal();
    observer.observe(stage);
    reset();
  });
}
