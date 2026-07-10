// 결과 내보내기: DXF(AutoCAD 호환, 로컬 m좌표) / GeoJSON(위경도)
const Exporters = (() => {
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function dxfPolylineEntity(corners, layer) {
    const lines = ["0", "LWPOLYLINE", "8", layer, "90", String(corners.length), "70", "1"];
    for (const c of corners) {
      lines.push("10", c.x.toFixed(3), "20", c.y.toFixed(3));
    }
    return lines;
  }

  // stallsWorld/aislesWorld: 위경도 좌표 배열([{lat,lng},...]) 목록. origin 기준 로컬 m좌표로 변환하여 DXF 작성.
  function buildDxf(sitePolyLatLng, stallsLatLng, aislesLatLng, origin) {
    const toLocal = (ll) => Geo.project(ll.lat, ll.lng, origin);
    let body = ["0", "SECTION", "2", "ENTITIES"];
    if (sitePolyLatLng && sitePolyLatLng.length >= 3) {
      body = body.concat(dxfPolylineEntity(sitePolyLatLng.map(toLocal), "SITE_BOUNDARY"));
    }
    for (const s of stallsLatLng) {
      body = body.concat(dxfPolylineEntity(s.map(toLocal), "PARKING_STALL"));
    }
    for (const a of aislesLatLng) {
      body = body.concat(dxfPolylineEntity(a.map(toLocal), "DRIVE_AISLE"));
    }
    body = body.concat(["0", "ENDSEC", "0", "EOF"]);
    return body.join("\n");
  }

  function buildGeoJson(sitePolyLatLng, stallsLatLng, aislesLatLng, meta) {
    const ring = (pts) => {
      const coords = pts.map((p) => [p.lng, p.lat]);
      coords.push(coords[0]);
      return coords;
    };
    const features = [];
    if (sitePolyLatLng && sitePolyLatLng.length >= 3) {
      features.push({
        type: "Feature",
        properties: { kind: "site_boundary" },
        geometry: { type: "Polygon", coordinates: [ring(sitePolyLatLng)] },
      });
    }
    stallsLatLng.forEach((s, i) => {
      features.push({
        type: "Feature",
        properties: { kind: "parking_stall", index: i },
        geometry: { type: "Polygon", coordinates: [ring(s)] },
      });
    });
    aislesLatLng.forEach((a, i) => {
      features.push({
        type: "Feature",
        properties: { kind: "drive_aisle", index: i },
        geometry: { type: "Polygon", coordinates: [ring(a)] },
      });
    });
    return JSON.stringify({ type: "FeatureCollection", properties: meta || {}, features }, null, 2);
  }

  return { downloadText, buildDxf, buildGeoJson };
})();
