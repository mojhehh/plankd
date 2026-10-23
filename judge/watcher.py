import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from concurrent.futures import Executor
from pathlib import Path

import numpy as np
from livekit import rtc

from pose import PoseTracker

FPS = 8
ROTATIONS = {
    rtc.VideoRotation.VIDEO_ROTATION_0: 0,
    rtc.VideoRotation.VIDEO_ROTATION_90: -1,
    rtc.VideoRotation.VIDEO_ROTATION_180: 2,
    rtc.VideoRotation.VIDEO_ROTATION_270: 1,
}

log = logging.getLogger("judge.watcher")

Report = Callable[[dict], Awaitable[None]]


def to_rgb(event: rtc.VideoFrameEvent) -> np.ndarray:
    frame = event.frame
    pixels = np.frombuffer(frame.data, dtype=np.uint8).reshape(frame.height, frame.width, 3)
    turns = ROTATIONS.get(event.rotation, 0)
    return np.ascontiguousarray(np.rot90(pixels, k=turns) if turns else pixels)


class RoomWatcher:
    def __init__(self, room: str, url: str, token: str, players: set[str], model: Path, pool: Executor, report: Report):
        self.room = room
        self._url = url
        self._token = token
        self._players = players
        self._model = model
        self._pool = pool
        self._report = report
        self._streams: dict[str, asyncio.Task] = {}
        self._stopped = asyncio.Event()
        self._error: BaseException | None = None

    def stop(self) -> None:
        self._stopped.set()

    async def run(self) -> None:
        room = rtc.Room()
        room.on("track_subscribed", self._on_track)
        room.on("track_unsubscribed", self._on_track_gone)
        room.on("disconnected", lambda *_: self._stopped.set())
        try:
            await room.connect(self._url, self._token)
            log.info("watching room %s", self.room)
            await self._stopped.wait()
            if self._error:
                raise RuntimeError(f"judging failed in {self.room}") from self._error
        finally:
            for task in self._streams.values():
                task.cancel()
            await asyncio.gather(*self._streams.values(), return_exceptions=True)
            await room.disconnect()
            log.info("left room %s", self.room)

    def _on_track(self, track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        identity = participant.identity
        log.info("subscribed to %s track from %s (source %s)", track.kind, identity, publication.source)
        if track.kind != rtc.TrackKind.KIND_VIDEO or publication.source != rtc.TrackSource.SOURCE_CAMERA:
            return
        if identity not in self._players:
            log.warning("ignoring track from unexpected participant %s in %s", identity, self.room)
            return
        previous = self._streams.pop(identity, None)
        if previous:
            previous.cancel()
        task = asyncio.create_task(self._watch(track, identity))
        task.add_done_callback(lambda t: self._stream_done(identity, t))
        self._streams[identity] = task

    def _stream_done(self, identity: str, task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception():
            self._error = task.exception()
            log.error("judging %s in %s crashed", identity, self.room, exc_info=self._error)
            self.stop()

    def _on_track_gone(self, track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        if publication.source != rtc.TrackSource.SOURCE_CAMERA:
            return
        task = self._streams.pop(participant.identity, None)
        if task:
            task.cancel()

    async def _watch(self, track: rtc.Track, identity: str) -> None:
        loop = asyncio.get_running_loop()
        tracker = await loop.run_in_executor(self._pool, PoseTracker, self._model)
        stream = rtc.VideoStream(track, capacity=1, format=rtc.VideoBufferType.RGB24)
        interval = 1 / FPS
        last = 0.0
        try:
            async for event in stream:
                now = time.monotonic()
                if now - last < interval:
                    continue
                last = now
                rgb = to_rgb(event)
                height, width = rgb.shape[:2]
                ts_ms = event.timestamp_us // 1000
                pose = await loop.run_in_executor(self._pool, tracker.detect, rgb, ts_ms)
                frame, world = pose if pose else (None, None)
                await self._report({
                    "t": "pose",
                    "room": self.room,
                    "identity": identity,
                    "frame": frame,
                    "world": world,
                    "aspect": round(width / height, 4),
                })
        finally:
            await stream.aclose()
            await loop.run_in_executor(self._pool, tracker.close)
