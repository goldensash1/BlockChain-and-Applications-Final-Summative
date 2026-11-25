const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("path");
const cfg = require("./config");
const { db } = require("./db");
const chain = require("./chain");
const { loadUser } = require("./middleware");
const render = require("./render");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], objectSrc: ["'none'"] } } }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(loadUser);

app.get("/api/health", async (_req, res) => {
  const c = await chain.health().catch((e) => ({ ok: false, error: e.message }));
  res.status(c.ok ? 200 : 503).json({ server: "ok", chain: c });
});
app.get("/api/config", (_req, res) => res.json({ contract: chain.info().contract }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/institution", require("./routes/institution"));
app.use("/api/documents", require("./routes/documents"));
app.use("/api/files", require("./routes/files"));
app.use("/api/verify", require("./routes/verify"));
app.use("/api/v1", require("./routes/v1")); // company "seal" API (API keys) + public verification

// Printable document by verification code (the code itself is the access secret)
app.get("/d/:code", async (req, res, next) => {
  try {
    const d = db.prepare("SELECT * FROM documents WHERE code=? AND chain_status='anchored'").get(String(req.params.code).toUpperCase());
    if (!d) return res.status(404).send("Document not found");
    const onChain = await chain.verify(d.doc_hash).catch(() => null);
    res.type("html").send(await render(d, JSON.parse(d.payload), onChain));
  } catch (e) { next(e); }
});

// Public download of a registered file by its verification code (the code is the access secret, like /d/:code)
app.get("/f/:code", (req, res) => {
  const f = db.prepare("SELECT * FROM files WHERE code=? AND chain_status='anchored' AND stored=1").get(String(req.params.code).toUpperCase());
  if (!f) return res.status(404).send("File not found");
  res.attachment(f.original_name); // forces download; type derives from the extension
  res.send(require("fs").readFileSync(require("./upload").filePath(f.code)));
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error" });
});

module.exports = app;
