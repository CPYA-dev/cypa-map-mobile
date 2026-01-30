const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;


app.use(express.json());
app.use(express.static("public"));

// Athens bbox (west, south, east, north)
const ATHENS_BBOX = { west: 23.65, south: 37.85, east: 24.05, north: 38.10 };

// ---------- Helpers ----------
function isPlaceLikeFromNominatim(p) {
  const cls = String(p.class || "");
  return ["shop", "amenity", "tourism", "office", "leisure", "building", "healthcare"].includes(cls);
}

function scoreNominatim(p, qLower) {
  const display = String(p.display_name || "");
  const name = String(p.namedetails?.name || p.name || "");
  const displayLower = display.toLowerCase();
  const nameLower = name.toLowerCase();

  const exact = nameLower === qLower ? 3 : 0;
  const starts = nameLower.startsWith(qLower) || displayLower.startsWith(qLower) ? 1.5 : 0;
  const contains = nameLower.includes(qLower) || displayLower.includes(qLower) ? 1 : 0;

  const imp = Number(p.importance || 0);
  const poiBonus = isPlaceLikeFromNominatim(p) ? 1.0 : 0;

  const shortPenalty = qLower.length <= 2 ? -0.8 : 0;

  return exact + starts + contains + imp * 0.6 + poiBonus + shortPenalty;
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

function loosePattern(q) {
  const cleaned = q
    .toLowerCase()
    .replace(/[^a-z0-9α-ωάέήίόύώϊΐϋΰ]/gi, "");

  if (cleaned.length < 3) return null;

  return cleaned
    .split("")
    .map((ch) => ch.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&"))
    .join(".*");
}

function escapeOverpassRegex(s) {
  // Overpass uses regex in ["name"~"..."]
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
}

function buildAddressFromTags(tags) {
  const street = tags["addr:street"] || "";
  const housenumber = tags["addr:housenumber"] || "";
  const city = tags["addr:city"] || "";
  const postcode = tags["addr:postcode"] || "";

  const address = [
    [street, housenumber].filter(Boolean).join(" ").trim(),
    city,
    postcode,
  ].filter(Boolean).join(", ");

  return address; // may be "" if not present
}

// ---------- Overpass: name/brand search ----------
async function overpassSearch(q) {
  const { west, south, east, north } = ATHENS_BBOX;
  const safe = escapeOverpassRegex(q);

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
  const qLower = String(q).toLowerCase();

  return els
    .map((e) => {
      const lat = Number(e.lat ?? e.center?.lat);
      const lon = Number(e.lon ?? e.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const tags = e.tags || {};
      const name = tags.name || tags.brand || tags.operator || "Place";
      const kind = tags.healthcare || tags.amenity || tags.shop || tags.tourism || tags.office || "";

      const address = buildAddressFromTags(tags);

      const hit = String(name).toLowerCase().includes(qLower) ? 1 : 0;

      return {
        name,
        address,
        lat,
        lon,
        kind,
        source: "overpass",
        score: 0.9 + hit * 0.4,
        osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
      };
    })
    .filter(Boolean);
}

// ---------- Overpass: nearby category search ----------
async function overpassNearby(lat, lon, cat, radiusMeters = 1500) {
  // Keep within Athens-ish: simple guard
  const inAthens =
    lon >= ATHENS_BBOX.west && lon <= ATHENS_BBOX.east &&
    lat >= ATHENS_BBOX.south && lat <= ATHENS_BBOX.north;

  if (!inAthens) return [];

  const around = `${radiusMeters},${lat},${lon}`;

  let filters = "";
  if (cat === "cafe") {
    filters = `
      node["amenity"="cafe"](around:${around});
      way["amenity"="cafe"](around:${around});
      relation["amenity"="cafe"](around:${around});
    `;
  } else if (cat === "food") {
    filters = `
      node["amenity"~"restaurant|fast_food|cafe"](around:${around});
      way["amenity"~"restaurant|fast_food|cafe"](around:${around});
      relation["amenity"~"restaurant|fast_food|cafe"](around:${around});
    `;
  } else if (cat === "pharmacy") {
    filters = `
      node["amenity"="pharmacy"](around:${around});
      way["amenity"="pharmacy"](around:${around});
      relation["amenity"="pharmacy"](around:${around});
    `;
  } else if (cat === "supermarket") {
    filters = `
      node["shop"="supermarket"](around:${around});
      way["shop"="supermarket"](around:${around});
      relation["shop"="supermarket"](around:${around});
    `;
  } else {
    return [];
  }

  const query = `
[out:json][timeout:25];
(
  ${filters}
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
      const rlat = Number(e.lat ?? e.center?.lat);
      const rlon = Number(e.lon ?? e.center?.lon);
      if (!Number.isFinite(rlat) || !Number.isFinite(rlon)) return null;

      const tags = e.tags || {};
      const name = tags.name || tags.brand || tags.operator || "Place";
      const kind = tags.healthcare || tags.amenity || tags.shop || tags.tourism || tags.office || "";

      const address = buildAddressFromTags(tags);

      return {
        name,
        address,
        lat: rlat,
        lon: rlon,
        kind,
        source: "overpass_nearby",
        score: 1.0,
        osmUrl: `https://www.openstreetmap.org/?mlat=${rlat}&mlon=${rlon}#map=18/${rlat}/${rlon}`,
      };
    })
    .filter(Boolean);
}

// ---------- Routes ----------
app.post("/where", async (req, res) => {
  try {
    const q = String(req.body?.q || "").trim();
    if (!q) return res.json({ found: false, top5: [], results: [] });

    const qLower = q.toLowerCase();

    const viewbox = `${ATHENS_BBOX.west},${ATHENS_BBOX.south},${ATHENS_BBOX.east},${ATHENS_BBOX.north}`;

    const nomUrl =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        q,
        format: "json",
        limit: "40",
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
        address: p.display_name, // nominatim already gives full address
        lat: Number(p.lat),
        lon: Number(p.lon),
        kind: `${p.class || ""}:${p.type || ""}`,
        source: "nominatim",
        score: scoreNominatim(p, qLower),
        osmUrl: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`,
      }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    // Always Overpass too
    const over = await overpassSearch(q);
    results = results.concat(over);

    // Typo-tolerant fallback
    if (results.length < 10) {
      const pat = loosePattern(q);
      if (pat) {
        const overLoose = await overpassSearch(pat);
        results = results.concat(overLoose.map((x) => ({ ...x, score: (x.score || 0) - 0.2 })));
      }
    }

    results = uniqByLatLonAndName(results).sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json({
      found: results.length > 0,
      top5: results.slice(0, 5),
      results,
    });
  } catch (e) {
    res.json({ found: false, top5: [], results: [], error: String(e?.message || e) });
  }
});

app.get("/nearby", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const cat = String(req.query.cat || "").trim();

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cat) {
      return res.status(400).json({ found: false, results: [], error: "lat/lon/cat required" });
    }

    const results = await overpassNearby(lat, lon, cat, 1500);
    const clean = uniqByLatLonAndName(results);

    res.json({
      found: clean.length > 0,
      top5: clean.slice(0, 5),
      results: clean,
    });
  } catch (e) {
    res.status(500).json({ found: false, results: [], error: String(e?.message || e) });
  }
});

app.get("/health", (req, res) => res.send("OK"));

app.get("/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, error: "lat/lon required" });
    }

    const url =
      "https://api.open-meteo.com/v1/forecast?" +
      new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
        timezone: "Europe/Athens",
      }).toString();

    const r = await fetch(url, { headers: { "User-Agent": "CPYA-Map/1.0 (local)" } });
    if (!r.ok) return res.status(502).json({ ok: false, error: `weather HTTP ${r.status}` });

    const data = await r.json();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Running: http://localhost:${PORT}`);
});
