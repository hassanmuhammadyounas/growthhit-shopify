import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

let prisma;

// Database connection logging
const dbLog = (level, message, context = {}) => {
  const timestamp = new Date().toISOString();
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  
  const color = colors[level] || colors.reset;
  console.log(
    `${color}[${timestamp}] ${level.toUpperCase()} [DATABASE]${colors.reset}`,
    message,
    context && Object.keys(context).length > 0 ? context : ""
  );
};

if (process.env.NODE_ENV === "production") {
  dbLog("info", "Initializing Prisma Client with Accelerate for production");
  
  prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'info' },
    ],
  }).$extends(withAccelerate());

  // Production logging - only errors and warnings
  prisma.$on('error', (e) => {
    dbLog("error", "Database error", {
      target: e.target,
      message: e.message
    });
  });

  prisma.$on('warn', (e) => {
    dbLog("warn", "Database warning", {
      target: e.target,
      message: e.message
    });
  });

} else {
  dbLog("info", "Initializing Prisma Client for development");
  
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'info' },
      ],
    });

    // Development logging - all events
    global.prismaGlobal.$on('query', (e) => {
      dbLog("info", "Database query", {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
        target: e.target
      });
    });

    global.prismaGlobal.$on('error', (e) => {
      dbLog("error", "Database error", {
        target: e.target,
        message: e.message
      });
    });

    global.prismaGlobal.$on('warn', (e) => {
      dbLog("warn", "Database warning", {
        target: e.target,
        message: e.message
      });
    });

    global.prismaGlobal.$on('info', (e) => {
      dbLog("info", "Database info", {
        target: e.target,
        message: e.message
      });
    });
  }
  
  prisma = global.prismaGlobal;
}

// Add connection error handling with retries
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

async function connectWithRetry() {
  connectionAttempts++;
  
  try {
    await prisma.$connect();
    dbLog("info", "Successfully connected to database", {
      attempt: connectionAttempts,
      environment: process.env.NODE_ENV,
      accelerate: process.env.NODE_ENV === "production"
    });
  } catch (error) {
    dbLog("error", `Database connection failed (attempt ${connectionAttempts})`, {
      error: error.message,
      code: error.code,
      attempt: connectionAttempts,
      maxAttempts: MAX_CONNECTION_ATTEMPTS
    });

    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      dbLog("info", `Retrying database connection in 2 seconds...`);
      setTimeout(connectWithRetry, 2000);
    } else {
      dbLog("error", "Max connection attempts exceeded. Exiting process.");
      process.exit(1);
    }
  }
}

// Enhanced middleware for query monitoring
prisma.$use(async (params, next) => {
  const start = Date.now();
  
  try {
    const result = await next(params);
    const duration = Date.now() - start;
    
    // Log slow queries (> 1000ms)
    if (duration > 1000) {
      dbLog("warn", "Slow query detected", {
        model: params.model,
        action: params.action,
        duration: `${duration}ms`
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    
    dbLog("error", "Query failed", {
      model: params.model,
      action: params.action,
      duration: `${duration}ms`,
      error: error.message
    });
    
    throw error;
  }
});

// Initialize connection
connectWithRetry();

// Graceful shutdown handling
process.on('beforeExit', async () => {
  dbLog("info", "Disconnecting from database...");
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  dbLog("info", "Received SIGINT, disconnecting from database...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  dbLog("info", "Received SIGTERM, disconnecting from database...");
  await prisma.$disconnect();
  process.exit(0);
});

export default prisma;
