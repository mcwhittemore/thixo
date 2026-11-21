// The cast, seen from above and heading right (+x), centred on the origin, about 60 units long.
// Draw one with drawAnimal(ctx, animal, t, d, lift): t is seconds, d is how far it has travelled, and lift is how
// high it is above the gel, which sets how far away and how soft its shadow falls.
//
// Each animal is built the way the animal is: jointed limbs with fixed bone lengths, wings made of feathers or
// membranes that hinge where the real ones do, bodies shaded so they look round. `both` draws the left and right
// side from one description; fn gets +1 or -1 so the two sides need not hold the same pose.

const DPR = Math.min(2, window.devicePixelRatio || 1);
let SHADOW = false;   // true while an animal is being drawn as its own shadow
const P2 = (d) => typeof d === 'string' ? new Path2D(d) : d;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const mixn = (a, b, k) => a + (b - a) * k;
const noise = (i) => { const v = Math.sin(i * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };
// a step of the given length from a point, at an angle measured from straight ahead round towards this side
const reach = ([x, y], deg, len) => [x + len * Math.cos(deg * Math.PI / 180), y - len * Math.sin(deg * Math.PI / 180)];

function both(ctx, fn) { fn(1); ctx.save(); ctx.scale(1, -1); fn(-1); ctx.restore(); }
function fill(ctx, d, colour, alpha = 1) { ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = SHADOW ? '#000' : colour; ctx.fill(P2(d)); ctx.restore(); }
function stroke(ctx, d, colour, width, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = SHADOW ? '#000' : colour; ctx.lineWidth = width;
  ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(P2(d)); ctx.restore();
}
// make a filled shape look round: dark down both flanks, a soft highlight a little off the middle
function volume(ctx, d, half, strength = 0.38) {
  if (SHADOW) return;
  ctx.save(); ctx.clip(P2(d));
  const g = ctx.createLinearGradient(0, -half, 0, half);
  g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(0.28, 'rgba(0,0,0,0)');
  g.addColorStop(0.4, `rgba(255,255,255,${strength * 0.55})`); g.addColorStop(0.56, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength * 1.25})`);
  ctx.fillStyle = g; ctx.fillRect(-90, -90, 180, 180); ctx.restore();
}
// a bone-and-muscle limb through the joints: an edge colour under a skin colour, thick to thin
function limb(ctx, pts, widths, colour, edge) {
  for (const [c, grow] of [[edge, 1.6], [colour, 0]]) for (let i = 1; i < pts.length; i++)
    stroke(ctx, `M ${pts[i - 1]} L ${pts[i]}`, c, widths[i - 1] + grow);
}
// one feather from its root to its tip, fuller on the trailing side
function feather(ctx, a, b, width, colour, alpha = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, nx = -dy / n, ny = dx / n;
  const m = [a[0] + dx * 0.55, a[1] + dy * 0.55];
  fill(ctx, `M ${a} Q ${m[0] + nx * width} ${m[1] + ny * width} ${b} Q ${m[0] - nx * width * 0.45} ${m[1] - ny * width * 0.45} ${a} Z`, colour, alpha);
}

// Draw an animal with its shadow. The shadow falls down and to the right on the page whichever way the animal faces.
const shadowPad = document.createElement('canvas'); shadowPad.width = shadowPad.height = 320;
function drawAnimal(ctx, animal, t, d = 0, lift = 8) {
  const up = typeof lift === 'function' ? lift(d) : lift, m = ctx.getTransform(), s = shadowPad.getContext('2d'), half = shadowPad.width / 2;
  s.setTransform(1, 0, 0, 1, 0, 0); s.clearRect(0, 0, shadowPad.width, shadowPad.height);
  s.setTransform(m.a, m.b, m.c, m.d, half, half);
  SHADOW = true; animal(s, t, d); SHADOW = false;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.2; ctx.filter = `blur(${(1.2 + up * 0.22) * DPR}px)`;
  ctx.drawImage(shadowPad, m.e - half + up * 0.55 * DPR, m.f - half + up * 0.9 * DPR); ctx.restore();
  animal(ctx, t, d);
}

// Honey bee (Apis mellifera), flying. Heather honey is thixotropic.
function bee(ctx, t) {
  const dark = '#2b2218', gold = '#d9a441', fur = '#9a7a42';
  // in flight the legs are drawn up, the hind pair trailing
  both(ctx, (s) => {
    stroke(ctx, `M 13 -6 Q 17 -11 ${19.5 + s} -9.5`, dark, 1.2);
    stroke(ctx, `M 8 -8 Q 5 -14 ${-1 - s} -13.5`, dark, 1.2);
    stroke(ctx, `M 2 -7 Q -7 -14 ${-16 + 1.5 * s} -13 L ${-22 + 2 * s} -15.5`, dark, 1.7);
  });
  const abdomen = 'M -1 0 C -1 -7 -5 -11 -12 -11 C -20 -11 -27 -6 -31 0 C -27 6 -20 11 -12 11 C -5 11 -1 7 -1 0 Z';
  fill(ctx, abdomen, gold);
  if (!SHADOW) {
    ctx.save(); ctx.clip(P2(abdomen));
    [[-7, 3.2], [-13.5, 3.6], [-20, 3.8]].forEach(([x, w]) => stroke(ctx, `M ${x} -12 Q ${x - 2.6} 0 ${x} 12`, dark, w));
    fill(ctx, 'M -25 -12 Q -27.5 0 -25 12 L -33 12 L -33 -12 Z', dark);
    for (let i = 0; i < 46; i++) {   // the fine pale hair along each band
      const x = -4 - noise(i) * 22, y = (noise(i + 50) - 0.5) * 20;
      stroke(ctx, `M ${x} ${y} l ${-1.6 - noise(i + 9)} ${(noise(i + 5) - 0.5) * 0.8}`, '#f0d79a', 0.45, 0.6);
    }
    ctx.restore();
  }
  volume(ctx, abdomen, 11.5);
  const thorax = 'M 16 0 C 16 -6 12 -9.5 6 -9.5 C 0 -9.5 -3 -6 -3 0 C -3 6 0 9.5 6 9.5 C 12 9.5 16 6 16 0 Z';
  fill(ctx, thorax, fur); volume(ctx, thorax, 10, 0.45);
  for (let i = 0; i < 90; i++) {     // the thorax is a ball of fur, not a smooth shell
    const a = noise(i) * 2 * Math.PI, r = Math.sqrt(noise(i + 200)) * 9.5, x = 6.5 + Math.cos(a) * r, y = Math.sin(a) * r;
    const len = 2 + noise(i + 400) * 2.4, lean = a + (noise(i + 600) - 0.5) * 1.2;
    stroke(ctx, `M ${x} ${y} l ${Math.cos(lean) * len - 0.8} ${Math.sin(lean) * len}`, i % 3 ? '#c9a868' : '#6e5528', 0.55, 0.85);
  }
  const head = 'M 16 -6.5 C 20 -8 24 -6 25 0 C 24 6 20 8 16 6.5 C 17.5 3 17.5 -3 16 -6.5 Z';
  fill(ctx, head, dark); volume(ctx, head, 8, 0.3);
  both(ctx, () => {
    fill(ctx, 'M 17 -7 C 20.5 -8.5 23.5 -6 24 -2.5 C 21.5 -3 19 -4.5 17 -7 Z', '#5d4932');
    stroke(ctx, 'M 19 -6.6 Q 21.5 -6.6 22.8 -4.4', '#a08a68', 0.6, 0.7);
    stroke(ctx, 'M 23 -2.5 L 27 -7 Q 31 -9.5 34 -7', dark, 1);
  });
  // the wings beat: the wing itself, and two fainter traces of where it has just been
  both(ctx, () => {
    for (const [ang, al] of [[0.44 * Math.sin(t * 40 - 1.1), 0.14], [0.44 * Math.sin(t * 40 - 0.55), 0.22], [0.44 * Math.sin(t * 40), 0.6]]) {
      ctx.save(); ctx.translate(8, -5); ctx.rotate(ang); ctx.translate(-8, 5);
      fill(ctx, 'M 5 -6 C 0 -11 -9 -17 -17 -17 C -21 -16.5 -20 -13 -15 -10.5 C -9 -8 -2 -6.5 5 -6 Z', '#ffffff', al);
      const fore = 'M 9 -6 C 7 -14 -4 -25 -19 -27 C -25 -27.5 -27 -23 -22 -18.5 C -14 -12 -2 -7 9 -6 Z';
      fill(ctx, fore, '#ffffff', al); stroke(ctx, fore, dark, 0.5, al);
      stroke(ctx, 'M 9 -6 C 0 -13 -10 -20 -21 -24 M 2 -9 C -6 -12 -14 -17 -22 -19', dark, 0.45, al * 0.8);
      ctx.restore();
    }
  });
}

// Frog (a brown frog, Rana). Its saliva thins as the tongue strikes and thickens again to hold on.
// It moves in leaps. One leap, by phase: crouched and still; the hind legs straighten and throw it forward;
// it flies with legs trailing and arms swept back; the arms come forward to land and the legs fold up again.
const HOP = 120;   // one leap, in the units of d
const hopPhase = (d) => { const n = d / HOP; return n - Math.floor(n); };
const frogTravel = (d) => HOP * (Math.floor(d / HOP) + ease01((hopPhase(d) - 0.3) / 0.6));   // still while crouched
const frogAir = (d) => Math.sin(Math.PI * clamp01((hopPhase(d) - 0.32) / 0.58));             // 0 on the ground, 1 at the top
function frog(ctx, t, d) {
  const ph = hopPhase(d), air = frogAir(d);
  const kick = ph < 0.3 ? 0 : ph < 0.42 ? ease01((ph - 0.3) / 0.12) : ph < 0.62 ? 1 : 1 - ease01((ph - 0.62) / 0.28);
  // arms: 0 planted, -1 swept back in flight, +1 reaching forward to land
  const arm = ph < 0.3 ? 0 : ph < 0.44 ? -ease01((ph - 0.3) / 0.14) : ph < 0.6 ? -1 : ph < 0.8 ? -1 + 2 * ease01((ph - 0.6) / 0.2) : 1 - ease01((ph - 0.8) / 0.2);
  const pose = (sit, back, fwd) => arm < 0 ? mixn(sit, back, -arm) : mixn(sit, fwd, arm);
  const skin = '#7c8249', edge = '#39401f', light = '#aab074', blotch = '#434a27';
  ctx.save(); ctx.scale(1 + 0.07 * air, 1 + 0.07 * air);
  both(ctx, (s) => {
    // hind leg: thigh, shin and foot are fixed lengths, only the joints turn
    const hip = [-16, -5], knee = reach(hip, mixn(55, 162, kick), 15), ankle = reach(knee, mixn(172, 185, kick), 16.5), sole = reach(ankle, mixn(28, 172, kick), 12);
    const footDir = mixn(28, 172, kick), toes = [[-38, 6], [-14, 8.5], [10, 9], [34, 6.5]].map(([off, len]) => reach(sole, footDir + off, len));
    fill(ctx, `M ${sole} L ${toes.join(' L ')} Z`, light, 0.75);                    // the web between the toes
    for (const toe of toes) limb(ctx, [sole, toe], [1.3], skin, edge);
    limb(ctx, [hip, knee, ankle, sole], [8, 5.6, 3.2], skin, edge);
    if (!SHADOW) for (const [a, b, at] of [[hip, knee, 0.55], [knee, ankle, 0.35], [knee, ankle, 0.72]]) {   // dark bars across the leg
      const x = mixn(a[0], b[0], at), y = mixn(a[1], b[1], at), nx = -(b[1] - a[1]), ny = b[0] - a[0], n = Math.hypot(nx, ny) / 2.6;
      stroke(ctx, `M ${x - nx / n} ${y - ny / n} L ${x + nx / n} ${y + ny / n}`, blotch, 1.8, 0.8);
    }
    // front leg: upper arm and forearm, then the fingers
    const shoulder = [11, -9], elbow = reach(shoulder, pose(82, 152, 38), 8.5), hand = reach(elbow, pose(12, 174, 4), 9);
    const handDir = pose(20, 176, 6);
    for (const [off, len] of [[-34, 4], [-10, 5.2], [14, 5], [40, 3.8]]) limb(ctx, [hand, reach(hand, handDir + off, len)], [1.1], skin, edge);
    limb(ctx, [shoulder, elbow, hand], [4.4, 3.2], skin, edge);
  });
  const body = 'M 29 0 C 29 -4 26 -8 21 -10.5 C 19 -13.5 15 -14 13 -11.5 C 8 -13 2 -14 -5 -13 C -12 -12 -18 -8 -22 -3 L -23 0 L -22 3 C -18 8 -12 12 -5 13 C 2 14 8 13 13 11.5 C 15 14 19 13.5 21 10.5 C 26 8 29 4 29 0 Z';
  fill(ctx, body, skin);
  if (!SHADOW) {
    ctx.save(); ctx.clip(P2(body));
    for (let i = 0; i < 16; i++) {   // mottling: uneven blotches, no two alike
      const x = -20 + noise(i) * 44, y = (noise(i + 30) - 0.5) * 22, r = 1.2 + noise(i + 60) * 2.2, w = (k) => r * (0.7 + noise(i * 7 + k) * 0.7);
      fill(ctx, `M ${x + w(1)} ${y} Q ${x + w(2)} ${y + w(3)} ${x} ${y + w(4)} Q ${x - w(5)} ${y + w(6)} ${x - w(7)} ${y} Q ${x - w(8)} ${y - w(9)} ${x} ${y - w(10)} Q ${x + w(11)} ${y - w(12)} ${x + w(1)} ${y} Z`, blotch, 0.75);
    }
    ctx.restore();
  }
  volume(ctx, body, 14, 0.42);
  stroke(ctx, body, edge, 0.9);
  both(ctx, () => {
    stroke(ctx, 'M 12 -9 C 4 -10.5 -8 -9.5 -18 -5', light, 1.1, 0.9);              // the fold along each side of the back
    fill(ctx, 'M 12.5 -9.5 a 2 2 0 1 0 -4 0 a 2 2 0 1 0 4 0 Z', blotch, 0.9);       // eardrum
    const eye = 'M 20.5 -10.5 C 20.5 -13 18.5 -14 16.5 -13.5 C 14.5 -13 13.5 -11 14.5 -9.5 C 16 -8 20 -8.5 20.5 -10.5 Z';
    fill(ctx, eye, '#c9a54a'); stroke(ctx, eye, edge, 0.9);
    stroke(ctx, 'M 15.8 -11.3 L 19.4 -10.6', '#1c1a18', 1.5);
    stroke(ctx, 'M 16 -12.6 Q 17.5 -13.2 19 -12.4', '#f3e3a8', 0.6, 0.8);
    stroke(ctx, 'M 26.5 -2 L 27.2 -1.2', edge, 0.9);                                // nostril
  });
  ctx.restore();
}

// Barn swallow (Hirundo rustica). It builds its nest from mud that flows while worked and sets when left.
// It flies in bursts: a few quick beats, then a short glide. On each downstroke the wing is spread wide; on the
// upstroke it bends at the wrist and the long outer feathers sweep back, so from above the wing shortens and folds.
// how folded the wing is at time t: 0 spread wide at the bottom of a downstroke, 1 swept back at the top of an upstroke
function swallowFold(t) {
  const cycle = (t % 0.78) / 0.78;
  return cycle < 0.62 ? 0.5 - 0.5 * Math.cos(cycle / 0.62 * 5 * 2 * Math.PI) : mixn(0, 0.34, ease01((cycle - 0.62) / 0.1)) * (1 - ease01((cycle - 0.92) / 0.08));
}
function swallow(ctx, t) {
  const back = '#22344f', flight = '#161b27', covert = '#1b2942', pale = '#e8e4da';
  const cycle = (t % 0.78) / 0.78, beating = cycle < 0.62, fold = swallowFold(t);
  const fan = beating ? 0.25 : 0.6;   // the tail spreads a little in the glide
  // tail: a fan of feathers, the two outermost drawn out into long streamers
  both(ctx, () => {
    for (let i = 5; i >= 0; i--) {
      const root = [-11, -1.2 - i * 0.5], ang = 180 - (2 + i * (3.2 + fan * 2.6)), len = i === 5 ? 37 : 15 + i * 2.2;
      const tip = reach(root, ang, len);
      feather(ctx, root, tip, i === 5 ? 1.7 : 3.4, flight);
      if (i < 5 && !SHADOW) { const sp = reach(root, ang, len * 0.72); fill(ctx, `M ${sp[0] + 1.4} ${sp[1]} l -2.8 -0.9 l 0 1.8 Z`, pale, 0.9); }
    }
  });
  both(ctx, () => {
    const shoulder = [9, -4.5], wrist = reach(shoulder, mixn(97, 122, fold), 15), armDir = mixn(97, 122, fold), handDir = mixn(112, 168, fold);
    // primaries: nine long feathers hinged at the wrist, longest at the leading edge
    for (let i = 8; i >= 0; i--) {
      const a = handDir + i * mixn(4.4, 1.9, fold), len = 32 - i * 1.9;
      feather(ctx, reach(wrist, armDir + 180, i * 0.6), reach(wrist, a, len), 4, i % 2 ? flight : '#1d2433');
    }
    // secondaries: shorter feathers along the arm, pointing back
    for (let i = 0; i < 6; i++) {
      const root = [mixn(shoulder[0], wrist[0], i / 6), mixn(shoulder[1], wrist[1], i / 6)];
      feather(ctx, root, reach(root, mixn(176, 184, i / 5) + fold * 6, 14.5 - i * 0.5), 3.8, i % 2 ? '#1d2433' : flight);
    }
    // the small feathers over the arm and wrist, glossy blue like the back
    const e = reach(wrist, handDir, 7), b = reach(shoulder, 180, 5), c = reach(wrist, 180, 6.5);
    const coverts = `M ${shoulder[0] + 3} ${shoulder[1] + 1} Q ${wrist[0] + 5} ${wrist[1] - 1.5} ${e} Q ${c} ${b} Z`;
    fill(ctx, coverts, covert); volume(ctx, coverts, 30, 0.2);
    stroke(ctx, `M ${shoulder[0] + 3} ${shoulder[1] + 1} Q ${wrist[0] + 5} ${wrist[1] - 1.5} ${e}`, '#5a82b9', 0.7, 0.5);
  });
  const body = 'M 31 0 C 30 -1.5 27 -4.5 22 -5 C 14 -7 4 -7 -4 -6 C -9 -5 -12 -3 -13 0 C -12 3 -9 5 -4 6 C 4 7 14 7 22 5 C 27 4.5 30 1.5 31 0 Z';
  fill(ctx, body, back); volume(ctx, body, 7, 0.5);
  stroke(ctx, 'M 19 -1.6 C 11 -3.4 1 -3.4 -8 -1.6', '#5a82b9', 1.8, 0.45);        // the sheen down the back
  fill(ctx, 'M 29 0 C 29 -1.8 27.5 -2.6 26 -2.2 C 25 -1 25 1 26 2.2 C 27.5 2.6 29 1.8 29 0 Z', '#8a3b22');   // chestnut forehead
  fill(ctx, 'M 30 -1.3 L 34.5 0 L 30 1.3 Z', flight);
}

// Mud dauber wasp (Sceliphron caementarium), flying. It buzzes its mud to make it flow, and the mud sets when it stops.
function wasp(ctx, t) {
  const black = '#1c1a18', yellow = '#e0b52e';
  // the long hind legs hang back behind it in flight; the others are drawn up
  both(ctx, (s) => {
    stroke(ctx, `M 16 -4 Q 20 -9 ${24 + s} -8`, black, 1.3);
    stroke(ctx, `M 13 -5 Q 9 -12 ${2 - s} -11 L ${-4 - s} -13`, black, 1.3);
    stroke(ctx, `M 10 -5 Q 2 -11 -10 -9.5`, black, 1.5);
    stroke(ctx, `M -10 -9.5 L ${-27 + 2 * s} ${-11 - s} L ${-38 + 3 * s} ${-9 - s}`, yellow, 1.3);
  });
  const abdomen = 'M -12 0 C -13 -4 -17 -6.5 -22 -6 C -28 -5.5 -32 -3 -35 0 C -32 3 -28 5.5 -22 6 C -17 6.5 -13 4 -12 0 Z';
  fill(ctx, abdomen, black);
  if (!SHADOW) { ctx.save(); ctx.clip(P2(abdomen)); stroke(ctx, 'M -16 -7 Q -17.5 0 -16 7', yellow, 2); ctx.restore(); }
  volume(ctx, abdomen, 6.5, 0.5);
  stroke(ctx, 'M 8 0 L -12 0', black, 1.8);                                          // the thread waist
  const thorax = 'M 21 0 C 21 -4.5 18 -6.5 14 -6.5 C 10 -6.5 7 -4.5 7 0 C 7 4.5 10 6.5 14 6.5 C 18 6.5 21 4.5 21 0 Z';
  fill(ctx, thorax, black);
  if (!SHADOW) { ctx.save(); ctx.clip(P2(thorax)); stroke(ctx, 'M 19.3 -5 Q 20.8 0 19.3 5', yellow, 1.5); ctx.restore(); }
  fill(ctx, 'M 10.4 0 a 1.4 1.6 0 1 0 -2.8 0 a 1.4 1.6 0 1 0 2.8 0 Z', yellow);
  volume(ctx, thorax, 7, 0.5);
  const head = 'M 21 -5 C 25 -6 28 -4 28.5 0 C 28 4 25 6 21 5 C 22.5 2 22.5 -2 21 -5 Z';
  fill(ctx, head, black); volume(ctx, head, 6, 0.5);
  both(ctx, () => {
    fill(ctx, 'M 15 -5.5 a 1.1 1.1 0 1 0 -2.2 0 a 1.1 1.1 0 1 0 2.2 0 Z', yellow);
    stroke(ctx, 'M 27 -2 C 32 -6 37 -8 42 -6', black, 1);
    for (const [ang, al] of [[0.42 * Math.sin(t * 40 - 1.1), 0.16], [0.42 * Math.sin(t * 40 - 0.55), 0.26], [0.42 * Math.sin(t * 40), 0.7]]) {
      ctx.save(); ctx.translate(15, -4); ctx.rotate(ang); ctx.translate(-15, 4);
      const wing = 'M 15 -4.5 C 10 -9 -4 -17 -22 -21 C -28 -22 -30 -19 -26 -16 C -18 -11 0 -6 15 -4.5 Z';
      fill(ctx, wing, '#a0641e', al * 0.8); stroke(ctx, wing, '#3c230a', 0.5, al);
      stroke(ctx, 'M 15 -4.5 C 4 -9 -10 -15 -25 -19', '#3c230a', 0.45, al * 0.8);
      ctx.restore();
    }
  });
}
