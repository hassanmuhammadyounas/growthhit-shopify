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

// Create a debugging wrapper for PrismaSessionStorage
class DebuggingPrismaSessionStorage extends PrismaSessionStorage {
  constructor(prisma) {
    super(prisma);
    this.prisma = prisma;
  }

  async storeSession(session) {
    const startTime = Date.now();
    console.log("[session-storage] STORE SESSION START", {
      sessionId: session.id,
      shop: session.shop,
      isOnline: session.isOnline
    });
    
    try {
      const result = await super.storeSession(session);
      console.log("[session-storage] STORE SESSION SUCCESS", {
        sessionId: session.id,
        shop: session.shop,
        duration: Date.now() - startTime
      });
      return result;
    } catch (error) {
      console.error("[session-storage] STORE SESSION FAILED", {
        sessionId: session.id,
        shop: session.shop,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async loadSession(id) {
    const startTime = Date.now();
    console.log("[session-storage] LOAD SESSION START", { sessionId: id });
    
    try {
      const result = await super.loadSession(id);
      console.log("[session-storage] LOAD SESSION SUCCESS", {
        sessionId: id,
        found: !!result,
        shop: result?.shop,
        duration: Date.now() - startTime
      });
      return result;
    } catch (error) {
      console.error("[session-storage] LOAD SESSION FAILED", {
        sessionId: id,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async deleteSession(id) {
    const startTime = Date.now();
    console.log("[session-storage] DELETE SESSION START", { sessionId: id });
    
    try {
      const result = await super.deleteSession(id);
      console.log("[session-storage] DELETE SESSION SUCCESS", {
        sessionId: id,
        duration: Date.now() - startTime
      });
      return result;
    } catch (error) {
      console.error("[session-storage] DELETE SESSION FAILED", {
        sessionId: id,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async deleteSessions(ids) {
    const startTime = Date.now();
    console.log("[session-storage] DELETE SESSIONS START", { 
      sessionIds: ids,
      count: ids.length 
    });
    
    try {
      const result = await super.deleteSessions(ids);
      console.log("[session-storage] DELETE SESSIONS SUCCESS", {
        count: ids.length,
        duration: Date.now() - startTime
      });
      return result;
    } catch (error) {
      console.error("[session-storage] DELETE SESSIONS FAILED", {
        count: ids.length,
        duration: Date.now() - startTime,
        error: error.message
      });
      throw error;
    }
  }

  async findSessionsByShop(shop) {
    const startTime = Date.now();
    console.log("[session-storage] FIND SESSIONS BY SHOP START", { shop });
    
    try {
      const result = await super.findSessionsByShop(shop);
      console.log("[session-storage] FIND SESSIONS BY SHOP SUCCESS", {
        shop,
        count: result.length,
        duration: Date.now() - startTime
      });
      return result;
    } catch (error) {
      console.error("[session-storage] FIND SESSIONS BY SHOP FAILED", {
        shop,
        duration: Date.now() - startTime,
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
  sessionStorage: new DebuggingPrismaSessionStorage(prisma),
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
    hasHmac: !!url.searchParams.get('hmac'),
    searchParams: url.searchParams.toString()
  });
  
  try {
    // Add detailed step-by-step logging
    let stepTimer = Date.now();
    
    console.log("[auth] STEP 1: About to call authenticate.admin", {
      elapsed: Date.now() - t0,
      shop
    });
    
    // Add periodic logging during long OAuth processes
    const timeoutId = setInterval(() => {
      console.log("[auth] Still processing authenticate.admin...", {
        elapsed: Date.now() - t0,
        path: url.pathname,
        shop
      });
    }, 5000); // Log every 5 seconds
    
    // Test database connectivity before OAuth
    console.log("[auth] STEP 2: Testing database connectivity", {
      elapsed: Date.now() - t0,
      shop
    });
    
    try {
      await prisma.$queryRaw`SELECT 1 as test`;
      console.log("[auth] STEP 2: Database connectivity OK", {
        elapsed: Date.now() - t0,
        dbTime: Date.now() - stepTimer,
        shop
      });
    } catch (dbError) {
      console.error("[auth] STEP 2: Database connectivity FAILED", {
        elapsed: Date.now() - t0,
        error: dbError.message,
        shop
      });
    }
    
    stepTimer = Date.now();
    console.log("[auth] STEP 3: Calling Shopify authenticate.admin", {
      elapsed: Date.now() - t0,
      shop
    });
    
    // Directly call Shopify's authenticate.admin
    const result = await authenticate.admin(request);
    
    clearInterval(timeoutId);
    
    console.log("[auth] STEP 4: authenticate.admin completed successfully", {
      elapsed: Date.now() - t0,
      authTime: Date.now() - stepTimer,
      shop: result?.session?.shop || shop,
      hasSession: !!result?.session,
      sessionId: result?.session?.id,
      isOnline: result?.session?.isOnline
    });
    
    // Test session storage after OAuth
    if (result?.session) {
      stepTimer = Date.now();
      console.log("[auth] STEP 5: Testing session storage after OAuth", {
        elapsed: Date.now() - t0,
        shop: result.session.shop
      });
      
      try {
        const storedSession = await sessionStorage.loadSession(result.session.id);
        console.log("[auth] STEP 5: Session storage test OK", {
          elapsed: Date.now() - t0,
          storageTime: Date.now() - stepTimer,
          hasStoredSession: !!storedSession,
          shop: result.session.shop
        });
      } catch (storageError) {
        console.error("[auth] STEP 5: Session storage test FAILED", {
          elapsed: Date.now() - t0,
          error: storageError.message,
          shop: result.session.shop
        });
      }
    }
    
    console.log("[auth] authenticate.admin finished successfully", {
      totalTime: Date.now() - t0,
      path: url.pathname,
      shop: result?.session?.shop || shop,
    });
    
    return result;
  } catch (error) {
    clearInterval(timeoutId);
    
    console.error("[auth] authenticate.admin failed", {
      totalTime: Date.now() - t0,
      path: url.pathname,
      shop,
      error: error.message,
      errorType: error.constructor.name,
      stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
    });
    
    // Additional error context
    if (error.message.includes('timeout')) {
      console.error("[auth] TIMEOUT ERROR DETAILS", {
        shop,
        elapsed: Date.now() - t0,
        errorMessage: error.message,
        possibleCauses: [
          'Database connection slow/hanging',
          'Shopify API timeout',
          'Session storage timeout',
          'Network connectivity issues'
        ]
      });
    }
    
    if (error.message.includes('database') || error.message.includes('prisma')) {
      console.error("[auth] DATABASE ERROR DETAILS", {
        shop,
        elapsed: Date.now() - t0,
        errorMessage: error.message,
        possibleCauses: [
          'Database connection pool exhausted',
          'Long-running query',
          'Database server overloaded'
        ]
      });
    }
    
    throw error;
  }
}
