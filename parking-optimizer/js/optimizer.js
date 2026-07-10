// 주차 배치 최적화 엔진
// 대지 폴리곤(로컬 m좌표) + 제외구역(건물 등) + 옵션을 받아 여러 회전각/주차형식 조합을 탐색,
// 완전히 대지 내부(및 setback 이격, 제외구역 회피)에 들어가는 주차 칸을 최대한 채우는 배치안을 찾는다.
const Optimizer = (() => {
  function candidateAngles(poly, stepDeg) {
    const set = new Map();
    const add = (a) => {
      let v = ((a % 180) + 180) % 180;
      v = Math.round(v * 100) / 100;
      set.set(v, true);
    };
    for (let a = 0; a < 180; a += stepDeg) add(a);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      add(Geo.toDeg(Math.atan2(b.y - a.y, b.x - a.x)));
    }
    return Array.from(set.keys());
  }

  // 한 조합(회전각 gridAngleDeg, 주차각 parkingAngleDeg, 통로형식 aisleMode)에 대한 배치 생성
  function generateLayout(poly, exclusions, gridAngleDeg, parkingAngleDeg, aisleMode, stallDims, aisleWidth, setback, offsetYFrac) {
    const centroid = Geo.polygonCentroid(poly);
    const rad = Geo.toRad(gridAngleDeg);
    const toLocal = (p) => Geo.rotatePoint(Geo.sub(p, centroid), -rad);
    const toWorld = (p) => Geo.add(Geo.rotatePoint(p, rad), centroid);

    const localPoly = poly.map(toLocal);
    const xs = localPoly.map((p) => p.x), ys = localPoly.map((p) => p.y);
    // 바운딩박스를 setback만큼 안쪽으로 당겨서, 경계에 걸쳐 통째로 탈락하는 행/열이 생기지 않도록 함
    // (오목한 형상 등 실제 경계와 다른 부분은 각 스톨의 rectFullyInsidePolygon 검사가 최종 검증함)
    const minX = Math.min(...xs) + setback, maxX = Math.max(...xs) - setback;
    const minY = Math.min(...ys) + setback, maxY = Math.max(...ys) - setback;

    const W = stallDims.width, L = stallDims.length;
    let pitch, rowDepth, extraRotDeg;
    if (parkingAngleDeg === 0) {
      pitch = L; rowDepth = W; extraRotDeg = 0; // 평행주차: 차량 길이방향이 진행방향(로컬 X)과 나란함
    } else {
      const phi = Geo.toRad(parkingAngleDeg);
      pitch = W / Math.sin(phi);
      // 회전된 스톨 사각형(W x L, 자체 중심 기준 extraRot 회전)의 실제 진행방향(Y) 점유폭.
      // sin항(L*sinφ)만 쓰면 W*cosφ 성분이 누락되어 사선주차 맞은편 열끼리 겹치는 버그가 생김.
      rowDepth = L * Math.sin(phi) + W * Math.cos(phi);
      extraRotDeg = 90 - parkingAngleDeg;
    }
    if (!isFinite(pitch) || !isFinite(rowDepth) || pitch <= 0 || rowDepth <= 0) return null;

    const bandDepth = aisleMode === "double" ? rowDepth * 2 + aisleWidth : rowDepth + aisleWidth;
    const totalH = maxY - minY;
    const totalW = maxX - minX;
    if (totalH < rowDepth || totalW < pitch) return null;

    const nBands = Math.max(0, Math.floor((totalH + 1e-6) / bandDepth));
    const remainder = totalH - nBands * bandDepth;
    let curY = minY + offsetYFrac * Math.max(0, remainder);

    const stalls = [];
    const aisles = [];

    function addRow(rowY0) {
      const nStalls = Math.floor((totalW + 1e-6) / pitch);
      for (let k = 0; k < nStalls; k++) {
        const cx = minX + pitch * (k + 0.5);
        const cy = rowY0 + rowDepth / 2;
        const cornersLocal = Geo.rectCorners(cx, cy, W, L, Geo.toRad(extraRotDeg));
        const cornersWorld = cornersLocal.map(toWorld);
        if (!Geo.rectFullyInsidePolygon(cornersWorld, poly, setback)) continue;
        let blocked = false;
        for (const ex of exclusions) {
          if (Geo.rectOverlapsPolygon(cornersWorld, ex)) { blocked = true; break; }
        }
        if (blocked) continue;
        stalls.push(cornersWorld);
      }
    }
    function addAisle(y0, h) {
      const cx = (minX + maxX) / 2, cy = y0 + h / 2;
      const cornersLocal = Geo.rectCorners(cx, cy, totalW, h, 0);
      aisles.push(cornersLocal.map(toWorld));
    }

    for (let b = 0; b < nBands; b++) {
      addRow(curY);
      const aisleY0 = curY + rowDepth;
      addAisle(aisleY0, aisleWidth);
      if (aisleMode === "double") {
        addRow(aisleY0 + aisleWidth);
        curY = aisleY0 + aisleWidth + rowDepth;
      } else {
        curY = aisleY0 + aisleWidth;
      }
    }
    // 잔여 공간에 통로 없이 붙는 마지막 단열 주차 1열 보너스 배치 시도
    const leftover = maxY - curY;
    if (leftover >= rowDepth - 1e-6) addRow(curY);

    return {
      gridAngle: gridAngleDeg,
      parkingAngle: parkingAngleDeg,
      aisleMode,
      stallDims,
      aisleWidth,
      stalls,
      aisles,
      count: stalls.length,
    };
  }

  // 장애인전용 등 우선 배치 구역: 출입구 인근 대지 경계 1면을 따라 간이 배치 (참고용)
  function placeReservedBlock(poly, exclusions, entrancePoint, count, dims, aisleWidth, setback) {
    if (!count || count <= 0) return { stalls: [], aisles: [], exclusion: null };
    const ref = entrancePoint || poly[0];
    let bestEdge = null, bestDist = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const d = Geo.distPointToSegment(ref, a, b);
      if (d < bestDist) { bestDist = d; bestEdge = [a, b]; }
    }
    const [a, b] = bestEdge;
    const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x);
    const edgeLen = Geo.dist(a, b);
    const dir = { x: Math.cos(edgeAngle), y: Math.sin(edgeAngle) };
    let normal = { x: -dir.y, y: dir.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const testPt = { x: mid.x + normal.x * 0.5, y: mid.y + normal.y * 0.5 };
    if (!Geo.pointInPolygon(testPt, poly)) normal = { x: -normal.x, y: -normal.y };

    const rowDepth = dims.length;
    const pitch = dims.width;
    const stalls = [];
    const maxSlots = Math.floor(edgeLen / pitch);
    for (let k = 0; k < maxSlots && stalls.length < count; k++) {
      const t = (k + 0.5) * pitch;
      if (t > edgeLen) break;
      const baseX = a.x + dir.x * t, baseY = a.y + dir.y * t;
      const cx = baseX + normal.x * (setback + rowDepth / 2);
      const cy = baseY + normal.y * (setback + rowDepth / 2);
      const corners = Geo.rectCorners(cx, cy, dims.width, dims.length, edgeAngle);
      if (!Geo.rectFullyInsidePolygon(corners, poly, setback)) continue;
      let blocked = false;
      for (const ex of exclusions) {
        if (Geo.rectOverlapsPolygon(corners, ex)) { blocked = true; break; }
      }
      if (blocked) continue;
      stalls.push(corners);
    }
    if (stalls.length === 0) return { stalls: [], aisles: [], exclusion: null };

    const aisleCx = mid.x + normal.x * (setback + rowDepth + aisleWidth / 2);
    const aisleCy = mid.y + normal.y * (setback + rowDepth + aisleWidth / 2);
    const aisleCorners = Geo.rectCorners(aisleCx, aisleCy, edgeLen, aisleWidth, edgeAngle);

    const exclCx = mid.x + normal.x * (setback + (rowDepth + aisleWidth) / 2);
    const exclCy = mid.y + normal.y * (setback + (rowDepth + aisleWidth) / 2);
    const exclusion = Geo.rectCorners(exclCx, exclCy, edgeLen + dims.length, rowDepth + aisleWidth + 0.5, edgeAngle);

    return { stalls, aisles: [aisleCorners], exclusion };
  }

  function optimize(poly, exclusions, opts) {
    const stepDeg = opts.angleStep || 10;
    const angles = candidateAngles(poly, stepDeg);

    let workingExclusions = exclusions.slice();
    let reserved = { stalls: [], aisles: [], exclusion: null };
    if (opts.reservedCount > 0) {
      reserved = placeReservedBlock(
        poly, workingExclusions, opts.entrance, opts.reservedCount, opts.reservedDims,
        opts.aisleWidth || Standards.aisleWidthByAngle[90], opts.setback
      );
      if (reserved.exclusion) workingExclusions = workingExclusions.concat([reserved.exclusion]);
    }

    const configs = opts.parkingAngle === "auto"
      ? [
          { pa: 90, am: "double" },
          { pa: 90, am: "single" },
          { pa: 60, am: "double" },
          { pa: 45, am: "double" },
          { pa: 0, am: "double" },
        ]
      : [{ pa: opts.parkingAngle, am: opts.aisleMode }];

    let best = null;
    const bestByConfig = {};

    for (const cfg of configs) {
      const aw = opts.aisleWidth || Standards.aisleWidthByAngle[cfg.pa] || 6.0;
      let bestForCfg = null;
      for (const ang of angles) {
        for (const offsetYFrac of [0, 0.5]) {
          const layout = generateLayout(
            poly, workingExclusions, ang, cfg.pa, cfg.am,
            opts.stallDims, aw, opts.setback, offsetYFrac
          );
          if (layout && (!bestForCfg || layout.count > bestForCfg.count)) bestForCfg = layout;
        }
      }
      if (bestForCfg) {
        const key = `${cfg.pa}-${cfg.am}`;
        bestByConfig[key] = bestForCfg;
        if (!best || bestForCfg.count > best.count) best = bestForCfg;
      }
    }

    if (!best) return null;

    const alternatives = Object.values(bestByConfig).sort((a, b) => b.count - a.count);
    const siteArea = Geo.polygonArea(poly);

    return {
      best,
      alternatives,
      reserved,
      siteArea,
      totalCount: best.count + reserved.stalls.length,
    };
  }

  return { optimize, generateLayout, candidateAngles, placeReservedBlock };
})();
