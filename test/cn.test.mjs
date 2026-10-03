import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

// A stand-in for CN's token endpoint, checking what the desk sends.
const calls = [];
let reply = { status: 200, body: { access_token: "tok-1", expires_in: "3600", token_type: "BearerToken" } };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});

let cn;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.CN_API_BASE = `http://localhost:${server.address().port}`;
  cn = await import("../netlify/lib/cn.mjs");
});
after(() => server.close());

test("without a key and secret, the CN connection is not set up", async () => {
  delete process.env.CN_API_KEY;
  delete process.env.CN_API_SECRET;
  assert.equal(cn.cnConfig().configured, false);
  await assert.rejects(cn.cnToken(), (err) => err.status === 503 && /not set up/.test(err.message));
  assert.equal(calls.length, 0, "CN is not called");
});

test("gets a token the way CN's API overview describes, and reuses it", async () => {
  process.env.CN_API_KEY = "key-123";
  process.env.CN_API_SECRET = "secret-456";
  assert.equal(cn.cnConfig().configured, true);
  assert.equal(await cn.cnToken({ fresh: true }), "tok-1");
  const call = calls.at(-1);
  assert.equal(call.method, "POST");
  assert.equal(call.url, "/v1/oauth/jwt-token/accesstokenJWT?grant_type=client_credentials");
  assert.equal(call.headers["x-apikey"], "key-123");
  assert.equal(call.headers.authorization, `Basic ${Buffer.from("key-123:secret-456").toString("base64")}`);
  assert.equal(call.body, "grant_type=client_credentials");
  const before = calls.length;
  assert.equal(await cn.cnToken(), "tok-1");
  assert.equal(calls.length, before, "a valid token is reused");
});

test("a refused key and secret gives a plain message, without the secret", async () => {
  reply = { status: 401, body: { fault: "Invalid client" } };
  await assert.rejects(cn.cnToken({ fresh: true }), (err) => err.status === 502 && /did not accept/.test(err.message) && !err.message.includes("secret-456"));
  reply = { status: 200, body: {} };
  await assert.rejects(cn.cnToken({ fresh: true }), (err) => /without an access token/.test(err.message));
});
