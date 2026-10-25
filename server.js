const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const next = require("next");
const { parse } = require("url");

const port = Number(process.env.PORT || 3000);
const legacyPort = Number(process.env.LEGACY_PORT || 8000);
const legacyRoot = path.join(__dirname, "legacy");
const legacy = spawn(process.execPath, [path.join(legacyRoot, "index.js")], {
  cwd: legacyRoot,
  env: { ...process.env, PORT: String(legacyPort), SERVER_PORT: String(legacyPort) },
  stdio: "inherit",
});
legacy.on("exit", (code) => {
  if (code && code !== 0) console.error(`Legacy compatibility server exited with ${code}`);
});

const legacyPaths = new Set(["/about", "/tutorials", "/plugins", "/api", "/services", "/community", "/admin", "/crysnova", "/bancheck", "/dashboard", "/status", "/pair", "/health", "/ping"]);
const legacyPrefixes = ["/api/", "/auth/", "/qr", "/public/", "/node_modules/", "/pair.js", "/qr.js", "/public.css"];
const shouldProxy = (pathname) => legacyPaths.has(pathname) || legacyPrefixes.some((prefix) => pathname.startsWith(prefix));

function proxyLegacy(req, res) {
  const proxy = http.request({ hostname: "127.0.0.1", port: legacyPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${legacyPort}` } }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Compatibility service unavailable: ${error.message}`);
  });
  req.pipe(proxy);
}

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();
app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const pathname = parse(req.url || "/").pathname || "/";
    if (shouldProxy(pathname)) return proxyLegacy(req, res);
    return handle(req, res, parse(req.url || "/", true));
  });
  server.listen(port, "0.0.0.0", () => console.log(`Next upgrade listening on ${port}; compatibility server on ${legacyPort}`));
  const shutdown = () => { legacy.kill("SIGTERM"); server.close(() => process.exit(0)); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
});
