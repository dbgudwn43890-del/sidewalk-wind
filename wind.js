// Ground coordinates are metres: x across the path, z away from the viewer, y up.
const Wind = (() => {
  const eye = 1.62;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function camera(width, height) {
    // Match the plate's vanishing point and CSS object-fit crop, including on portrait screens.
    const scale = Math.max(width / 1536, height / 1024);
    return {
      cx: (width - 1536 * scale) * .53 + 811 * scale,
      cy: (height - 1024 * scale) * .18 + 108 * scale,
      f: 1100 * scale
    };
  }

  function project(cam, x, y, z) {
    return { x: cam.cx + cam.f * x / z, y: cam.cy + cam.f * (eye - y) / z };
  }

  function onPavement(x, z) {
    if (z <= 0 || z > 23 || x < -2.46 || x > 2.84) return false;
    // Tree pits interrupt the walking surface along the right edge.
    return !(x > 1.55 && ((z > 4.9 && z < 6.2) || (z > 10.6 && z < 14.8)));
  }

  function groundAt(cam, x, y) {
    if (!cam.f || y <= cam.cy) return null;
    const z = cam.f * eye / (y - cam.cy);
    const across = (x - cam.cx) * z / cam.f;
    return onPavement(across, z) ? { x: across, z } : null;
  }

  function makeLeaf(x, z, random = Math.random) {
    const yaw = random() * Math.PI * 2;
    return { x, z, y: 0, vx: 0, vy: 0, vz: 0, yaw, roll: 0, pitch: 0, phase: yaw,
      spin: random() * 2 - 1, grip: .52 + random() * .65,
      size: .085 + random() * .060, sprite: Math.floor(random() * 6) };
  }

  function makeGust(x, z, random = Math.random) {
    return { x, z, vx: 0, vz: 0, targetX: x, targetZ: z, age: 0, releasedAt: null, strength: .62,
      radius: .94 + random() * .22, sign: random() < .5 ? -1 : 1 };
  }

  function advanceGust(gust, dt) {
    gust.age += dt;
    const fade = gust.releasedAt === null ? 1 : 1 - (gust.age - gust.releasedAt) / .8;
    if (fade <= 0) return null;
    if (gust.releasedAt === null) {
      const dx = gust.targetX - gust.x, dz = gust.targetZ - gust.z;
      const distance = Math.hypot(dx, dz);
      // The pointer steers a travelling column. Limit its speed so it sweeps the street between samples.
      const speedLimit = 2.9 + .16 * gust.z;
      const gain = Math.min(6, speedLimit / Math.max(.001, distance));
      const steering = -Math.expm1(-16 * dt);
      gust.vx += (gain * dx - gust.vx) * steering;
      gust.vz += (gain * dz - gust.vz) * steering;
    } else {
      const drag = Math.exp(-4 * dt);
      gust.vx *= drag;
      gust.vz *= drag;
    }
    gust.x += gust.vx * dt;
    gust.z += gust.vz * dt;
    gust.strength = (.62 + .38 * Math.min(1, gust.age / .16)) * fade;
    return gust;
  }

  function step(leaf, gust, time, dt) {
    const gustPhase = Math.sin(time * .95 - leaf.z * .5 + leaf.x * .18);
    const breeze = Math.pow(Math.max(0, gustPhase), 3);
    const direction = Math.sin(time * .21 + .9);
    let wx = direction * (.04 + breeze * .67), wz = direction * breeze * .16, wy = 0;
    let airResponse = 1.7;
    if (gust) {
      // The airborne part trails slightly on a turn; the base first encounters new ground leaves.
      const trail = Math.min(.19, leaf.y * .21);
      const dx = leaf.x - gust.x + gust.vx * trail, dz = leaf.z - gust.z + gust.vz * trail;
      const distanceSq = dx * dx + dz * dz;
      const radius = gust.radius + leaf.y * .23;
      if (distanceSq < (radius * 2.6) ** 2) {
        const core = Math.sqrt(distanceSq + .19 * .19);
        const radialSq = distanceSq / (radius * radius);
        const speed = gust.strength * Math.exp(-1.15 * radialSq);
        // Air in the moving column translates as well as rotates. Ground friction delays pickup.
        const carry = 1.12 * gust.strength * Math.exp(-.28 * radialSq) * Math.min(1, .22 + 2.8 * leaf.y);
        wx += gust.vx * carry;
        wz += gust.vz * carry;
        airResponse += 5.3 * Math.min(1, speed * 3.5);
        // Tangential flow winds around the axis; near-ground inflow feeds the rising column.
        const swirl = 3.9 * gust.sign;
        const inflow = 2.9 / (1 + leaf.y * 3);
        wx += speed * (-dz * swirl - dx * inflow) / core;
        wz += speed * ( dx * swirl - dz * inflow) / core;
        wy += speed * (4.1 + .46 * Math.sin(leaf.phase + time * 5)) * Math.exp(-leaf.y * 1.3);
      }
    }
    const grounded = leaf.y === 0 && leaf.vy <= 0;
    const pickup = wy > leaf.grip * 1.48;
    const move = !grounded || Math.hypot(wx, wz) > leaf.grip * .62;
    const follow = grounded && !pickup ? 2.6 : airResponse;
    const floorDrag = grounded && !pickup ? .36 : 1;
    leaf.vx += ((move ? wx * floorDrag : 0) - leaf.vx) * follow * dt;
    leaf.vz += ((move ? wz * floorDrag : 0) - leaf.vz) * follow * dt;
    if (!grounded || pickup) {
      const flutter = Math.sin(time * 8 + leaf.phase);
      leaf.vy += ((wy - leaf.vy) * 3.35 - 4.8 * leaf.grip + flutter * .45) * dt;
    }
    leaf.x += leaf.vx * dt;
    leaf.z += leaf.vz * dt;
    leaf.y += leaf.vy * dt;
    if (leaf.y <= 0) { leaf.y = 0; leaf.vy = 0; }

    const speed = Math.hypot(leaf.vx, leaf.vz);
    const airborne = Math.min(1, leaf.y * 6);
    leaf.yaw += dt * (leaf.spin + .32) * (speed * 2.1 + airborne);
    leaf.phase += dt * (.8 + speed * 2.4 + airborne * 3.6);
    leaf.roll += dt * 8 * ((.15 + .98 * airborne) * Math.sin(leaf.phase) * Math.min(1, speed * 2 + airborne) - leaf.roll);
    leaf.pitch += dt * 7 * ((.12 + .72 * airborne) * Math.cos(leaf.phase * 1.37) * Math.min(1, speed + airborne) - leaf.pitch);
  }

  return { camera, project, groundAt, onPavement, makeLeaf, makeGust, advanceGust, step, clamp };
})();
if (typeof module === 'object' && module.exports) module.exports = Wind;
