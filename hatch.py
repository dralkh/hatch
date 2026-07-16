#!/usr/bin/env python3
"""Hatchframe: generate a complete animated pixel pet from one prompt.

Python 3.10+ is sufficient for PNG-returning providers. xAI currently returns
JPEG, so that provider also needs Pillow for lossless conversion into Hatch's
internal PNG pipeline.

Quick start:

    # Hosted path; .env is loaded automatically
    python3 hatch.py --provider openai "baby dragon hawk, cyan and green"

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

The hosted paths support fal, OpenAI, xAI, OpenRouter, and Google. ComfyUI and
InvokeAI can run the same prompts against a user's own model and executable
workflow templates. Chroma removal, pose extraction, run-left mirroring,
normalization, atlas packing, the 24-frame hatch, QA, and export always happen
locally.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import dataclasses
import datetime as dt
import io
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


VERSION = "0.5.0"
TEXT_MODEL = "fal-ai/flux-2/klein/9b"
EDIT_MODEL = "fal-ai/flux-2/klein/9b/edit"
DIRECT_CLOUD_PROVIDERS = ("openai", "xai", "openrouter", "google")
CLOUD_PROVIDERS = ("fal", *DIRECT_CLOUD_PROVIDERS)
PACKAGE_FORMATS = ("hatch", "hermes", "both")
CLOUD_SETTINGS = {
    "openai": ("OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "gpt-image-2"),
    "xai": ("XAI_API_KEY", "XAI_IMAGE_MODEL", "grok-imagine-image-quality"),
    "openrouter": ("OPENROUTER_API_KEY", "OPENROUTER_IMAGE_MODEL", "google/gemini-3.1-flash-image"),
    "google": ("GOOGLE_API_KEY", "GOOGLE_IMAGE_MODEL", "gemini-3.1-flash-image"),
}
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


def load_dotenv() -> None:
    """Load local development secrets without replacing exported variables."""
    roots = (Path.cwd(), Path(__file__).resolve().parent)
    seen: set[Path] = set()
    for root in roots:
        for name in (".env.local", ".env"):
            path = root / name
            if path in seen or not path.is_file():
                continue
            seen.add(path)
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError as error:
                raise HatchError(f"Unable to read {path}: {error}") from error
            for raw in lines:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].lstrip()
                key, separator, value = line.partition("=")
                key = key.strip()
                if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ.setdefault(key, value)


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


class ProviderHTTPError(HatchError):
    def __init__(self, message: str, status: int, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


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
    """Provider boundary shared by fal, ComfyUI, and InvokeAI."""

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
        raise HatchError("fal returned an asset that is not a PNG.")
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
                py = oy + 121 + math.sin(angle) * radius * 0.72
                size = max(0.7, 3.2 * (1 - burst) + particle % 2)
                color = (168, 255, 79) if particle % 2 else (92, 246, 255)
                fill_square(atlas, px, py, size, color, max(0.0, math.sin(burst * math.pi)) * 0.9)
        if reveal > 0:
            settle = -math.sin(reveal * math.pi) * 32 if frame < 19 else math.sin((frame - 18) * 1.8) * max(0, 4 - (frame - 18) * 0.7)
            pop_scale = 0.72 + eased_reveal * 0.28
            squash = 1 + math.sin(reveal * math.pi) * 0.12 if frame < 18 else 1
            pw = idle_frame.width * pet_scale * pop_scale * squash
            ph = idle_frame.height * pet_scale * pop_scale / squash
            blit_scaled(atlas, idle_frame.image, ox + (CELL_W - pw) / 2, oy + 194 - ph + settle, pw, ph, opacity=eased_reveal)
    return atlas


def _allowed_asset_url(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and not parsed.username
        and not parsed.password
        and (parsed.port in (None, 443))
        and (
            host == "fal.media"
            or host.endswith(".fal.media")
            or host == "fal.run"
            or host.endswith(".fal.run")
            or host == "storage.googleapis.com"
        )
    )


class _SafeAssetRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: urllib.request.Request, fp: Any, code: int, message: str, headers: Any, new_url: str) -> urllib.request.Request:
        resolved = urllib.parse.urljoin(request.full_url, new_url)
        if not _allowed_asset_url(resolved):
            raise HatchError("Generated asset redirected to an untrusted host.")
        return super().redirect_request(request, fp, code, message, headers, resolved)


def _json_request(url: str, method: str, api_key: str, payload: dict[str, Any] | None = None, timeout: int = 90) -> dict[str, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Authorization": f"Key {api_key}", "User-Agent": f"Hatchframe-CLI/{VERSION}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw.decode())
            message = detail.get("detail") or detail.get("error") or str(detail)
        except Exception:
            message = raw.decode(errors="replace") or str(error)
        raise HatchError(f"fal request failed ({error.code}): {message}") from error
    except urllib.error.URLError as error:
        raise HatchError(f"Unable to reach fal: {error.reason}") from error
    try:
        result = json.loads(raw.decode())
    except Exception as error:
        raise HatchError("fal returned an invalid JSON response.") from error
    if not isinstance(result, dict):
        raise HatchError("fal returned an unexpected response shape.")
    return result


def _validate_lifecycle_url(url: Any, request_id: str, action: str) -> str:
    if not isinstance(url, str) or not url:
        raise HatchError(f"fal did not return a {action} URL.")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "queue.fal.run" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise HatchError("fal returned an invalid queue lifecycle URL.")
    if action == "status":
        expected_path = rf"/requests/{re.escape(request_id)}/status$"
    elif action == "cancel":
        expected_path = rf"/requests/{re.escape(request_id)}/cancel$"
    else:
        # fal has returned both forms over time; current REST documentation
        # shows a convenience response_url ending in /response while the
        # canonical result endpoint ends at the request ID.
        expected_path = rf"/requests/{re.escape(request_id)}(?:/response)?$"
    if not re.search(expected_path, parsed.path):
        raise HatchError("fal queue URL does not match its request ID.")
    if action == "status":
        query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        query["logs"] = "1"
        parsed = parsed._replace(query=urllib.parse.urlencode(query), fragment="")
    else:
        parsed = parsed._replace(query="", fragment="")
    return urllib.parse.urlunsplit(parsed)


def run_queued(api_key: str, model: str, model_input: dict[str, Any], label: str) -> dict[str, Any]:
    check_cancelled()
    submitted = _json_request(f"https://queue.fal.run/{model}", "POST", api_key, model_input)
    request_id = submitted.get("request_id")
    if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,160}", request_id):
        raise HatchError("fal did not return a valid request ID.")
    status_url = _validate_lifecycle_url(submitted.get("status_url"), request_id, "status")
    response_url = _validate_lifecycle_url(submitted.get("response_url"), request_id, "result")
    last_message = ""
    for _poll in range(360):
        check_cancelled()
        time.sleep(1.5)
        status = _json_request(status_url, "GET", api_key, timeout=60)
        state = status.get("status")
        if state == "IN_QUEUE":
            position = status.get("queue_position")
            message = f"{label}: queued" + (f" ({position} ahead)" if isinstance(position, int) else "")
        elif state == "IN_PROGRESS":
            logs = status.get("logs")
            log = logs[-1].get("message") if isinstance(logs, list) and logs and isinstance(logs[-1], dict) else None
            message = f"{label}: {log or 'generating'}"
        elif state == "COMPLETED":
            if status.get("error"):
                raise HatchError(str(status["error"]))
            return _json_request(response_url, "GET", api_key, timeout=90)
        elif state in ("FAILED", "CANCELLED"):
            raise HatchError(str(status.get("error") or f"fal request {str(state).lower()}"))
        else:
            message = f"{label}: waiting for fal"
        if message != last_message:
            progress(message[:180])
            last_message = message
    raise HatchError(f"{label} did not finish within nine minutes.")


def download_asset(url: str) -> bytes:
    if not _allowed_asset_url(url):
        raise HatchError("fal returned an untrusted generated asset URL.")
    opener = urllib.request.build_opener(_SafeAssetRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": f"Hatchframe-CLI/{VERSION}"})
    try:
        with opener.open(request, timeout=120) as response:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type and content_type not in ("image/png", "application/octet-stream"):
                raise HatchError(f"fal returned unsupported media type {content_type}.")
            data = response.read(MAX_ASSET_BYTES + 1)
    except urllib.error.URLError as error:
        raise HatchError(f"Unable to download generated image: {error.reason}") from error
    if len(data) > MAX_ASSET_BYTES:
        raise HatchError("Generated image exceeds the 25 MB safety limit.")
    return data


def _result_image_url(result: dict[str, Any], label: str) -> str:
    images = result.get("images")
    url = images[0].get("url") if isinstance(images, list) and images and isinstance(images[0], dict) else None
    if not isinstance(url, str) or not url:
        raise HatchError(f"{label} returned no image.")
    return url


def _download_clean(url: str) -> tuple[Image, float]:
    return remove_chroma(decode_png(download_asset(url)))


class FalBackend(ImageBackend):
    name = "fal"

    def __init__(self, api_key: str):
        self.api_key = re.sub(r"^Key\s+", "", api_key.strip(), flags=re.IGNORECASE)
        if not self.api_key:
            raise HatchError("A fal API key is required.")

    def generate(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        label: str,
        reference: GeneratedImage | None = None,
    ) -> GeneratedImage:
        if reference is None:
            model = TEXT_MODEL
            model_input: dict[str, Any] = {
                "prompt": prompt,
                "image_size": "square_hd" if width == height == 1024 else {"width": width, "height": height},
                "num_inference_steps": 4,
                "output_format": "png",
                "num_images": 1,
                "seed": seed,
            }
        else:
            if not reference.handle:
                raise HatchError("fal reference image is missing its generated asset URL.")
            model = EDIT_MODEL
            model_input = {
                "prompt": prompt,
                "image_urls": [reference.handle],
                "image_size": "square" if width == height == 1024 else {"width": width, "height": height},
                "num_inference_steps": 4,
                "output_format": "png",
                "num_images": 1,
                "seed": seed,
            }
        result = run_queued(self.api_key, model, model_input, label)
        url = _result_image_url(result, label)
        return GeneratedImage(download_asset(url), url)


def _normalize_endpoint(endpoint: str) -> str:
    parsed = urllib.parse.urlsplit(endpoint.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HatchError("Engine endpoint must be an http:// or https:// URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HatchError("Engine endpoint must not contain credentials, a query, or a fragment.")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def _engine_headers(token: str | None = None) -> dict[str, str]:
    headers = {"User-Agent": f"Hatchframe-CLI/{VERSION}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _engine_request(
    provider: str,
    url: str,
    method: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 90,
    max_bytes: int = MAX_ASSET_BYTES,
) -> tuple[bytes, Any]:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(max_bytes + 1)
            response_headers = response.headers
    except urllib.error.HTTPError as error:
        detail = error.read(64 * 1024).decode(errors="replace")
        try:
            decoded = json.loads(detail)
            if isinstance(decoded, dict):
                candidate = decoded.get("detail") or decoded.get("error") or decoded
                if isinstance(candidate, dict):
                    candidate = candidate.get("message") or candidate
                detail = str(candidate)
        except Exception:
            pass
        retry_after: float | None = None
        try:
            header = error.headers.get("Retry-After") if error.headers else None
            retry_after = max(0.0, float(header)) if header else None
        except (TypeError, ValueError):
            retry_after = None
        raise ProviderHTTPError(
            f"{provider} request failed ({error.code}): {detail or error.reason}",
            error.code,
            retry_after,
        ) from error
    except urllib.error.URLError as error:
        raise HatchError(f"Unable to reach {provider}: {error.reason}") from error
    if len(raw) > max_bytes:
        raise HatchError(f"{provider} response exceeds the {max_bytes // (1024 * 1024)} MB safety limit.")
    return raw, response_headers


def _engine_json(
    provider: str,
    url: str,
    method: str,
    *,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: int = 90,
) -> dict[str, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    headers = _engine_headers(token)
    if body is not None:
        headers["Content-Type"] = "application/json"
    raw, _headers = _engine_request(provider, url, method, data=body, headers=headers, timeout=timeout, max_bytes=4 * 1024 * 1024)
    try:
        result = json.loads(raw.decode())
    except Exception as error:
        raise HatchError(f"{provider} returned invalid JSON.") from error
    if not isinstance(result, dict):
        raise HatchError(f"{provider} returned an unexpected response shape.")
    return result


def _multipart_png(field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----hatchframe-{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: image/png\r\n\r\n")
    body.extend(data)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _multipart_image(fields: dict[str, str], field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    boundary = f"----hatchframe-{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.extend(value.encode())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: image/png\r\n\r\n")
    body.extend(data)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _cloud_json(
    provider: str,
    url: str,
    key: str,
    *,
    payload: dict[str, Any] | None = None,
    body: bytes | None = None,
    content_type: str = "application/json",
) -> dict[str, Any]:
    headers = {"User-Agent": f"Hatchframe-CLI/{VERSION}", "Content-Type": content_type}
    if provider == "google":
        headers["x-goog-api-key"] = key
    else:
        headers["Authorization"] = f"Bearer {key}"
    if provider == "openrouter":
        headers["X-Title"] = "Hatch"
    request_body = json.dumps(payload).encode() if payload is not None else body
    raw = b""
    for attempt in range(5):
        check_cancelled()
        try:
            raw, _headers = _engine_request(
                provider,
                url,
                "POST",
                data=request_body,
                headers=headers,
                timeout=240,
                max_bytes=MAX_ASSET_BYTES * 2,
            )
            break
        except ProviderHTTPError as error:
            retryable = error.status == 429 or 500 <= error.status < 600
            if not retryable or attempt == 4:
                raise
            delay = error.retry_after if error.retry_after is not None else min(60.0, 5.0 * (2 ** attempt))
            delay = min(120.0, max(1.0, delay))
            progress(f"{provider}: temporary HTTP {error.status}; retrying in {delay:g}s")
            deadline = time.monotonic() + delay
            while time.monotonic() < deadline:
                check_cancelled()
                time.sleep(min(0.5, deadline - time.monotonic()))
    try:
        result = json.loads(raw.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HatchError(f"{provider} returned invalid JSON.") from error
    if not isinstance(result, dict):
        raise HatchError(f"{provider} returned an unexpected response shape.")
    return result


def _base64_image(value: Any, provider: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise HatchError(f"{provider} returned no inline image.")
    if len(value) > MAX_ASSET_BYTES * 2:
        raise HatchError(f"{provider} returned an image that is too large.")
    try:
        data = base64.b64decode(value, validate=True)
    except Exception as error:
        raise HatchError(f"{provider} returned invalid base64 image data.") from error
    if not data or len(data) > MAX_ASSET_BYTES:
        raise HatchError(f"{provider} returned an empty or oversized image.")
    return data


def _normalized_provider_png(data: bytes, provider: str) -> bytes:
    if data.startswith(PNG_SIGNATURE):
        try:
            decode_png(data)
            return data
        except HatchError:
            pass
    if not (data.startswith(b"\xff\xd8\xff") or (len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP") or data.startswith(PNG_SIGNATURE)):
        raise HatchError(f"{provider} returned an unsupported image format.")
    try:
        from PIL import Image as PillowImage
        from PIL import UnidentifiedImageError
    except ImportError as error:
        raise HatchError(
            f"{provider} returned JPEG/WebP. Install Pillow (`python3 -m pip install Pillow`) "
            "so Hatch can convert it to PNG."
        ) from error
    try:
        PillowImage.MAX_IMAGE_PIXELS = 16_000_000
        with PillowImage.open(io.BytesIO(data)) as source:
            source.load()
            if source.width < 1 or source.height < 1 or source.width * source.height > 16_000_000:
                raise HatchError(f"{provider} returned unsafe image dimensions.")
            rgba = source.convert("RGBA")
            return encode_png(Image(rgba.width, rgba.height, bytearray(rgba.tobytes())))
    except HatchError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HatchError(f"{provider} returned an image that could not be decoded.") from error


def _aspect_ratio(width: int, height: int) -> str:
    return "1:1" if width == height else "16:9"


def _openai_size(width: int, height: int) -> str:
    return "1024x1024" if width == height else "1536x1024"


class DirectCloudBackend(ImageBackend):
    def __init__(self, provider: str, api_key: str, model: str):
        if provider not in DIRECT_CLOUD_PROVIDERS:
            raise HatchError(f"Unsupported direct cloud provider: {provider}.")
        self.name = provider
        self.api_key = api_key.strip()
        self.model = model.strip()
        if not self.api_key:
            key_env = CLOUD_SETTINGS[provider][0]
            raise HatchError(f"A {provider} API key is required. Set {key_env} or use --api-key.")
        if not self.model:
            raise HatchError(f"A {provider} image model is required.")
        if provider == "xai":
            try:
                import PIL  # noqa: F401
            except ImportError as error:
                raise HatchError(
                    "xAI currently returns JPEG. Install Pillow (`python3 -m pip install Pillow`) "
                    "before starting a billable Hatch run."
                ) from error

    def _data_result(self, result: dict[str, Any]) -> bytes:
        images = result.get("data")
        first = images[0] if isinstance(images, list) and images and isinstance(images[0], dict) else None
        return _base64_image(first.get("b64_json") if first else None, self.name)

    def _generate_openai(self, prompt: str, width: int, height: int, reference: GeneratedImage | None) -> bytes:
        url = "https://api.openai.com/v1/images/generations"
        if reference is None:
            result = _cloud_json(self.name, url, self.api_key, payload={
                "model": self.model,
                "prompt": prompt,
                "size": _openai_size(width, height),
                "quality": "low",
                "output_format": "png",
                "n": 1,
            })
        else:
            body, content_type = _multipart_image({
                "model": self.model,
                "prompt": prompt,
                "size": _openai_size(width, height),
                "quality": "low",
                "output_format": "png",
            }, "image[]", "identity.png", reference.data)
            result = _cloud_json(
                self.name,
                "https://api.openai.com/v1/images/edits",
                self.api_key,
                body=body,
                content_type=content_type,
            )
        return self._data_result(result)

    def _generate_xai(self, prompt: str, width: int, height: int, reference: GeneratedImage | None) -> bytes:
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json",
            "resolution": "1k",
            "aspect_ratio": _aspect_ratio(width, height),
        }
        endpoint = "generations"
        if reference is not None:
            endpoint = "edits"
            payload["image"] = {
                "type": "image_url",
                "url": f"data:image/png;base64,{base64.b64encode(reference.data).decode()}",
            }
        return self._data_result(_cloud_json(
            self.name, f"https://api.x.ai/v1/images/{endpoint}", self.api_key, payload=payload,
        ))

    def _generate_openrouter(self, prompt: str, width: int, height: int, seed: int, reference: GeneratedImage | None) -> bytes:
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "resolution": "1K",
            "aspect_ratio": _aspect_ratio(width, height),
            "output_format": "png",
            "seed": seed,
        }
        if reference is not None:
            data_url = f"data:image/png;base64,{base64.b64encode(reference.data).decode()}"
            payload["input_references"] = [{"type": "image_url", "image_url": {"url": data_url}}]
        return self._data_result(_cloud_json(
            self.name, "https://openrouter.ai/api/v1/images", self.api_key, payload=payload,
        ))

    def _generate_google(self, prompt: str, width: int, height: int, reference: GeneratedImage | None) -> bytes:
        inputs: list[dict[str, Any]] = []
        if reference is not None:
            inputs.append({
                "type": "image",
                "mime_type": "image/png",
                "data": base64.b64encode(reference.data).decode(),
            })
        inputs.append({"type": "text", "text": prompt})
        result = _cloud_json(
            self.name,
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            self.api_key,
            payload={
                "model": self.model,
                "store": False,
                "input": inputs,
                "response_format": {
                    "type": "image",
                    "mime_type": "image/png",
                    "aspect_ratio": _aspect_ratio(width, height),
                    "image_size": "1K",
                },
            },
        )
        steps = result.get("steps")
        if isinstance(steps, list):
            for step in reversed(steps):
                if not isinstance(step, dict) or step.get("type") != "model_output":
                    continue
                content = step.get("content")
                if not isinstance(content, list):
                    continue
                for item in reversed(content):
                    if isinstance(item, dict) and item.get("type") == "image":
                        return _base64_image(item.get("data"), self.name)
        raise HatchError("google returned no generated image.")

    def generate(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        label: str,
        reference: GeneratedImage | None = None,
    ) -> GeneratedImage:
        check_cancelled()
        progress(f"{label}: sending to {'xAI' if self.name == 'xai' else self.name}")
        if self.name == "openai":
            data = self._generate_openai(prompt, width, height, reference)
        elif self.name == "xai":
            data = self._generate_xai(prompt, width, height, reference)
        elif self.name == "openrouter":
            data = self._generate_openrouter(prompt, width, height, seed, reference)
        else:
            data = self._generate_google(prompt, width, height, reference)
        return GeneratedImage(_normalized_provider_png(data, self.name))


def _replace_workflow_values(value: Any, replacements: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: _replace_workflow_values(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_workflow_values(item, replacements) for item in value]
    if not isinstance(value, str):
        return value
    if value in replacements:
        return replacements[value]
    rendered = value
    for placeholder, replacement in replacements.items():
        rendered = rendered.replace(placeholder, str(replacement))
    return rendered


def _workflow_contains(value: Any, placeholder: str) -> bool:
    if isinstance(value, dict):
        return any(_workflow_contains(item, placeholder) for item in value.values())
    if isinstance(value, list):
        return any(_workflow_contains(item, placeholder) for item in value)
    return isinstance(value, str) and placeholder in value


def load_workflow(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise HatchError(f"Unable to read workflow {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise HatchError(f"Workflow {path} is not valid JSON: {error}") from error
    if not isinstance(value, dict):
        raise HatchError(f"Workflow {path} must contain a JSON object.")
    return value


class LocalWorkflowBackend(ImageBackend):
    def __init__(
        self,
        endpoint: str,
        text_workflow: dict[str, Any],
        edit_workflow: dict[str, Any],
        *,
        timeout: int = 540,
        output_node: str | None = None,
        token: str | None = None,
    ):
        self.endpoint = _normalize_endpoint(endpoint)
        self.text_workflow = text_workflow
        self.edit_workflow = edit_workflow
        self.timeout = max(1, timeout)
        self.output_node = output_node
        self.token = token.strip() if token else None
        self._upload_lock = threading.Lock()
        self._uploaded_references: dict[int, str] = {}
        if not _workflow_contains(text_workflow, "{{PROMPT}}"):
            raise HatchError("Text workflow must contain {{PROMPT}}.")
        if not _workflow_contains(edit_workflow, "{{PROMPT}}") or not _workflow_contains(edit_workflow, "{{REFERENCE_IMAGE}}"):
            raise HatchError("Edit workflow must contain {{PROMPT}} and {{REFERENCE_IMAGE}}.")

    def _url(self, path: str) -> str:
        return f"{self.endpoint}/{path.lstrip('/')}"

    def _upload_once(self, reference: GeneratedImage) -> str:
        key = id(reference.data)
        with self._upload_lock:
            existing = self._uploaded_references.get(key)
            if existing:
                return existing
            handle = self._upload(reference.data)
            self._uploaded_references[key] = handle
            return handle

    def _upload(self, data: bytes) -> str:
        raise NotImplementedError

    def _execute(self, workflow: dict[str, Any], label: str) -> bytes:
        raise NotImplementedError

    def generate(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        label: str,
        reference: GeneratedImage | None = None,
    ) -> GeneratedImage:
        reference_handle = self._upload_once(reference) if reference is not None else ""
        template = self.edit_workflow if reference is not None else self.text_workflow
        workflow = _replace_workflow_values(template, {
            "{{PROMPT}}": prompt,
            "{{NEGATIVE_PROMPT}}": "realistic, 3D, blurry, text, watermark, duplicate creature, extra limbs",
            "{{SEED}}": seed,
            "{{WIDTH}}": width,
            "{{HEIGHT}}": height,
            "{{REFERENCE_IMAGE}}": reference_handle,
            "{{REFERENCE_IMAGE_NAME}}": reference_handle,
        })
        return GeneratedImage(self._execute(workflow, label))


class ComfyUIBackend(LocalWorkflowBackend):
    name = "comfyui"

    def _upload(self, data: bytes) -> str:
        body, content_type = _multipart_png("image", "hatchframe-anchor.png", data)
        headers = _engine_headers(self.token)
        headers["Content-Type"] = content_type
        raw, _ = _engine_request(self.name, self._url("/upload/image"), "POST", data=body, headers=headers, timeout=self.timeout, max_bytes=1024 * 1024)
        try:
            result = json.loads(raw.decode())
        except Exception as error:
            raise HatchError("ComfyUI returned invalid upload JSON.") from error
        if not isinstance(result, dict) or not isinstance(result.get("name"), str):
            raise HatchError("ComfyUI upload returned no image name.")
        subfolder = result.get("subfolder")
        return f"{subfolder}/{result['name']}" if isinstance(subfolder, str) and subfolder else result["name"]

    def _execute(self, workflow: dict[str, Any], label: str) -> bytes:
        submitted = _engine_json(self.name, self._url("/prompt"), "POST", payload={"prompt": workflow, "client_id": uuid.uuid4().hex}, token=self.token, timeout=self.timeout)
        prompt_id = submitted.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise HatchError("ComfyUI returned no prompt ID.")
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            check_cancelled()
            history = _engine_json(self.name, self._url(f"/history/{urllib.parse.quote(prompt_id, safe='')}"), "GET", token=self.token, timeout=min(60, self.timeout))
            record = history.get(prompt_id)
            if isinstance(record, dict):
                status = record.get("status")
                if isinstance(status, dict) and status.get("status_str") in ("error", "failed"):
                    raise HatchError(f"{label} failed in ComfyUI.")
                outputs = record.get("outputs")
                if isinstance(outputs, dict):
                    candidates = [outputs.get(self.output_node)] if self.output_node else list(outputs.values())
                    for candidate in candidates:
                        images = candidate.get("images") if isinstance(candidate, dict) else None
                        if isinstance(images, list) and images and isinstance(images[0], dict):
                            image = images[0]
                            filename = image.get("filename")
                            if isinstance(filename, str) and filename:
                                query = urllib.parse.urlencode({
                                    "filename": filename,
                                    "subfolder": image.get("subfolder", ""),
                                    "type": image.get("type", "output"),
                                })
                                raw, headers = _engine_request(self.name, self._url(f"/view?{query}"), "GET", headers=_engine_headers(self.token), timeout=self.timeout)
                                _validate_engine_png(self.name, raw, headers)
                                return raw
            time.sleep(0.25)
        raise HatchError(f"{label} did not finish in ComfyUI within {self.timeout} seconds.")


def _find_invoke_image(value: Any, output_node: str | None = None) -> str | None:
    if isinstance(value, dict):
        if output_node and output_node in value:
            return _find_invoke_image(value[output_node])
        image_name = value.get("image_name")
        if isinstance(image_name, str) and image_name:
            return image_name
        for item in value.values():
            found = _find_invoke_image(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_invoke_image(item)
            if found:
                return found
    return None


class InvokeAIBackend(LocalWorkflowBackend):
    name = "invoke"

    def _upload(self, data: bytes) -> str:
        body, content_type = _multipart_png("file", "hatchframe-anchor.png", data)
        headers = _engine_headers(self.token)
        headers["Content-Type"] = content_type
        raw, _ = _engine_request(self.name, self._url("/api/v1/images/upload"), "POST", data=body, headers=headers, timeout=self.timeout, max_bytes=1024 * 1024)
        try:
            result = json.loads(raw.decode())
        except Exception as error:
            raise HatchError("InvokeAI returned invalid upload JSON.") from error
        if not isinstance(result, dict) or not isinstance(result.get("image_name"), str):
            raise HatchError("InvokeAI upload returned no image name.")
        return result["image_name"]

    def _execute(self, workflow: dict[str, Any], label: str) -> bytes:
        submitted = _engine_json(
            self.name,
            self._url("/api/v1/queue/default/enqueue_batch"),
            "POST",
            payload={"batch": {"graph": workflow, "runs": 1}},
            token=self.token,
            timeout=self.timeout,
        )
        item_ids = submitted.get("item_ids")
        if not isinstance(item_ids, list) or not item_ids:
            raise HatchError("InvokeAI returned no queue item ID.")
        item_id = str(item_ids[0])
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            check_cancelled()
            item = _engine_json(self.name, self._url(f"/api/v1/queue/default/i/{urllib.parse.quote(item_id, safe='')}"), "GET", token=self.token, timeout=min(60, self.timeout))
            status = item.get("status")
            if status in ("failed", "canceled", "cancelled"):
                raise HatchError(f"{label} {status} in InvokeAI.")
            if status == "completed":
                image_name = _find_invoke_image(item.get("session", {}).get("results", {}), self.output_node)
                if not image_name:
                    raise HatchError(f"{label} completed without an InvokeAI image output.")
                encoded = urllib.parse.quote(image_name, safe="")
                raw, headers = _engine_request(self.name, self._url(f"/api/v1/images/i/{encoded}/full"), "GET", headers=_engine_headers(self.token), timeout=self.timeout)
                _validate_engine_png(self.name, raw, headers)
                return raw
            time.sleep(0.25)
        raise HatchError(f"{label} did not finish in InvokeAI within {self.timeout} seconds.")


def _validate_engine_png(provider: str, data: bytes, headers: Any) -> None:
    content_type = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in ("image/png", "application/octet-stream"):
        raise HatchError(f"{provider} returned unsupported media type {content_type}.")
    if not data.startswith(PNG_SIGNATURE):
        raise HatchError(f"{provider} returned an asset that is not a PNG.")


def _clean_generated(generated: GeneratedImage, label: str) -> tuple[Image, float]:
    try:
        return remove_chroma(decode_png(generated.data))
    except HatchError as error:
        raise HatchError(f"{label}: {error}") from error


def build_row(row: RowSpec, canonical: GeneratedImage, style: str, seed: int, backend: ImageBackend, auto_retry: bool) -> RowAsset:
    max_attempts = 2 if auto_retry else 1
    segment_count = math.ceil(len(row.phases) / 2)
    frames: list[Frame] = []
    total_attempts = 0
    for start in range(0, len(row.phases), 2):
        phases = row.phases[start:start + 2]
        expected = len(phases)
        segment = start // 2 + 1
        accepted: list[Frame] | None = None
        retry_reason = ""
        for attempt in range(1, max_attempts + 1):
            check_cancelled()
            total_attempts += 1
            progress(f"[{row.label}] {'pose pair' if expected == 2 else 'final pose'} {segment}/{segment_count}" + (" retry" if attempt > 1 else ""))
            prompt = pair_pose_prompt(phases[0], phases[1], style, retry_reason) if expected == 2 else single_pose_prompt(phases[0], style, retry_reason)
            generated = backend.generate(
                prompt,
                1024,
                512 if expected == 2 else 1024,
                seed + start * 11 + attempt - 1,
                f"{row.label} {segment}/{segment_count}",
                canonical,
            )
            clean, _ratio = _clean_generated(generated, f"{row.label} segment {segment}")
            candidate = extract_frames(clean, expected)
            if all(frame.opaque > 0 for frame in candidate):
                accepted = candidate
                break
            retry_reason = (
                f"The previous attempt omitted one of the required {expected} isolated full-body "
                f"poses. Render exactly {expected} complete pose{'s' if expected != 1 else ''} and no others."
            )
        if accepted is None:
            raise HatchError(f"{row.label} segment {segment} did not contain {expected} complete pose{'s' if expected != 1 else ''}.")
        frames.extend(accepted)
    qa = analyze_frames(frames, row, 1024, 512)
    progress(f"[{row.label}] {row.count} frames ready · QA {qa['score']}" + (f" · {'; '.join(qa['reasons'])}" if qa["reasons"] else ""))
    return RowAsset(frames, qa, total_attempts)


def build_egg(canonical: GeneratedImage, style: str, seed: int, backend: ImageBackend) -> Image:
    progress("[Hatch] designing identity-matched egg")
    generated = backend.generate(egg_prompt(style), 1024, 1024, seed, "Hatch egg", canonical)
    clean, _ratio = _clean_generated(generated, "Hatch egg")
    progress("[Hatch] clean egg ready")
    return clean


def manifest_for(description: str) -> dict[str, Any]:
    return {
        "schema": "sprite-pet/v1",
        "description": description,
        "assets": {
            "pet": {"src": "spritesheet.png", "width": PET_WIDTH, "height": PET_HEIGHT, "grid": {"columns": 8, "rows": 9, "cellWidth": CELL_W, "cellHeight": CELL_H}},
            "hatch": {"src": "hatch.png", "width": PET_WIDTH, "height": HATCH_HEIGHT, "grid": {"columns": 8, "rows": 3, "cellWidth": CELL_W, "cellHeight": CELL_H}},
        },
        "pivot": {"x": 96, "y": 194},
        "clips": {
            "hatch": {"asset": "hatch", "start": 0, "count": 24, "frameMs": 83, "loop": False, "next": "idle"},
            "idle": {"asset": "pet", "row": 0, "count": 6, "frameMs": 167, "loop": True},
            "runRight": {"asset": "pet", "row": 1, "count": 8, "frameMs": 91, "loop": True},
            "runLeft": {"asset": "pet", "row": 2, "count": 8, "frameMs": 91, "loop": True},
            "wave": {"asset": "pet", "row": 3, "count": 4, "frameMs": 143, "loop": False, "next": "idle"},
            "jump": {"asset": "pet", "row": 4, "count": 5, "frameMs": 111, "loop": False, "next": "idle"},
            "failed": {"asset": "pet", "row": 5, "count": 8, "frameMs": 143, "loop": False, "next": "idle"},
            "waiting": {"asset": "pet", "row": 6, "count": 6, "frameMs": 200, "loop": True},
            "work": {"asset": "pet", "row": 7, "count": 6, "frameMs": 111, "loop": True},
            "review": {"asset": "pet", "row": 8, "count": 6, "frameMs": 167, "loop": True},
        },
    }


def portable_runtime() -> str:
    return '''export class SpritePet {
  constructor(canvas, manifest, base = ".") {
    this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.manifest = manifest; this.base = base;
    this.images = {}; this.state = "idle"; this.started = performance.now(); this.raf = 0;
  }
  async load() {
    for (const [id, asset] of Object.entries(this.manifest.assets)) {
      const image = new Image(); image.src = new URL(asset.src, new URL(this.base, location.href)).href;
      await image.decode(); this.images[id] = image;
    }
    this.play("hatch");
  }
  play(name) { this.state = name; this.started = performance.now(); cancelAnimationFrame(this.raf); this.tick(this.started); }
  tick = (now) => {
    const clip = this.manifest.clips[this.state]; const asset = this.manifest.assets[clip.asset]; const elapsed = now - this.started;
    let frame = Math.floor(elapsed / clip.frameMs);
    if (!clip.loop && frame >= clip.count) { this.play(clip.next || "idle"); return; }
    frame %= clip.count; const absolute = clip.start == null ? clip.row * asset.grid.columns + frame : clip.start + frame;
    const col = absolute % asset.grid.columns, row = Math.floor(absolute / asset.grid.columns);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.images[clip.asset], col * asset.grid.cellWidth, row * asset.grid.cellHeight, asset.grid.cellWidth, asset.grid.cellHeight, 0, 0, this.canvas.width, this.canvas.height);
    this.raf = requestAnimationFrame(this.tick);
  }
  destroy() { cancelAnimationFrame(this.raf); }
}
'''


def example_html() -> str:
    return '''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sprite Pet</title><style>body{min-height:100vh;display:grid;place-items:center;background:#eef7fa}canvas{width:192px;height:208px;image-rendering:pixelated}</style></head>
<body><canvas id="pet" width="192" height="208"></canvas><script type="module">
import {SpritePet} from './sprite-pet.js';
const manifest=await fetch('./manifest.json').then(r=>r.json());
const pet=new SpritePet(document.querySelector('#pet'),manifest); await pet.load(); window.pet=pet;
</script></body></html>
'''


def package_readme(description: str) -> str:
    return f"""# {description}

Generated by the dependency-free Hatchframe CLI.

- `spritesheet.png`: app-ready 8x9 runtime atlas, 192x208 cells, 57 populated frames
- `hatch.png`: exact 24-frame 8x3 one-shot hatch atlas
- `pet.json`: portable pet identity metadata
- `manifest.json`: app-agnostic animation contract
- `sprite-pet.js` + `index.html`: dependency-free browser player
- `qa.json`: per-state extraction and consistency checks

Serve this folder over HTTP and open `index.html`:

```sh
python3 -m http.server 8000 -d .
```

Use `window.pet.play('review')`, `window.pet.play('work')`, or
`window.pet.play('hatch')` from the browser console. The same manifest can be
consumed by any web, game, desktop, or mobile runtime that can draw atlas cells.
"""


def write_package(
    output_dir: Path,
    description: str,
    pet_atlas: Image,
    hatch_atlas: Image,
    assets: dict[str, RowAsset],
    seed: int,
    style: str,
    provider: str = "self-test",
    package_format: str = "hatch",
) -> tuple[Path, ...]:
    if package_format not in PACKAGE_FORMATS:
        raise HatchError(f"Unknown package format: {package_format}")
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(description)
    manifest = manifest_for(description)
    pet_json = {
        "id": slug,
        "displayName": description[:80],
        "description": description,
        "spritesheetPath": "spritesheet.png",
        "createdBy": "Hatchframe CLI",
        "provider": provider,
    }
    scores = [asset.qa["score"] for asset in assets.values()]
    state_qa: dict[str, Any] = {}
    for row in ROWS:
        source_id = row.mirror_of or row.id
        source = assets[source_id]
        state_qa[row.id] = {
            **source.qa,
            "attempts": 0 if row.mirror_of else source.attempts,
            **({"source": f"mirrored locally from {source_id}"} if row.mirror_of else {}),
        }
    qa = {
        "schema": "hatchframe-qa/v1",
        "overallScore": round((sum(scores) + 96) / (len(scores) + 1)),
        "runtimeFrames": 57,
        "hatchFrames": 24,
        "seed": seed,
        "style": style,
        "provider": provider,
        "states": state_qa,
        "hatch": {"pass": True, "score": 96, "source": "local deterministic 24-frame composition"},
    }
    files: dict[str, bytes] = {
        "spritesheet.png": encode_png(pet_atlas),
        "hatch.png": encode_png(hatch_atlas),
        "pet.json": json.dumps(pet_json, indent=2, ensure_ascii=False).encode(),
        "manifest.json": json.dumps(manifest, indent=2, ensure_ascii=False).encode(),
        "qa.json": json.dumps(qa, indent=2, ensure_ascii=False).encode(),
        "sprite-pet.js": portable_runtime().encode(),
        "index.html": example_html().encode(),
        "README.md": package_readme(description).encode(),
    }
    for name, content in files.items():
        (output_dir / name).write_bytes(content)
    archives: list[Path] = []
    if package_format in ("hatch", "both"):
        archive = output_dir.parent / f"{slug}-sprite-pet.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=8) as zipped:
            for name, content in files.items():
                zipped.writestr(name, content)
        archives.append(archive)
    if package_format in ("hermes", "both"):
        archive = output_dir.parent / f"{slug}-hermes-pet.zip"
        hermes_meta = {
            "id": slug,
            "displayName": description[:80],
            "description": description,
            "spritesheetPath": "spritesheet.png",
        }
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=8) as zipped:
            zipped.writestr("pet.json", json.dumps(hermes_meta, indent=2, ensure_ascii=False).encode())
            zipped.writestr("spritesheet.png", files["spritesheet.png"])
        archives.append(archive)
    return tuple(archives)


def dry_run(
    description: str,
    style: str,
    output: Path,
    seed: int,
    concurrency: int,
    auto_retry: bool,
    provider: str = "fal",
    model_override: str | None = None,
    package_format: str = "hatch",
) -> None:
    if provider == "fal":
        models: dict[str, str] = {"anchor": TEXT_MODEL, "edits": EDIT_MODEL}
    elif provider in DIRECT_CLOUD_PROVIDERS:
        settings = CLOUD_SETTINGS[provider]
        selected = (model_override or os.environ.get(settings[1]) or settings[2]).strip()
        models = {"anchor": selected, "edits": selected}
    else:
        models = {"anchor": "local text workflow", "edits": "local reference workflow"}
    plan = {
        "description": description,
        "enhancedBrief": enhance_character_brief(description),
        "style": style,
        "provider": provider,
        "models": models,
        "normalPaidJobs": 27 if provider in CLOUD_PROVIDERS else 0,
        "jobs": {"anchor": 1, "motionSegments": 25, "egg": 1},
        "localWork": ["chroma removal", "pose extraction", "run-left mirroring", "pivot normalization", "runtime atlas", "24-frame hatch", "QA", "ZIP export"],
        "geometry": {"cell": [CELL_W, CELL_H], "runtimeAtlas": [PET_WIDTH, PET_HEIGHT], "hatchAtlas": [PET_WIDTH, HATCH_HEIGHT]},
        "seed": seed,
        "concurrency": concurrency,
        "autoRetryMissingPoses": auto_retry,
        "packageFormat": package_format,
        "output": str(output),
        "anchorPrompt": character_prompt(description, style),
        "firstMotionPrompt": pair_pose_prompt(ROWS[0].phases[0], ROWS[0].phases[1], style),
    }
    print(json.dumps(plan, indent=2, ensure_ascii=False))


def generate(
    description: str,
    style: str,
    output: Path,
    seed: int,
    concurrency: int,
    auto_retry: bool,
    backend: ImageBackend,
    package_format: str = "hatch",
) -> Path:
    progress("[1/4] Creating canonical identity anchor")
    canonical = backend.generate(character_prompt(description, style), 1024, 1024, seed, "Identity anchor")
    anchor_clean, anchor_transparency = _clean_generated(canonical, "Identity anchor")
    if not extract_frames(anchor_clean, 1)[0].opaque:
        raise HatchError("The identity anchor does not contain one extractable character.")
    progress(f"[1/4] Identity locked · {anchor_transparency:.0%} transparent after local matte")

    progress("[2/4] Generating 49 source poses and one egg with bounded concurrency")
    assets: dict[str, RowAsset] = {}
    egg: Image | None = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(4, concurrency))) as executor:
        egg_future = executor.submit(build_egg, canonical, style, seed + 900, backend)
        row_futures = {
            executor.submit(build_row, row, canonical, style, seed + 100 + index * 17, backend, auto_retry): row
            for index, row in enumerate(GENERATED_ROWS)
        }
        try:
            for future in concurrent.futures.as_completed((*row_futures.keys(), egg_future)):
                check_cancelled()
                if future is egg_future:
                    egg = future.result()
                else:
                    row = row_futures[future]
                    assets[row.id] = future.result()
        except BaseException:
            _cancelled.set()
            for future in (*row_futures.keys(), egg_future):
                future.cancel()
            raise
    if egg is None:
        raise HatchError("The egg generation did not complete.")

    progress("[3/4] Packing exact atlas geometry locally")
    pet_atlas = compose_pet_atlas(assets)
    idle = assets.get("idle")
    if idle is None or not idle.frames:
        raise HatchError("Idle frames are unavailable for the hatch reveal.")
    hatch_atlas = compose_hatch(egg, idle.frames[0])

    progress("[4/4] Writing portable runtime package")
    archives = write_package(
        output,
        description,
        pet_atlas,
        hatch_atlas,
        assets,
        seed,
        style,
        backend.name,
        package_format,
    )
    progress(f"Ready: {output.resolve()}")
    for archive in archives:
        progress(f"ZIP:   {archive.resolve()}")
    return archives[0]


def self_test() -> None:
    progress("Running Hatchframe offline self-test…")
    synthetic = Image.blank(192, 96)
    for i in range(0, len(synthetic.pixels), 4):
        synthetic.pixels[i:i + 4] = bytes((255, 0, 255, 255))
    for left, color in ((24, (30, 220, 210)), (116, (120, 240, 70))):
        for y in range(18, 84):
            for x in range(left, left + 52):
                index = (y * synthetic.width + x) * 4
                synthetic.pixels[index:index + 4] = bytes((*color, 255))
    encoded = encode_png(synthetic)
    decoded = decode_png(encoded)
    if decoded.width != 192 or decoded.height != 96 or decoded.pixels != synthetic.pixels:
        raise HatchError("PNG codec self-test failed.")
    clean, ratio = remove_chroma(decoded)
    frames = extract_frames(clean, 2)
    if ratio < 0.25 or len(frames) != 2 or not all(frame.opaque for frame in frames):
        raise HatchError("Chroma or pose extraction self-test failed.")
    request_id = "764cabcf-b745-4b3e-ae38-1200304cf45b"
    base = f"https://queue.fal.run/{TEXT_MODEL}/requests/{request_id}"
    if not _validate_lifecycle_url(base + "/status", request_id, "status").endswith("/status?logs=1"):
        raise HatchError("Queue status URL self-test failed.")
    for result_url in (base, base + "/response"):
        if _validate_lifecycle_url(result_url, request_id, "result") != result_url:
            raise HatchError("Queue result URL self-test failed.")
    assets: dict[str, RowAsset] = {}
    for row in GENERATED_ROWS:
        row_frames = [frames[index % 2] for index in range(row.count)]
        assets[row.id] = RowAsset(row_frames, analyze_frames(row_frames, row, 192, 96), 0)
    pet = compose_pet_atlas(assets)
    egg_source = Image.blank(96, 96)
    for i in range(0, len(egg_source.pixels), 4):
        egg_source.pixels[i:i + 4] = bytes((255, 0, 255, 255))
    for y in range(18, 84):
        half_width = max(4, int(math.sin((y - 18) / 66 * math.pi) * 27))
        for x in range(48 - half_width, 48 + half_width):
            index = (y * 96 + x) * 4
            egg_source.pixels[index:index + 4] = bytes((245, 220, 100, 255))
    egg, _ = remove_chroma(egg_source)
    hatch = compose_hatch(egg, assets["idle"].frames[0])
    if (pet.width, pet.height) != (PET_WIDTH, PET_HEIGHT) or (hatch.width, hatch.height) != (PET_WIDTH, HATCH_HEIGHT):
        raise HatchError("Atlas geometry self-test failed.")
    if decode_png(encode_png(pet)).pixels != pet.pixels or decode_png(encode_png(hatch)).pixels != hatch.pixels:
        raise HatchError("Atlas PNG round-trip self-test failed.")
    with tempfile.TemporaryDirectory(prefix="hatchframe-self-test-") as temporary:
        archives = write_package(
            Path(temporary) / "pet",
            "self-test pet",
            pet,
            hatch,
            assets,
            DEFAULT_SEED,
            "pixel",
            package_format="both",
        )
        hatch_archive, hermes_archive = archives
        with zipfile.ZipFile(hatch_archive) as zipped:
            expected = {"spritesheet.png", "hatch.png", "pet.json", "manifest.json", "qa.json", "sprite-pet.js", "index.html", "README.md"}
            if set(zipped.namelist()) != expected:
                raise HatchError("Portable package self-test failed.")
        with zipfile.ZipFile(hermes_archive) as zipped:
            if set(zipped.namelist()) != {"pet.json", "spritesheet.png"}:
                raise HatchError("Hermes package self-test failed.")
            metadata = json.loads(zipped.read("pet.json"))
            if metadata.get("spritesheetPath") != "spritesheet.png":
                raise HatchError("Hermes package metadata self-test failed.")
    progress("Self-test passed: PNG, chroma, extraction, packing, hatch, manifest, runtime, Hatch ZIP, and Hermes ZIP.")


def _local_workflows(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    if args.workflow and (args.text_workflow or args.edit_workflow):
        raise HatchError("Use either --workflow or --text-workflow/--edit-workflow, not both.")
    if args.workflow:
        bundle = load_workflow(args.workflow)
        text_workflow = bundle.get("text")
        edit_workflow = bundle.get("edit")
        if not isinstance(text_workflow, dict) or not isinstance(edit_workflow, dict):
            raise HatchError("Workflow bundle must contain object-valued 'text' and 'edit' entries.")
        return text_workflow, edit_workflow
    if not args.text_workflow or not args.edit_workflow:
        raise HatchError("Local providers require --workflow or both --text-workflow and --edit-workflow.")
    return load_workflow(args.text_workflow), load_workflow(args.edit_workflow)


def backend_from_args(args: argparse.Namespace) -> ImageBackend:
    if args.provider in CLOUD_PROVIDERS:
        if args.endpoint or args.workflow or args.text_workflow or args.edit_workflow or args.output_node or args.engine_token:
            raise HatchError("Local workflow options cannot be used with a cloud provider.")
        if args.provider == "fal":
            if args.model:
                raise HatchError("--model is not supported for fal because it uses separate anchor and edit models.")
            key = (args.api_key or os.environ.get("FAL_KEY") or "").strip()
            return FalBackend(key)
        key_env, model_env, default_model = CLOUD_SETTINGS[args.provider]
        key = (args.api_key or os.environ.get(key_env) or "").strip()
        selected_model = (args.model or os.environ.get(model_env) or default_model).strip()
        return DirectCloudBackend(args.provider, key, selected_model)
    if args.api_key:
        raise HatchError("--api-key is only valid with a cloud provider; use --engine-token for a local engine.")
    if args.model:
        raise HatchError("--model is only valid with OpenAI, xAI, OpenRouter, or Google.")
    text_workflow, edit_workflow = _local_workflows(args)
    default_endpoint = "http://127.0.0.1:8188" if args.provider == "comfyui" else "http://127.0.0.1:9090"
    token = args.engine_token
    if args.provider == "invoke" and not token:
        token = os.environ.get("INVOKEAI_TOKEN")
    backend_type = ComfyUIBackend if args.provider == "comfyui" else InvokeAIBackend
    return backend_type(
        args.endpoint or default_endpoint,
        text_workflow,
        edit_workflow,
        timeout=args.engine_timeout,
        output_node=args.output_node,
        token=token,
    )


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(
        prog="hatch.py",
        description="Generate a stable 81-frame animated pixel pet package from one text prompt.",
        epilog=(
            "Hatch loads .env automatically. Set FAL_KEY, OPENAI_API_KEY, XAI_API_KEY, "
            "OPENROUTER_API_KEY, or GOOGLE_API_KEY. Local engines require workflow templates."
        ),
    )
    cli.add_argument("description", nargs="?", help='Pet idea, for example: "baby dragon hawk, cyan and green"')
    cli.add_argument("--provider", choices=(*CLOUD_PROVIDERS, "comfyui", "invoke"), default="fal", help="Generation engine (default: fal)")
    cli.add_argument("--endpoint", help="Local engine base URL (defaults: ComfyUI :8188, InvokeAI :9090)")
    cli.add_argument("--workflow", type=Path, help="JSON bundle containing 'text' and 'edit' workflows")
    cli.add_argument("--text-workflow", type=Path, help="Text-to-image workflow JSON for a local provider")
    cli.add_argument("--edit-workflow", type=Path, help="Reference-edit workflow JSON for a local provider")
    cli.add_argument("--output-node", help="Preferred ComfyUI output node ID or InvokeAI result node ID")
    cli.add_argument("--engine-token", help="Optional local-engine bearer token; INVOKEAI_TOKEN is also supported")
    cli.add_argument("--engine-timeout", type=int, default=540, metavar="SECONDS", help="Local queue timeout (default: 540)")
    cli.add_argument("--style", choices=tuple(STYLE_PROMPTS), default="pixel", help="Pixel-art direction (default: pixel)")
    cli.add_argument("--out", type=Path, help="Output directory (default: ./<pet>-sprite-pet)")
    cli.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"Deterministic base seed (default: {DEFAULT_SEED})")
    cli.add_argument("--concurrency", type=int, default=3, choices=range(1, 5), metavar="1-4", help="Maximum simultaneous engine jobs (default: 3)")
    cli.add_argument("--api-key", help="Selected cloud-provider key; the matching environment variable is safer")
    cli.add_argument("--model", help="Optional image model override for OpenAI, xAI, OpenRouter, or Google")
    cli.add_argument(
        "--package-format",
        choices=PACKAGE_FORMATS,
        default="hatch",
        help="ZIP output: hatch, hermes, or both (default: hatch)",
    )
    cli.add_argument("--no-retry", action="store_true", help="Do not retry a motion segment that omits a required pose")
    cli.add_argument("--dry-run", action="store_true", help="Print the complete model and local-processing plan without spending credits")
    cli.add_argument("--self-test", action="store_true", help="Run the full local image/export pipeline with synthetic inputs")
    cli.add_argument("--version", action="version", version=f"Hatch CLI {VERSION}")
    return cli


def main(argv: Sequence[str] | None = None) -> int:
    try:
        load_dotenv()
    except HatchError as error:
        progress(f"Error: {error}")
        return 1
    args = parser().parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    description = re.sub(r"\s+", " ", (args.description or "").strip())
    if not description:
        parser().error("description is required unless --self-test is used")
    if len(description) > 600:
        parser().error("description must be 600 characters or fewer")
    output = args.out or Path.cwd() / f"{slugify(description)}-sprite-pet"
    try:
        if args.provider in CLOUD_PROVIDERS:
            if args.endpoint or args.workflow or args.text_workflow or args.edit_workflow or args.output_node or args.engine_token:
                raise HatchError("Local workflow options cannot be used with a cloud provider.")
            backend = None if args.dry_run else backend_from_args(args)
        else:
            backend = backend_from_args(args)
        if args.dry_run:
            dry_run(
                description,
                args.style,
                output,
                args.seed,
                args.concurrency,
                not args.no_retry,
                args.provider,
                args.model,
                args.package_format,
            )
            return 0
    except HatchError as error:
        parser().error(str(error))
    assert backend is not None
    _cancelled.clear()
    old_sigint = signal.signal(signal.SIGINT, _signal_cancel)
    try:
        generate(
            description,
            args.style,
            output,
            args.seed,
            args.concurrency,
            not args.no_retry,
            backend,
            args.package_format,
        )
        return 0
    except KeyboardInterrupt:
        progress("Cancelled. No API key or generated source URL was written to disk.")
        return 130
    except HatchError as error:
        progress(f"Error: {error}")
        return 1
    finally:
        signal.signal(signal.SIGINT, old_sigint)


if __name__ == "__main__":
    raise SystemExit(main())
