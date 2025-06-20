import { PrismaClient } from "@prisma/client";

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

const rawDbUrl = process.env.DATABASE_URL;
if (rawDbUrl && !rawDbUrl.includes("connection_limit")) {
  process.env.DATABASE_URL = `${rawDbUrl}${rawDbUrl.includes("?") ? "&" : "?"}connection_limit=1&pool_timeout=20`;
}

if (process.env.NODE_ENV === "production") {
  dbLog("info", "Initializing Prisma Client for production");
  
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    global.prismaGlobal.$on('error', (e) => {
      dbLog("error", "Database error", {
        target: e.target,
        message: e.message,
      });
    });

    global.prismaGlobal.$on('warn', (e) => {
      dbLog("warn", "Database warning", {
        target: e.target,
        message: e.message,
      });
    });
  }
  
  prisma = global.prismaGlobal;
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

    global.prismaGlobal.$on('query', (e) => {
      if (e.duration > 500) {
        dbLog("warn", "Slow query detected", {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
          target: e.target
        });
      }
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
    const start = Date.now();
    dbLog("info", "Connecting to database...");
    await prisma.$connect();
    const duration = Date.now() - start;
    dbLog("info", `Connected in ${duration}ms`);
    dbLog("info", "Successfully connected to database", {
      attempt: connectionAttempts,
      environment: process.env.NODE_ENV
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