// netlify/functions/create-checkout.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICE_MAP = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const { plan, user_id, email, ref } = body;

    if (!PRICE_MAP[plan]) return { statusCode: 400, body: "Invalid plan" };
    if (!user_id || !email) return { statusCode: 400, body: "Missing user" };

    // Ensure profile exists
    await supabaseAdmin.from("profiles").upsert({
      user_id,
      email,
      updated_at: new Date().toISOString()
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: PRICE_MAP[plan], quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.PUBLIC_SITE_URL}/?success=1`,
      cancel_url: `${process.env.PUBLIC_SITE_URL}/?canceled=1`,
      metadata: {
        plan,
        user_id,
        ref: ref || ""
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
