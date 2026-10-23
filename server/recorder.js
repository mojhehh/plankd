import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { measurePlank } from "../shared/plank.js";

const MAX_FRAMES = 400;
const KEEP_REPORTS = 60;

function round(value) {
  return Math.round(value * 10) / 10;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / 2)]);
}

export class Recorder {
  frames = [];
  #reasons = {};
  #metrics = { visibility: [], length: [], tilt: [], hip: [], knee: [] };

  add(phase, at, frame, aspect, reason) {
    this.#reasons[reason] = (this.#reasons[reason] ?? 0) + 1;
    if (frame) {
      const m = measurePlank(frame, aspect);
      for (const key of Object.keys(this.#metrics)) this.#metrics[key].push(key === "visibility" || key === "length" ? m[key] * 100 : m[key]);
    }
    this.frames.push({ phase, at, aspect, reason, frame });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  summary() {
    return {
      reasons: this.#reasons,
      medians: Object.fromEntries(Object.entries(this.#metrics).map(([key, values]) => [key, median(values)])),
    };
  }
}

async function prune(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  await Promise.all(files.slice(0, Math.max(0, files.length - KEEP_REPORTS)).map((f) => rm(path.join(dir, f))));
}

export function saveReport(dir, report) {
  const { frames, ...summary } = report;
  console.log("match report:", JSON.stringify(summary));
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${report.room}.json`);
  mkdir(dir, { recursive: true })
    .then(() => writeFile(file, JSON.stringify(report)))
    .then(() => prune(dir))
    .catch((err) => console.error("saving match report failed:", err));
}
