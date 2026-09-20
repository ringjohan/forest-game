export type Footprint = {
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
  heading: number;
};

export function circleIntersectsFootprint(x: number, z: number, radius: number, box: Footprint): boolean {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  const dx = x - box.x, dz = z - box.z;
  const localX = Math.max(Math.abs(dx * c - dz * s) - box.halfWidth, 0);
  const localZ = Math.max(Math.abs(dx * s + dz * c) - box.halfLength, 0);
  return localX * localX + localZ * localZ <= radius * radius;
}

export function footprintsIntersect(a: Footprint, b: Footprint): boolean {
  const ac = Math.cos(a.heading), as = Math.sin(a.heading);
  const bc = Math.cos(b.heading), bs = Math.sin(b.heading);
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [x, z] of [[ac, -as], [as, ac], [bc, -bs], [bs, bc]]) {
    const ar = a.halfWidth * Math.abs(x * ac - z * as) + a.halfLength * Math.abs(x * as + z * ac);
    const br = b.halfWidth * Math.abs(x * bc - z * bs) + b.halfLength * Math.abs(x * bs + z * bc);
    if (Math.abs(dx * x + dz * z) > ar + br) return false;
  }
  return true;
}

export function footprintCorners(box: Footprint): { x: number; z: number }[] {
  const c = Math.cos(box.heading), s = Math.sin(box.heading);
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => ({
    x: box.x + sx * box.halfWidth * c + sz * box.halfLength * s,
    z: box.z - sx * box.halfWidth * s + sz * box.halfLength * c,
  }));
}
