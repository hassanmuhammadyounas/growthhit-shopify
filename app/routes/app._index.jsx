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
    console.log('[loader] Starting /app index', { 
      url: request.url, 
      requestId,
      timestamp: new Date().toISOString()
    });

    // Remove timeout wrapper - let Shopify handle its own timeouts
    const authResult = await authWithLog(request);

    const { session } = authResult;
    shop = session.shop;
    
    console.log('[loader] Authentication successful', { 
      shop: session.shop, 
      requestId,
      authTime: `${Date.now() - startTime}ms`
    });

    await logger.info("App index loaded", { 
      requestId,
      shop,
      userAgent: request.headers.get("user-agent")
    }, request, shop);

    // Check for existing Airbyte connection with timeout
    let existingConnection = null;
    try {
      existingConnection = await Promise.race([
        prisma.airbyteConnection.findUnique({
          where: { shop: session.shop }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout')), 10000)
        )
      ]);

      await logger.database("findUnique", "AirbyteConnection", shop, {
        requestId,
        found: !!existingConnection
      });
    } catch (dbError) {
      console.warn('[loader] Database query failed, continuing without connection data', {
        error: dbError.message,
        requestId,
        shop
      });
      
      await logger.warn("Database query timeout", {
        requestId,
        error: dbError.message,
        operation: "findUnique AirbyteConnection"
      }, request, shop);
    }

    const loadTime = Date.now() - startTime;
    await logger.metric("page_load_time", loadTime, shop, { 
      page: "app_index",
      requestId 
    });

    console.log('[loader] /app index completed', {
      shop: session.shop,
      loadTime: `${loadTime}ms`,
      requestId,
      hasConnection: !!existingConnection
    });

    return json({
      shop: session.shop,
      accessToken: session.accessToken,
      connectionStatus: existingConnection?.status || "ready",
      connectionData: existingConnection ? {
        connectionId: existingConnection.connectionId,
        sourceId: existingConnection.sourceId,
        destinationId: existingConnection.destinationId,
        jobId: existingConnection.jobId,
        errorMessage: existingConnection.errorMessage,
        lastSyncAt: existingConnection.lastSyncAt,
        syncCount: existingConnection.syncCount,
      } : null,
    });
  } catch (error) {
    const loadTime = Date.now() - startTime;
    
    console.error('[loader] /app index failed', {
      error: error.message,
      loadTime: `${loadTime}ms`,
      requestId,
      shop,
      stack: error.stack
    });

    await logger.error("Failed to load app index", {
      requestId,
      error: error.message,
      stack: error.stack,
      loadTime
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
            errorMessage: "Network error occurred while connecting to Airbyte",
            updatedAt: new Date()
          },
          create: {
            shop: session.shop,
            status: "failed",
            errorMessage: "Network error occurred while connecting to Airbyte",
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
          message: "Network error occurred while connecting to Airbyte",
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
        return <Badge status="success">Successfully Connected</Badge>;
      case "failed":
        return <Badge status="critical">Connection Failed</Badge>;
      case "ready":
      default:
        return <Badge status="info">Ready to Connect</Badge>;
    }
  };

  const getStatusMessage = () => {
    if (connectionStatus === "connecting") {
      return "Connecting to Airbyte... This may take a few moments.";
    }
    
    if (connectionStatus === "connected") {
      const syncInfo = connectionData?.lastSyncAt 
        ? ` Last sync: ${new Date(connectionData.lastSyncAt).toLocaleString()}. Total syncs: ${connectionData.syncCount || 0}.`
        : "";
      return `Your Shopify store is successfully connected to Airbyte. Data syncing is active.${syncInfo}`;
    }
    
    if (connectionStatus === "failed") {
      const errorMsg = actionData?.message || connectionData?.errorMessage;
      return errorMsg || "Connection to Airbyte failed. Please try again.";
    }
    
    return "Connect your Shopify store to Airbyte for automated data syncing to BigQuery.";
  };

  const getButtonText = () => {
    if (isConnecting) return "Connecting...";
    if (connectionStatus === "connected") return "Reconnect";
    return "Connect to Airbyte";
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
                GrowthHit Analytics Integration
              </Text>
            </Box>
            
            <Box paddingBlockEnd="200">
              <Text as="p">
                Connect your Shopify store to sync data automatically with BigQuery through Airbyte.
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
          </Card>
        </Layout.Section>

        {/* Connection Details */}
        <Layout.Section>
          {renderConnectionDetails()}
        </Layout.Section>

        {/* Shop Information */}
        <Layout.Section>
          <Card>
            <Text variant="headingMd" as="h3">Shop Information</Text>
            <Box paddingBlockStart="200">
              <Text as="p"><strong>Shop Domain:</strong> {shop}</Text>
              <Text as="p" tone="subdued">
                This information is used to configure your data sync settings.
              </Text>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
