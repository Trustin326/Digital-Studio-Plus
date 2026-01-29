// netlify/functions/stripe-webhook.js
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export const handler = async (event) => {
  // IMPORTANT: need the raw body for signature verification
  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;

    // Pull identifiers you set during Checkout creation:
    // - session.customer_details.email
    // - session.client_reference_id (optional)
    // - session.metadata (recommended)
    // Stripe supports metadata for your own identifiers. :contentReference[oaicite:1]{index=1}
    const email = session.customer_details?.email;
    const plan = session.metadata?.plan; // "starter" | "pro" | "agency"
    const affiliateCode = session.metadata?.ref || null;

    // 1) Activate plan in DB
    // 2) Create license keys
    // 3) Track affiliate payout
    // 4) Email license + download links

    const licenseKey = `TF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    // Upsert user profile by email (or use auth user id if you pass it)
    const { data: profile, error: upsertErr } = await supabase
      .from("profiles")
      .upsert({ email, plan, updated_at: new Date().toISOString() }, { onConflict: "email" })
      .select()
      .single();

    if (upsertErr) return { statusCode: 500, body: upsertErr.message };

    // Save license
    await supabase.from("licenses").insert({
      email,
      plan,
      key: licenseKey,
      status: "active",
      created_at: new Date().toISOString(),
    });

    // Affiliate payout tracking
    if (affiliateCode) {
      // Example: 20% commission
      const commission = Math.round((session.amount_total || 0) * 0.2) / 100;
      await supabase.from("affiliate_events").insert({
        affiliate_code: affiliateCode,
        email,
        plan,
        amount: (session.amount_total || 0) / 100,
        commission,
        stripe_session_id: session.id,
        created_at: new Date().toISOString(),
      });
    }

    // Email delivery (Resend example docs) :contentReference[oaicite:2]{index=2}
    await resend.emails.send({
      from: "TechForge <licenses@yourdomain.com>",
      to: [email],
      subject: "Your TechForge License + Downloads",
      html: `
        <h2>You're activated 🎉</h2>
        <p><b>Plan:</b> ${plan}</p>
        <p><b>License Key:</b> ${licenseKey}</p>
        <p>Downloads:</p>
        <ul>
          <li><a href="${process.env.PUBLIC_DOWNLOAD_BASE}/download?template=saas&license=${licenseKey}">SaaS Landing</a></li>
          <li><a href="${process.env.PUBLIC_DOWNLOAD_BASE}/download?template=ai&license=${licenseKey}">AI Startup</a></li>
          <li><a href="${process.env.PUBLIC_DOWNLOAD_BASE}/download?template=agency&license=${licenseKey}">Agency Suite</a></li>
        </ul>
      `,
    });

    return { statusCode: 200, body: "ok" };
  }

  return { statusCode: 200, body: "ignored" };
};
