import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { login, authWithLog } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  console.log('[_index] loader called', { url: request.url, searchParams: url.searchParams.toString() });

  if (url.searchParams.get("shop")) {
    console.log('[_index] shop param found, attempting auth...');
    try {
      // Try to authenticate first
      await authWithLog(request);
      console.log('[_index] auth successful, redirecting to /app');
      throw redirect(`/app?${url.searchParams.toString()}`);
    } catch (error) {
      if (error instanceof Response) {
        // This is a redirect response from authentication
        console.log('[_index] auth returned redirect, following it');
        throw error;
      }
      console.error('[_index] auth failed:', error);
      // If auth fails, still show the form
    }
  }

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
