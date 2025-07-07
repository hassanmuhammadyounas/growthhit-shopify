import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Button,
  Text,
  Icon,
  Banner,
} from "@shopify/polaris";
import { DatabaseConnectIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Test database connection
  let dbStatus = "disconnected";
  let dbError = null;
  
  try {
    await prisma.session.count();
    dbStatus = "connected";
    console.log("Database Status:", dbStatus);
  } catch (err) {
    dbError = err.message;
    console.log("Database Connection Error:", err.message);
  }

  let isConnected = false;
  let connectionData = null;
  
  try {
    const data = await prisma.connections.findUnique({
      where: { shop: session.shop }
    });
    
    if (data) {
      isConnected = true;
      connectionData = data;
      console.log("Shop Connection Status:", { isConnected, shop: session.shop });
    }
  } catch (err) {
    console.log("Shop not found in DB:", session.shop);
  }

  return json({
    shop: session.shop,
    accessToken: session.accessToken,
    isConnected,
    connectionData,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Connect action
  try {
    const response = await fetch(process.env.AIRBYTE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        shop: session.shop, 
        api_password: session.accessToken 
      }),
    });
    
    const responseData = await response.json();
    console.log("Airbyte API Response:", responseData);
    
    if (response.ok && responseData.status === "success") {
      // Save to database using Prisma 
      try {
        await prisma.connections.upsert({
          where: { shop: session.shop },
          update: {
            access_token: session.accessToken,
            source_id: responseData.details.source_id,
            destination_id: responseData.details.destination_id,
            connection_id: responseData.details.connection_id,
            job_id: responseData.details.job_id,
            request_id: responseData.request_id,
            updated_at: new Date(),
          },
          create: {
            shop: session.shop,
            access_token: session.accessToken,
            source_id: responseData.details.source_id,
            destination_id: responseData.details.destination_id,
            connection_id: responseData.details.connection_id,
            job_id: responseData.details.job_id,
            request_id: responseData.request_id,
            source_created_at: new Date(),
            destination_created_at: new Date(),
            connection_created_at: new Date(),
            job_created_at: new Date(),
          },
        });
        
        console.log("Successfully saved to database for shop:", session.shop);
        return json({
          success: true,
          message: "Successfully connected to GrowthHit Dashboard!",
          saved: true,
        });
      } catch (dbError) {
        console.log("Database Save Error:", dbError.message);
        return json({
          success: false,
          error: `Database error: ${dbError.message}`,
        });
      }
    }
    
    return json({
      success: false,
      error: "Connection failed. Please try again.",
    });
  } catch (error) {
    console.log("Action Error:", error.message);
    return json({
      success: false,
      error: error.message,
    });
  }
};

export default function Index() {
  const { shop, accessToken, isConnected, connectionData } = useLoaderData();
  const fetcher = useFetcher();
  
  const isLoading = fetcher.state === "submitting";
  const apiResponse = fetcher.data;

  // Browser console logs (safe information only)
  // Updated: Now using PostgreSQL with Prisma for better performance
  useEffect(() => {
    console.log("🔗 Connection Status:", { isConnected });
    console.log("📊 Connection Data Available:", !!connectionData);
    if (connectionData) {
      console.log("📊 Connection IDs:", {
        connection_id: connectionData.connection_id,
        source_id: connectionData.source_id,
        destination_id: connectionData.destination_id,
        job_id: connectionData.job_id,
        request_id: connectionData.request_id,
        created_at: connectionData.created_at
      });
    }
  }, [isConnected, connectionData]);

  useEffect(() => {
    if (apiResponse) {
      console.log("📨 API Response Status:", { 
        success: apiResponse.success, 
        message: apiResponse.message || "No message",
        error: apiResponse.error || "No error"
      });
    }
  }, [apiResponse]);

  const handleConnect = () => {
    console.log("🚀 Initiating connection...");
    fetcher.submit({}, { method: "POST" });
  };

  return (
    <Page>
      <TitleBar title="GrowthHit" />
      <Layout>
        <Layout.Section>
          <div style={{ 
            display: "flex", 
            justifyContent: "center", 
            padding: "2rem 0" 
          }}>
            <div style={{ 
              maxWidth: "500px", 
              width: "100%", 
              textAlign: "center" 
            }}>
              <Card>
                <div style={{ padding: "3rem 2rem" }}>
                  <BlockStack gap="600">
                    <div style={{ 
                      display: "flex", 
                      justifyContent: "center", 
                      marginBottom: "1rem" 
                    }}>
                      <div style={{ 
                        width: "80px", 
                        height: "80px", 
                        backgroundColor: "#f6f6f7", 
                        borderRadius: "50%", 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        border: "1px solid #e1e3e5"
                      }}>
                        <div style={{ transform: "scale(1.5)" }}>
                          <Icon source={DatabaseConnectIcon} tone="base" />
                        </div>
                      </div>
                    </div>
                    
                    <BlockStack gap="400">
                      <Text variant="headingLg" as="h2" alignment="center">
                        Connect to GrowthHit Dashboard
                      </Text>
                      
                      <Text variant="bodyMd" as="p" alignment="center" tone="subdued">
                        Seamlessly integrate your Shopify store with GrowthHit's powerful analytics platform to unlock advanced insights, track performance metrics, and optimize your business growth strategies with real-time data visualization.
                      </Text>
                    </BlockStack>
                    
                    <div style={{ 
                      margin: "1rem 0" 
                    }}>
                      <Button 
                        variant="primary" 
                        size="large" 
                        onClick={handleConnect} 
                        tone="success" 
                        fullWidth
                        loading={isLoading}
                        disabled={isConnected}
                      >
                        {isLoading ? "Connecting..." : isConnected ? "Connected" : "Connect Now"}
                      </Button>
                    </div>
                    
                    <div style={{ 
                      display: "flex", 
                      justifyContent: "center", 
                      alignItems: "center", 
                      gap: "0.5rem",
                      marginTop: "1rem"
                    }}>
                      <div style={{ 
                        width: "8px", 
                        height: "8px", 
                        backgroundColor: isConnected ? "#008060" : "#d72c0d", 
                        borderRadius: "50%" 
                      }}></div>
                      <Text variant="bodyMd" tone={isConnected ? "success" : "critical"}>
                        Status: {isConnected ? "Connected" : "Disconnected"}
                      </Text>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </div>
          </div>
        </Layout.Section>
        
        {apiResponse && (
          <Layout.Section>
            {apiResponse.success ? (
              <Banner tone="success" title="Success!">
                <p>{apiResponse.message}</p>
              </Banner>
            ) : (
              <Banner tone="critical" title="Connection Failed">
                <p>{apiResponse.error}</p>
              </Banner>
            )}
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
