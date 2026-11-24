const assert = require('node:assert/strict');
const W = require('./wind.js');

for (const [w, h] of [[1440, 900], [390, 844], [1920, 760]]) {
  const cam = W.camera(w, h);
  const point = W.project(cam, .48, 0, 3.2);
  const hit = W.groundAt(cam, point.x, point.y);
  assert(Math.abs(hit.x - .48) < 1e-8 && Math.abs(hit.z - 3.2) < 1e-8);
  assert.equal(W.groundAt(cam, cam.cx, cam.cy - 1), null);
}

const fixed = () => .5;
const leaf = W.makeLeaf(.5, 4, fixed);
const far = W.makeLeaf(-2, 12, fixed);
let gust = W.makeGust(0, 4, fixed);
const nextLeaf = W.makeLeaf(1.4, 8.2, fixed);
const originalLeaves = Array.from({length: 24}, (_, i) => {
  const a = i * Math.PI / 12;
  const r = .3 + (i % 3) * .2;
  return W.makeLeaf(Math.cos(a) * r, 4 + Math.sin(a) * r, () => (i + .5) / 24);
});
let carried = [];
let maxY = 0, angle = 0, previousAngle = 0, firstMotion, firstLift;
const dt = 1/90;
for (let i = 1; i <= 22 * 90; i++) {
  const t = i * dt;
  if (i === 12 * 90) {
    assert.equal(gust.strength, 1, 'a stationary hold must keep blowing');
    assert(leaf.y > .1, 'a stationary hold should still carry leaves at twelve seconds');
    carried = originalLeaves.filter(l => l.y > .1);
    assert(carried.length >= 16);
    gust.targetX = 1.2;
    gust.targetZ = 8.2;
  }
  if (i === 12 * 90 + 9) {
    assert(gust.z > 4 && gust.z < 4.5, 'a fast pointer move must leave a visible path to travel');
    assert.equal(nextLeaf.y, 0, 'leaves ahead wait for the travelling flow');
  }
  if (i === 14 * 90) {
    assert(Math.hypot(gust.x - 1.2, gust.z - 8.2) < .12);
    assert(nextLeaf.y > .15, 'dragging must pick up leaves at the new location');
    assert(carried.filter(l => l.y > .1 && Math.hypot(l.x - gust.x, l.z - gust.z) < 1.6).length
      >= carried.length * .65, 'the same airborne leaves must travel with the vortex');
  }
  if (i === 15 * 90) {
    gust.releasedAt = gust.age;
  }
  if (gust) gust = W.advanceGust(gust, dt);
  for (const current of [leaf, far, nextLeaf]) W.step(current, gust, t, dt);
  for (const current of originalLeaves) W.step(current, gust, t, dt);
  if (firstMotion === undefined && Math.hypot(leaf.x - .5, leaf.z - 4) > .003) firstMotion = t;
  if (firstLift === undefined && leaf.y > .002) firstLift = t;
  maxY = Math.max(maxY, leaf.y);
  if (t < 4) {
    const a = Math.atan2(leaf.z - 4, leaf.x);
    angle += Math.atan2(Math.sin(a - previousAngle), Math.cos(a - previousAngle));
    previousAngle = a;
  }
  assert.equal(far.y, 0);
}
assert.equal(gust, null);
assert(angle > 2 * Math.PI, 'the leaf must orbit the held point');
assert(firstMotion <= .06 && firstLift <= .10, 'a nearby leaf should respond on contact');
assert(maxY > .25 && maxY < 2.5);
assert.equal(nextLeaf.y, 0, 'the leaf settles after release');

let coasting = W.makeGust(-1, 4, fixed);
coasting.targetX = 1;
for (let i = 0; i < 20; i++) W.advanceGust(coasting, dt);
const releaseX = coasting.x, releaseSpeed = coasting.vx;
coasting.releasedAt = coasting.age;
for (let i = 0; i < 24; i++) coasting = W.advanceGust(coasting, dt);
assert(coasting.x > releaseX && coasting.x < coasting.targetX);
assert(coasting.vx > 0 && coasting.vx < releaseSpeed);
console.log('Ground picking, pickup, sustained orbit, airborne transport, coasting and landing passed.');
