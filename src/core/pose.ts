/** Euler angles (degrees) from a MediaPipe facial transformation matrix (4x4, column-major). */
export function poseFromMatrix(data: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // column-major: element (row r, col c) = data[c*4 + r]
  const m = (r: number, c: number) => data[c * 4 + r];
  const sx = Math.hypot(m(0, 0), m(1, 0), m(2, 0)) || 1;
  const sy = Math.hypot(m(0, 1), m(1, 1), m(2, 1)) || 1;
  const sz = Math.hypot(m(0, 2), m(1, 2), m(2, 2)) || 1;
  const r00 = m(0, 0) / sx,
    r10 = m(1, 0) / sx,
    r20 = m(2, 0) / sx;
  const r21 = m(2, 1) / sy,
    r22 = m(2, 2) / sz;
  const deg = 180 / Math.PI;
  const pitch = Math.atan2(r21, r22) * deg;
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22)) * deg;
  const roll = Math.atan2(r10, r00) * deg;
  return { yaw, pitch, roll };
}
