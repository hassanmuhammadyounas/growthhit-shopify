import { json } from "@remix-run/node";
import prisma from "../db.server";

export const action = async ({ request }) => {
  try {
    const { sessionToken, shop } = await request.json();
    if (!sessionToken || !shop) {
      return json({ ok: false, message: "Missing sessionToken or shop" }, { status: 400 });
    }

    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type:
          "urn:shopify:params:oauth:token-type:offline-access-token",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return json({ ok: false, message: "Token exchange failed", error: err }, { status: 500 });
    }

    const tokenJson = await tokenRes.json();
    const offlineToken = tokenJson.access_token;
    if (!offlineToken) {
      return json({ ok: false, message: "No access_token returned" }, { status: 500 });
    }

    const sessionId = `${shop}_offline`;

    await prisma.session.upsert({
      where: { id: sessionId },
      update: {
        accessToken: offlineToken,
        isOnline: false,
        scope: tokenJson.scope || null,
        expires: null,
      },
      create: {
        id: sessionId,
        shop,
        state: "offline",
        isOnline: false,
        accessToken: offlineToken,
        scope: tokenJson.scope || null,
      },
    });

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, message: error.message }, { status: 500 });
  }
}; 