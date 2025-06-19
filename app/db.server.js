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

  // Safely attach production event listeners (Accelerate client may not support $on)
  if (typeof prisma.$on === 'function') {
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
    dbLog("warn", "Prisma Accelerate client does not support $on event listeners – skipping error/warn handlers");
  }

} else {
  dbLog("info", "Initializing Prisma Client for development");
  
  if (!global.prismaGlobal) {
    // Create base client first
    const baseClient = new PrismaClient({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'info' },
      ],
    });

    // Set up event listeners on base client
    baseClient.$on('query', (e) => {
      // Log slow queries directly in the event handler
      if (e.duration > 500) {
        dbLog("warn", "Slow query detected", {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
          target: e.target
        });
      } else {
        dbLog("info", "Database query", {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
          target: e.target
        });
      }
    });

    baseClient.$on('error', (e) => {
      dbLog("error", "Database error", {
        target: e.target,
        message: e.message
      });
    });

    baseClient.$on('warn', (e) => {
      dbLog("warn", "Database warning", {
        target: e.target,
        message: e.message
      });
    });

    baseClient.$on('info', (e) => {
      dbLog("info", "Database info", {
        target: e.target,
        message: e.message
      });
    });

    // Apply Accelerate extension after setting up listeners
    global.prismaGlobal = baseClient.$extends(withAccelerate());
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
      accelerate: true
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
