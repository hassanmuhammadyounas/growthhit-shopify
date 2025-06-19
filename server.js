import { createRequestHandler } from "@vercel/node";

// Import the server build
const build = await import("./build/server/index.js");

export default createRequestHandler({
  build: build.default || build,
  mode: process.env.NODE_ENV,
});