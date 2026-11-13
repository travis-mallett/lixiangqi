/** Material at the front circumference, in left-to-right screen order. */
export function sidewallColors(pixels: Uint8ClampedArray, size: number): string[] {
  const samples = Array.from({ length: 33 }, (_, step) => {
    const x = (step / 32) * 2 - 1;
    const y = Math.sqrt(1 - x * x);
    // Take the last fully opaque texel, not the antialiased boundary or the
    // inset face/ring. This continues wood's baked bevel and grain into its side.
    // Textured contours (Wudang) can indent by roughly 2% of the canvas.
    for (let radius = 0.452; radius >= 0.42; radius -= 0.001) {
      const col = Math.round((0.5 + x * radius) * size - 0.5);
      const row = Math.round((0.5 + y * radius) * size - 0.5);
      const index = (row * size + col) * 4;
      if (pixels[index + 3] > 250) return [pixels[index], pixels[index + 1], pixels[index + 2]];
    }
    throw new Error('Piece material must have an opaque 90%-diameter body');
  });
  // A small spatial filter removes contour-rasterization noise, which would
  // otherwise stretch into stripes. Preserve the side endpoints and the broad
  // bevel lighting; this work happens once when a material enters the cache.
  return samples.map(
    (color, i) =>
      `#${color
        .map((channel, c) => {
          const value =
            i === 0 || i === 32
              ? channel
              : [1, 4, 6, 4, 1].reduce(
                  (sum, weight, j) => sum + samples[Math.max(0, Math.min(32, i + j - 2))][c] * weight,
                  0,
                ) / 16;
          return Math.round(value).toString(16).padStart(2, '0');
        })
        .join('')}`,
  );
}

export function sidewallMaterial(colors: readonly string[]): { color: string; image: string } {
  const color = `#${[1, 3, 5]
    .map(offset =>
      Math.round(
        colors.reduce((sum, c) => sum + parseInt(c.slice(offset, offset + 2), 16), 0) / colors.length,
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
  // Padding around the circle keeps its antialiased underside away from the
  // image boundary. One cached image supplies a solid, continuous
  // contour, with a small bottom bevel instead of an outline or blurred shadow.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs><linearGradient id="material" gradientUnits="userSpaceOnUse" x1="5" x2="95">${colors
      .map((c, i) => `<stop offset="${i / Math.max(1, colors.length - 1)}" stop-color="${c}"/>`)
      .join('')}</linearGradient>
    <linearGradient id="bevel" x2="0" y2="1"><stop offset=".88" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient></defs>
    <circle cx="50" cy="50" r="45" fill="url(#material)"/>
    <circle cx="50" cy="50" r="45" fill="url(#bevel)"/>
  </svg>`;
  return { color, image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` };
}

/** Thickness contracts with pitch; material never fades during lift or landing. */
export function sidewallOffset(pitch: number): number {
  return (7.65 * Math.sin((pitch * Math.PI) / 180)) / Math.sin((27 * Math.PI) / 180);
}

export function sidewallTransform(pitch: number): string {
  return `translateY(${sidewallOffset(pitch)}%)`;
}
