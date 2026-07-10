// 앱 진입점: UI 이벤트 바인딩 및 MapView <-> Optimizer <-> Exporters 연결
(function () {
  let origin = null;          // 로컬 평면좌표 변환 기준점 {lat,lng}
  let lastLocalResult = null; // optimizer 결과 (로컬 m좌표)
  let lastLatLngResult = null; // 위경도로 변환된 최신 표시용 결과
  let selectedAltIndex = -1;  // -1 = best, 0.. = alternatives 인덱스

  function $(id) { return document.getElementById(id); }

  function currentStallDims() {
    const key = $("selStallType").value;
    if (key === "custom") {
      return { width: parseFloat($("inCustomW").value) || 2.5, length: parseFloat($("inCustomL").value) || 5.0 };
    }
    const s = Standards.stallTypes[key];
    return { width: s.width, length: s.length };
  }

  function updateSiteInfo() {
    const pts = MapView.getSiteLatLngs();
    const box = $("siteInfo");
    if (pts.length < 3) {
      box.textContent = "대지가 아직 그려지지 않았습니다.";
      return;
    }
    const o = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
    const local = pts.map((p) => Geo.project(p.lat, p.lng, o));
    const area = Geo.polygonArea(local);
    box.textContent = `꼭짓점 ${pts.length}개 · 대지면적 약 ${area.toFixed(1)} m² (${(area / 3.3058).toFixed(1)}평)`;
  }

  function updateExclusionInfo() {
    const list = MapView.getExclusionsLatLng();
    $("exclusionInfo").textContent = list.length === 0 ? "제외구역 없음" : `제외구역 ${list.length}개 등록됨`;
  }

  function toLatLngPoly(localCorners) {
    return localCorners.map((p) => Geo.unproject(p, origin));
  }

  function renderFromLocal(localBest, localReservedByCategory) {
    const bestLatLng = {
      stalls: localBest.stalls.map(toLatLngPoly),
      aisles: localBest.aisles.map(toLatLngPoly),
    };
    const reservedByCategoryLatLng = {};
    for (const key of Object.keys(localReservedByCategory || {})) {
      const cat = localReservedByCategory[key];
      reservedByCategoryLatLng[key] = {
        key: cat.key, label: cat.label,
        stalls: cat.stalls.map(toLatLngPoly),
        aisles: cat.aisles.map(toLatLngPoly),
      };
    }
    lastLatLngResult = { best: bestLatLng, reservedByCategory: reservedByCategoryLatLng };
    MapView.renderResult(lastLatLngResult);
    return lastLatLngResult;
  }

  function angleLabel(cfg) {
    if (cfg.parkingAngle === 0) return "평행주차";
    return `직각/사선 ${cfg.parkingAngle}도`;
  }

  function reservedTotal(r) {
    return Object.values(r.reservedByCategory).reduce((s, c) => s + c.stalls.length, 0);
  }

  function renderSummary() {
    const r = lastLocalResult;
    if (!r) return;
    const chosen = selectedAltIndex === -1 ? r.best : r.alternatives[selectedAltIndex];
    const resTotal = reservedTotal(r);
    const total = chosen.count + resTotal;
    const eff = total > 0 ? (r.siteArea / total).toFixed(1) : "-";

    const catLines = Object.values(r.reservedByCategory)
      .filter((c) => c.needed > 0)
      .map((c) => `  - ${c.label}: ${c.stalls.length}/${c.needed}대`)
      .join("\n");

    $("resultSummary").textContent =
      `총 주차대수: ${total}대 (일반 ${chosen.count}대 + 특수구역 ${resTotal}대)\n` +
      (catLines ? catLines + "\n" : "") +
      `대지면적: ${r.siteArea.toFixed(1)} m²\n` +
      `대당 소요면적: ${eff} m²/대\n` +
      `배치: ${angleLabel(chosen)} · ${chosen.aisleMode === "double" ? "양측주차" : "편측주차"} · 회전각 ${chosen.gridAngle.toFixed(1)}도\n` +
      `주차규격: ${chosen.stallDims.width}m x ${chosen.stallDims.length}m · 차로폭 ${chosen.aisleWidth.toFixed(1)}m`;

    const box = $("alternativesBox");
    box.innerHTML = "";
    const makeItem = (label, count, idx) => {
      const div = document.createElement("div");
      div.className = "alt-item" + (idx === selectedAltIndex ? " active" : "");
      div.innerHTML = `<span>${label}</span><b>${count}대</b>`;
      div.onclick = () => {
        selectedAltIndex = idx;
        renderFromLocal(idx === -1 ? r.best : r.alternatives[idx], r.reservedByCategory);
        renderSummary();
      };
      box.appendChild(div);
    };
    if (r.alternatives.length > 1) {
      const title = document.createElement("div");
      title.className = "hint";
      title.textContent = "대안 비교 (클릭하여 지도에 표시):";
      box.appendChild(title);
      r.alternatives.forEach((alt, idx) => {
        makeItem(`${angleLabel(alt)} · ${alt.aisleMode === "double" ? "양측" : "편측"}`, alt.count + resTotal, idx);
      });
    }
  }

  function runOptimize() {
    const sitePts = MapView.getSiteLatLngs();
    if (sitePts.length < 3) {
      alert("먼저 지도에 대지 경계를 그려주세요.");
      return;
    }
    $("calcStatus").textContent = "계산 중...";
    $("btnOptimize").disabled = true;

    setTimeout(() => {
      try {
        origin = { lat: sitePts.reduce((s, p) => s + p.lat, 0) / sitePts.length, lng: sitePts.reduce((s, p) => s + p.lng, 0) / sitePts.length };
        const localSite = sitePts.map((p) => Geo.project(p.lat, p.lng, origin));
        const localExclusions = MapView.getExclusionsLatLng().map((poly) => poly.map((p) => Geo.project(p.lat, p.lng, origin)));
        const entranceLatLng = MapView.getEntranceLatLng();
        const entranceLocal = entranceLatLng ? Geo.project(entranceLatLng.lat, entranceLatLng.lng, origin) : null;

        const parkingAngleVal = $("selParkingAngle").value;
        const opts = {
          stallDims: currentStallDims(),
          parkingAngle: parkingAngleVal === "auto" ? "auto" : parseInt(parkingAngleVal, 10),
          aisleMode: $("selAisleMode").value,
          aisleWidth: $("inAisleWidth").value ? parseFloat($("inAisleWidth").value) : null,
          setback: parseFloat($("inSetback").value) || 0,
          angleStep: parseInt($("selPrecision").value, 10),
          entrance: entranceLocal,
          quotas: {
            disabled: parseFloat($("inPctDisabled").value) || 0,
            ev: parseFloat($("inPctEv").value) || 0,
            extended: parseFloat($("inPctExtended").value) || 0,
          },
        };

        const result = Optimizer.optimize(localSite, localExclusions, opts);
        if (!result) {
          $("calcStatus").textContent = "배치를 찾지 못했습니다. 대지가 너무 작거나 이격거리/규격을 확인하세요.";
          $("btnOptimize").disabled = false;
          return;
        }
        lastLocalResult = result;
        selectedAltIndex = -1;
        renderFromLocal(result.best, result.reservedByCategory);
        renderSummary();
        $("resultsPanel").style.display = "block";
        $("calcStatus").textContent = "계산 완료.";
      } catch (err) {
        console.error(err);
        $("calcStatus").textContent = "오류: " + err.message;
      } finally {
        $("btnOptimize").disabled = false;
      }
    }, 30);
  }

  function allStallsAisles() {
    let stalls = lastLatLngResult.best.stalls.slice();
    let aisles = lastLatLngResult.best.aisles.slice();
    for (const cat of Object.values(lastLatLngResult.reservedByCategory)) {
      stalls = stalls.concat(cat.stalls);
      aisles = aisles.concat(cat.aisles);
    }
    return { stalls, aisles };
  }
  function exportDxf() {
    if (!lastLatLngResult) return;
    const { stalls, aisles } = allStallsAisles();
    const dxf = Exporters.buildDxf(MapView.getSiteLatLngs(), stalls, aisles, origin);
    Exporters.downloadText("parking_layout.dxf", dxf, "application/dxf");
  }
  function exportGeoJson() {
    if (!lastLatLngResult) return;
    const { stalls, aisles } = allStallsAisles();
    const gj = Exporters.buildGeoJson(MapView.getSiteLatLngs(), stalls, aisles, { generated: new Date().toISOString() });
    Exporters.downloadText("parking_layout.geojson", gj, "application/geo+json");
  }

  function bindUI() {
    $("selStallType").addEventListener("change", (e) => {
      $("customStallBox").classList.toggle("hidden", e.target.value !== "custom");
    });
    $("selParkingAngle").addEventListener("change", (e) => {
      $("manualConfigBox").classList.toggle("hidden", e.target.value === "auto");
    });

    $("btnDrawSite").addEventListener("click", () => MapView.startDrawSite());
    $("btnFinishDraw").addEventListener("click", () => MapView.finishDrawing());
    $("btnUndoPoint").addEventListener("click", () => MapView.undoLastPoint());
    $("btnCancelDraw").addEventListener("click", () => MapView.cancelDrawing());
    $("btnClearSite").addEventListener("click", () => { MapView.clearSite(); updateSiteInfo(); $("resultsPanel").style.display = "none"; lastLocalResult = null; });

    $("btnDrawExclusion").addEventListener("click", () => MapView.startDrawExclusion());
    $("btnRemoveLastExclusion").addEventListener("click", () => { MapView.removeLastExclusion(); updateExclusionInfo(); });
    $("btnClearExclusion").addEventListener("click", () => { MapView.clearExclusions(); updateExclusionInfo(); });

    $("btnPickEntrance").addEventListener("click", () => MapView.startPickEntrance());
    $("btnClearEntrance").addEventListener("click", () => MapView.clearEntrance());

    $("btnOptimize").addEventListener("click", runOptimize);
    $("btnExportDxf").addEventListener("click", exportDxf);
    $("btnExportGeoJson").addEventListener("click", exportGeoJson);

    MapView.setOnSiteChange(updateSiteInfo);
    MapView.setOnExclusionChange(updateExclusionInfo);
  }

  window.addEventListener("DOMContentLoaded", () => {
    MapView.init("map");
    bindUI();
    $("disclaimerText").textContent = Standards.disclaimer;
  });
})();
