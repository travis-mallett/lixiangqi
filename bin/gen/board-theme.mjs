// Parent artwork uses 100-unit cells inside scale(0.98). Variant artwork
// supplies its own cell size; never scale strokes by the overall canvas size.
export const boardThemes = {
  'lixiangqi-default': { line: 'xiangqi-coordinate-grid-line', ink: 'g56', frame: 'rect1' },
  'paper-board': { line: 'xiangqi-coordinate-grid-line', frame: 'rect2' },
  'xiangqi-tournament': { line: 'line', ink: 'g91' },
  'xiangqi-wudang': { line: 'xiangqi-coordinate-grid-line', ink: 'board-artwork', frame: 'rect1' },
};

export function boardTheme(doc, name, cellSize) {
  const theme = boardThemes[name];
  const line = doc.getElementById(theme.line);
  const ink = theme.ink && doc.getElementById(theme.ink);
  const attribute = (element, name) => {
    for (let el = element; el; el = el.parentElement) {
      const value = el.style?.getPropertyValue(name) || el.getAttribute(name);
      if (value) return value;
    }
    throw new Error(`Missing ${name} in parent board artwork`);
  };
  const scale = cellSize / 100;
  const scaled = value => Number((Number(value) * scale).toFixed(6));
  const frame = theme.frame && doc.getElementById(theme.frame);
  return {
    ink: attribute(line, 'stroke'),
    opacity: ink ? attribute(ink, 'opacity') : '1',
    width: scaled(attribute(line, 'stroke-width')),
    frame: frame && {
      ink: attribute(frame, 'stroke'),
      width: scaled(attribute(frame, 'stroke-width')),
      offset: scaled(-Number(frame.getAttribute('x')) - 400),
    },
  };
}
