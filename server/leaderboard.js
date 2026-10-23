import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

export class Leaderboard {
  #file;
  #players;
  #saving = Promise.resolve();

  static async open(file) {
    let players = {};
    try {
      players = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    await mkdir(path.dirname(file), { recursive: true });
    return new Leaderboard(file, players);
  }

  constructor(file, players) {
    this.#file = file;
    this.#players = players;
  }

  register(id, name) {
    this.#players[id] ??= { name, wins: 0, losses: 0, draws: 0, best: 0 };
    this.#players[id].name = name;
    this.#save();
  }

  record(id, outcome, holdMs) {
    const player = this.#players[id];
    if (!player) return;
    player.best = Math.max(player.best, holdMs);
    if (outcome === "win") player.wins++;
    else if (outcome === "loss") player.losses++;
    else player.draws++;
    this.#save();
  }

  top(limit = 20) {
    return Object.values(this.#players)
      .filter((p) => p.best > 0)
      .sort((a, b) => b.best - a.best || b.wins - a.wins)
      .slice(0, limit)
      .map(({ name, wins, losses, best }) => ({ name, wins, losses, best }));
  }

  #save() {
    const json = JSON.stringify(this.#players);
    this.#saving = this.#saving
      .then(async () => {
        const tmp = `${this.#file}.tmp`;
        await writeFile(tmp, json);
        await rename(tmp, this.#file);
      })
      .catch((err) => console.error("leaderboard save failed:", err));
  }
}
