const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const host = "127.0.0.1";
const preferredPort = Number(process.env.PORT || 8000);
const root = __dirname;
const dataDir = path.join(root, ".data");
const usersFile = path.join(dataDir, "users.json");
const upstreamAI = "https://text.pollinations.ai/openai";
const sessions = new Map();
const systemPrompt = [
  "You are ArchiveBot, a friendly, playful, smart desktop robot living in a browser.",
  "Keep answers useful, warm, and concise unless the user asks for depth.",
  "If asked your name, say your name is ArchiveBot.",
  "Do not repeat API provider notices, deprecation notices, queue messages, or authentication warnings.",
  "When helpful, add one small dash of robot personality without overdoing it."
].join(" ");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function createServer() {
  return http.createServer(async (request, response) => {
    const requestPath = decodeURIComponent(request.url.split("?")[0]);

    if (request.method === "POST" && requestPath === "/api/chat") {
      await handleAIChat(request, response);
      return;
    }

    if (request.method === "GET" && requestPath === "/api/me") {
      handleCurrentUser(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/signup") {
      await handleSignUp(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/signin") {
      await handleSignIn(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/signout") {
      handleSignOut(request, response);
      return;
    }

    serveStatic(requestPath, response);
  });
}

function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, safePath);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.startsWith(".data")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
}

async function handleAIChat(request, response) {
  try {
    const body = await readJSONBody(request);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const sanitizedMessages = messages
      .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content.slice(0, 1200) }));

    if (!sanitizedMessages.some((item) => item.role === "user")) {
      sendJSON(response, 400, { error: "No user message provided" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26000);

    try {
      const upstreamResponse = await fetch(upstreamAI, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: "openai",
          messages: [
            { role: "system", content: systemPrompt },
            ...sanitizedMessages
          ],
          temperature: 0.8,
          max_tokens: 420
        }),
        signal: controller.signal
      });

      const rawText = await upstreamResponse.text();
      if (!upstreamResponse.ok) {
        sendJSON(response, 502, { error: extractProviderError(rawText) });
        return;
      }

      const data = JSON.parse(rawText);
      const reply = cleanAIText(data?.choices?.[0]?.message?.content || "");

      if (!reply || isProviderNotice(reply)) {
        sendJSON(response, 502, { error: "AI provider returned a notice instead of a reply" });
        return;
      }

      sendJSON(response, 200, { reply });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    sendJSON(response, 500, { error: error.message || "ArchiveBot server error" });
  }
}

function handleCurrentUser(request, response) {
  const user = getSessionUser(request);
  sendJSON(response, 200, { user: user ? publicUser(user) : null });
}

async function handleSignUp(request, response) {
  try {
    const body = await readJSONBody(request);
    const name = sanitizeName(body.name);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!name) {
      sendJSON(response, 400, { error: "Name is required" });
      return;
    }

    if (!isValidEmail(email)) {
      sendJSON(response, 400, { error: "Enter a valid email address" });
      return;
    }

    if (password.length < 6) {
      sendJSON(response, 400, { error: "Password must be at least 6 characters" });
      return;
    }

    const users = readUsers();
    if (users.some((user) => user.email === email)) {
      sendJSON(response, 409, { error: "An account with this email already exists" });
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };

    users.push(user);
    writeUsers(users);
    createSession(response, user);
    sendJSON(response, 201, { user: publicUser(user) });
  } catch (error) {
    sendJSON(response, 500, { error: error.message || "Could not create account" });
  }
}

async function handleSignIn(request, response) {
  try {
    const body = await readJSONBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const users = readUsers();
    const user = users.find((item) => item.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJSON(response, 401, { error: "Email or password is incorrect" });
      return;
    }

    createSession(response, user);
    sendJSON(response, 200, { user: publicUser(user) });
  } catch (error) {
    sendJSON(response, 500, { error: error.message || "Could not sign in" });
  }
}

function handleSignOut(request, response) {
  const sessionId = getCookie(request, "archivebot_session");
  if (sessionId) {
    sessions.delete(sessionId);
  }

  response.setHeader("Set-Cookie", "archivebot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  sendJSON(response, 200, { ok: true });
}

function createSession(response, user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, { userId: user.id, createdAt: Date.now() });
  response.setHeader("Set-Cookie", `archivebot_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function getSessionUser(request) {
  const sessionId = getCookie(request, "archivebot_session");
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - session.createdAt > oneWeek) {
    sessions.delete(sessionId);
    return null;
  }

  return readUsers().find((user) => user.id === session.userId) || null;
}

function getCookie(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  const match = cookies
    .map((cookie) => cookie.trim().split("="))
    .find(([key]) => key === name);

  return match ? decodeURIComponent(match[1] || "") : "";
}

function readUsers() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(usersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureDataFile();
  fs.writeFileSync(usersFile, `${JSON.stringify({ users }, null, 2)}\n`, "utf8");
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, "{\n  \"users\": []\n}\n", "utf8");
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [method, iterations, salt, hash] = String(storedHash || "").split("$");
  if (method !== "pbkdf2_sha256" || !iterations || !salt || !hash) return false;

  const testHash = crypto.pbkdf2Sync(password, salt, Number(iterations), 32, "sha256");
  const storedBuffer = Buffer.from(hash, "hex");

  if (storedBuffer.length !== testHash.length) return false;
  return crypto.timingSafeEqual(storedBuffer, testHash);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function sanitizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readJSONBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 120000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function sendJSON(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function cleanAIText(text) {
  return String(text)
    .replace(/the pollinations legacy text api is being deprecated[\s\S]*?continue to work normally\.?/gi, "")
    .replace(/please migrate to our new service at https:\/\/enter\.pollinations\.ai[\s\S]*?(latest models\.|$)/gi, "")
    .replace(/^ArchiveBot:\s*/i, "")
    .replace(/^Assistant:\s*/i, "")
    .trim();
}

function isProviderNotice(text) {
  return /pollinations legacy text api|enter\.pollinations\.ai|deprecation_notice|queue full for ip|authentication required/i.test(text);
}

function extractProviderError(rawText) {
  try {
    const data = JSON.parse(rawText);
    return data?.error?.message || data?.message || data?.deprecation_notice || "AI provider error";
  } catch {
    return cleanAIText(rawText) || "AI provider error";
  }
}

function listen(port) {
  const server = createServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < preferredPort + 10) {
      listen(port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.log(`ArchiveBot running at http://${host}:${port}/`);
  });
}

listen(preferredPort);
