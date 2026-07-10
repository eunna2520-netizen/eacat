// Leaflet 지도 위 대지경계/제외구역/출입구 드로잉 + 결과 레이어 렌더링
const MapView = (() => {
  let map;
  let siteLatLngs = [];       // [{lat,lng}, ...]
  let exclusionsLatLng = [];  // [[{lat,lng},...], ...]
  let entrancePointLatLng = null;

  let siteLayer = null;
  let siteVertexMarkers = [];
  let exclusionLayers = [];
  let entranceMarker = null;
  let resultLayerGroup = null;

  let mode = "idle"; // idle | drawSite | drawExclusion
  let drawBuffer = [];
  let drawPreviewLayer = null;

  const onChange = { site: null, exclusion: null, entrance: null };

  function init(elementId) {
    map = L.map(elementId).setView([37.5665, 126.9780], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 21,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    resultLayerGroup = L.layerGroup().addTo(map);

    map.on("click", (e) => {
      if (mode === "drawSite" || mode === "drawExclusion") {
        drawBuffer.push({ lat: e.latlng.lat, lng: e.latlng.lng });
        redrawPreview();
      } else if (mode === "pickEntrance") {
        entrancePointLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
        renderEntrance();
        mode = "idle";
        if (onChange.entrance) onChange.entrance(entrancePointLatLng);
      }
    });
    map.on("dblclick", (e) => {
      if (mode === "drawSite" || mode === "drawExclusion") {
        L.DomEvent.stop(e);
        finishDrawing();
      }
    });
    return map;
  }

  function redrawPreview() {
    if (drawPreviewLayer) map.removeLayer(drawPreviewLayer);
    if (drawBuffer.length === 0) return;
    const color = mode === "drawExclusion" ? "#e74c3c" : "#2b6cff";
    if (drawBuffer.length === 1) {
      drawPreviewLayer = L.circleMarker(drawBuffer[0], { radius: 4, color }).addTo(map);
    } else {
      drawPreviewLayer = L.polyline(drawBuffer, { color, weight: 2, dashArray: "4,4" }).addTo(map);
    }
  }

  function startDrawSite() {
    mode = "drawSite";
    drawBuffer = [];
    redrawPreview();
  }
  function startDrawExclusion() {
    mode = "drawExclusion";
    drawBuffer = [];
    redrawPreview();
  }
  function startPickEntrance() {
    mode = "pickEntrance";
  }
  function cancelDrawing() {
    mode = "idle";
    drawBuffer = [];
    if (drawPreviewLayer) { map.removeLayer(drawPreviewLayer); drawPreviewLayer = null; }
  }
  function undoLastPoint() {
    if (drawBuffer.length > 0) {
      drawBuffer.pop();
      redrawPreview();
    }
  }

  function finishDrawing() {
    if (drawBuffer.length < 3) {
      cancelDrawing();
      return;
    }
    if (mode === "drawSite") {
      siteLatLngs = drawBuffer.slice();
      renderSite();
      if (onChange.site) onChange.site(siteLatLngs);
    } else if (mode === "drawExclusion") {
      exclusionsLatLng.push(drawBuffer.slice());
      renderExclusions();
      if (onChange.exclusion) onChange.exclusion(exclusionsLatLng);
    }
    mode = "idle";
    drawBuffer = [];
    if (drawPreviewLayer) { map.removeLayer(drawPreviewLayer); drawPreviewLayer = null; }
  }

  function renderSite() {
    if (siteLayer) map.removeLayer(siteLayer);
    siteVertexMarkers.forEach((m) => map.removeLayer(m));
    siteVertexMarkers = [];
    if (siteLatLngs.length < 3) return;
    siteLayer = L.polygon(siteLatLngs, { color: "#2b6cff", weight: 3, fillOpacity: 0.08 }).addTo(map);
    siteLatLngs.forEach((p) => {
      siteVertexMarkers.push(L.circleMarker(p, { radius: 3, color: "#2b6cff" }).addTo(map));
    });
  }

  function renderExclusions() {
    exclusionLayers.forEach((l) => map.removeLayer(l));
    exclusionLayers = exclusionsLatLng.map((poly) =>
      L.polygon(poly, { color: "#e74c3c", weight: 2, fillOpacity: 0.15, dashArray: "5,3" }).addTo(map)
    );
  }

  function renderEntrance() {
    if (entranceMarker) map.removeLayer(entranceMarker);
    if (!entrancePointLatLng) return;
    entranceMarker = L.marker(entrancePointLatLng, {
      icon: L.divIcon({ className: "entrance-icon", html: "🚗", iconSize: [20, 20] }),
    }).addTo(map);
  }

  function clearSite() {
    siteLatLngs = [];
    if (siteLayer) { map.removeLayer(siteLayer); siteLayer = null; }
    siteVertexMarkers.forEach((m) => map.removeLayer(m));
    siteVertexMarkers = [];
    clearResults();
  }
  function clearExclusions() {
    exclusionsLatLng = [];
    exclusionLayers.forEach((l) => map.removeLayer(l));
    exclusionLayers = [];
  }
  function removeLastExclusion() {
    exclusionsLatLng.pop();
    renderExclusions();
  }
  function clearEntrance() {
    entrancePointLatLng = null;
    if (entranceMarker) { map.removeLayer(entranceMarker); entranceMarker = null; }
  }

  function clearResults() {
    resultLayerGroup.clearLayers();
  }

  function renderResult(layoutResult) {
    clearResults();
    if (!layoutResult) return;
    const { best, reserved } = layoutResult;
    for (const a of best.aisles) {
      L.polygon(a, { color: "#999", weight: 1, fillColor: "#ccc", fillOpacity: 0.35 }).addTo(resultLayerGroup);
    }
    for (const s of best.stalls) {
      L.polygon(s, { color: "#1976d2", weight: 1, fillColor: "#64b5f6", fillOpacity: 0.55 }).addTo(resultLayerGroup);
    }
    if (reserved && reserved.stalls.length) {
      for (const a of reserved.aisles) {
        L.polygon(a, { color: "#999", weight: 1, fillColor: "#ccc", fillOpacity: 0.35 }).addTo(resultLayerGroup);
      }
      for (const s of reserved.stalls) {
        L.polygon(s, { color: "#e67e22", weight: 1, fillColor: "#f5b041", fillOpacity: 0.6 }).addTo(resultLayerGroup);
      }
    }
  }

  function getSiteLatLngs() { return siteLatLngs; }
  function getExclusionsLatLng() { return exclusionsLatLng; }
  function getEntranceLatLng() { return entrancePointLatLng; }
  function getMap() { return map; }

  function setOnSiteChange(fn) { onChange.site = fn; }
  function setOnExclusionChange(fn) { onChange.exclusion = fn; }
  function setOnEntranceChange(fn) { onChange.entrance = fn; }

  return {
    init, startDrawSite, startDrawExclusion, startPickEntrance,
    cancelDrawing, undoLastPoint, finishDrawing,
    clearSite, clearExclusions, removeLastExclusion, clearEntrance, clearResults,
    renderResult, getSiteLatLngs, getExclusionsLatLng, getEntranceLatLng, getMap,
    setOnSiteChange, setOnExclusionChange, setOnEntranceChange,
  };
})();
