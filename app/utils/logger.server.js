import prisma from "../db.server";

/**
 * Comprehensive logging utility for the Shopify app
 * Logs to both console and database with structured format
 */

export class Logger {
  constructor(source = "app") {
    this.source = source;
  }

  /**
   * Create a new logger instance for a specific source
   */
  static create(source) {
    return new Logger(source);
  }

  /**
   * Generate a unique request ID for correlating logs
   */
  static generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract client info from request
   */
  static extractClientInfo(request) {
    return {
      userAgent: request?.headers?.get?.("user-agent") || "unknown",
      ipAddress: request?.headers?.get?.("x-forwarded-for") || 
                request?.headers?.get?.("x-real-ip") || 
                "unknown",
      url: request?.url || "unknown",
      method: request?.method || "unknown"
    };
  }

  /**
   * Base logging method
   */
  async _log(level, message, context = {}, request = null, shop = null) {
    const timestamp = new Date().toISOString();
    const clientInfo = request ? Logger.extractClientInfo(request) : {};
    
    // Console logging with colors
    const colors = {
      info: '\x1b[36m',    // Cyan
      warn: '\x1b[33m',    // Yellow
      error: '\x1b[31m',   // Red
      debug: '\x1b[35m',   // Magenta
      reset: '\x1b[0m'
    };

    const color = colors[level] || colors.reset;
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      source: this.source,
      message,
      shop,
      context,
      ...clientInfo
    };

    // Console output
    console.log(
      `${color}[${timestamp}] ${level.toUpperCase()} [${this.source}]${colors.reset}`,
      message,
      context && Object.keys(context).length > 0 ? context : ""
    );

    // Database logging (async, non-blocking)
    if (shop) {
      try {
        await prisma.appLog.create({
          data: {
            shop,
            level,
            message,
            context: context && Object.keys(context).length > 0 ? context : null,
            source: this.source,
            userId: context.userId || null,
            requestId: context.requestId || null,
            userAgent: clientInfo.userAgent,
            ipAddress: clientInfo.ipAddress,
          }
        }).catch(err => {
          // Fallback to console if DB logging fails
          console.error("Failed to write log to database:", err.message);
        });
      } catch (error) {
        // Silent fail for database logging to not break app flow
        console.error("Logger database error:", error.message);
      }
    }

    return logEntry;
  }

  /**
   * Info level logging
   */
  async info(message, context = {}, request = null, shop = null) {
    return this._log("info", message, context, request, shop);
  }

  /**
   * Warning level logging
   */
  async warn(message, context = {}, request = null, shop = null) {
    return this._log("warn", message, context, request, shop);
  }

  /**
   * Error level logging
   */
  async error(message, context = {}, request = null, shop = null) {
    return this._log("error", message, context, request, shop);
  }

  /**
   * Debug level logging
   */
  async debug(message, context = {}, request = null, shop = null) {
    if (process.env.NODE_ENV === "development") {
      return this._log("debug", message, context, request, shop);
    }
  }

  /**
   * Log API calls and responses
   */
  async apiCall(method, url, status, duration, shop, context = {}) {
    const message = `API ${method} ${url} - ${status} (${duration}ms)`;
    const level = status >= 400 ? "error" : status >= 300 ? "warn" : "info";
    
    return this._log(level, message, {
      ...context,
      method,
      url,
      status,
      duration,
      type: "api_call"
    }, null, shop);
  }

  /**
   * Log Airbyte operations
   */
  async airbyteOperation(operation, shop, status, context = {}) {
    const message = `Airbyte ${operation} - ${status}`;
    const level = status === "failed" ? "error" : status === "connecting" ? "info" : "info";
    
    return this._log(level, message, {
      ...context,
      operation,
      status,
      type: "airbyte_operation"
    }, null, shop);
  }

  /**
   * Log webhook events
   */
  async webhook(topic, shop, processed = false, context = {}) {
    const message = `Webhook ${topic} - ${processed ? "processed" : "received"}`;
    
    return this._log("info", message, {
      ...context,
      topic,
      processed,
      type: "webhook"
    }, null, shop);
  }

  /**
   * Log authentication events
   */
  async auth(event, shop, context = {}) {
    const message = `Auth ${event} - ${shop}`;
    
    return this._log("info", message, {
      ...context,
      event,
      type: "auth"
    }, null, shop);
  }

  /**
   * Log database operations
   */
  async database(operation, model, shop, context = {}) {
    const message = `Database ${operation} on ${model}`;
    
    return this._log("debug", message, {
      ...context,
      operation,
      model,
      type: "database"
    }, null, shop);
  }

  /**
   * Log metrics
   */
  async metric(metricName, value, shop, context = {}) {
    const message = `Metric ${metricName}: ${value}`;
    
    // Store in database
    try {
      await prisma.appMetrics.create({
        data: {
          shop,
          metricName,
          metricValue: parseFloat(value),
          metadata: context && Object.keys(context).length > 0 ? context : null
        }
      });
    } catch (error) {
      console.error("Failed to store metric:", error.message);
    }
    
    return this._log("info", message, {
      ...context,
      metricName,
      value,
      type: "metric"
    }, null, shop);
  }
}

// Default logger instance
export const logger = Logger.create("app");

// Specialized loggers
export const authLogger = Logger.create("auth");
export const airbyteLogger = Logger.create("airbyte");
export const webhookLogger = Logger.create("webhook");
export const apiLogger = Logger.create("api");
export const dbLogger = Logger.create("database");

export default logger; 