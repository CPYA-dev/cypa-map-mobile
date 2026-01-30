const express = require("express");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

// Athens bounding box (west, south, east, north)
const ATHENS_VIEWBOX = "23.65,37.85,24.05,38.10";

function isPlaceLike(p) {
  const cls = String(p.class || "");
  return ["shop", "amenity", "tourism", "office", "leisure", "building"].includes(cls);
}

// Athens bounding box (west, south, east, north)
const ATHENS_BBOX = { west: 23.65, south: 37.85, east: 24.05, north: 38.10 };

function isPlaceLikeFromNominatim(p) {
  const cls = String(p.class || "");
  return ["shop", "amenity", "tourism", "office", "leisure", "building"].includes(cls);
}

function scoreNominatim(p, qLower) {
  const name = String(p.display_name || "");
  const nameLower = name.toLowerCase();
  const nameHit = nameLower.includes(qLower) ? 1 : 0;
  const imp = Number(p.importance || 0);
  const poiBonus = isPlaceLikeFromNominatim(p) ? 0.3 : 0;
  return nameHit * 1.0 + imp * 0.6 + poiBonus;
}

function uniqByLatLonAndName(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const key = `${x.lat.toFixed(6)},${x.lon.toFixed(6)}|${x.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

async function overpassSearch(q) {
  const { west, south, east, north } = ATHENS_BBOX;
  const safe = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); // simple safety for regex string

  const query = `
[out:json][timeout:25];
(
  node["name"~"${safe}",i](${south},${west},${north},${east});
  way["name"~"${safe}",i](${south},${west},${north},${east});
  relation["name"~"${safe}",i](${south},${west},${north},${east});

  node["brand"~"${safe}",i](${south},${west},${north},${east});
  way["brand"~"${safe}",i](${south},${west},${north},${east});
  relation["brand"~"${safe}",i](${south},${west},${north},${east});

  node["operator"~"${safe}",i](${south},${west},${north},${east});
  way["operator"~"${safe}",i](${south},${west},${north},${east});
  relation["operator"~"${safe}",i](${south},${west},${north},${east});

  node["alt_name"~"${safe}",i](${south},${west},${north},${east});
  way["alt_name"~"${safe}",i](${south},${west},${north},${east});
  relation["alt_name"~"${safe}",i](${south},${west},${north},${east});
);
out center tags;
`;

  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "CPYA-Map/1.0 (local)" },
    body: query,
  });

  if (!r.ok) return [];
  const data = await r.json();
  const els = Array.isArray(data.elements) ? data.elements : [];

  return els
    .map((e) => {
      const lat = Number(e.lat ?? e.center?.lat);
      const lon = Number(e.lon ?? e.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const name = e.tags?.name || e.tags?.brand || e.tags?.operator || "Place";
      const kind =
        e.tags?.healthcare || e.tags?.amenity || e.tags?.shop || e.tags?.tourism || e.tags?.office || "";

      return {
        name,
        lat,
        lon,
        kind,
        source: "overpass",
        score: 0.8 + (String(name).toLowerCase().includes(q.toLowerCase()) ? 0.3 : 0),
        osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
      };
    })
    .filter(Boolean);
}

app.post("/where", async (req, res) => {
  try {
    const q = String(req.body?.q || "").trim();
    if (!q) return res.json({ found: false, top5: [], results: [] });

    const qLower = q.toLowerCase();

    // 1) Nominatim
    const viewbox = `${ATHENS_BBOX.west},${ATHENS_BBOX.south},${ATHENS_BBOX.east},${ATHENS_BBOX.north}`;
    const nomUrl =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        q,
        format: "json",
        limit: "50",
        addressdetails: "1",
        extratags: "1",
        namedetails: "1",
        "accept-language": "el,en",
        bounded: "1",
        viewbox,
      }).toString();

    const nomRes = await fetch(nomUrl, { headers: { "User-Agent": "CPYA-Map/1.0 (local)" } });
    const nomData = nomRes.ok ? await nomRes.json() : [];
    const nomList = Array.isArray(nomData) ? nomData : [];

    let results = nomList
      .map((p) => ({
        name: p.display_name,
        lat: Number(p.lat),
        lon: Number(p.lon),
        kind: `${p.class || ""}:${p.type || ""}`,
        source: "nominatim",
        score: scoreNominatim(p, qLower),
        osmUrl: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`,
      }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    // 2) Overpass fallback if weak
    if (results.length < 8) {
      const over = await overpassSearch(q);
      results = results.concat(over);
    }

    // 3) De-dup + sort
    results = uniqByLatLonAndName(results).sort((a, b) => (b.score || 0) - (a.score || 0));

    const top5 = results.slice(0, 5);

    res.json({ found: results.length > 0, top5, results });
  } catch (e) {
    res.json({ found: false, top5: [], results: [], error: String(e?.message || e) });
  }
});


        if (!r.ok) return res.json({ found: false, results: [], error: `HTTP ${r.status}` });

    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return res.json({ found: false, results: [] });

    const qLower = q.toLowerCase();

    const scored = data.map((p) => {
      const name = String(p.display_name || "");
      const nameLower = name.toLowerCase();

      const nameHit = nameLower.includes(qLower) ? 1 : 0;
      const imp = Number(p.importance || 0);
      const poiBonus = isPlaceLike(p) ? 0.3 : 0;

      const score = nameHit * 1.0 + imp * 0.6 + poiBonus;
      return { p, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, 5).map(({ p }, idx) => ({
      rank: idx + 1,
      name: p.display_name,
      lat: Number(p.lat),
      lon: Number(p.lon),
      osmUrl: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`,
    }));

    res.json({ found: true, results });
  } catch (e) {
    res.json({ found: false, results: [], error: String(e?.message || e) });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Running: http://localhost:${PORT}`);
});
