import asyncio
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

import websockets

from pose import ensure_model
from watcher import RoomWatcher

log = logging.getLogger("judge")


class Judge:
    def __init__(self, server_url: str, secret: str):
        self._server_url = server_url
        self._secret = secret
        self._model = ensure_model()
        self._pool = ThreadPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1))
        self._watchers: dict[str, tuple[RoomWatcher, asyncio.Task]] = {}
        self._ws = None

    async def run(self) -> None:
        backoff = 1
        while True:
            try:
                async with websockets.connect(
                    self._server_url,
                    additional_headers={"Authorization": f"Bearer {self._secret}"},
                    max_size=1 << 20,
                ) as ws:
                    self._ws = ws
                    backoff = 1
                    log.info("connected to game server")
                    async for raw in ws:
                        self._handle(raw)
            except (OSError, websockets.ConnectionClosed, websockets.InvalidStatus, websockets.InvalidHandshake) as err:
                log.warning("game server connection lost: %s", err)
            finally:
                self._ws = None
                await self._stop_all()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def _handle(self, raw: str | bytes) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            log.error("game server sent invalid json")
            return
        match msg:
            case {"t": "watch", "room": str(room), "url": str(url), "token": str(token), "players": list(players)} if all(isinstance(p, str) for p in players):
                self._watch(room, url, token, set(players))
            case {"t": "unwatch", "room": str(room)}:
                entry = self._watchers.get(room)
                if entry:
                    entry[0].stop()
            case _:
                log.error("unknown message from game server: %.80s", raw)

    def _watch(self, room: str, url: str, token: str, players: set[str]) -> None:
        if room in self._watchers:
            return
        watcher = RoomWatcher(room, url, token, players, self._model, self._pool, self._report)
        task = asyncio.create_task(watcher.run())
        self._watchers[room] = (watcher, task)
        task.add_done_callback(lambda t: self._finished(room, t))

    def _finished(self, room: str, task: asyncio.Task) -> None:
        self._watchers.pop(room, None)
        if not task.cancelled() and task.exception():
            log.error("watcher for %s crashed", room, exc_info=task.exception())
            asyncio.create_task(self._report({"t": "watch_failed", "room": room}))

    async def _report(self, msg: dict) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.send(json.dumps(msg, separators=(",", ":")))
        except websockets.ConnectionClosed:
            pass

    async def _stop_all(self) -> None:
        tasks = []
        for watcher, task in list(self._watchers.values()):
            watcher.stop()
            tasks.append(task)
        await asyncio.gather(*tasks, return_exceptions=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    server_url = os.environ.get("PLANKD_JUDGE_URL", "ws://127.0.0.1:7401")
    secret = os.environ["PLANKD_JUDGE_SECRET"]
    asyncio.run(Judge(server_url, secret).run())


if __name__ == "__main__":
    main()
