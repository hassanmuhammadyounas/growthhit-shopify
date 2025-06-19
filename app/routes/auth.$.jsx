import { authWithLog } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useRouteError } from "@remix-run/react";

export const loader = async ({ request }) => {
  await authWithLog(request);

  return null;
};

// Shopify App Bridge error boundary to handle redirects outside iframe
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

// Shopify App Bridge headers to set required headers for embedded contexts
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
