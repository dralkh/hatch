from __future__ import annotations

import base64
import contextlib
import io
import json
import os
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
from unittest import mock

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

    def test_direct_cloud_backend_end_to_end_pipeline(self) -> None:
        def fake_cloud(_provider: str, _url: str, _key: str, **kwargs: Any) -> dict[str, Any]:
            payload = kwargs.get("payload") or {}
            prompt = payload.get("prompt", "") if isinstance(payload, dict) else ""
            multipart = kwargs.get("body") or b""
            pair = "TWO-POSE" in prompt or b"TWO-POSE" in multipart
            encoded = base64.b64encode(synthetic_png(pair)).decode()
            return {"data": [{"b64_json": encoded}]}

        backend = hatch.DirectCloudBackend("openai", "secret", "gpt-image-2")
        with tempfile.TemporaryDirectory(prefix="hatchframe-openai-") as temporary, mock.patch.object(
            hatch, "_cloud_json", side_effect=fake_cloud
        ):
            output = Path(temporary) / "pet"
            hatch._cancelled.clear()
            archive = hatch.generate("tiny mint test pet", "pixel", output, 41721, 4, False, backend)
            self.assertTrue((output / "spritesheet.png").is_file())
            with zipfile.ZipFile(archive) as package:
                self.assertEqual(json.loads(package.read("pet.json"))["provider"], "openai")
                self.assertEqual(json.loads(package.read("qa.json"))["hatchFrames"], 24)


class WorkflowContractTest(unittest.TestCase):
    def test_workflow_placeholders_preserve_exact_value_types(self) -> None:
        rendered = hatch._replace_workflow_values(
            {
                "seed": "{{SEED}}",
                "width": "{{WIDTH}}",
                "prompt": "prefix {{PROMPT}}",
                "items": ["{{REFERENCE_IMAGE}}"],
            },
            {
                "{{SEED}}": 42,
                "{{WIDTH}}": 1024,
                "{{PROMPT}}": "mint pet",
                "{{REFERENCE_IMAGE}}": "anchor.png",
            },
        )
        self.assertEqual(rendered["seed"], 42)
        self.assertEqual(rendered["width"], 1024)
        self.assertEqual(rendered["prompt"], "prefix mint pet")
        self.assertEqual(rendered["items"], ["anchor.png"])

    def test_bundle_builds_local_backend_without_network_access(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary) / "workflow.json"
            bundle.write_text(json.dumps({"text": COMFY_TEXT, "edit": COMFY_EDIT}))
            args = hatch.parser().parse_args(["--provider", "comfyui", "--workflow", str(bundle), "mint pet"])
            backend = hatch.backend_from_args(args)
        self.assertIsInstance(backend, hatch.ComfyUIBackend)
        self.assertEqual(backend.endpoint, "http://127.0.0.1:8188")

    def test_local_endpoint_rejects_embedded_credentials(self) -> None:
        with self.assertRaisesRegex(hatch.HatchError, "must not contain credentials"):
            hatch.ComfyUIBackend("http://user:secret@127.0.0.1:8188", COMFY_TEXT, COMFY_EDIT)

    def test_fal_dry_run_does_not_require_or_spend_a_key(self) -> None:
        output = io.StringIO()
        with mock.patch.dict("os.environ", {}, clear=True), contextlib.redirect_stdout(output):
            self.assertEqual(hatch.main(["--dry-run", "mint pet"]), 0)
        self.assertIn('"normalPaidJobs": 27', output.getvalue())

    def test_fal_backend_builds_anchor_and_edit_requests(self) -> None:
        png = synthetic_png(False)
        with mock.patch.object(hatch, "run_queued", return_value={"images": [{"url": "https://fal.media/test.png"}]}) as queued, mock.patch.object(hatch, "download_asset", return_value=png):
            backend = hatch.FalBackend("secret")
            anchor = backend.generate("anchor", 1024, 1024, 1, "anchor")
            backend.generate("edit", 1024, 512, 2, "edit", anchor)
        self.assertEqual(queued.call_args_list[0].args[1], hatch.TEXT_MODEL)
        self.assertEqual(queued.call_args_list[1].args[1], hatch.EDIT_MODEL)
        self.assertEqual(queued.call_args_list[1].args[2]["image_urls"], ["https://fal.media/test.png"])

    def test_dotenv_loads_provider_keys_without_overriding_exported_values(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".env").write_text("OPENAI_API_KEY=file-key\nXAI_API_KEY='xai-key'\n")
            previous = Path.cwd()
            try:
                os.chdir(root)
                with mock.patch.object(hatch, "__file__", str(root / "hatch.py")), mock.patch.dict(
                    os.environ, {"OPENAI_API_KEY": "exported-key"}, clear=True
                ):
                    hatch.load_dotenv()
                    self.assertEqual(os.environ["OPENAI_API_KEY"], "exported-key")
                    self.assertEqual(os.environ["XAI_API_KEY"], "xai-key")
            finally:
                os.chdir(previous)

    def test_direct_cloud_backends_build_generation_and_reference_edit_requests(self) -> None:
        png = synthetic_png(False)
        encoded = base64.b64encode(png).decode()
        calls: list[tuple[str, str, dict[str, Any]]] = []

        def fake_cloud(provider: str, url: str, _key: str, **kwargs: Any) -> dict[str, Any]:
            calls.append((provider, url, kwargs))
            if provider == "google":
                return {"steps": [{"type": "model_output", "content": [{"type": "image", "data": encoded, "mime_type": "image/png"}]}]}
            return {"data": [{"b64_json": encoded}]}

        defaults = {provider: hatch.CLOUD_SETTINGS[provider][2] for provider in hatch.DIRECT_CLOUD_PROVIDERS}
        with mock.patch.object(hatch, "_cloud_json", side_effect=fake_cloud):
            for provider in hatch.DIRECT_CLOUD_PROVIDERS:
                backend = hatch.DirectCloudBackend(provider, "secret", defaults[provider])
                anchor = backend.generate("anchor", 1024, 1024, 1, "anchor")
                edited = backend.generate("edit", 1024, 512, 2, "edit", anchor)
                self.assertTrue(anchor.data.startswith(hatch.PNG_SIGNATURE), provider)
                self.assertTrue(edited.data.startswith(hatch.PNG_SIGNATURE), provider)

        by_provider = {provider: [call for call in calls if call[0] == provider] for provider in hatch.DIRECT_CLOUD_PROVIDERS}
        self.assertTrue(by_provider["openai"][1][1].endswith("/images/edits"))
        self.assertIn(b'name="image[]"', by_provider["openai"][1][2]["body"])
        self.assertNotIn(b"input_fidelity", by_provider["openai"][1][2]["body"])
        self.assertIn("image", by_provider["xai"][1][2]["payload"])
        self.assertIn("input_references", by_provider["openrouter"][1][2]["payload"])
        self.assertEqual(by_provider["google"][1][2]["payload"]["input"][0]["type"], "image")

    def test_backend_from_args_supports_every_direct_cloud_provider(self) -> None:
        for provider in hatch.DIRECT_CLOUD_PROVIDERS:
            key_env, _model_env, default_model = hatch.CLOUD_SETTINGS[provider]
            args = hatch.parser().parse_args(["--provider", provider, "mint pet"])
            with mock.patch.dict(os.environ, {key_env: "secret"}, clear=True):
                backend = hatch.backend_from_args(args)
            self.assertIsInstance(backend, hatch.DirectCloudBackend)
            self.assertEqual(backend.name, provider)
            self.assertEqual(backend.model, default_model)

    def test_cloud_requests_retry_rate_limits(self) -> None:
        limited = hatch.ProviderHTTPError("limited", 429, 0)
        response = json.dumps({"data": []}).encode()
        with mock.patch.object(hatch, "_engine_request", side_effect=[limited, (response, {})]) as request, mock.patch.object(
            hatch.time, "monotonic", side_effect=[0.0, 2.0]
        ):
            result = hatch._cloud_json("openai", "https://api.openai.com/v1/images/generations", "secret", payload={"prompt": "test"})
        self.assertEqual(result, {"data": []})
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
