import hashlib
import urllib.request
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
MODEL_SHA256 = "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"
MODEL_PATH = Path(__file__).parent / "models" / "pose_landmarker_full.task"


def ensure_model() -> Path:
    if not MODEL_PATH.exists():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = MODEL_PATH.with_suffix(".download")
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
            tmp.write_bytes(response.read())
        tmp.replace(MODEL_PATH)
    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    if digest != MODEL_SHA256:
        raise RuntimeError(f"pose model checksum mismatch: {digest}")
    return MODEL_PATH


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


class PoseTracker:
    def __init__(self, model: Path):
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = PoseLandmarker.create_from_options(options)
        self._last_ts = -1

    def detect(self, rgb: np.ndarray, ts_ms: int) -> list[list[float]] | None:
        ts = max(ts_ms, self._last_ts + 1)
        self._last_ts = ts
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(image, ts)
        if not result.pose_landmarks:
            return None
        return [
            [
                round(_clamp(p.x, -1.0, 2.0), 4),
                round(_clamp(p.y, -1.0, 2.0), 4),
                round(_clamp(p.visibility or 0.0, 0.0, 1.0), 3),
            ]
            for p in result.pose_landmarks[0]
        ]

    def close(self) -> None:
        self._landmarker.close()
