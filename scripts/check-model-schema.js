// Run: node scripts/check-model-schema.js
// Requires REPLICATE_API_TOKEN in environment
const R = require("replicate");
const r = new R({ auth: process.env.REPLICATE_API_TOKEN });
r.models.get("ideogram-ai", "ideogram-v3-turbo").then((m) => {
  const p = m.latest_version?.openapi_schema?.components?.schemas?.Input?.properties;
  if (p) {
    Object.entries(p).forEach(([k, v]) =>
      console.log(k, "-", (v.description || v.type || "").toString().slice(0, 150))
    );
  } else {
    console.log("no schema found");
  }
}).catch((e) => console.error(e.message));
