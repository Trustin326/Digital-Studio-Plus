// netlify/functions/download.js
const { createClient } = require("@supabase/supabase-js");
const JSZip = require("jszip");

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PLAN_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };
const TEMPLATE_MIN_PLAN = {
  saas: "starter",
  ai: "pro",
  agency: "agency"
};

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const template = (q.template || "").toLowerCase();
    const license = (q.license || "").trim();

    if (!TEMPLATE_MIN_PLAN[template]) return { statusCode: 400, body: "Invalid template" };
    if (!license) return { statusCode: 400, body: "Missing license" };

    // Validate license
    const { data: lic, error: licErr } = await supabaseAdmin
      .from("licenses")
      .select("email, plan, status")
      .eq("license_key", license)
      .single();

    if (licErr || !lic) return { statusCode: 403, body: "Invalid license" };
    if (lic.status !== "active") return { statusCode: 403, body: "License not active" };

    const required = TEMPLATE_MIN_PLAN[template];
    if ((PLAN_RANK[lic.plan] || 0) < (PLAN_RANK[required] || 0)) {
      return { statusCode: 403, body: `Plan upgrade required: ${required}` };
    }

    // Fetch template zip from storage (private bucket)
    const bucket = process.env.TEMPLATE_BUCKET || "templates";
    const fileName = `${template}.zip`;

    const { data: file, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(fileName);
    if (dlErr) return { statusCode: 500, body: dlErr.message };

    const arrayBuffer = await file.arrayBuffer();

    // Build a watermarked zip
    const zip = new JSZip();
    const watermark = `TechForge Watermark
Email: ${lic.email}
License: ${license}
Template: ${template}
Generated: ${new Date().toISOString()}
`;

    zip.file("WATERMARK.txt", watermark);
    zip.file("LICENSE.txt", `License Key: ${license}\nPlan: ${lic.plan}\n`);

    // Add original zip as embedded file (simple + reliable)
    // (If you want deep injection into files, we can do that too, but it’s longer.)
    zip.file(`${template}-original.zip`, Buffer.from(arrayBuffer));

    const out = await zip.generateAsync({ type: "nodebuffer" });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="techforge-${template}-watermarked.zip"`
      },
      body: out.toString("base64"),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
