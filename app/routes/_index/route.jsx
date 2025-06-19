import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login, sessionStorage } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  console.log('[_index] loader called', { url: request.url, searchParams: url.searchParams.toString() });

  const shop = url.searchParams.get("shop");

  if (shop) {
    // Check if the app is already installed by looking for an offline session.
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);
    
    // If a session exists, the app is installed. Redirect to the app's main page.
    if (session) {
      console.log('[_index] Found existing session, redirecting to /app');
      // The search params are preserved to carry over the `host` and other Shopify data.
      throw redirect(`/app?${url.searchParams.toString()}`);
    } else {
      // No session found, this is a new install.
      // Trigger the OAuth flow, which will throw a redirect response.
      console.log('[_index] No session found, redirecting to login to start OAuth flow...');
      await login(request);
      
      // This line is technically unreachable because login() always throws a redirect.
      return null;
    }
  }

  // For requests that don't have a shop param, we show the main marketing page with a login form.
  return { showForm: Boolean(login) };
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
