#!/usr/bin/env python3
"""Hatchframe: generate a complete animated pixel pet from one prompt.

No third-party packages are required. Python 3.10+ is sufficient.

Quick start:

    # Hosted FLUX path
    export FAL_KEY="your-fal-key"
    python3 hatch.py "baby dragon hawk, cyan and green"

    # Local ComfyUI path (no cloud key)
    python3 hatch.py --provider comfyui \
      --text-workflow anchor-api.json --edit-workflow edit-api.json \
      "baby dragon hawk, cyan and green"

The command creates a portable folder and ZIP containing:

    spritesheet.png  - 57 populated runtime frames in an 8x9 atlas
    hatch.png        - exactly 24 locally composed hatch frames
    manifest.json    - app-agnostic animation contract
    pet.json         - pet identity metadata
    sprite-pet.js    - dependency-free Canvas player
    index.html       - working browser example
    README.md        - integration notes
    qa.json          - per-state quality report

The default hosted path uses FLUX.2 [klein] 9B through fal. ComfyUI and
InvokeAI can run the same prompts against a user's own model and executable
workflow templates. Chroma removal, pose extraction, run-left mirroring,
normalization, atlas packing, the 24-frame hatch, QA, and export always happen
locally.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import json
import math
import os
import re
import signal
import struct
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import zlib
from array import array
from pathlib import Path
from typing import Any, Iterable, Sequence


VERSION = "2.0.0"
TEXT_MODEL = "fal-ai/flux-2/klein/9b"
EDIT_MODEL = "fal-ai/flux-2/klein/9b/edit"
CELL_W = 192
CELL_H = 208
COLS = 8
PET_ROWS = 9
HATCH_ROWS = 3
PET_WIDTH = CELL_W * COLS
PET_HEIGHT = CELL_H * PET_ROWS
HATCH_HEIGHT = CELL_H * HATCH_ROWS
DEFAULT_SEED = 41721
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_ASSET_BYTES = 25 * 1024 * 1024


@dataclasses.dataclass(frozen=True)
class RowSpec:
    id: str
    label: str
    count: int
    fps: int
    loop: bool
    phases: tuple[str, ...]
    mirror_of: str | None = None


ROWS = (
    RowSpec("idle", "Idle", 6, 6, True, (
        "neutral relaxed stance",
        "gentle inhale with chest slightly raised",
        "breath crest with a tiny ear or wing response",
        "soft exhale",
        "small blink and tail response",
        "return to the exact neutral stance",
    )),
    RowSpec("running-right", "Run right", 8, 11, True, (
        "right-facing run contact pose, front foot landing",
        "right-facing run recoil pose",
        "right-facing low passing pose",
        "right-facing airborne pose",
        "opposite foot contact pose",
        "opposite recoil pose",
        "opposite passing pose",
        "second airborne pose that loops to the first",
    )),
    RowSpec("running-left", "Run left", 8, 11, True, (), "running-right"),
    RowSpec("waving", "Wave", 4, 7, False, (
        "friendly ready stance",
        "one paw or wing raised to begin a wave",
        "wave at its highest cheerful peak",
        "relaxed return toward neutral",
    )),
    RowSpec("jumping", "Jump", 5, 9, False, (
        "anticipation crouch",
        "strong takeoff",
        "high celebratory apex",
        "soft landing compression",
        "upright recovery",
    )),
    RowSpec("failed", "Failed", 8, 7, False, (
        "noticing a harmless mistake",
        "surprised reaction",
        "small backward wobble",
        "disappointed slump",
        "brief disappointed hold",
        "steadying the body",
        "recovering confidence",
        "calm return; no injury or gore",
    )),
    RowSpec("waiting", "Waiting", 6, 5, True, (
        "patient neutral stance",
        "quiet glance to the side",
        "tiny weight shift",
        "single relaxed blink",
        "soft breath",
        "return to patient neutral, awake and calm",
    )),
    RowSpec("running", "Working", 6, 9, True, (
        "focused work-in-place stance",
        "energetic forward lean without traveling",
        "active paw, wing or tool-free processing gesture",
        "peak energetic work pose",
        "small recoil",
        "return to focused stance on the same pivot",
    )),
    RowSpec("review", "Review", 6, 6, True, (
        "focused review stance",
        "eyes scanning slightly left",
        "eyes scanning slightly right",
        "thoughtful consideration",
        "small approving nod",
        "return to focused review; no external prop",
    )),
)
GENERATED_ROWS = tuple(row for row in ROWS if not row.mirror_of)

STYLE_PROMPTS = {
    "pixel": (
        "crisp modern 32-bit pixel art, deliberate square pixel clusters, "
        "five-color maximum palette, hard clean edges, compact cute proportions, "
        "strong readable silhouette, no realism, no 3D rendering, no gradients, "
        "no blur, no painterly texture"
    ),
    "toon": (
        "soft pastel pixel art, carefully stepped pixel curves, six-color maximum "
        "palette, compact cute proportions, simple expressive face, hard clean "
        "edges, no realism, no 3D rendering, no gradients, no blur, no painterly texture"
    ),
    "plush": (
        "chunky low-resolution pixel art, large deliberate square pixel clusters, "
        "four-color maximum palette, tiny chibi proportions, bold readable silhouette, "
        "no realism, no 3D rendering, no gradients, no blur, no fabric texture"
    ),
}

CREATURE_WORDS = (
    "dragon", "hawk", "eagle", "bird", "fox", "cat", "kitten", "moth",
    "dog", "corgi", "wolf", "bear", "rabbit", "bunny", "otter", "frog",
    "turtle", "dinosaur", "griffin", "phoenix", "axolotl", "hamster", "slime",
)
COLOR_WORDS = (
    "cyan", "green", "lime", "teal", "blue", "red", "orange", "yellow",
    "purple", "violet", "pink", "white", "black", "gold", "silver",
)


class HatchError(RuntimeError):
    """A user-actionable generation or packing error."""


@dataclasses.dataclass
class Image:
    width: int
    height: int
    pixels: bytearray

    @classmethod
    def blank(cls, width: int, height: int) -> "Image":
        return cls(width, height, bytearray(width * height * 4))

    def copy(self) -> "Image":
        return Image(self.width, self.height, bytearray(self.pixels))


@dataclasses.dataclass
class Frame:
    image: Image
    opaque: int
    edge: int
    multiple: bool

    @property
    def width(self) -> int:
        return self.image.width if self.opaque else 0

    @property
    def height(self) -> int:
        return self.image.height if self.opaque else 0


@dataclasses.dataclass
class RowAsset:
    frames: list[Frame]
    qa: dict[str, Any]
    attempts: int


@dataclasses.dataclass(frozen=True)
class GeneratedImage:
    """PNG bytes plus an engine-native reference handle when one exists."""

    data: bytes
    handle: str | None = None


class ImageBackend:
    """Small provider boundary shared by fal, ComfyUI, and InvokeAI."""

    name = "engine"

    def generate(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        label: str,
        reference: GeneratedImage | None = None,
    ) -> GeneratedImage:
        raise NotImplementedError


_print_lock = threading.Lock()
_cancelled = threading.Event()


def progress(message: str) -> None:
    with _print_lock:
        print(message, flush=True)


def _signal_cancel(_signum: int, _frame: Any) -> None:
    _cancelled.set()


def check_cancelled() -> None:
    if _cancelled.is_set():
        raise KeyboardInterrupt


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:42]
    return slug or "sprite-pet"


def enhance_character_brief(raw: str) -> str:
    compact = re.sub(r"\s+", " ", raw.strip())
    lower = compact.lower()
    creatures = [word for word in CREATURE_WORDS if re.search(rf"\b{re.escape(word)}\b", lower)]
    colors = [word for word in COLOR_WORDS if re.search(rf"\b{re.escape(word)}\b", lower)]
    is_dragon_hawk = "dragon" in creatures and ("hawk" in creatures or "eagle" in creatures)
    if is_dragon_hawk:
        primary = colors[0] if colors else "cyan"
        secondary = colors[1] if len(colors) > 1 else "green"
        return (
            "Exactly one cohesive baby dragon-hawk hybrid: compact dragon body, "
            "expressive hawk beak and eyes, two layered feathered wings, two sturdy "
            "hind legs, one tapered dragon tail, and a small swept-back horn crest. "
            f"Primary {primary} body with {secondary} feather and scale accents. "
            "Friendly, alert expression; symmetrical anatomy; no separate bird or "
            "second creature; no duplicated wings, heads, legs or tails."
        )
    if len(creatures) == 1 and len(compact) < 90:
        palette = ""
        if colors:
            palette = f" Primary {colors[0]} palette"
            if len(colors) > 1:
                palette += f" with {colors[1]} accents"
            palette += "."
        return (
            f"Exactly one friendly baby {creatures[0]} digital pet with compact "
            "game-ready proportions, a distinctive face, a clean full-body silhouette "
            f"and symmetrical anatomy.{palette} Preserve the user concept: {compact}. "
            "No duplicate anatomy or extra creature."
        )
    return (
        f"Exactly one cohesive digital pet based on: {compact}. Keep a compact full-body "
        "game silhouette, expressive face, symmetrical anatomy, consistent markings and "
        "one unmistakable visual identity. Interpret any comma-separated animals as traits "
        "of one hybrid, never as multiple creatures. No duplicate anatomy or extra creature."
    )


def character_prompt(description: str, style: str) -> str:
    return (
        "CANONICAL CHARACTER TURNAROUND SOURCE. "
        f"{enhance_character_brief(description)} {STYLE_PROMPTS[style]}. Show the entire "
        "body centered, facing right in a clean side or slight three-quarter game view, "
        "neutral standing pose, generous empty padding on every side. Preserve every "
        "distinctive color, marking and accessory clearly. Exactly one character. Background "
        "must be one perfectly flat, uniform solid chroma magenta #FF00FF from edge to edge. "
        "No floor, ground, cast shadow, reflection, glow on background, scenery, text, label, "
        "border, crop, prop, duplicate body part or extra limb. Do not use magenta anywhere "
        "on the character. This image is the immutable identity reference for all animation poses."
    )


def pair_pose_prompt(phase_a: str, phase_b: str, style: str, retry_reason: str = "") -> str:
    return (
        "TWO-POSE PRODUCTION STRIP. Use the single reference character as the exact identity "
        "source. Render exactly TWO separate full-body poses total in one horizontal image: "
        "pose A centered in the LEFT half and pose B centered in the RIGHT half, with a wide "
        f"empty gap between. Pose A: {phase_a}. Pose B: {phase_b}. {STYLE_PROMPTS[style]}. "
        "Same single character identity, anatomy, proportions, palette, markings, scale, "
        "camera and lighting in both poses. Entire body and every wing, tail, ear and foot "
        "must stay visible. Background is one perfectly flat uniform solid chroma magenta "
        "#FF00FF edge to edge. No third pose, duplicate anatomy, second creature, panels, "
        "lines, labels, words, numbers, floor, shadow, scenery, prop, overlap or crop. Never "
        f"use magenta on the character. {retry_reason}"
    ).strip()


def single_pose_prompt(phase: str, style: str, retry_reason: str = "") -> str:
    return (
        "SINGLE PRODUCTION ANIMATION POSE. Use the single reference character as the exact "
        f"identity source. Render exactly ONE full-body character in this motion phase: {phase}. "
        f"{STYLE_PROMPTS[style]}. Preserve the exact face, anatomy, proportions, palette, "
        "markings, camera and lighting from the reference. Center the complete body with "
        "generous padding. Background is one perfectly flat uniform solid chroma magenta "
        "#FF00FF edge to edge. No second pose, duplicate anatomy, extra creature, panel, line, "
        "label, word, number, floor, shadow, scenery, prop or crop. Never use magenta on the "
        f"character. {retry_reason}"
    ).strip()


def egg_prompt(style: str) -> str:
    return (
        "Using the reference character only as an identity and palette guide, render exactly "
        "one closed magical hatching egg. The shell colors, markings and one simple emblem "
        f"must unmistakably match the character. {STYLE_PROMPTS[style]}. One centered complete "
        "egg, generous padding, same camera and lighting. Background must be one perfectly flat "
        "uniform solid chroma magenta #FF00FF from edge to edge. No visible creature, duplicate "
        "egg, scenery, nest, floor, shadow, reflection, text, label, border or crop. Do not use "
        "magenta on the egg."
    )


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def encode_png(image: Image, level: int = 8) -> bytes:
    if len(image.pixels) != image.width * image.height * 4:
        raise HatchError("Invalid RGBA image buffer.")
    scanlines = bytearray()
    stride = image.width * 4
    for y in range(image.height):
        scanlines.append(0)
        start = y * stride
        scanlines.extend(image.pixels[start:start + stride])
    header = struct.pack(">IIBBBBB", image.width, image.height, 8, 6, 0, 0, 0)
    return PNG_SIGNATURE + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(bytes(scanlines), level)) + _png_chunk(b"IEND", b"")


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def decode_png(data: bytes) -> Image:
    if not data.startswith(PNG_SIGNATURE):
        raise HatchError("The generation engine returned an asset that is not a PNG.")
    position = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    palette: bytes | None = None
    transparency: bytes | None = None
    while position + 12 <= len(data):
        length = struct.unpack_from(">I", data, position)[0]
        kind = data[position + 4:position + 8]
        payload = data[position + 8:position + 8 + length]
        expected_crc = struct.unpack_from(">I", data, position + 8 + length)[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise HatchError("Generated PNG failed its CRC check.")
        position += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(">IIBBBBB", payload)
        elif kind == b"PLTE":
            palette = payload
        elif kind == b"tRNS":
            transparency = payload
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
    if not width or not height or bit_depth != 8 or interlace != 0:
        raise HatchError("Only non-interlaced 8-bit PNG model output is supported.")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(int(color_type))
    if not channels:
        raise HatchError(f"Unsupported PNG color type {color_type}.")
    raw = zlib.decompress(bytes(compressed))
    stride = width * channels
    expected = (stride + 1) * height
    if len(raw) != expected:
        raise HatchError("Generated PNG has an unexpected scanline length.")
    unfiltered = bytearray(stride * height)
    source = 0
    for y in range(height):
        filter_type = raw[source]
        source += 1
        row_start = y * stride
        previous_start = (y - 1) * stride
        for x in range(stride):
            value = raw[source]
            source += 1
            a = unfiltered[row_start + x - channels] if x >= channels else 0
            b = unfiltered[previous_start + x] if y else 0
            c = unfiltered[previous_start + x - channels] if y and x >= channels else 0
            if filter_type == 1:
                value = (value + a) & 255
            elif filter_type == 2:
                value = (value + b) & 255
            elif filter_type == 3:
                value = (value + ((a + b) >> 1)) & 255
            elif filter_type == 4:
                value = (value + _paeth(a, b, c)) & 255
            elif filter_type != 0:
                raise HatchError(f"Unsupported PNG filter {filter_type}.")
            unfiltered[row_start + x] = value
    rgba = bytearray(width * height * 4)
    for index in range(width * height):
        source_index = index * channels
        target = index * 4
        if color_type == 6:
            rgba[target:target + 4] = unfiltered[source_index:source_index + 4]
        elif color_type == 2:
            rgba[target:target + 3] = unfiltered[source_index:source_index + 3]
            rgba[target + 3] = 255
        elif color_type == 0:
            gray = unfiltered[source_index]
            rgba[target:target + 3] = bytes((gray, gray, gray))
            rgba[target + 3] = 255
        elif color_type == 4:
            gray, alpha = unfiltered[source_index:source_index + 2]
            rgba[target:target + 3] = bytes((gray, gray, gray))
            rgba[target + 3] = alpha
        else:
            palette_index = unfiltered[source_index]
            if palette is None or palette_index * 3 + 2 >= len(palette):
                raise HatchError("Generated indexed PNG has an invalid palette.")
            rgba[target:target + 3] = palette[palette_index * 3:palette_index * 3 + 3]
            rgba[target + 3] = transparency[palette_index] if transparency and palette_index < len(transparency) else 255
    return Image(width, height, rgba)


def remove_chroma(image: Image) -> tuple[Image, float]:
    output = image.copy()
    pixels = output.pixels
    inset = max(1, int(min(image.width, image.height) * 0.008))
    key_r = key_g = key_b = samples = 0
    for x in range(0, image.width, inset):
        for y in (inset, image.height - 1 - inset):
            i = (y * image.width + x) * 4
            key_r += pixels[i]
            key_g += pixels[i + 1]
            key_b += pixels[i + 2]
            samples += 1
    for y in range(inset, image.height, inset):
        for x in (inset, image.width - 1 - inset):
            i = (y * image.width + x) * 4
            key_r += pixels[i]
            key_g += pixels[i + 1]
            key_b += pixels[i + 2]
            samples += 1
    key_r /= max(1, samples)
    key_g /= max(1, samples)
    key_b /= max(1, samples)
    if not (key_r > 150 and key_b > 150 and key_g < min(key_r, key_b) * 0.65):
        raise HatchError("The model did not return the required flat magenta background; retry with a new seed.")
    transparent = 0
    for i in range(0, len(pixels), 4):
        dr = pixels[i] - key_r
        dg = pixels[i + 1] - key_g
        db = pixels[i + 2] - key_b
        distance = math.sqrt(dr * dr + dg * dg + db * db)
        matte = max(0.0, min(1.0, (distance - 28.0) / 82.0))
        alpha = round(pixels[i + 3] * matte)
        if alpha < 24:
            transparent += 1
        if matte < 1:
            spill = (1 - matte) * 0.72
            neutral = min(pixels[i], pixels[i + 2])
            pixels[i] = round(pixels[i] * (1 - spill) + neutral * spill)
            pixels[i + 2] = round(pixels[i + 2] * (1 - spill) + neutral * spill)
        pixels[i + 3] = alpha
        if not alpha:
            pixels[i:i + 3] = b"\0\0\0"
    ratio = transparent / (image.width * image.height)
    if ratio < 0.08:
        raise HatchError("The generated background could not be removed cleanly; retry with a new seed.")
    return output, ratio


def extract_frames(image: Image, count: int) -> list[Frame]:
    width, height, pixels = image.width, image.height, image.pixels
    total = width * height
    labels = array("i", [-1]) * total
    components: list[dict[str, int]] = []
    for index in range(total):
        if labels[index] != -1 or pixels[index * 4 + 3] < 36:
            continue
        component_id = len(components)
        queue = array("I", [index])
        labels[index] = component_id
        head = 0
        component_count = 0
        min_x, min_y, max_x, max_y = width, height, -1, -1
        while head < len(queue):
            current = queue[head]
            head += 1
            y, x = divmod(current, width)
            component_count += 1
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for oy in (-1, 0, 1):
                ny = y + oy
                if ny < 0 or ny >= height:
                    continue
                for ox in (-1, 0, 1):
                    nx = x + ox
                    if (not ox and not oy) or nx < 0 or nx >= width:
                        continue
                    neighbor = ny * width + nx
                    if labels[neighbor] == -1 and pixels[neighbor * 4 + 3] >= 36:
                        labels[neighbor] = component_id
                        queue.append(neighbor)
        components.append({"id": component_id, "count": component_count, "min_x": min_x, "min_y": min_y, "max_x": max_x, "max_y": max_y})
    ranked = sorted(components, key=lambda item: item["count"], reverse=True)
    largest = ranked[0]["count"] if ranked else 0
    significant = [item for item in ranked if item["count"] >= largest * 0.06]
    selected = sorted(significant[:count], key=lambda item: item["min_x"] + item["max_x"])
    smallest = min((item["count"] for item in selected), default=0)
    selected_ids = {item["id"] for item in selected}
    extra = next((item for item in significant if item["id"] not in selected_ids), None)
    multiple = bool(extra and smallest and extra["count"] > smallest * 0.45)
    edge_x = max(3, round(width * 0.006))
    edge_y = max(3, round(height * 0.018))
    frames: list[Frame] = []
    for component in selected:
        left = max(0, component["min_x"] - 2)
        top = max(0, component["min_y"] - 2)
        right = min(width - 1, component["max_x"] + 2)
        bottom = min(height - 1, component["max_y"] + 2)
        frame = Image.blank(right - left + 1, bottom - top + 1)
        opaque = edge = 0
        component_id = component["id"]
        for y in range(top, bottom + 1):
            for x in range(left, right + 1):
                source_pixel = y * width + x
                belongs = labels[source_pixel] == component_id
                if not belongs and pixels[source_pixel * 4 + 3] > 0:
                    for oy in (-1, 0, 1):
                        if belongs:
                            break
                        ny = y + oy
                        if ny < 0 or ny >= height:
                            continue
                        for ox in (-1, 0, 1):
                            nx = x + ox
                            if 0 <= nx < width and labels[ny * width + nx] == component_id:
                                belongs = True
                                break
                if not belongs:
                    continue
                source = source_pixel * 4
                target = ((y - top) * frame.width + (x - left)) * 4
                frame.pixels[target:target + 4] = pixels[source:source + 4]
                if pixels[source + 3] >= 36:
                    opaque += 1
                    if x < edge_x or x >= width - edge_x or y < edge_y or y >= height - edge_y:
                        edge += 1
        frames.append(Frame(frame, opaque, edge, multiple))
    while len(frames) < count:
        frames.append(Frame(Image.blank(1, 1), 0, 0, False))
    return frames


def analyze_frames(frames: Sequence[Frame], row: RowSpec, width: int, height: int) -> dict[str, Any]:
    reasons: list[str] = []
    empty = sum(not frame.opaque for frame in frames)
    if empty:
        reasons.append(f"{empty} of {row.count} slots are empty")
    clipped = sum(bool(frame.opaque and frame.edge / frame.opaque > 0.015) for frame in frames)
    if clipped:
        reasons.append(f"{clipped} poses touch a slot edge")
    multiple = sum(frame.multiple for frame in frames)
    if multiple:
        reasons.append(f"{multiple} slots may contain multiple subjects")
    populated = [frame for frame in frames if frame.opaque]
    if len(populated) > 1:
        heights = [frame.height for frame in populated]
        mean = sum(heights) / len(heights)
        variance = sum((value - mean) ** 2 for value in heights) / len(heights)
        if math.sqrt(variance) / max(1, mean) > 0.22 and row.id != "jumping":
            reasons.append("pose scale varies unusually")
    reasons = list(dict.fromkeys(reasons))
    return {
        "pass": not reasons,
        "critical": bool(empty or clipped > math.ceil(row.count / 2)),
        "score": max(0, round(100 - empty * 28 - clipped * 8 - max(0, len(reasons) - 2) * 6)),
        "reasons": reasons,
        "sourceWidth": width,
        "sourceHeight": height,
    }


def _alpha_blend(destination: bytearray, index: int, r: int, g: int, b: int, alpha: int, opacity: float = 1.0) -> None:
    source_alpha = max(0, min(255, round(alpha * opacity)))
    if source_alpha <= 0:
        return
    destination_alpha = destination[index + 3]
    out_alpha = source_alpha + (destination_alpha * (255 - source_alpha) + 127) // 255
    if out_alpha <= 0:
        return
    for offset, value in enumerate((r, g, b)):
        numerator = value * source_alpha * 255 + destination[index + offset] * destination_alpha * (255 - source_alpha)
        destination[index + offset] = max(0, min(255, (numerator + out_alpha * 127) // (out_alpha * 255)))
    destination[index + 3] = out_alpha


def blit_scaled(destination: Image, source: Image, dx: float, dy: float, dw: float, dh: float, *, flip_x: bool = False, opacity: float = 1.0) -> None:
    target_w = max(1, round(dw))
    target_h = max(1, round(dh))
    left = round(dx)
    top = round(dy)
    for ty in range(target_h):
        py = top + ty
        if py < 0 or py >= destination.height:
            continue
        sy = min(source.height - 1, int((ty + 0.5) * source.height / target_h))
        for tx in range(target_w):
            px = left + tx
            if px < 0 or px >= destination.width:
                continue
            mapped_x = target_w - 1 - tx if flip_x else tx
            sx = min(source.width - 1, int((mapped_x + 0.5) * source.width / target_w))
            source_index = (sy * source.width + sx) * 4
            alpha = source.pixels[source_index + 3]
            if not alpha:
                continue
            target_index = (py * destination.width + px) * 4
            _alpha_blend(destination.pixels, target_index, source.pixels[source_index], source.pixels[source_index + 1], source.pixels[source_index + 2], alpha, opacity)


def blit_affine(destination: Image, source: Image, center_x: float, bottom_y: float, width: float, height: float, rotation: float, scale_x: float, scale_y: float, opacity: float) -> None:
    cos_r = math.cos(rotation)
    sin_r = math.sin(rotation)
    half_w = width / 2
    corners: list[tuple[float, float]] = []
    for local_x, local_y in ((-half_w, -height), (half_w, -height), (half_w, 0), (-half_w, 0)):
        scaled_x, scaled_y = local_x * scale_x, local_y * scale_y
        corners.append((center_x + scaled_x * cos_r - scaled_y * sin_r, bottom_y + scaled_x * sin_r + scaled_y * cos_r))
    min_x = max(0, math.floor(min(point[0] for point in corners)))
    max_x = min(destination.width - 1, math.ceil(max(point[0] for point in corners)))
    min_y = max(0, math.floor(min(point[1] for point in corners)))
    max_y = min(destination.height - 1, math.ceil(max(point[1] for point in corners)))
    for py in range(min_y, max_y + 1):
        for px in range(min_x, max_x + 1):
            translated_x = px + 0.5 - center_x
            translated_y = py + 0.5 - bottom_y
            local_x = (translated_x * cos_r + translated_y * sin_r) / scale_x
            local_y = (-translated_x * sin_r + translated_y * cos_r) / scale_y
            if local_x < -half_w or local_x >= half_w or local_y < -height or local_y >= 0:
                continue
            sx = min(source.width - 1, max(0, int((local_x + half_w) * source.width / width)))
            sy = min(source.height - 1, max(0, int((local_y + height) * source.height / height)))
            source_index = (sy * source.width + sx) * 4
            alpha = source.pixels[source_index + 3]
            if not alpha:
                continue
            target_index = (py * destination.width + px) * 4
            _alpha_blend(destination.pixels, target_index, source.pixels[source_index], source.pixels[source_index + 1], source.pixels[source_index + 2], alpha, opacity)


def fill_square(destination: Image, center_x: float, center_y: float, size: float, color: tuple[int, int, int], opacity: float) -> None:
    half = max(1, round(size / 2))
    for y in range(round(center_y) - half, round(center_y) + half + 1):
        if y < 0 or y >= destination.height:
            continue
        for x in range(round(center_x) - half, round(center_x) + half + 1):
            if 0 <= x < destination.width:
                _alpha_blend(destination.pixels, (y * destination.width + x) * 4, *color, 255, opacity)


def _median(values: Iterable[int]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    return float(ordered[middle]) if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def compose_pet_atlas(assets: dict[str, RowAsset]) -> Image:
    atlas = Image.blank(PET_WIDTH, PET_HEIGHT)
    for row_index, spec in enumerate(ROWS):
        source_id = spec.mirror_of or spec.id
        asset = assets.get(source_id)
        if asset is None:
            raise HatchError(f"Missing {source_id} frames.")
        frames = asset.frames
        if len(frames) < spec.count or any(not frame.opaque for frame in frames[:spec.count]):
            raise HatchError(f"{spec.label} contains an empty frame.")
        median_height = _median(frame.height for frame in frames[:spec.count])
        median_width = _median(frame.width for frame in frames[:spec.count])
        scale = min(174 / max(1, median_height), 166 / max(1, median_width))
        jump_offsets = (0, -24, -52, -30, 0)
        for frame_index in range(spec.count):
            frame = frames[frame_index]
            dw = frame.width * scale
            dh = frame.height * scale
            local_x = (CELL_W - dw) / 2
            lift = jump_offsets[frame_index] if spec.id == "jumping" else 0
            dy = row_index * CELL_H + 194 - dh + lift
            blit_scaled(atlas, frame.image, frame_index * CELL_W + local_x, dy, dw, dh, flip_x=bool(spec.mirror_of))
    return atlas


def compose_hatch(egg: Image, idle_frame: Frame) -> Image:
    egg_frame = extract_frames(egg, 1)[0]
    if not egg_frame.opaque or not idle_frame.opaque:
        raise HatchError("Hatch sources are empty.")
    atlas = Image.blank(PET_WIDTH, HATCH_HEIGHT)
    egg_scale = min(150 / egg_frame.width, 172 / egg_frame.height)
    pet_scale = min(166 / idle_frame.width, 174 / idle_frame.height)
    for frame in range(24):
        col, row = frame % COLS, frame // COLS
        ox, oy = col * CELL_W, row * CELL_H
        reveal = max(0.0, min(1.0, (frame - 9) / 9))
        eased_reveal = 1 - (1 - reveal) ** 3
        wobble = math.sin(frame * 2.15) * max(1, frame - 2) * 0.72 if frame < 13 else 0
        egg_alpha = 1.0 if frame < 10 else max(0.0, 1 - (frame - 9) / 7)
        egg_pulse = 1 + math.sin(frame * 1.4) * min(frame / 24, 0.025)
        blit_affine(
            atlas,
            egg_frame.image,
            ox + CELL_W / 2,
            oy + 194,
            egg_frame.width * egg_scale,
            egg_frame.height * egg_scale,
            math.radians(wobble),
            egg_pulse,
            2 - egg_pulse,
            egg_alpha,
        )
        if frame >= 7:
            burst = max(0.0, min(1.0, (frame - 7) / 12))
            for particle in range(10):
                angle = particle * 2.399 + 0.4
                radius = 16 + burst * (38 + (particle % 3) * 8)
                px = ox + CELL_W / 2 + math.cos(angle) * radius
                py = oy 