const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31],
  [24, 26], [26, 28], [28, 30], [28, 32],
];
const MIN_VISIBILITY = 0.5;

function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return ratio;
}

function videoRect(canvas, video) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.min(canvas.width / vw, canvas.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}

export function clearSkeleton(canvas) {
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

const COLORS = { ok: "#3ddc84", warn: "#ffb020", bad: "#ff4d4d" };

export function drawSkeleton(canvas, video, frame, tone) {
  const ratio = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;

  const rect = videoRect(canvas, video);
  const at = ([x, y]) => [rect.x + x * rect.w, rect.y + y * rect.h];
  const color = COLORS[tone];

  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, rect.h / 90) * (ratio > 1 ? 1 : 1.2);
  for (const [a, b] of BONES) {
    if (frame[a][2] < MIN_VISIBILITY || frame[b][2] < MIN_VISIBILITY) continue;
    const [ax, ay] = at(frame[a]);
    const [bx, by] = at(frame[b]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffffff";
  const radius = ctx.lineWidth * 0.9;
  frame.forEach((point, i) => {
    if (i < 11 && i !== 0) return;
    if (point[2] < MIN_VISIBILITY) return;
    const [x, y] = at(point);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}
