/** app/routes/app._index.jsx **/

import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page, Card, Text, Button, Banner, Spinner, Badge, Layout, Box, Divider
} from "@shopify/polaris";
// Server-only modules must be imported dynamically inside loaders/actions so they don't end up in the client bundle

// Airbyte API endpoint
const AIRBYTE_URL = process.env.AIRBYTE_API_URL || "https://your-airbyte-handler.com/api";

export const loader = async ({ request }) => {
  const [{ Logger, logger, airbyteLogger }] = await Promise.all([
    import("../utils/logger.server")
  ]);
  const { authWithLog, unauthenticated } = await import("../shopify.server");
  const prisma = (await import("../db.server")).default;

  const startTime = Date.now();
  const requestId = Logger.generateRequestId();
  let shop = null;

  try {
    const { session } = await authWithLog(request);
    shop = session.shop;
    console.log("[loader] /app index", { url: request.url, shop: session.shop });

    await logger.info("App index loaded", { requestId, shop, userAgent: request.headers.get("user-agent") }, request, shop);

    // Use online session token for page loads - offline tokens only used when explicitly connecting
    const accessToken = session.accessToken;

    /* ------------------------------------------------------------------
       Call the Airbyte handler to determine current connection status   
       (If a connection already exists, this returns saved IDs instead of creating new.)
    ------------------------------------------------------------------*/
    console.log("[STATUS_CHECK] Starting Airbyte status check", { requestId, shop: session.shop, endpoint: AIRBYTE_URL });
    await logger.info("Starting Airbyte status check", { requestId, shop: session.shop, endpoint: AIRBYTE_URL });

    let airbyteResp;
    let fetchError;
    const apiStart = Date.now();
    try {
      // Use online token for status checks - only use offline tokens for actual connections
      airbyteResp = await fetch(AIRBYTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: session.shop,
          api_password: accessToken,    // <-- using online token for status checks
        }),
      });
      console.log("[STATUS_CHECK] Response received", { requestId, shop: session.shop, status: airbyteResp.status, ok: airbyteResp.ok, duration: Date.now() - apiStart });
      await logger.info("Airbyte status check response received", { requestId, shop: session.shop, status: airbyteResp.status, ok: airbyteResp.ok, duration: Date.now() - apiStart });
    } catch (error) {
      fetchError = error;
      console.error("[STATUS_CHECK] Fetch failed", { requestId, shop: session.shop, error: error.message, duration: Date.now() - apiStart });
      await logger.error("Airbyte status check fetch failed", { requestId, shop: session.shop, error: error.message, stack: error.stack, duration: Date.now() - apiStart });
    }

    // Process response JSON into status and connectionPayload
    let status = "disconnected";
    let connectionPayload = null;
    
    if (airbyteResp && airbyteResp.ok) {
      try {
        const responseData = await airbyteResp.json();
        status = responseData.status || "connected";
        connectionPayload = responseData;
      } catch (error) {
        console.error("[STATUS_CHECK] Failed to parse response JSON", { requestId, shop: session.shop, error: error.message });
        await logger.error("Failed to parse Airbyte response JSON", { requestId, shop: session.shop, error: error.message });
      }
    } else if (fetchError) {
      status = "failed";
    }

    // Persist status to DB (upsert AirbyteConnection)
    await prisma.airbyteConnection.upsert({
      where: { shop: session.shop },
      update: { 
        status,
        errorMessage: fetchError?.message || null,
        updatedAt: new Date()
      },
      create: { 
        shop: session.shop, 
        status,
        errorMessage: fetchError?.message || null
      }
    });

    // Log page load metrics
    await logger.metric("page_loads", 1, shop, { requestId, duration: Date.now() - startTime });

    return json({
      shop: session.shop,
      connectionStatus: status,
      connectionData: connectionPayload,
      apiKey: process.env.SHOPIFY_API_KEY,
    });
  } catch (error) {
    await logger.error("Failed to load app index", { requestId, shop, error: error.message, stack: error.stack }, request, shop);
    throw error;
  }
};

export const action = async ({ request }) => {
  const [{ Logger, logger, airbyteLogger }] = await Promise.all([
    import("../utils/logger.server")
  ]);
  const { authWithLog, unauthenticated } = await import("../shopify.server");
  const prisma = (await import("../db.server")).default;

  const startTime = Date.now();
  const requestId = Logger.generateRequestId();
  let shop = null;

  try {
    const { session } = await authWithLog(request);
    shop = session.shop;
    const formData = await request.formData();
    const actionType = formData.get("action");

    await logger.info("Action triggered", { requestId, action: actionType, shop }, request, shop);

    if (actionType === "connect" || actionType === "reconnect") {
      try {
        await airbyteLogger.airbyteOperation("connection_attempt", shop, "starting", { requestId, action: actionType });
        // Mark status "connecting" in DB
        await prisma.airbyteConnection.upsert({
          where: { shop: session.shop },
          update: { status: "connecting", errorMessage: null, updatedAt: new Date() },
          create: { shop: session.shop, status: "connecting" }
        });
        await logger.database("upsert", "AirbyteConnection", shop, { requestId, status: "connecting" });

        // Load offline token from DB - must exist from previous /api/exchange-token call
        const offlineRec = await prisma.session.findFirst({ 
          where: { shop: session.shop, isOnline: false } 
        });
        
        if (!offlineRec?.accessToken) {
          // No offline token found - user must click Connect button first
          return json({ 
            success: false, 
            message: "Offline access token not found. Please use the Connect button to authorize background access." 
          });
        }

        const offlineToken = offlineRec.accessToken;

        console.log("[CONNECT] Calling Airbyte Handler API", { requestId, shop, endpoint: AIRBYTE_URL });
        await airbyteLogger.info("Calling Airbyte Handler API", { requestId, shop, endpoint: AIRBYTE_URL });
        const apiStartTime = Date.now();
        // Use offline token for the connection request (long-lived background access)
        const response = await fetch(AIRBYTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: session.shop,
            api_password: offlineToken,   // <-- offline API token for background operations
          }),
        });
        const apiDuration = Date.now() - apiStartTime;
        const result = await response.json();
        await logger.apiCall("POST", "airbyte-handler", response.status, apiDuration, shop, { requestId, resultKeys: Object.keys(result) });

        if (response.ok) {
          // On success, save connection details to DB...
          await prisma.airbyteConnection.upsert({
            where: { shop: session.shop },
            update: {
              status: "connected",
              connectionId: result.connection_id,
              sourceId: result.source_id,
              destinationId: result.destination_id,
              jobId: result.job_id,
              errorMessage: null,
              lastSyncAt: new Date(),
              syncCount: ((await prisma.airbyteConnection.findUnique({ where: { shop: session.shop } }))?.syncCount || 0) + 1,
              updatedAt: new Date()
            },
            create: {
              shop: session.shop,
              status: "connected",
              connectionId: result.connection_id,
              sourceId: result.source_id,
              destinationId: result.destination_id,
              jobId: result.job_id,
              lastSyncAt: new Date(),
              syncCount: 1,
            }
          });
          await airbyteLogger.airbyteOperation("connection_attempt", shop, "connected", { requestId, connectionId: result.connection_id, duration: Date.now() - startTime });
          await logger.metric("successful_connections", 1, shop, { requestId });
          return json({ success: true, message: "Successfully connected to Airbyte!", data: result });
        } else {
          // On failure, mark status failed and log error...
          await prisma.airbyteConnection.upsert({
            where: { shop: session.shop },
            update: { status: "failed", errorMessage: result.message || "Failed to connect to Airbyte", updatedAt: new Date() },
            create: { shop: session.shop, status: "failed", errorMessage: result.message || "Failed to connect to Airbyte" }
          });
          await airbyteLogger.airbyteOperation("connection_attempt", shop, "failed", { requestId, error: result.message, apiStatus: response.status });
          await logger.metric("failed_connections", 1, shop, { requestId });
          return json({ success: false, message: result.message || "Failed to connect to Airbyte", error: result.error });
        }
      } catch (error) {
        // Network or unexpected error during connect
        await prisma.airbyteConnection.upsert({
          where: { shop: session.shop },
          update: { status: "failed", errorMessage: "Network error occurred while connecting to GrowthHit Dashboard", updatedAt: new Date() },
          create: { shop: session.shop, status: "failed", errorMessage: "Network error occurred while connecting to GrowthHit Dashboard" }
        });
        await airbyteLogger.error("Connection attempt failed", { requestId, shop, error: error.message, stack: error.stack });
        await logger.metric("connection_errors", 1, shop, { requestId });
        return json({ success: false, message: "Network error occurred while connecting to GrowthHit Dashboard", error: error.message });
      }
    }

    // If action is not recognized
    await logger.warn("Invalid action received", { requestId, action: actionType, shop });
    return json({ success: false, message: "Invalid action" });
  } catch (error) {
    await logger.error("Action failed", { requestId, shop, error: error.message, stack: error.stack }, request, shop);
    throw error;
  }
};

export default function Index() {
  const { shop, connectionStatus: dbConnectionStatus, connectionData, apiKey } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  // Connect button handler (client-side only)
  const handleConnect = async (e) => {
    e.preventDefault();
    if (typeof window === "undefined") return;
    
    try {
      const [{ default: createApp }, { getSessionToken }] = await Promise.all([
        import(/* @vite-ignore */ "@shopify/app-bridge"),
        import(/* @vite-ignore */ "@shopify/app-bridge/utilities"),
      ]);
      
      const app = createApp({
        apiKey,
        host: new URLSearchParams(window.location.search).get("host"),
      });
      
      const sessionToken = await getSessionToken(app);
      
      // Exchange session token for offline access token
      const response = await fetch("/api/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, shop }),
      });
      
      const result = await response.json();
      if (!result.ok) {
        console.error("Failed to get offline access token:", result.message);
        // You might want to show user-friendly error here
        return;
      }
      
      console.log("Successfully obtained offline access token");
      
      // After token stored successfully, submit the hidden connect form
      document.getElementById("connectForm").submit();
    } catch (error) {
      console.error("Error in handleConnect:", error);
      // You might want to show user-friendly error here
    }
  };

  return (
    <Page>
      {/* existing UI ... */}
      <Form method="post" id="connectForm">
        <input type="hidden" name="action" value="connect" />
        <Button primary onClick={handleConnect}>Connect</Button>
      </Form>
    </Page>
  );
}
