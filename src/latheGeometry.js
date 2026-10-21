// Shared native Lathe finishing geometry. Work radii are sampled along the spin axis.
const A = 96;
const OUT_TRIS = 15000;
export function latheCavity(w, p, ho) {
    const minR = (i) => { let m = Infinity; for (let j = 0; j < A; j++) m = Math.min(m, w.r[i * A + j]); return m; };
    const open = ho.end === "tail" ? p.b : p.a, dir = ho.end === "tail" ? -1 : 1, far = ho.end === "tail" ? p.a : p.b;
    const inner = new Map();
    for (let i = open; dir > 0 ? i <= far : i >= far; i += dir) {
      if (Math.abs(far - i) * w.du < ho.base) break;
      const rin = minR(i) - ho.wall;
      if (rin < 0.8) break;
      inner.set(i, rin);
    }
    if (inner.size < 2) return null;
    if (ho.style === "straight") { const m = Math.min(...inner.values()); for (const k of inner.keys()) inner.set(k, m); }
    else {
      // a little smoothing so the inside is clean
      const ks = [...inner.keys()], vs = ks.map((k) => inner.get(k));
      for (let it = 0; it < 3; it++) for (let k = 1; k < vs.length - 1; k++) vs[k] = Math.min(vs[k], (vs[k - 1] + vs[k] * 2 + vs[k + 1]) / 4);
      ks.forEach((k, n) => inner.set(k, vs[n]));
    }
    const ks = [...inner.keys()];
    return { open, bottom: ks[ks.length - 1], inner };
  }
export function buildLathePiece(w, p, ho) {
    const cav = ho && ho.on ? latheCavity(w, p, ho) : null;
    // fewer rings where the shape is straight
    const keep = new Uint8Array(w.N); keep[p.a] = keep[p.b] = 1;
    if (cav) { keep[cav.open] = keep[cav.bottom] = 1; }
    const tol = 0.04;
    const stack = [[p.a, p.b]];
    const row = (i, j) => Math.max(0.3, w.r[i * A + j]);
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      let bd = 0, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const f = (i - a) / (b - a);
        let d = 0;
        for (let j = 0; j < A; j += 2) d = Math.max(d, Math.abs(row(i, j) - (row(a, j) * (1 - f) + row(b, j) * f)));
        if (cav && cav.inner.has(i) && cav.inner.has(a) && cav.inner.has(b)) d = Math.max(d, Math.abs(cav.inner.get(i) - (cav.inner.get(a) * (1 - f) + cav.inner.get(b) * f)));
        if (d > bd) { bd = d; bi = i; }
      }
      if (bi > 0 && bd > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const rings = []; for (let i = p.a; i <= p.b; i++) if (keep[i]) rings.push(i);
    // round enough: fewer angles
    let round = true;
    for (const i of rings) { let lo = Infinity, hi = -Infinity; for (let j = 0; j < A; j++) { lo = Math.min(lo, w.r[i * A + j]); hi = Math.max(hi, w.r[i * A + j]); } if (hi - lo > 0.08) { round = false; break; } }
    const innerRings = cav ? rings.filter((i) => cav.inner.has(i)) : [];
    let Aout = round ? 64 : A;
    while (Aout > 24 && 2 * Aout * (rings.length + innerRings.length + 2) > OUT_TRIS) Aout = Aout === 96 ? 64 : Aout === 64 ? 48 : Aout === 48 ? 32 : 24;
    const rAt = (i, jo) => {
      // the radius at an output angle (the most material within that angle's share)
      const t = (jo / Aout) * A, j0 = Math.floor(t), f = t - j0;
      return Math.max(0.3, w.r[i * A + (j0 % A)] * (1 - f) + w.r[i * A + ((j0 + 1) % A)] * f);
    };
    const V = [], I = [];
    const ring = (i, rf) => { const base = V.length / 3, u = w.u0 + i * w.du; for (let j = 0; j < Aout; j++) { const t = (2 * Math.PI * j) / Aout, r = rf(j); V.push(u, r * Math.cos(t), r * Math.sin(t)); } return base; };
    const center = (i) => { V.push(w.u0 + i * w.du, 0, 0); return V.length / 3 - 1; };
    const outer = rings.map((i) => ring(i, (j) => rAt(i, j)));
    for (let k = 0; k < rings.length - 1; k++) {
      const A0 = outer[k], B0 = outer[k + 1];
      for (let j = 0; j < Aout; j++) { const j1 = (j + 1) % Aout; I.push(A0 + j, A0 + j1, B0 + j, A0 + j1, B0 + j1, B0 + j); }
    }
    const capLow = (R0) => { const c = center(rings[0]); for (let j = 0; j < Aout; j++) I.push(c, R0 + ((j + 1) % Aout), R0 + j); };
    const capHigh = (R0, i) => { const c = center(i); for (let j = 0; j < Aout; j++) I.push(c, R0 + j, R0 + ((j + 1) % Aout)); };
    if (!cav) { capLow(outer[0]); capHigh(outer[outer.length - 1], rings[rings.length - 1]); }
    else {
      const tail = ho.end === "tail";
      const ir = (tail ? innerRings.slice().reverse() : innerRings); // from the open end inward
      const inner = ir.map((i) => ring(i, () => cav.inner.get(i)));
      // the rim at the open end
      const O = tail ? outer[outer.length - 1] : outer[0], In = inner[0];
      for (let j = 0; j < Aout; j++) {
        const j1 = (j + 1) % Aout;
        if (!tail) I.push(O + j, In + j, O + j1, O + j1, In + j, In + j1);
        else I.push(O + j, O + j1, In + j, O + j1, In + j1, In + j);
      }
      // the inside wall (facing the axis)
      for (let k = 0; k < inner.length - 1; k++) {
        // rings in order of u
        const lo = tail ? inner[k + 1] : inner[k], hi = tail ? inner[k] : inner[k + 1];
        for (let j = 0; j < Aout; j++) { const j1 = (j + 1) % Aout; I.push(lo + j, hi + j, lo + j1, lo + j1, hi + j, hi + j1); }
      }
      // the bottom of the cavity, and the solid end
      const Bt = inner[inner.length - 1], bi = ir[ir.length - 1];
      if (!tail) { capHigh(Bt, bi); capHigh(outer[outer.length - 1], rings[rings.length - 1]); }
      else { const c = center(bi); for (let j = 0; j < Aout; j++) I.push(c, Bt + ((j + 1) % Aout), Bt + j); capLow(outer[0]); }
    }
    return { V: new Float32Array(V), I: new Uint32Array(I), hollow: !!cav };
  }
