from __future__ import annotations

import contextlib
import json
import sys
import tempfile
import threading
import unittest
import urllib.parse
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hatch  # noqa: E402


def synthetic_png(pair: bool) -> bytes:
    image = hatch.Image.blank(192 if pair else 96, 96)
    for index in range(0, len(image.pixels), 4):
        image.pixels[index:index + 4] = bytes((255, 0, 255, 255))
    starts = (20, 116) if pair else (22,)
    for subject, left in enumerate(starts):
        color = (32, 218, 205, 255) if subject == 0 else (128, 238, 74, 255)
        for y in range(18, 84):
            for x in range(left, min(image.width, left + 52)):
                offset = (y * image.width + x) * 4
                image.pixels[offset:offset + 4] = bytes(color)
    return hatch.encode_png(image)


class FakeEngine(ThreadingHTTPServer):
    def __init__(self, provider: str):
        super().__init__(("127.0.0.1", 0), FakeEngineHandler)
        self.provider = provider
        self.images: dict[str, bytes] = {}
        self.items: dict[str, str] = {}
        self.saw_reference = False
        self.lock = threading.Lock()


class FakeEngineHandler(BaseHTTPRequestHandler):
    server: FakeEngine

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("content-length", "0")))

    def _json(self, status: int, value: Any) -> None:
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _png(self, value: bytes) -> None:
        self.send_response(200)
        self.send_header("content-type", "image/png")
        self.send_header("content-length", str(len(value)))
        self.end_headers()
        self.wfile.write(value)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.startswith("/upload/image"):
            body = self._body()
            self.server.saw_reference = self.server.saw_reference or b"Content-Disposition" in body
            self._json(200, {"name": "anchor.png", "subfolder": "hatchframe", "type": "input"})
            return
        if self.path.startswith("/api/v1/images/upload"):
            body = self._body()
            self.server.saw_reference = self.server.saw_reference or b"Content-Disposition" in body
            self._json(201, {"image_name": "invoke-anchor.png"})
            return

        payload = json.loads(self._body())
        if self.path == "/prompt":
            inputs = payload["prompt"]["1"]["inputs"]
            prompt_id = uuid.uuid4().hex
            filename = f"{prompt_id}.png"
            self.server.saw_reference = self.server.saw_reference or bool(inputs.get("reference"))
            self.server.images[filename] = synthetic_png("TWO-POSE" in inputs["prompt"])
            self.server.items[prompt_id] = filename
            self._json(200, {"prompt_id": prompt_id, "number": 1, "node_errors": {}})
            return
        if self.path == "/api/v1/queue/default/enqueue_batch":
            inputs = payload["batch"]["graph"]["nodes"]["generate"]
            with self.server.lock:
                item_id = str(len(self.server.items) + 1)
                filename = f"invoke-{item_id}.png"
                self.server.saw_reference = self.server.saw_reference or bool(inputs.get("reference"))
                self.server.images[filename] = synthetic_png("TWO-POSE" in inputs["prompt"])
                self.server.items[item_id] = filename
            self._json(201, {"batch_id": uuid.uuid4().hex, "item_ids": [int(item_id)]})
            return
        self._json(404, {"error": "not found"})

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path)
        if path.path.startswith("/history/"):
            prompt_id = path.path.rsplit("/", 1)[-1]
            filename = self.server.items[prompt_id]
            self._json(200, {prompt_id: {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": filename, "subfolder": "", "type": "output"}]}}}})
            return
        if path.path == "/view":
            filename = urllib.parse.parse_qs(path.query)["filename"][0]
            self._png(self.server.images[filename])
            return
        if path.path.startswith("/api/v1/queue/default/i/"):
            item_id = path.path.rsplit("/", 1)[-1]
            filename = self.server.items[item_id]
            self._json(200, {"status": "completed", "session": {"results": {"save": {"type": "image_output", "image": {"image_name": filename}}}}})
            return
        if path.path.startswith("/api/v1/images/i/") and path.path.endswith("/full"):
            filename = urllib.parse.unquote(path.path.removeprefix("/api/v1/images/i/").removesuffix("/full"))
            self._png(self.server.images[filename])
            return
        self._json(404, {"error": "not found"})


@contextlib.contextmanager
def fake_engine(provider: str) -> Iterator[tuple[FakeEngine, str]]:
    server = FakeEngine(provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


COMFY_TEXT = {"1": {"class_type": "MockGenerate", "inputs": {"prompt": "{{PROMPT}}", "seed": "{{SEED}}", "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "reference": ""}}}
COMFY_EDIT = {"1": {"class_type": "MockGenerate", "inputs": {"prompt": "{{PROMPT}}", "seed": "{{SEED}}", "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "reference": "{{REFERENCE_IMAGE}}"}}}
INVOKE_TEXT = {"id": "anchor", "nodes": {"generate": {"id": "generate", "type": "mock", "prompt": "{{PROMPT}}", "seed": "{{SEED}}", "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "reference": ""}}, "edges": []}
INVOKE_EDIT = {"id": "edit", "nodes": {"generate": {"id": "generate", "type": "mock", "prompt": "{{PROMPT}}", "seed": "{{SEED}}", "width": "{{WIDTH}}", "height": "{{HEIGHT}}", "reference": "{{REFERENCE_IMAGE}}"}}, "edges": []}


class LocalBackendIntegrationTest(unittest.TestCase):
    def _run_backend(self, provider: str) -> None:
        with fake_engine(provider) as (server, endpoint), tempfile.TemporaryDirectory(prefix=f"hatchframe-{provider}-") as temporary:
            if provider == "comfyui":
                backend: hatch.ImageBackend = hatch.ComfyUIBackend(endpoint, COMFY_TEXT, COMFY_EDIT, timeout=30)
            else:
                backend = hatch.InvokeAIBackend(endpoint, INVOKE_TEXT, INVOKE_EDIT, timeout=30)
            hatch._cancelled.clear()
            output = Path(temporary) / "pet"
            archive = hatch.generate("tiny mint test pet", "pixel", output, 41721, 4, False, backend)
            self.assertTrue(server.saw_reference)
            self.assertTrue((output / "spritesheet.png").is_file())
            self.assertTrue((output / "hatch.png").is_file())
            with zipfile.ZipFile(archive) as package:
                self.assertEqual(json.loads(package.read("pet.json"))["provider"], provider)
                self.assertEqual(json.loads(package.read("qa.json"))["hatchFrames"], 24)

    def test_comfyui_native_queue_end_to_end(self) -> None:
        self._run_backend("comfyui")

    def test_invokeai_native_queue_end_to_end(self) -> None:
        self._run_backend("invoke")


if __name__ == "__main__":
    unittest.main()
