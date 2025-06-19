/** app/routes/app._index.jsx **/

import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page, Card, Text, Button, Banner, Spinner, Badge, Layout, Box, Divider
} from "@shopify/polaris";
import { authWithLog, unauthenticated } from "../shopify.server"; // ✅ Import unauthenticated helper
import prisma from "../db.server";
import { logger, airbyteLogger, Logger } from "../utils/logger.server";

export const loader = async ({ request }) => {
  const startTime = Date.now();
  const requestId = Logger.generateRequestId();
  let shop = null;

  try {
    const { session } = await authWithLog(request);
    shop = session.shop;
    console.log("[loader] /app index", { url: request.url, shop: session.shop });

    await logger.info("App index loaded", { requestId, shop, userAgent: request.headers.get("user-agent") }, request, shop);

    // **Determine the correct token to use**
    let offlineToken = session.accessToken;
    if (session.isOnline) {
      // If an online (session) token is present, retrieve the offline token for the shop
      const { session: offlineSession } = await unauthenticated.admin(session.shop);
      if (offlineSession?.accessToken) {
        offlineToken = offlineSession.accessToken;
      }
    }

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
      // ✅ Use offlineToken instead of session.accessToken
      airbyteResp = await fetch(AIRBYTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: session.shop,
          api_password: offlineToken,    // <-- offline API token for the store
        }),
      });
      console.log("[STATUS_CHECK] Response received", { requestId, shop: session.shop, status: airbyteResp.status, ok: airbyteResp.ok, duration: Date.now() - apiStart });
      await logger.info("Airbyte status check response received", { requestId, shop: session.shop, status: airbyteResp.status, ok: airbyteResp.ok, duration: Date.now() - apiStart });
    } catch (error) {
      fetchError = error;
      console.error("[STATUS_CHECK] Fetch failed", { requestId, shop: session.shop, error: error.message, duration: Date.now() - apiStart });
      await logger.error("Airbyte status check fetch failed", { requestId, shop: session.shop, error: error.message, stack: error.stack, duration: Date.now() - apiStart });
    }

    // ... (process response JSON into `status` and `connectionPayload` as before) ...

    // Persist status to DB (upsert AirbyteConnection) ...
    // Log page load metrics ...

    return json({
      shop: session.shop,
      // 🔒 **Removed** accessToken from response for security
      connectionStatus: status,
      connectionData: connectionPayload,
    });
  } catch (error) {
    await logger.error("Failed to load app index", { requestId, shop, error: error.message, stack: error.stack }, request, shop);
    throw error;
  }
};

export const action = async ({ request }) => {
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

        // **Determine the correct token to use**
        let offlineToken = session.accessToken;
        if (session.isOnline) {
          const { session: offlineSession } = await unauthenticated.admin(session.shop);
          if (offlineSession?.accessToken) {
            offlineToken = offlineSession.accessToken;
          }
        }

        console.log("[CONNECT] Calling Airbyte Handler API", { requestId, shop, endpoint: AIRBYTE_URL });
        await airbyteLogger.info("Calling Airbyte Handler API", { requestId, shop, endpoint: AIRBYTE_URL });
        const apiStartTime = Date.now();
        // ✅ Use offlineToken for the connect request
        const response = await fetch(AIRBYTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: session.shop,
            api_password: offlineToken,   // <-- offline API token used here
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
  const { shop, connectionStatus: dbConnectionStatus, connectionData } = useLoaderData();  {/* 🔒 Removed accessToken from loader data */}
  const actionData = useActionData();
  const navigation = useNavigation();
  // ... (UI rendering logic unchanged) ...
}
