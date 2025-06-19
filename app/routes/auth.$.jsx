import { authWithLog } from "../shopify.server";

export const loader = async ({ request }) => {
  await authWithLog(request);

  return null;
};
