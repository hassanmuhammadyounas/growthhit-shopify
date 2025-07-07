import { authenticate } from "../shopify.server";
import { registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Ensure mandatory compliance webhooks are registered (app/uninstalled, app/scopes_update)
  // If they already exist, registerWebhooks is a no-op.
  await registerWebhooks({ session });

  return null;
};
