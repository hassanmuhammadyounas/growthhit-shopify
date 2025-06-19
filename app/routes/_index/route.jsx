import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useRouteError } from "@remix-run/react";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  console.log('[_index] Loader called', {
    shop,
    embedded: url.searchParams.get("embedded"),
    url: request.url,
  });

  if (shop) {
    // Always trigger OAuth flow for shops without valid sessions
    console.log('[_index] Shop parameter found, initiating OAuth flow');
    throw await login(request);
  }

  // No shop parameter - show marketing page
  return json({ showForm: true });
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>A short heading about [your app]</h1>
        <p className={styles.text}>
          A tagline about [your app] that describes your value proposition.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
          <li>
            <strong>Product feature</strong>. Some detail about your feature and
            its benefit to your customer.
          </li>
        </ul>
      </div>
    </div>
  );
}

// Shopify App Bridge error boundary to handle redirects outside iframe
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

// Shopify App Bridge headers to set required headers for embedded contexts
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};