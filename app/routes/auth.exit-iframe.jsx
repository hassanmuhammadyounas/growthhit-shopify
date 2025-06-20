import { boundary } from "@shopify/shopify-app-remix/server";
import { useRouteError } from "@remix-run/react";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const exitIframe = url.searchParams.get("exitIframe");
  
  if (exitIframe) {
    // Redirect to the destination URL
    return new Response(null, {
      status: 302,
      headers: {
        Location: exitIframe,
        "X-Frame-Options": "DENY",
      },
    });
  }
  
  // If no exitIframe parameter, redirect to root
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
    },
  });
};

// Shopify App Bridge error boundary to handle redirects outside iframe
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

// Shopify App Bridge headers to set required headers for embedded contexts
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
}; 