"""Extract the photographed tournament Xiangqi pieces into game-ready PNGs.

The source photo contains one example of every red and black piece.  Coordinates
and rotations are intentionally explicit so the output is reproducible and the
Chinese glyphs remain the photographed originals rather than OCR reconstructions.
"""

from __future__ import annotations

import argparse
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


PIECES = {
    # Filled after validating the labelled source preview.
    "01": (349, 370),
    "02": (1087, 493),
    "03": (1829, 508),
    "04": (2560, 700),
    "05": (375, 1091),
    "06": (1120, 1238),
    "07": (1847, 1285),
    "08": (2539, 1416),
    "09": (384, 1850),
    "10": (1139, 1911),
    "11": (1845, 2091),
    "12": (2523, 2059),
    "13": (401, 2531),
    "14": (1133, 2683),
}

BASE_ROTATIONS = {
    "01": 229,
    "02": 352,
    "03": 315,
    "04": 90,
    "05": 229,
    "06": 135,
    "07": 143,
    "08": 135,
    "09": 278,
    "10": 225,
    "11": 180,
    "12": 90,
    "13": 315,
    "14": 86,
}

FILENAMES = {
    "01": "rA.png",
    "02": "bA.png",
    "03": "rC.png",
    "04": "bC.png",
    "05": "rB.png",
    "06": "bB.png",
    "07": "rP.png",
    "08": "bP.png",
    "09": "rR.png",
    "10": "bR.png",
    "11": "rK.png",
    "12": "bK.png",
    "13": "rN.png",
    "14": "bN.png",
}


def source_preview(source: Path, output: Path, radius: int = 330) -> None:
    image = Image.open(source).convert("RGB")
    tile = 360
    preview = Image.new("RGB", (tile * 7, tile * 2), "#dddddd")
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=28)
    for index, (label, (cx, cy)) in enumerate(PIECES.items()):
        crop = image.crop((cx - radius, cy - radius, cx + radius, cy + radius))
        crop.thumbnail((tile, tile), Image.Resampling.LANCZOS)
        x = (index % 7) * tile
        y = (index // 7) * tile
        preview.paste(crop, (x, y))
        draw.rectangle((x + 8, y + 8, x + 58, y + 45), fill="black")
        draw.text((x + 17, y + 12), label, fill="white", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output)


def rotation_preview(source: Path, output: Path, radius: int = 310) -> None:
    image = Image.open(source).convert("RGB")
    angles = tuple(range(0, 360, 45))
    tile = 190
    preview = Image.new("RGB", (tile * len(angles), tile * len(PIECES)), "#dddddd")
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=20)
    for row, (label, (cx, cy)) in enumerate(PIECES.items()):
        crop = image.crop((cx - radius, cy - radius, cx + radius, cy + radius))
        for column, angle in enumerate(angles):
            rotated = crop.rotate(angle, Image.Resampling.BICUBIC, expand=False, fillcolor="white")
            rotated.thumbnail((tile, tile), Image.Resampling.LANCZOS)
            x, y = column * tile, row * tile
            preview.paste(rotated, (x, y))
            draw.rectangle((x + 3, y + 3, x + 72, y + 29), fill="black")
            draw.text((x + 7, y + 5), f"{label} {angle}", fill="white", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output)


def fine_rotation_preview(source: Path, output: Path, radius: int = 310) -> None:
    image = Image.open(source).convert("RGB")
    offsets = (-12, -8, -4, 0, 4, 8, 12)
    tile = 190
    preview = Image.new("RGB", (tile * len(offsets), tile * len(PIECES)), "#dddddd")
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=20)
    for row, (label, (cx, cy)) in enumerate(PIECES.items()):
        crop = image.crop((cx - radius, cy - radius, cx + radius, cy + radius))
        for column, offset in enumerate(offsets):
            angle = BASE_ROTATIONS[label] + offset
            rotated = crop.rotate(angle, Image.Resampling.BICUBIC, expand=False, fillcolor="white")
            rotated.thumbnail((tile, tile), Image.Resampling.LANCZOS)
            x, y = column * tile, row * tile
            preview.paste(rotated, (x, y))
            draw.rectangle((x + 3, y + 3, x + 82, y + 29), fill="black")
            draw.text((x + 7, y + 5), f"{label} {angle % 360}", fill="white", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output)


def measure_centers(source: Path, radius: int = 340) -> None:
    image = Image.open(source).convert("L")
    for label, (cx, cy) in PIECES.items():
        crop = image.crop((cx - radius, cy - radius, cx + radius + 1, cy + radius + 1))
        mask = crop.point(lambda value: 255 if value < 252 else 0).filter(ImageFilter.MaxFilter(7))
        pixels = mask.load()
        seen = {(radius, radius)}
        queue = deque(seen)
        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < mask.width and 0 <= ny < mask.height and pixels[nx, ny] and (nx, ny) not in seen:
                    seen.add((nx, ny))
                    queue.append((nx, ny))
        xs = [point[0] for point in seen]
        ys = [point[1] for point in seen]
        measured_x = cx + round((min(xs) + max(xs)) / 2 - radius)
        measured_y = cy + round((min(ys) + max(ys)) / 2 - radius)
        print(label, measured_x, measured_y, "bbox", min(xs), min(ys), max(xs), max(ys))


def photo_alpha(image: Image.Image, inner_radius: float = 280, outer_radius: float = 304) -> Image.Image:
    """Keep the wood opaque while removing the photographed white edge fringe."""
    center = (image.width - 1) / 2
    alpha = Image.new("L", image.size)
    alpha_pixels = alpha.load()
    rgb_pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            distance = math.hypot(x - center, y - center)
            if distance <= inner_radius:
                alpha_pixels[x, y] = 255
                continue
            radial = round(255 * max(0.0, min(1.0, (outer_radius - distance) / (outer_radius - inner_radius))))
            red, green, blue = rgb_pixels[x, y]
            backdrop_delta = max(255 - red, 255 - green, 255 - blue)
            matte = max(0, min(255, (backdrop_delta - 3) * 12))
            alpha_pixels[x, y] = min(radial, matte)
    return alpha


def extract(source: Path, output: Path, crop_radius: int = 310, output_size: int = 256) -> None:
    image = Image.open(source).convert("RGB")
    output.mkdir(parents=True, exist_ok=True)
    for label, (cx, cy) in PIECES.items():
        crop = image.crop((cx - crop_radius, cy - crop_radius, cx + crop_radius, cy + crop_radius))
        rotated = crop.rotate(BASE_ROTATIONS[label], Image.Resampling.BICUBIC, expand=False)
        rgba = rotated.convert("RGBA")
        rgba.putalpha(photo_alpha(rotated))
        rgba.resize((output_size, output_size), Image.Resampling.LANCZOS).save(
            output / FILENAMES[label], optimize=True
        )


def output_preview(output: Path, destination: Path) -> None:
    tile = 256
    names = ("rK", "rA", "rB", "rN", "rR", "rC", "rP", "bK", "bA", "bB", "bN", "bR", "bC", "bP")
    preview = Image.new("RGB", (tile * 7, tile * 2), "#b8b8b8")
    draw = ImageDraw.Draw(preview)
    for index, name in enumerate(names):
        checker = Image.new("RGB", (tile, tile), "#eeeeee")
        checker_draw = ImageDraw.Draw(checker)
        block = 24
        for y in range(0, tile, block):
            for x in range(0, tile, block):
                if (x // block + y // block) % 2:
                    checker_draw.rectangle((x, y, x + block - 1, y + block - 1), fill="#cccccc")
        piece = Image.open(output / f"{name}.png").convert("RGBA")
        piece.thumbnail((tile, tile), Image.Resampling.LANCZOS)
        checker.paste(piece, (0, 0), piece)
        x, y = (index % 7) * tile, (index // 7) * tile
        preview.paste(checker, (x, y))
        draw.rectangle((x + 8, y + 8, x + 62, y + 38), fill="black")
        draw.text((x + 14, y + 10), name, fill="white", font=ImageFont.load_default(size=22))
    destination.parent.mkdir(parents=True, exist_ok=True)
    preview.save(destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--rotations", action="store_true")
    parser.add_argument("--fine-rotations", action="store_true")
    parser.add_argument("--measure", action="store_true")
    parser.add_argument("--output-preview", type=Path)
    args = parser.parse_args()
    if args.preview:
        source_preview(args.source, args.output)
        return
    if args.rotations:
        rotation_preview(args.source, args.output)
        return
    if args.fine_rotations:
        fine_rotation_preview(args.source, args.output)
        return
    if args.measure:
        measure_centers(args.source)
        return
    extract(args.source, args.output)
    if args.output_preview:
        output_preview(args.output, args.output_preview)


if __name__ == "__main__":
    main()
