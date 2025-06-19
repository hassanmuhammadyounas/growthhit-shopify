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

// Custom session storage wrapper with logging
class LoggedPrismaSessionStorage extends PrismaSessionStorage {
  constructor(prisma) {
    super(prisma);
    this.prisma = prisma;
  }

  async storeSession(session) {
    const start = Date.now();
    console.log("[session] Storing session", { 
      shop: session.shop, 
      isOnline: session.isOnline 
    });
    
    try {
      const result = await super.storeSession(session);
      console.log("[session] Session stored successfully", { 
        shop: session.shop,
        duration: `${Date.now() - start}ms`
      });
      return result;
    } catch (error) {
      console.error("[session] Failed to store session", {
        shop: session.shop,
        duration: `${Date.now() - start}ms`,
        error: error.message
      });
      throw error;
    }
  }

  async loadSession(id) {
    const start = Date.now();
    console.log("[session] Loading session", { sessionId: id });
    
    try {
      const result = await super.loadSession(id);
      console.log("[session] Session loaded", { 
        sessionId: id,
        found: !!result,
        shop: result?.shop,
        duration: `${Date.now() - start}ms`
      });
      return result;
    } catch (error) {
      console.error("[session] Failed to load session", {
        sessionId: id,
        duration: `${Date.now() - start}ms`,
        error: error.message
      });
      throw error;
    }
  }

  async deleteSession(id) {
    const start = Date.now();
    console.log("[session] Deleting session", { sessionId: id });
    
    try {
      const result = await super.deleteSession(id);
      console.log("[session] Session deleted", { 
        sessionId: id,
        duration: `${Date.now() - start}ms`
      });
      return result;
    } catch (error) {
      console.error("[session] Failed to delete session", {
        sessionId: id,
        duration: `${Date.now() - start}ms`,
        error: error.message
      });
      throw error;
    }
  }
}

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
  sessionStorage: new LoggedPrismaSessionStorage(prisma),
  isEmbeddedApp: true,
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: false,
    removeRest: true,
  },
  hooks: {
    afterAuth: async ({ session }) => {
      console.log("[shopify] Session created/updated", { 
        shop: session.shop, 
        isOnline: session.isOnline 
      });
    },
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

// Simple rate limiter for authentication attempts
const authAttempts = new Map();

// Helper that wraps authenticate.admin with timing logs
export async function authWithLog(request) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const sessionToken = url.searchParams.get('id_token');
  const shop = url.searchParams.get('shop');
  
  // Create a unique key for this authentication attempt
  const authKey = `${shop}-${sessionToken?.slice(-8) || 'no-token'}`;
  
  console.log("[auth] Starting authenticate.admin...", { 
    path: url.pathname,
    shop,
    authKey,
    hasSessionToken: !!sessionToken,
    embedded: url.searchParams.get('embedded'),
    host: url.searchParams.get('host')
  });
  
  // Check if there's already an auth attempt in progress for this shop
  if (authAttempts.has(authKey)) {
    console.log("[auth] Authentication already in progress, waiting...", { authKey });
    try {
      const result = await authAttempts.get(authKey);
      console.log("[auth] Used cached authentication result", { 
        authKey,
        shop: result?.session?.shop,
        ms: Date.now() - t0
      });
      return result;
    } catch (error) {
      console.log("[auth] Cached authentication failed, will retry", { authKey, error: error.message });
      authAttempts.delete(authKey);
    }
  }
  
  try {
    console.log("[auth] Calling authenticate.admin...", { authKey });
    
    // Store the promise to prevent concurrent calls
    const authPromise = authenticate.admin(request);
    authAttempts.set(authKey, authPromise);
    
    const result = await authPromise;
    
    console.log("[auth] authenticate.admin finished", {
      ms: Date.now() - t0,
      path: url.pathname,
      shop: result?.session?.shop || null,
      isOnline: result?.session?.isOnline || null,
      authKey
    });
    
    // Clean up the cache after successful auth
    setTimeout(() => authAttempts.delete(authKey), 5000);
    
    return result;
  } catch (error) {
    console.error("[auth] authenticate.admin failed", {
      ms: Date.now() - t0,
      path: url.pathname,
      shop,
      authKey,
      error: error.message,
      stack: error.stack
    });
    
    // Clean up the cache on error
    authAttempts.delete(authKey);
    throw error;
  }
}
