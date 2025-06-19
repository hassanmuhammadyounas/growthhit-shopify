import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login, authenticate } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const embedded = url.searchParams.get("embedded");
  
  console.log('[_index] Loader called', {
    shop,
    embedded,
    url: request.url,
  });

  if (shop) {
    try {
      // Try to authenticate - if session exists, redirect to app
      const { session } = await authenticate.admin(request);
      
      if (session) {
        console.log('[_index] Valid session found, redirecting to app', {
          shop: session.shop,
          sessionId: session.id
        });
        
        // Preserve all query params when redirecting
        return redirect(`/app?${url.searchParams.toString()}`);
      }
    } catch (error) {
      // No valid session, proceed with login
      console.log('[_index] No valid session, initiating OAuth flow', {
        shop,
        error: error.message
      });
    }

    // Initiate OAuth flow
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