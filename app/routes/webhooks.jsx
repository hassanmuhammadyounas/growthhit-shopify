import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`Received webhook for topic: ${topic}, shop: ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    case "APP_SCOPES_UPDATE":
      if (session && payload && payload.current) {
        await db.session.update({
          where: {
            id: session.id,
          },
          data: {
            scope: payload.current.toString(),
          },
        });
      }
      break;
    default:
      console.log(`Unhandled webhook topic: ${topic}`);
      // Return a 200 OK for unhandled topics to prevent Shopify from retrying.
      break;
  }

  return new Response(null, { status: 200 });
}; 