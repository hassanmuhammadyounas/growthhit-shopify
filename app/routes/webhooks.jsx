import { authenticate } from "../shopify.server";
import db from "../db.server";
import { webhookLogger, logger, Logger } from "../utils/logger.server";

export const action = async ({ request }) => {
  const startTime = Date.now();
  const requestId = Logger.generateRequestId();
  let shop = null;
  let topic = null;

  try {
    const { topic: webhookTopic, shop: webhookShop, session, payload } = await authenticate.webhook(request);
    
    shop = webhookShop;
    topic = webhookTopic;

    await webhookLogger.webhook(topic, shop, false, {
      requestId,
      hasSession: !!session,
      payloadSize: payload ? JSON.stringify(payload).length : 0
    });

    // Store webhook event in database
    const webhookEvent = await db.webhookEvent.create({
      data: {
        shop,
        topic,
        payload: payload || null,
        processed: false,
        receivedAt: new Date()
      }
    });

    await logger.database("create", "WebhookEvent", shop, {
      requestId,
      webhookEventId: webhookEvent.id,
      topic
    });

    try {
      switch (topic) {
        case "APP_UNINSTALLED":
          await handleAppUninstalled(shop, session, requestId);
          break;
          
        case "APP_SCOPES_UPDATE":
          await handleAppScopesUpdate(shop, session, payload, requestId);
          break;
          
        default:
          await webhookLogger.warn(`Unhandled webhook topic: ${topic}`, {
            requestId,
            shop,
            topic
          });
          break;
      }

      // Mark webhook as processed
      await db.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          processedAt: new Date()
        }
      });

      await webhookLogger.webhook(topic, shop, true, {
        requestId,
        processingTime: Date.now() - startTime
      });

    } catch (processingError) {
      // Mark webhook as failed
      await db.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: false,
          processingError: processingError.message,
          processedAt: new Date()
        }
      });

      await webhookLogger.error(`Failed to process webhook ${topic}`, {
        requestId,
        shop,
        error: processingError.message,
        stack: processingError.stack
      });

      // Don't throw - return 200 to prevent Shopify retries for processing errors
    }

    const totalTime = Date.now() - startTime;
    await logger.metric("webhook_processing_time", totalTime, shop, {
      requestId,
      topic
    });

    return new Response(null, { status: 200 });

  } catch (error) {
    await webhookLogger.error("Webhook authentication/parsing failed", {
      requestId,
      error: error.message,
      stack: error.stack,
      shop,
      topic
    });

    // Return 200 even for auth errors to prevent retries
    return new Response(null, { status: 200 });
  }
};

/**
 * Handle app uninstalled webhook
 */
async function handleAppUninstalled(shop, session, requestId) {
  await webhookLogger.info("Processing app uninstalled", {
    requestId,
    shop,
    hasSession: !!session
  });

  if (session) {
    // Delete all sessions for this shop
    const deletedSessions = await db.session.deleteMany({ 
      where: { shop } 
    });

    await logger.database("deleteMany", "Session", shop, {
      requestId,
      deletedCount: deletedSessions.count
    });

    // Update Airbyte connection status
    await db.airbyteConnection.updateMany({
      where: { shop },
      data: {
        status: "disconnected",
        updatedAt: new Date()
      }
    });

    await logger.database("updateMany", "AirbyteConnection", shop, {
      requestId,
      status: "disconnected"
    });

    await logger.metric("app_uninstalls", 1, shop, { requestId });
  }

  await webhookLogger.info("App uninstalled processed successfully", {
    requestId,
    shop
  });
}

/**
 * Handle app scopes update webhook
 */
async function handleAppScopesUpdate(shop, session, payload, requestId) {
  await webhookLogger.info("Processing app scopes update", {
    requestId,
    shop,
    hasSession: !!session,
    hasPayload: !!payload,
    currentScopes: payload?.current
  });

  if (session && payload && payload.current) {
    const updatedSession = await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: payload.current.toString(),
        updatedAt: new Date()
      },
    });

    await logger.database("update", "Session", shop, {
      requestId,
      sessionId: session.id,
      newScopes: payload.current.toString()
    });

    await logger.metric("scope_updates", 1, shop, { requestId });
  } else {
    await webhookLogger.warn("App scopes update missing required data", {
      requestId,
      shop,
      hasSession: !!session,
      hasPayload: !!payload,
      hasCurrent: !!(payload?.current)
    });
  }

  await webhookLogger.info("App scopes update processed successfully", {
    requestId,
    shop
  });
} 