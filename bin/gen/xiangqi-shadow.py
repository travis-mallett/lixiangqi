"""Generate the shared contact shadow fitted to TianTian's resting pieces.

Requires Pillow. Run from any directory; the output is repository-relative.
The 512px texture occupies twice the board's piece box on each axis.
"""

from math import erf, hypot, sqrt
from pathlib import Path

from PIL import Image

SIZE = 512
CENTER = (271.438752, 295.061001)
RADII = (108.993536, 114.625221)
SIGMA = 12.392690
OPACITY = 0.397370
COLOR = (23, 10, 0)


def main():
    pixels = []
    for y in range(SIZE):
        for x in range(SIZE):
            nx = (x + 0.5 - CENTER[0]) / RADII[0]
            ny = (y + 0.5 - CENTER[1]) / RADII[1]
            radius = hypot(nx, ny)
            gradient = hypot(nx / RADII[0], ny / RADII[1]) / max(radius, 1e-8)
            distance = (radius - 1) / max(gradient, 1e-8)
            alpha = OPACITY * (1 + erf(-distance / (SIGMA * sqrt(2)))) / 2
            pixels.append((*COLOR, round(255 * alpha)))
    image = Image.new('RGBA', (SIZE, SIZE))
    image.putdata(pixels)
    destination = Path(__file__).resolve().parents[2] / 'public/piece/effects/xiangqi-rest-shadow.png'
    image.save(destination, optimize=True)
    print(f'{destination}: {destination.stat().st_size} bytes')


if __name__ == '__main__':
    main()
