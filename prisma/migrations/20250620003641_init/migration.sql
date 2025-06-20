-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airbyte_connections" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "connectionId" TEXT,
    "sourceId" TEXT,
    "destinationId" TEXT,
    "jobId" TEXT,
    "errorMessage" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "airbyte_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_logs" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "source" TEXT,
    "userId" TEXT,
    "requestId" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_metrics" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "app_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_shop_key" ON "sessions"("shop");

-- CreateIndex
CREATE INDEX "sessions_shop_idx" ON "sessions"("shop");

-- CreateIndex
CREATE INDEX "sessions_shop_isOnline_idx" ON "sessions"("shop", "isOnline");

-- CreateIndex
CREATE INDEX "sessions_expires_idx" ON "sessions"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "airbyte_connections_shop_key" ON "airbyte_connections"("shop");

-- CreateIndex
CREATE INDEX "airbyte_connections_shop_idx" ON "airbyte_connections"("shop");

-- CreateIndex
CREATE INDEX "airbyte_connections_status_idx" ON "airbyte_connections"("status");

-- CreateIndex
CREATE INDEX "airbyte_connections_lastSyncAt_idx" ON "airbyte_connections"("lastSyncAt");

-- CreateIndex
CREATE INDEX "app_logs_shop_idx" ON "app_logs"("shop");

-- CreateIndex
CREATE INDEX "app_logs_level_idx" ON "app_logs"("level");

-- CreateIndex
CREATE INDEX "app_logs_createdAt_idx" ON "app_logs"("createdAt");

-- CreateIndex
CREATE INDEX "app_logs_source_idx" ON "app_logs"("source");

-- CreateIndex
CREATE INDEX "app_logs_requestId_idx" ON "app_logs"("requestId");

-- CreateIndex
CREATE INDEX "webhook_events_shop_idx" ON "webhook_events"("shop");

-- CreateIndex
CREATE INDEX "webhook_events_topic_idx" ON "webhook_events"("topic");

-- CreateIndex
CREATE INDEX "webhook_events_processed_idx" ON "webhook_events"("processed");

-- CreateIndex
CREATE INDEX "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");

-- CreateIndex
CREATE INDEX "sync_logs_connectionId_idx" ON "sync_logs"("connectionId");

-- CreateIndex
CREATE INDEX "sync_logs_status_idx" ON "sync_logs"("status");

-- CreateIndex
CREATE INDEX "sync_logs_startedAt_idx" ON "sync_logs"("startedAt");

-- CreateIndex
CREATE INDEX "app_metrics_shop_idx" ON "app_metrics"("shop");

-- CreateIndex
CREATE INDEX "app_metrics_metricName_idx" ON "app_metrics"("metricName");

-- CreateIndex
CREATE INDEX "app_metrics_timestamp_idx" ON "app_metrics"("timestamp");

-- AddForeignKey
ALTER TABLE "airbyte_connections" ADD CONSTRAINT "airbyte_connections_shop_fkey" FOREIGN KEY ("shop") REFERENCES "sessions"("shop") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_logs" ADD CONSTRAINT "app_logs_shop_fkey" FOREIGN KEY ("shop") REFERENCES "sessions"("shop") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_shop_fkey" FOREIGN KEY ("shop") REFERENCES "sessions"("shop") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "airbyte_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
