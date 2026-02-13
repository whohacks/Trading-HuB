const defaultAllowedHeaders = "Content-Type, Authorization";
const defaultAllowedMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

export function applyCors(req, res) {
  const requestOrigin = req.headers.origin || "";
  const allowedOrigin =
    process.env.CORS_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || requestOrigin || "*";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", defaultAllowedHeaders);
  res.setHeader("Access-Control-Allow-Methods", defaultAllowedMethods);
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
