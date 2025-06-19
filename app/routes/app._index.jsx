import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Button,
  Banner,
  Spinner,
  Badge,
  Layout,
  Box,
  Divider,
} from "@shopify/polaris";
import { authWithLog } from "../shopify.server";
import prisma from "../db.server";
import { logger, airbyteLogger, Logger } from "../utils/logger.server";

export const loader = async ({ request }) => {
  const startTime = Date.now();
  const requestId = Logger.generateRequestId();
  let shop = null;

  try {
    const { session } = await authWithLog(request);
    shop = session.shop;
    console.log('[loader] /app index', { url: request.url, shop: session.shop });

    await logger.info("App index loaded", { 
      requestId,
      shop,
      userAgent: request.headers.get("user-agent")
    }, request, shop);

    /* ------------------------------------------------------------------
       Call the Airbyte handler to determine current connection status   
       (If a connection already exists, the function simply returns the 
        saved IDs and doesn't create a new one.)                         
    ------------------------------------------------------------------*/

    // Check Airbyte connection status
    console.log("[STATUS_CHECK] Starting Airbyte status check", {
      requestId,
      shop: session.shop,
      endpoint: "https://us-central1-growthhit-7be7b.cloudfunctions.net/airbyte-handler"
    });
    
    await logger.info("Starting Airbyte status check", {
      requestId,
      shop: session.shop,
      endpoint: "https://us-central1-growthhit-7be7b.cloudfunctions.net/airbyte-handler"
    });

    const apiStart = Date.now();
    let airbyteResp = null;
    let fetchError = null;

    try {
      airbyteResp = await fetch(
        "https://us-central1-growthhit-7be7b.cloudfunctions.net/airbyte-handler",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop: session.shop,
            api_password: session.accessToken,
          }),
        }
      );
      
             console.log("[STATUS_CHECK] Response received", {
         requestId,
         shop: session.shop,
         status: airbyteResp.status,
         ok: airbyteResp.ok,
         duration: Date.now() - apiStart
       });
       
       await logger.info("Airbyte status check response received", {
         requestId,
         shop: session.shop,
         status: airbyteResp.status,
         ok: airbyteResp.ok,
         duration: Date.now() - apiStart
       });
         } catch (error) {
       fetchError = error;
       console.log("[STATUS_CHECK] Fetch failed", {
         requestId,
         shop: session.shop,
         error: error.message,
         duration: Date.now() - apiStart
       });
       
       await logger.error("Airbyte status check fetch failed", {
         requestId,
         shop: session.shop,
         error: error.message,
         stack: error.stack,
         duration: Date.now() - apiStart
       });
     }

    let status = "ready";
    let connectionPayload = null;

    if (airbyteResp && airbyteResp.ok) {
      try {
        const result = await airbyteResp.json();
        
                 console.log("[STATUS_CHECK] JSON result", {
           requestId,
           shop: session.shop,
           hasConnectionId: !!result?.details?.connection_id,
           hasDetails: !!result?.details,
           resultKeys: Object.keys(result || {}),
           detailsKeys: result?.details ? Object.keys(result.details) : [],
           result: result
         });
         
         await logger.info("Airbyte status check result", {
           requestId,
           shop: session.shop,
           hasConnectionId: !!result?.connection_id,
           resultKeys: Object.keys(result || {}),
           result: result
         });

                 // Check if connection exists - it's nested under 'details'
         if (result?.details?.connection_id) {
           status = "connected";
           connectionPayload = {
             connectionId: result.details.connection_id,
             sourceId: result.details.source_id,
             destinationId: result.details.destination_id,
             jobId: result.details.job_id,
             lastSyncAt: result.details.last_sync_at ? new Date(result.details.last_sync_at) : new Date(),
             syncCount: result.details.sync_count || 1,
           };
           
           console.log("[STATUS_CHECK] Connection detected as CONNECTED!", {
             requestId,
             shop: session.shop,
             connectionId: result.details.connection_id,
             syncCount: result.details.sync_count || 1
           });
           
           await logger.info("Connection detected as connected", {
             requestId,
             shop: session.shop,
             connectionId: result.details.connection_id,
             syncCount: result.details.sync_count || 1
           });
         } else {
           console.log("[STATUS_CHECK] No connection_id found in details - status remains ready", {
             requestId,
             shop: session.shop,
             hasDetails: !!result?.details,
             result: result
           });
           
           await logger.info("No connection_id found in response - status remains ready", {
             requestId,
             shop: session.shop,
             result: result
           });
         }
      } catch (jsonError) {
        await logger.error("Failed to parse Airbyte response JSON", {
          requestId,
          shop: session.shop,
          error: jsonError.message,
          responseStatus: airbyteResp.status
        });
        status = "failed";
      }
    } else if (airbyteResp) {
      status = "failed";
      await logger.warn("Airbyte status check returned non-OK response", {
        requestId,
        shop: session.shop,
        status: airbyteResp.status,
        statusText: airbyteResp.statusText
      });
    } else if (fetchError) {
      status = "failed";
      await logger.error("Airbyte status check completely failed", {
        requestId,
        shop: session.shop,
        error: fetchError.message
      });
    }

         console.log("[STATUS_CHECK] Final status determined", {
       requestId,
       shop: session.shop,
       status,
       hasPayload: !!connectionPayload,
       connectionPayload
     });
     
     await logger.info("Final connection status determined", {
       requestId,
       shop: session.shop,
       status,
       hasPayload: !!connectionPayload
     });

    await logger.apiCall(
      "POST",
      "airbyte-handler-status",
      airbyteResp ? airbyteResp.status : 0,
      Date.now() - apiStart,
      shop,
      { requestId, status, fetchError: fetchError?.message }
    );

    // Persist the latest status in DB for reference, ignore errors silently
    try {
      await prisma.airbyteConnection.upsert({
        where: { shop: session.shop },
        update: {
          status,
          connectionId: connectionPayload?.connectionId ?? undefined,
          sourceId: connectionPayload?.sourceId ?? undefined,
          destinationId: connectionPayload?.destinationId ?? undefined,
          jobId: connectionPayload?.jobId ?? undefined,
          lastSyncAt: connectionPayload?.lastSyncAt ?? undefined,
          updatedAt: new Date(),
        },
        create: {
          shop: session.shop,
          status,
          connectionId: connectionPayload?.connectionId,
          sourceId: connectionPayload?.sourceId,
          destinationId: connectionPayload?.destinationId,
          jobId: connectionPayload?.jobId,
          lastSyncAt: connectionPayload?.lastSyncAt,
        },
      });
    } catch (_) {}

    const loadTime = Date.now() - startTime;
    await logger.metric("page_load_time", loadTime, shop, { 
      page: "app_index",
      requestId 
    });

    return json({
      shop: session.shop,
      accessToken: session.accessToken,
      connectionStatus: status,
      connectionData: connectionPayload,
    });
  } catch (error) {
    await logger.error("Failed to load app index", {
      requestId,
      error: error.message,
      stack: error.stack
    }, request, shop);
    
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
    const action = formData.get("action");

    await logger.info("Action triggered", {
      requestId,
      action,
      shop
    }, request, shop);

    if (action === "connect" || action === "reconnect") {
      try {
        await airbyteLogger.airbyteOperation("connection_attempt", shop, "starting", {
          requestId,
          action
        });

        // Update status to connecting
        await prisma.airbyteConnection.upsert({
          where: { shop: session.shop },
          update: { 
            status: "connecting",
            errorMessage: null,
            updatedAt: new Date()
          },
          create: { 
            shop: session.shop,
            status: "connecting"
          }
        });

        await logger.database("upsert", "AirbyteConnection", shop, {
          requestId,
          status: "connecting"
        });

        // Call the Airbyte Handler API
        const apiStartTime = Date.now();
        
        await airbyteLogger.info("Calling Airbyte Handler API", {
          requestId,
          shop,
          endpoint: "https://us-central1-growthhit-7be7b.cloudfunctions.net/airbyte-handler"
        });

        const response = await fetch(
          "https://us-central1-growthhit-7be7b.cloudfunctions.net/airbyte-handler",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              shop: session.shop,
              api_password: session.accessToken,
            }),
          }
        );

        const apiDuration = Date.now() - apiStartTime;
        const result = await response.json();

        await logger.apiCall(
          "POST",
          "airbyte-handler",
          response.status,
          apiDuration,
          shop,
          { requestId, resultKeys: Object.keys(result) }
        );

        if (response.ok) {
          // Update status to connected with details
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
              syncCount: (await prisma.airbyteConnection.findUnique({
                where: { shop: session.shop }
              }))?.syncCount || 0 + 1,
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

          await airbyteLogger.airbyteOperation("connection_attempt", shop, "connected", {
            requestId,
            connectionId: result.connection_id,
            duration: Date.now() - startTime
          });

          await logger.metric("successful_connections", 1, shop, { requestId });

          return json({
            success: true,
            message: "Successfully connected to Airbyte!",
            data: result,
          });
        } else {
          // Update status to failed with error
          await prisma.airbyteConnection.upsert({
            where: { shop: session.shop },
            update: {
              status: "failed",
              errorMessage: result.message || "Failed to connect to Airbyte",
              updatedAt: new Date()
            },
            create: {
              shop: session.shop,
              status: "failed",
              errorMessage: result.message || "Failed to connect to Airbyte",
            }
          });

          await airbyteLogger.airbyteOperation("connection_attempt", shop, "failed", {
            requestId,
            error: result.message,
            apiStatus: response.status
          });

          await logger.metric("failed_connections", 1, shop, { requestId });

          return json({
            success: false,
            message: result.message || "Failed to connect to Airbyte",
            error: result.error,
          });
        }
      } catch (error) {
        // Update status to failed with error
        await prisma.airbyteConnection.upsert({
          where: { shop: session.shop },
          update: {
            status: "failed",
            errorMessage: "Network error occurred while connecting to GrowthHit Dashboard",
            updatedAt: new Date()
          },
          create: {
            shop: session.shop,
            status: "failed",
            errorMessage: "Network error occurred while connecting to GrowthHit Dashboard",
          }
        });

        await airbyteLogger.error("Connection attempt failed", {
          requestId,
          error: error.message,
          stack: error.stack,
          shop
        });

        await logger.metric("connection_errors", 1, shop, { requestId });

        return json({
          success: false,
          message: "Network error occurred while connecting to GrowthHit Dashboard",
          error: error.message,
        });
      }
    }

    await logger.warn("Invalid action received", {
      requestId,
      action,
      shop
    });

    return json({ success: false, message: "Invalid action" });
  } catch (error) {
    await logger.error("Action failed", {
      requestId,
      error: error.message,
      stack: error.stack
    }, request, shop);
    
    throw error;
  }
};

export default function Index() {
  const { shop, accessToken, connectionStatus: dbConnectionStatus, connectionData } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  
  // Enhanced loading state detection
  const isConnecting = navigation.state === "submitting" && 
                      (navigation.formData?.get("action") === "connect" || 
                       navigation.formData?.get("action") === "reconnect");

  // Get connection status - prioritize database status, then action data
  const connectionStatus = isConnecting ? "connecting" : 
                          (actionData?.success === true ? "connected" : 
                           actionData?.success === false ? "failed" : 
                           dbConnectionStatus);

  const getStatusBadge = () => {
    switch (connectionStatus) {
      case "connecting":
        return <Badge status="attention">Connecting...</Badge>;
      case "connected":
        return <Badge status="success">Connected</Badge>;
      case "failed":
        return <Badge status="critical">Connection Failed</Badge>;
      case "ready":
      default:
        return <Badge status="attention">Ready to Connect</Badge>;
    }
  };

  const getStatusMessage = () => {
    if (connectionStatus === "connecting") {
      return "Connecting to GrowthHit Dashboard... This may take a few moments.";
    }
    
    if (connectionStatus === "connected") {
      return `Your Shopify store is successfully connected to GrowthHit Dashboard. Data syncing is active.`;
    }
    
    if (connectionStatus === "failed") {
      const errorMsg = actionData?.message || connectionData?.errorMessage;
      return errorMsg || "Connection to GrowthHit Dashboard failed. Please try again.";
    }
    
    // For "ready" status, return empty string to avoid duplicate text
    return "";
  };

  const getButtonText = () => {
    if (isConnecting) return "Connecting...";
    if (connectionStatus === "connected") return "Reconnect";
    return "Connect to GrowthHit Dashboard";
  };

  const getButtonAction = () => {
    return connectionStatus === "connected" ? "reconnect" : "connect";
  };

  const renderConnectionDetails = () => {
    if (connectionStatus === "connected" && connectionData) {
      return (
        <Card>
          <Text variant="headingMd" as="h3">Connection Details</Text>
          <Box paddingBlockStart="200">
            <Text as="p"><strong>Connection ID:</strong> {connectionData.connectionId}</Text>
            <Text as="p"><strong>Source ID:</strong> {connectionData.sourceId}</Text>
            <Text as="p"><strong>Destination ID:</strong> {connectionData.destinationId}</Text>
            <Text as="p"><strong>Job ID:</strong> {connectionData.jobId}</Text>
            {connectionData.lastSyncAt && (
              <Text as="p"><strong>Last Sync:</strong> {new Date(connectionData.lastSyncAt).toLocaleString()}</Text>
            )}
            {connectionData.syncCount && (
              <Text as="p"><strong>Total Syncs:</strong> {connectionData.syncCount}</Text>
            )}
          </Box>
        </Card>
      );
    }
    return null;
  };

  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Card>
            <Box paddingBlockEnd="200">
              <Text variant="headingLg" as="h2">
                GrowthHit Dashboard Integration
              </Text>
            </Box>
            
            <Box paddingBlockEnd="200">
              <Text as="p">
                Connect your Shopify store with GrowthHit Dashboard, setup will take about 60s to complete.
              </Text>
            </Box>

            <Box paddingBlockEnd="200">
              {getStatusBadge()}
            </Box>

            <Box paddingBlockEnd="400">
              <Text as="p">
                {getStatusMessage()}
              </Text>
            </Box>

            {/* Action Banner */}
            {actionData && actionData.success === false && (
              <Box paddingBlockEnd="400">
                <Banner status="critical">
                  <Text as="p">{actionData.message}</Text>
                  {actionData.error && (
                    <Text as="p" tone="subdued">
                      Technical details: {actionData.error}
                    </Text>
                  )}
                </Banner>
              </Box>
            )}

            {actionData && actionData.success === true && (
              <Box paddingBlockEnd="400">
                <Banner status="success">
                  <Text as="p">{actionData.message}</Text>
                </Banner>
              </Box>
            )}

            {/* Connection Form */}
            {connectionStatus !== "connected" && (
              <Form method="post">
                <input type="hidden" name="action" value={getButtonAction()} />
                <Button
                  variant="primary"
                  submit
                  loading={isConnecting}
                  disabled={isConnecting}
                >
                  {isConnecting && <Spinner size="small" accessibilityLabel="Connecting" />}
                  {getButtonText()}
                </Button>
              </Form>
            )}
          </Card>
        </Layout.Section>

        {/* Connection Details */}
        <Layout.Section>
          {renderConnectionDetails()}
        </Layout.Section>

        {/* Shop Information removed as per new requirements */}
      </Layout>
    </Page>
  );
}
