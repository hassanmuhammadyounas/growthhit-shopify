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
  useOnlineTokens: true,
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

// Helper around authenticate.admin with lightweight logging (no custom timeout)
export async function authWithLog(request) {
  const t0 = Date.now();
  const url = new URL(request.url);
  try {
    const result = await authenticate.admin(request);
    console.log("[auth] authenticate.admin finished", {
      path: url.pathname,
      shop: result?.session?.shop,
      ms: Date.now() - t0,
    });
    return result;
  } catch (error) {
    console.error("[auth] authenticate.admin failed", {
      path: url.pathname,
      error: error.message,
    });
    throw error;
  }
}
