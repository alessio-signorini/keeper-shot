/** Hungarian algorithm (min cost) for a rectangular matrix. Returns assignment[row] = col or -1. */
export function hungarian(cost: number[][]): number[] {
  const rows = cost.length;
  if (!rows) return [];
  const cols = cost[0].length;
  const n = Math.max(rows, cols);
  const a: number[][] = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i >= 1 && j >= 1 && i <= rows && j <= cols ? cost[i - 1][j - 1] : 0)),
  );
  const u = new Array(n + 1).fill(0),
    v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0),
    way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= rows && j <= cols) res[p[j] - 1] = j - 1;
  return res;
}
