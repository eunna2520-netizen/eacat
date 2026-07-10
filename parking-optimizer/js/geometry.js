// 기하 계산 유틸 (평면 좌표계, 단위: m)
const Geo = (() => {
  const EARTH_R = 6378137; // WGS84 근사 반지름(m)

  function toRad(deg) { return (deg * Math.PI) / 180; }
  function toDeg(rad) { return (rad * 180) / Math.PI; }

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // 원점(origin) 기준 위경도 <-> 로컬 평면좌표(m) 변환 (Equirectangular 근사, 소규모 대지에 충분한 정밀도)
  function project(lat, lng, origin) {
    const x = ((lng - origin.lng) * Math.PI / 180) * EARTH_R * Math.cos((origin.lat * Math.PI) / 180);
    const y = ((lat - origin.lat) * Math.PI / 180) * EARTH_R;
    return { x, y };
  }
  function unproject(pt, origin) {
    const lat = origin.lat + (pt.y / EARTH_R) * (180 / Math.PI);
    const lng = origin.lng + (pt.x / (EARTH_R * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI);
    return { lat, lng };
  }

  function rotatePoint(p, angleRad) {
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }

  function polygonArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    }
    return Math.abs(a) / 2;
  }

  function polygonCentroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
      a += cross;
      cx += (poly[j].x + poly[i].x) * cross;
      cy += (poly[j].y + poly[i].y) * cross;
    }
    a = a / 2;
    if (Math.abs(a) < 1e-9) {
      const n = poly.length;
      const sx = poly.reduce((s, p) => s + p.x, 0) / n;
      const sy = poly.reduce((s, p) => s + p.y, 0) / n;
      return { x: sx, y: sy };
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const intersect = (yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distPointToSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * abx, y: a.y + t * aby };
    return dist(p, proj);
  }

  function distPointToPolygon(p, poly) {
    let m = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      m = Math.min(m, distPointToSegment(p, poly[j], poly[i]));
    }
    return m;
  }

  function orientation(p, q, r) {
    const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(val) < 1e-9) return 0;
    return val > 0 ? 1 : 2;
  }
  function onSegment(p, q, r) {
    return (
      q.x <= Math.max(p.x, r.x) + 1e-9 && q.x >= Math.min(p.x, r.x) - 1e-9 &&
      q.y <= Math.max(p.y, r.y) + 1e-9 && q.y >= Math.min(p.y, r.y) - 1e-9
    );
  }
  function segmentsIntersect(p1, p2, p3, p4) {
    const o1 = orientation(p1, p2, p3), o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1), o4 = orientation(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p3, p2)) return true;
    if (o2 === 0 && onSegment(p1, p4, p2)) return true;
    if (o3 === 0 && onSegment(p3, p1, p4)) return true;
    if (o4 === 0 && onSegment(p3, p2, p4)) return true;
    return false;
  }

  function edges(poly) {
    const out = [];
    for (let i = 0; i < poly.length; i++) out.push([poly[i], poly[(i + 1) % poly.length]]);
    return out;
  }

  // 사각형(임의 회전) 네 꼭짓점: 중심(cx,cy), 로컬 X방향 폭 w, 로컬 Y방향 길이 h, 회전각 angleRad
  function rectCorners(cx, cy, w, h, angleRad) {
    const local = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    return local.map((p) => add(rotatePoint(p, angleRad), { x: cx, y: cy }));
  }

  // rect(4점, 반시계/시계 무관)가 poly 내부에 완전히 포함되는지(경계에서 setback 이상 이격) 검사
  function rectFullyInsidePolygon(rect, poly, setback) {
    for (const c of rect) {
      if (!pointInPolygon(c, poly)) return false;
      if (distPointToPolygon(c, poly) < setback - 1e-6) return false;
    }
    const polyEdges = edges(poly);
    for (let i = 0; i < rect.length; i++) {
      const r1 = rect[i], r2 = rect[(i + 1) % rect.length];
      for (const [a, b] of polyEdges) {
        if (segmentsIntersect(r1, r2, a, b)) return false;
      }
    }
    return true;
  }

  // rect와 poly(단순 다각형, 제외구역 등)가 조금이라도 겹치는지 검사
  function rectOverlapsPolygon(rect, poly) {
    if (!poly || poly.length < 3) return false;
    for (const c of rect) if (pointInPolygon(c, poly)) return true;
    for (const v of poly) if (pointInPolygon(v, rect)) return true;
    const polyEdges = edges(poly);
    for (let i = 0; i < rect.length; i++) {
      const r1 = rect[i], r2 = rect[(i + 1) % rect.length];
      for (const [a, b] of polyEdges) {
        if (segmentsIntersect(r1, r2, a, b)) return true;
      }
    }
    return false;
  }

  // poly와 축에 수직인 직선(fixedAxis='y'면 y=v인 가로선, 'x'면 x=v인 세로선)의 교차 구간을
  // [lo,hi] 범위로 잘라 반환. 스캔라인(짝수-홀수 규칙) 방식이라 오목 다각형도 지원.
  function crossIntervalsAt(poly, fixedAxis, v, lo, hi) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p1 = poly[j], p2 = poly[i];
      const c1 = fixedAxis === "y" ? p1.y : p1.x;
      const c2 = fixedAxis === "y" ? p2.y : p2.x;
      if ((c1 <= v && c2 > v) || (c2 <= v && c1 > v)) {
        const t = (v - c1) / (c2 - c1);
        const o1 = fixedAxis === "y" ? p1.x : p1.y;
        const o2 = fixedAxis === "y" ? p2.x : p2.y;
        xs.push(o1 + t * (o2 - o1));
      }
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const s = Math.max(xs[i], lo), e = Math.min(xs[i + 1], hi);
      if (e > s) out.push([s, e]);
    }
    return out;
  }

  function intersectIntervals(A, B) {
    const out = [];
    for (const [as, ae] of A) {
      for (const [bs, be] of B) {
        const s = Math.max(as, bs), e = Math.min(ae, be);
        if (e > s + 1e-9) out.push([s, e]);
      }
    }
    return out;
  }

  // 폭이 있는 띠(fixedAxis='y': y in [fixedLo,fixedHi]인 가로띠, 'x': x in [fixedLo,fixedHi]인 세로띠)를
  // poly로 클리핑. 띠 내부 여러 지점을 샘플링해 교집합을 취하므로 오목한 경계도 근사적으로 처리.
  function bandIntervals(poly, fixedAxis, fixedLo, fixedHi, alongMin, alongMax, samples) {
    const n = Math.max(2, samples || 4);
    let result = null;
    for (let i = 0; i <= n; i++) {
      const v = fixedLo + ((fixedHi - fixedLo) * i) / n;
      const seg = crossIntervalsAt(poly, fixedAxis, v, alongMin, alongMax);
      result = result === null ? seg : intersectIntervals(result, seg);
      if (result.length === 0) return [];
    }
    return result || [];
  }

  return {
    toRad, toDeg, add, sub, dist, project, unproject, rotatePoint,
    polygonArea, polygonCentroid, pointInPolygon, distPointToSegment,
    distPointToPolygon, segmentsIntersect, edges, rectCorners,
    rectFullyInsidePolygon, rectOverlapsPolygon, bandIntervals,
  };
})();
