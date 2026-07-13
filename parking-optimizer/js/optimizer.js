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

  // 한 조합(회전각 gridAngleDeg, 주차각 parkingAngleDeg, 통로형식 aisleMode)에 대한 배치 생성.
  // 통로(차로)는 실제 대지 경계에 맞춰 클리핑되고, 각 열의 통로를 하나로 잇는 연결 통로(comb 구조)를 포함한다.
  function generateLayout(poly, exclusions, gridAngleDeg, parkingAngleDeg, aisleMode, stallDims, aisleWidth, setback, offsetYFrac, entranceWorld) {
    const centroid = Geo.polygonCentroid(poly);
    const rad = Geo.toRad(gridAngleDeg);
    const toLocal = (p) => Geo.rotatePoint(Geo.sub(p, centroid), -rad);
    const toWorld = (p) => Geo.add(Geo.rotatePoint(p, rad), centroid);

    const localPoly = poly.map(toLocal);
    const xs = localPoly.map((p) => p.x), ys = localPoly.map((p) => p.y);
    const trueMinX = Math.min(...xs), trueMaxX = Math.max(...xs);
    const trueMinY = Math.min(...ys), trueMaxY = Math.max(...ys);
    // 바운딩박스를 setback만큼 안쪽으로 당겨서, 경계에 걸쳐 통째로 탈락하는 행/열이 생기지 않도록 함
    // (오목한 형상 등 실제 경계와 다른 부분은 각 스톨의 rectFullyInsidePolygon 검사가 최종 검증함)
    const minX = trueMinX + setback, maxX = trueMaxX - setback;
    const minY = trueMinY + setback, maxY = trueMaxY - setback;

    const W = stallDims.width, L = stallDims.length;
    let pitch, rowDepth, extraRotDeg, localW, localH;
    if (parkingAngleDeg === 0) {
      // 평행주차: 차량 길이방향이 진행방향(로컬 X)과 나란하므로 로컬 X폭=L(차량 길이), Y폭=W(차량 폭).
      // rectCorners(w,h)의 w는 항상 로컬 X 방향이므로 W/L을 그대로 넣으면 두 축이 뒤바뀌어
      // 인접 열(평행주차 맞은편)끼리 겹치는 버그가 생긴다.
      pitch = L; rowDepth = W; extraRotDeg = 0;
      localW = L; localH = W;
    } else {
      const phi = Geo.toRad(parkingAngleDeg);
      pitch = W / Math.sin(phi);
      // 회전된 스톨 사각형(W x L, 자체 중심 기준 extraRot 회전)의 실제 진행방향(Y) 점유폭.
      // sin항(L*sinφ)만 쓰면 W*cosφ 성분이 누락되어 사선주차 맞은편 열끼리 겹치는 버그가 생김.
      rowDepth = L * Math.sin(phi) + W * Math.cos(phi);
      extraRotDeg = 90 - parkingAngleDeg;
      localW = W; localH = L;
    }
    if (!isFinite(pitch) || !isFinite(rowDepth) || pitch <= 0 || rowDepth <= 0) return null;

    const bandDepth = aisleMode === "double" ? rowDepth * 2 + aisleWidth : rowDepth + aisleWidth;
    const totalH = maxY - minY;
    if (totalH < rowDepth) return null;

    // 각 열의 통로를 하나로 잇는 연결 통로(진입로)를 대지 경계 한쪽 면(출입구에 가까운 쪽)에 확보한다.
    // 그 폭만큼은 일반 주차 칸 배치에서 제외하되, 각 열의 통로 자체는 그 구간까지 이어지도록 전체 폭을 사용한다.
    let connectorSide = "min";
    if (entranceWorld) {
      const eLocal = toLocal(entranceWorld);
      connectorSide = eLocal.x - minX <= maxX - eLocal.x ? "min" : "max";
    }
    const connectorWidth = aisleWidth;
    let stallMinX = minX, stallMaxX = maxX;
    if (connectorSide === "min") stallMinX = minX + connectorWidth;
    else stallMaxX = maxX - connectorWidth;
    const stallTotalW = stallMaxX - stallMinX;
    if (stallTotalW < pitch) return null;

    const nBands = Math.max(0, Math.floor((totalH + 1e-6) / bandDepth));
    const remainder = totalH - nBands * bandDepth;
    let curY = minY + offsetYFrac * Math.max(0, remainder);

    const stalls = [];
    const aisles = [];

    function addRow(rowY0) {
      const nStalls = Math.floor((stallTotalW + 1e-6) / pitch);
      for (let k = 0; k < nStalls; k++) {
        const cx = stallMinX + pitch * (k + 0.5);
        const cy = rowY0 + rowDepth / 2;
        const cornersLocal = Geo.rectCorners(cx, cy, localW, localH, Geo.toRad(extraRotDeg));
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
    // 통로는 대지 경계(localPoly)에 실제로 맞춰 클리핑한다. 여러 조각으로 잘릴 수도 있음.
    function addAisle(y0, h) {
      const segs = Geo.bandIntervals(localPoly, "y", y0, y0 + h, trueMinX, trueMaxX, 4);
      for (const [s, e] of segs) {
        const segW = e - s - 2 * setback;
        if (segW <= 0) continue;
        const cx = (s + e) / 2, cy = y0 + h / 2;
        const cornersLocal = Geo.rectCorners(cx, cy, segW, h, 0);
        aisles.push(cornersLocal.map(toWorld));
      }
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
    let contentYEnd = curY;
    if (leftover >= rowDepth - 1e-6) {
      addRow(curY);
      contentYEnd = curY + rowDepth;
    }

    // 연결 통로: 배치된 모든 열의 통로를 하나의 진입로로 연결(빗살 구조)
    if (nBands > 0) {
      const connX = connectorSide === "min" ? minX + connectorWidth / 2 : maxX - connectorWidth / 2;
      const segs = Geo.bandIntervals(localPoly, "x", connX - connectorWidth / 2, connX + connectorWidth / 2, minY, contentYEnd, 4);
      for (const [s, e] of segs) {
        const segH = e - s - 2 * setback;
        if (segH <= 0) continue;
        const cy = (s + e) / 2;
        const cornersLocal = Geo.rectCorners(connX, cy, connectorWidth, segH, 0);
        aisles.push(cornersLocal.map(toWorld));
      }
    }

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

  // 지정한 변(a-b)을 따라 우선 배치구역(장애인전용/전기차/확장형 등) 칸을 채운다. (간이 배치, 참고용)
  function placeAlongEdge(poly, exclusions, a, b, count, dims, aisleWidth, setback) {
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
    let tMin = Infinity, tMax = -Infinity;
    const maxSlots = Math.floor((edgeLen - 2 * setback) / pitch);
    for (let k = 0; k < maxSlots && stalls.length < count; k++) {
      const t = setback + (k + 0.5) * pitch;
      if (t > edgeLen - setback) break;
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
      tMin = Math.min(tMin, t - pitch / 2);
      tMax = Math.max(tMax, t + pitch / 2);
    }
    if (stalls.length === 0) return { stalls: [], aisles: [], exclusionZone: null };

    // 통로/제외구역은 변 전체가 아니라 "실제로 배치된 칸들이 차지하는 구간"만큼만 차지하도록 하여
    // 일반 주차 배치용 대지를 불필요하게 많이 잠식하지 않게 한다.
    const spanLen = tMax - tMin;
    const tMid = (tMin + tMax) / 2;
    const spanMidX = a.x + dir.x * tMid, spanMidY = a.y + dir.y * tMid;

    const aisleCx = spanMidX + normal.x * (setback + rowDepth + aisleWidth / 2);
    const aisleCy = spanMidY + normal.y * (setback + rowDepth + aisleWidth / 2);
    const aisleCorners = Geo.rectCorners(aisleCx, aisleCy, spanLen, aisleWidth, edgeAngle);

    const exclCx = spanMidX + normal.x * (setback + (rowDepth + aisleWidth) / 2);
    const exclCy = spanMidY + normal.y * (setback + (rowDepth + aisleWidth) / 2);
    const exclusionZone = Geo.rectCorners(exclCx, exclCy, spanLen + 0.5, rowDepth + aisleWidth + 0.5, edgeAngle);

    return { stalls, aisles: [aisleCorners], exclusionZone };
  }

  // 우선 배치구역 한 카테고리를 배치한다. 출입구에 가까운 변부터 순서대로 시도하며
  // 목표 대수(count)를 채울 때까지 다음 변으로 넘어간다(간이 배치, 참고용).
  function placeReservedCategory(poly, exclusions, entrancePoint, count, dims, aisleWidth, setback) {
    if (!count || count <= 0) return { stalls: [], aisles: [], exclusionZones: [] };
    const ref = entrancePoint || poly[0];
    const edgesSorted = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      edgesSorted.push({ a, b, d: Geo.distPointToSegment(ref, a, b) });
    }
    edgesSorted.sort((x, y) => x.d - y.d);

    const stalls = [], aisles = [], exclusionZones = [];
    let workingExclusions = exclusions.slice();

    for (const { a, b } of edgesSorted) {
      if (stalls.length >= count) break;
      const need = count - stalls.length;
      const result = placeAlongEdge(poly, workingExclusions, a, b, need, dims, aisleWidth, setback);
      if (result.stalls.length > 0) {
        stalls.push(...result.stalls);
        aisles.push(...result.aisles);
        exclusionZones.push(result.exclusionZone);
        workingExclusions = workingExclusions.concat([result.exclusionZone]);
      }
    }
    return { stalls, aisles, exclusionZones };
  }

  function optimize(poly, exclusions, opts) {
    const stepDeg = opts.angleStep || 10;
    const angles = candidateAngles(poly, stepDeg);
    const configs = opts.parkingAngle === "auto"
      ? [
          { pa: 90, am: "double" },
          { pa: 90, am: "single" },
          { pa: 60, am: "double" },
          { pa: 45, am: "double" },
          { pa: 0, am: "double" },
        ]
      : [{ pa: opts.parkingAngle, am: opts.aisleMode }];

    function runGeneral(exclusionsForPass) {
      let best = null;
      const bestByConfig = {};
      for (const cfg of configs) {
        const aw = opts.aisleWidth || Standards.aisleWidthByAngle[cfg.pa] || 6.0;
        let bestForCfg = null;
        for (const ang of angles) {
          for (const offsetYFrac of [0, 0.5]) {
            const layout = generateLayout(
              poly, exclusionsForPass, ang, cfg.pa, cfg.am,
              opts.stallDims, aw, opts.setback, offsetYFrac, opts.entrance
            );
            if (layout && (!bestForCfg || layout.count > bestForCfg.count)) bestForCfg = layout;
          }
        }
        if (bestForCfg) {
          bestByConfig[`${cfg.pa}-${cfg.am}`] = bestForCfg;
          if (!best || bestForCfg.count > best.count) best = bestForCfg;
        }
      }
      return { best, alternatives: Object.values(bestByConfig).sort((a, b) => b.count - a.count) };
    }

    // 1단계: 우선 배치구역 없이 기준(일반형) 배치의 총 대수를 먼저 구해, 비율(%) 계산의 기준으로 삼는다.
    const pass1 = runGeneral(exclusions);
    if (!pass1.best) return null;
    const baseTotal = pass1.best.count;

    const quotas = opts.quotas || {};
    const categories = [
      { key: "disabled", label: "장애인전용", pct: quotas.disabled || 0, dims: opts.stallDimsByCategory?.disabled || Standards.stallTypes.disabled },
      { key: "ev", label: "전기차", pct: quotas.ev || 0, dims: opts.stallDimsByCategory?.ev || Standards.stallTypes.ev },
      { key: "extended", label: "확장형", pct: quotas.extended || 0, dims: opts.stallDimsByCategory?.extended || Standards.stallTypes.extended },
    ];

    let workingExclusions = exclusions.slice();
    const reservedByCategory = {};
    for (const cat of categories) {
      const need = Math.ceil((baseTotal * cat.pct) / 100);
      if (need <= 0) { reservedByCategory[cat.key] = { key: cat.key, label: cat.label, stalls: [], aisles: [] }; continue; }
      const placed = placeReservedCategory(poly, workingExclusions, opts.entrance, need, cat.dims, opts.aisleWidth || Standards.aisleWidthByAngle[90], opts.setback);
      reservedByCategory[cat.key] = { key: cat.key, label: cat.label, needed: need, ...placed };
      workingExclusions = workingExclusions.concat(placed.exclusionZones);
    }

    const anyQuota = categories.some((c) => c.pct > 0);
    const finalPass = anyQuota ? runGeneral(workingExclusions) : pass1;
    if (!finalPass.best) return null;

    const reservedTotal = Object.values(reservedByCategory).reduce((s, r) => s + r.stalls.length, 0);
    const siteArea = Geo.polygonArea(poly);

    return {
      best: finalPass.best,
      alternatives: finalPass.alternatives,
      reservedByCategory,
      baseTotal,
      siteArea,
      totalCount: finalPass.best.count + reservedTotal,
    };
  }

  return { optimize, generateLayout, candidateAngles, placeReservedCategory };
})();
