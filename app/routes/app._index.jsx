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
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Check for existing Airbyte connection
  const existingConnection = await prisma.airbyteConnection.findUnique({
    where: { shop: session.shop }
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
    } : null,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "connect" || action === "reconnect") {
    try {
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

      // Call the Airbyte Handler API
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

      const result = await response.json();

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
            updatedAt: new Date()
          },
          create: {
            shop: session.shop,
            status: "connected",
            connectionId: result.connection_id,
            sourceId: result.source_id,
            destinationId: result.destination_id,
            jobId: result.job_id,
          }
        });

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

      return json({
        success: false,
        message: "Network error occurred while connecting to Airbyte",
        error: error.message,
      });
    }
  }

  return json({ success: false, message: "Invalid action" });
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
      return "Your Shopify store is successfully connected to Airbyte. Data syncing is active.";
    }
    
    if (connectionStatus === "failed") {
      const errorMsg = actionData?.message || connectionData?.errorMessage;
      return errorMsg || "Connection to Airbyte failed. Please try again.";
    }
    
    return "Connect your Shopify store to Airbyte for automated data syncing to BigQuery.";
  };

  const getButtonText = () => {
    if (isConnecting) return "Connecting...";
    if (connectionStatus === "connected") return "Connected";
    if (connectionStatus === "failed") return "Reconnect to Airbyte";
    return "Connect to Airbyte";
  };

  const getButtonAction = () => {
    return connectionStatus === "failed" ? "reconnect" : "connect";
  };

  // Get connection data from either action response or database
  const displayData = actionData?.data || connectionData;

  return (
    <Page title="GrowthHit - Airbyte Integration">
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <Text variant="headingLg" as="h2">
                  Airbyte Connection
                </Text>
                {getStatusBadge()}
              </div>
              
              <Text variant="bodyMd" color="subdued" as="p">
                Store: <strong>{shop}</strong>
              </Text>
              
              <Box paddingBlockStart="400">
                <Divider />
              </Box>
              
              <Box paddingBlockStart="400">
                <Text variant="bodyMd" as="p">
                  {getStatusMessage()}
                </Text>
              </Box>

              {connectionStatus === "connecting" && (
                <Box paddingBlockStart="400">
                  <Banner status="info" title="Connecting to Airbyte">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Spinner size="small" />
                      <p>Setting up your data pipeline... Please wait.</p>
                    </div>
                  </Banner>
                </Box>
              )}

              {connectionStatus === "failed" && (
                <Box paddingBlockStart="400">
                  <Banner status="critical" title="Connection Failed">
                    <p>{getStatusMessage()}</p>
                    {(actionData?.error || connectionData?.errorMessage) && (
                      <Box paddingBlockStart="200">
                        <Text variant="bodySmall" color="subdued" as="p">
                          Error details: {actionData?.error || connectionData?.errorMessage}
                        </Text>
                      </Box>
                    )}
                  </Banner>
                </Box>
              )}

              {connectionStatus === "connected" && (
                <Box paddingBlockStart="400">
                  <Banner status="success" title="Successfully Connected!">
                    <p>Your Shopify store is now connected to Airbyte. Data syncing will begin shortly.</p>
                    {displayData && (
                      <Box paddingBlockStart="200">
                        {displayData.connectionId && (
                          <Text variant="bodySmall" color="subdued" as="p">
                            Connection ID: {displayData.connectionId}
                          </Text>
                        )}
                        {displayData.sourceId && (
                          <Text variant="bodySmall" color="subdued" as="p">
                            Source ID: {displayData.sourceId}
                          </Text>
                        )}
                        {displayData.destinationId && (
                          <Text variant="bodySmall" color="subdued" as="p">
                            Destination ID: {displayData.destinationId}
                          </Text>
                        )}
                        {displayData.jobId && (
                          <Text variant="bodySmall" color="subdued" as="p">
                            Initial Sync Job ID: {displayData.jobId}
                          </Text>
                        )}
                      </Box>
                    )}
                  </Banner>
                </Box>
              )}

              <Box paddingBlockStart="500">
                <Form method="post">
                  <input type="hidden" name="action" value={getButtonAction()} />
                  <Button
                    submit
                    primary
                    loading={isConnecting}
                    disabled={isConnecting || connectionStatus === "connected"}
                  >
                    {getButtonText()}
                  </Button>
                </Form>
              </Box>

              <Box paddingBlockStart="500">
                <Card background="bg-surface-secondary">
                  <Box padding="300">
                    <Text variant="headingSmall" as="h3">
                      What happens when you connect?
                    </Text>
                    <Box paddingBlockStart="200">
                      <Text variant="bodySmall" as="p">
                        • Creates a secure connection between your Shopify store and BigQuery
                      </Text>
                      <Text variant="bodySmall" as="p">
                        • Syncs products, orders, transactions, and refunds data
                      </Text>
                      <Text variant="bodySmall" as="p">
                        • Sets up daily automated data synchronization
                      </Text>
                      <Text variant="bodySmall" as="p">
                        • All data is securely stored in your BigQuery dataset
                      </Text>
                    </Box>
                  </Box>
                </Card>
              </Box>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
