import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authWithLog } from "../shopify.server";
import { checkDatabaseHealth } from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const startTime = Date.now();
  
  try {
    // Check database health first
    const dbHealth = await Promise.race([
      checkDatabaseHealth(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database health check timeout')), 5000)
      )
    ]);
    
    if (!dbHealth.healthy) {
      console.warn("[app] Database unhealthy but continuing", { message: dbHealth.message });
    }
    
    const authResult = await authWithLog(request);
    const loadTime = Date.now() - startTime;
    
    console.log("[app] App loader completed", { 
      loadTime: `${loadTime}ms`,
      shop: authResult?.session?.shop,
      dbHealthy: dbHealth.healthy 
    });

    return { 
      apiKey: process.env.SHOPIFY_API_KEY || "",
      dbHealthy: dbHealth.healthy
    };
  } catch (error) {
    const loadTime = Date.now() - startTime;
    console.error("[app] App loader failed", {
      loadTime: `${loadTime}ms`,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

export default function App() {
  const { apiKey, dbHealthy } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {!dbHealthy && (
        <div style={{ 
          backgroundColor: '#ffeaa7', 
          padding: '8px', 
          textAlign: 'center', 
          fontSize: '14px' 
        }}>
          ⚠️ Some features may be limited due to database connectivity issues
        </div>
      )}
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
