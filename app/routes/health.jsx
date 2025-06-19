import { json } from "@remix-run/node";
import { checkDatabaseHealth } from "../db.server";

export const loader = async ({ request }) => {
  const start = Date.now();
  
  try {
    // Check database health
    const dbHealth = await Promise.race([
      checkDatabaseHealth(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database health check timeout')), 5000)
      )
    ]);
    
    const duration = Date.now() - start;
    
    return json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: {
        healthy: dbHealth.healthy,
        message: dbHealth.message
      },
      environment: process.env.NODE_ENV,
      checks: {
        database_response_time: `${duration}ms`
      }
    });
  } catch (error) {
    const duration = Date.now() - start;
    
    return json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: {
        healthy: false,
        message: error.message
      },
      environment: process.env.NODE_ENV,
      checks: {
        database_response_time: `${duration}ms`
      }
    }, { status: 500 });
  }
}; 