import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { restResources } from "@shopify/shopify-api/rest/admin/2023-04";
import prisma from "./db.server";
import { LogSeverity } from "@shopify/shopify-api";



// Validate required environment variables
const requiredEnvVars = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
  SCOPES: process.env.SCOPES
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error("❌ Missing required environment variables:", missingVars);
  console.log("Current env vars:", {
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? "✅ Set" : "❌ Missing",
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? "✅ Set" : "❌ Missing", 
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || "❌ Missing",
    SCOPES: process.env.SCOPES || "❌ Missing"
  });
} else {
  console.log("✅ All required environment variables are set");
  console.log("App URL:", process.env.SHOPIFY_APP_URL);
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  isEmbeddedApp: true,
  distribution: AppDistribution.AppStore,
  logger: { level: LogSeverity.Debug },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

// Helper that wraps authenticate.admin with timing logs
export async function authWithLog(request) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  console.log("[auth] Starting authenticate.admin...", { 
    path: url.pathname,
    shop: shop,
    hasIdToken: !!url.searchParams.get('id_token'),
    hasSession: !!url.searchParams.get('session'),
    hasHmac: !!url.searchParams.get('hmac')
  });
  
  try {
    // For Vercel deployments, use shorter timeout to prevent function timeout
    const VERCEL_SAFE_TIMEOUT = 45000; // 45 seconds (well under Vercel's 90s limit)
    
    const authPromise = authenticate.admin(request);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`OAuth timeout after ${VERCEL_SAFE_TIMEOUT/1000}s. For new stores, please install using 'shopify app dev' locally first, then redeploy. This avoids Vercel serverless timeout issues during initial OAuth.`));
      }, VERCEL_SAFE_TIMEOUT);
    });
    
    // Race between auth and timeout
    const result = await Promise.race([authPromise, timeoutPromise]);
    
    console.log("[auth] authenticate.admin finished successfully", {
      totalTime: Date.now() - t0,
      path: url.pathname,
      shop: result?.session?.shop || shop,
    });
    
    return result;
  } catch (error) {
    const elapsed = Date.now() - t0;
    
    console.error("[auth] authenticate.admin failed", {
      totalTime: elapsed,
      path: url.pathname,
      shop,
      error: error.message,
      errorType: error.constructor.name
    });
    
    // Provide helpful error messages for common OAuth issues
    if (error.message.includes('timeout') || elapsed > 40000) {
      console.error("[auth] OAUTH TIMEOUT - VERCEL DEPLOYMENT ISSUE", {
        shop,
        elapsed,
        solution: "Install app locally first: 'shopify app dev', then deploy",
        documentation: "https://community.shopify.dev/t/shopify-app-authorization-gets-stuck-in-an-infinite-redirect/12592"
      });
      
      // Throw a more user-friendly error
      throw new Error(`OAuth installation timed out. This is a known issue with Vercel deployments. Please install the app locally using 'shopify app dev' first, then redeploy to production.`);
    }
    
    throw error;
  }
}
