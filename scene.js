const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const hint = document.querySelector('#hint');
const motion = document.querySelector('#motion');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const atlas = new Image();
const shadowAtlas = document.createElement('canvas');
const restingAtlas = document.createElement('canvas');
const leaves = [];
const instructions = hint.textContent;
let gust = null, activePointer = null, heldKey = null;
let width, height, pixelRatio, cam;
let paused = reduced.matches, time = 0, previous = 0, frame = 0, hintTimer;

function resize() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  // The street photo stays at native resolution; cap only the transparent motion layer.
  pixelRatio = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(2400000 / (width * height)));
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  cam = Wind.camera(width, height);
  render();
}

function seed() {
  while (leaves.length < 900) {
    const x = -2.4 + Math.random() * 5.18;
    const z = leaves.length < 390
      ? 1.5 + Math.pow(Math.random(), 1.65) * 19.5
      : 2.1 + Math.random() * 6.9;
    if (Wind.onPavement(x, z)) leaves.push(Wind.makeLeaf(x, z));
  }
}

// Project two leaf-local axes. A horizontal leaf foreshortens against the paving;
// as it tilts towards the viewer, the face and then the thin edge become visible.
function drawLeaf(leaf, shadow) {
  const y = shadow ? 0 : leaf.y + .007;
  const z = leaf.z + (shadow ? leaf.y * .33 : 0);
  if (z < .75) return;
  const x = leaf.x + (shadow ? leaf.y * .44 : 0);
  const p = Wind.project(cam, x, y, z);
  const size = cam.f / z * leaf.size;
  if (p.x < -size || p.y < -size || p.x > width + size || p.y > height + size) return;
  const c = Math.cos(leaf.yaw), s = Math.sin(leaf.yaw);
  const roll = shadow ? leaf.roll * .35 : leaf.roll;
  const pitch = shadow ? leaf.pitch * .35 : leaf.pitch;
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ax = c * cr, ay = sr, az = s * cr;
  const bx = -s * cp - c * sr * sp, by = cr * sp, bz = c * cp - s * sr * sp;
  const normX = (p.x - cam.cx) / cam.f, normY = (p.y - cam.cy) / cam.f;
  const scale = size * pixelRatio;
  ctx.setTransform(scale * (ax - normX * az), scale * (-ay - normY * az),
                   scale * (bx - normX * bz), scale * (-by - normY * bz),
                   p.x * pixelRatio, p.y * pixelRatio);
  ctx.globalAlpha = shadow ? .35 / (1 + 3.5 * leaf.y) : .95;
  const i = leaf.sprite;
  let texture = atlas;
  if (shadow) texture = shadowAtlas;
  else if (leaf.y <= .01) texture = restingAtlas;
  ctx.drawImage(texture, i % 3 * 256, Math.floor(i / 3) * 256, 256, 256, -.5, -.5, 1, 1);
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!leaves.length) return;
  leaves.sort((a, b) => b.z - a.z);
  for (const leaf of leaves) {
    if (leaf.y > .01) drawLeaf(leaf, true);
  }
  for (const leaf of leaves) drawLeaf(leaf, false);
  ctx.globalAlpha = 1;
}

function advance(dt) {
  time += dt;
  if (gust) gust = Wind.advanceGust(gust, dt);
  for (const leaf of leaves) {
    Wind.step(leaf, gust, time, dt);
    // At the curb or wall a grounded leaf loses its sideways momentum.
    if (leaf.x < -2.42 || leaf.x > 2.82) {
      leaf.x = Wind.clamp(leaf.x, -2.42, 2.82); leaf.vx = 0;
    }
    if (leaf.z < 1.3 || leaf.z > 22) {
      leaf.z = Wind.clamp(leaf.z, 1.3, 22); leaf.vz = 0;
    }
  }
}

function tick(now) {
  frame = 0;
  const dt = previous ? Math.min((now - previous) / 1000, .05) : 0;
  previous = now;
  const steps = Math.max(1, Math.ceil(dt * 90));
  for (let i = 0; i < steps; i++) advance(dt / steps);
  render();
  schedule();
}

function schedule() {
  if (!paused && !document.hidden && leaves.length && !frame) frame = requestAnimationFrame(tick);
}

function say(text, hide = false) {
  clearTimeout(hintTimer);
  hint.textContent = text;
  hint.classList.remove('quiet');
  if (hide) hintTimer = setTimeout(() => hint.classList.add('quiet'), 1900);
}

function setPaused(value) {
  paused = value;
  if (paused) endInput();
  cancelAnimationFrame(frame); frame = 0; previous = 0;
  const label = paused ? '움직임 재생하기' : '움직임 멈추기';
  motion.setAttribute('aria-label', label);
  motion.title = label;
  motion.classList.toggle('paused', paused);
  say(paused ? '재생을 누르면 낙엽이 움직여요' : instructions);
  schedule();
}

function releaseWind() {
  if (gust && gust.releasedAt === null) gust.releasedAt = gust.age;
}

function endInput() {
  const id = activePointer;
  activePointer = null;
  heldKey = null;
  releaseWind();
  if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}

function aim(x, y) {
  const point = x >= 0 && x <= width && y >= 0 && y <= height && Wind.groundAt(cam, x, y);
  // Keep the held column through gaps in the walkable surface. The next pavement point steers it onward.
  if (!point) return false;
  if (!gust || gust.releasedAt !== null) gust = Wind.makeGust(point.x, point.z);
  gust.targetX = point.x;
  gust.targetZ = point.z;
  clearTimeout(hintTimer); hint.classList.add('quiet');
  return true;
}

function aimPointer(e) {
  const rect = canvas.getBoundingClientRect();
  return aim(e.clientX - rect.left, e.clientY - rect.top);
}

// Standard Pointer Events, checked 2026-11-24: capture keeps a drag paired with its release.
// https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary || activePointer !== null || heldKey || paused || !leaves.length) return;
  activePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  if (!aimPointer(e)) say('가까운 보도블록 위를 눌러 보세요', true);
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === activePointer) aimPointer(e);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, e => { if (e.pointerId === activePointer) endInput(); });
}
canvas.addEventListener('click', e => {
  // Assistive activation can arrive without pointer or key events.
  if (e.detail === 0 && !heldKey && activePointer === null && !paused && leaves.length) {
    aim(width * .5, height * .72); releaseWind();
  }
});
canvas.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!e.repeat && !paused && leaves.length && activePointer === null && !heldKey) {
      heldKey = e.key;
      aim(width * .5, height * .72);
    }
  }
});
canvas.addEventListener('keyup', e => { if (e.key === heldKey) endInput(); });
canvas.addEventListener('blur', endInput);
window.addEventListener('blur', endInput);
motion.addEventListener('click', () => setPaused(!paused));
reduced.addEventListener('change', e => setPaused(e.matches));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) endInput();
  cancelAnimationFrame(frame); frame = 0; previous = 0; schedule();
});
window.addEventListener('resize', resize);

atlas.onload = () => {
  shadowAtlas.width = atlas.naturalWidth; shadowAtlas.height = atlas.naturalHeight;
  const shadow = shadowAtlas.getContext('2d');
  shadow.drawImage(atlas, 0, 0);
  shadow.globalCompositeOperation = 'source-in';
  shadow.fillStyle = '#211c16'; shadow.fillRect(0, 0, shadowAtlas.width, shadowAtlas.height);
  // Bake contact shadows once so every resting leaf needs only one draw per frame.
  restingAtlas.width = atlas.naturalWidth; restingAtlas.height = atlas.naturalHeight;
  const resting = restingAtlas.getContext('2d');
  resting.shadowColor = 'rgba(33, 28, 22, .42)';
  resting.shadowOffsetY = 3; resting.shadowBlur = 4;
  resting.drawImage(atlas, 0, 0);
  seed(); render(); setPaused(paused);
};
atlas.onerror = () => say('낙엽 이미지를 불러오지 못했어요. 페이지를 다시 열어 주세요.');
resize();
atlas.src = 'assets/leaves.webp';
