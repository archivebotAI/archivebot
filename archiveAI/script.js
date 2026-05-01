const ArchiveBotConfig = {
  endpoint: "/api/chat"
};

const dom = {
  form: document.getElementById("chat-form"),
  input: document.getElementById("user-input"),
  send: document.getElementById("send-button"),
  chat: document.getElementById("chat-box"),
  clear: document.getElementById("clear-chat"),
  robot: document.getElementById("robot"),
  bubble: document.getElementById("robot-bubble"),
  status: document.getElementById("system-status"),
  moodReadout: document.getElementById("mood-readout"),
  motionReadout: document.getElementById("motion-readout"),
  apiReadout: document.getElementById("api-readout"),
  authReadout: document.getElementById("auth-readout"),
  accessReadout: document.getElementById("access-readout"),
  homeAccountReadout: document.getElementById("home-account-readout"),
  accountName: document.getElementById("account-name"),
  signInOpen: document.getElementById("sign-in-open"),
  signOut: document.getElementById("sign-out-button"),
  createAccountHero: document.getElementById("create-account-hero"),
  authModal: document.getElementById("auth-modal"),
  authClose: document.getElementById("auth-close"),
  authForm: document.getElementById("auth-form"),
  authTitle: document.getElementById("auth-title"),
  authModeLabel: document.getElementById("auth-mode-label"),
  authSubmit: document.getElementById("auth-submit"),
  authMessage: document.getElementById("auth-message"),
  authName: document.getElementById("auth-name"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authTabs: document.querySelectorAll("[data-auth-mode]"),
  signupOnly: document.querySelectorAll(".signup-only"),
  navLinks: document.querySelectorAll("[data-nav]"),
  pageViews: document.querySelectorAll(".page-view"),
  suggestions: document.querySelectorAll("[data-prompt]")
};

const state = {
  busy: false,
  mood: "idle",
  user: null,
  authMode: "signin",
  messages: [
    {
      role: "assistant",
      content: "Hi, I am ArchiveBot. I can answer questions, brainstorm, explain things, and keep a tiny glowing face while I think."
    }
  ]
};

const moodMeta = {
  idle: { label: "Idle", motion: "Micro-bounce", bubble: "Systems warm. Ready when you are." },
  thinking: { label: "Thinking", motion: "Scanning", bubble: "Processing your message..." },
  talking: { label: "Talking", motion: "Voice bounce", bubble: "Response stream engaged." },
  happy: { label: "Happy", motion: "Soft bounce", bubble: "That was a good one." },
  excited: { label: "Excited", motion: "Spark jump", bubble: "Oh, I like this task." },
  error: { label: "Signal Lost", motion: "Recovery shake", bubble: "External AI hiccup. I used backup logic." }
};

const AccountAPI = {
  async me() {
    const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
    return readAccountResponse(response);
  },

  async signIn(email, password) {
    const response = await fetch("/api/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password })
    });
    return readAccountResponse(response);
  },

  async signUp(name, email, password) {
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    return readAccountResponse(response);
  },

  async signOut() {
    const response = await fetch("/api/signout", {
      method: "POST",
      headers: { Accept: "application/json" }
    });
    return readAccountResponse(response);
  }
};

const APIClient = {
  async ask(history) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);

    try {
      const response = await fetch(ArchiveBotConfig.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          messages: this.buildMessages(history)
        }),
        signal: controller.signal
      });

      const data = await safeReadResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || `AI endpoint returned ${response.status}`);
      }

      const text = cleanAIText(data?.reply || "");
      if (!text) {
        throw new Error("AI endpoint returned an empty response");
      }

      if (isProviderNotice(text)) {
        throw new Error("AI endpoint returned a provider notice instead of a chat response");
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  },

  buildMessages(history) {
    return history.slice(-8);
  }
};

const RobotUI = {
  setMood(mood) {
    state.mood = moodMeta[mood] ? mood : "idle";
    const meta = moodMeta[state.mood];

    dom.robot.className = `robot mood-${state.mood}`;
    dom.moodReadout.textContent = meta.label;
    dom.motionReadout.textContent = meta.motion;
    dom.bubble.textContent = meta.bubble;
  },

  speakPreview(text) {
    const preview = text.length > 92 ? `${text.slice(0, 89)}...` : text;
    dom.bubble.textContent = preview;
  },

  startEyeTracking() {
    document.addEventListener("pointermove", (event) => {
      const half = window.innerWidth / 2;
      const offset = Math.max(-8, Math.min(8, ((event.clientX - half) / half) * 8));
      dom.robot.style.setProperty("--eye-x", `${offset}px`);
    });
  }
};

const ChatUI = {
  renderInitial() {
    const accountLine = state.user
      ? `Signed in as ${state.user.name}. You can still chat the same way.`
      : "Guest mode is active. You can chat without signing in.";
    addMessage(`${accountLine} The page talks to a local /api/chat bridge, which connects to the free Pollinations endpoint with no key configured.`, "system");
    addMessage(state.messages[0].content, "bot");
  },

  setBusy(isBusy) {
    state.busy = isBusy;
    dom.input.disabled = isBusy;
    dom.send.disabled = isBusy;
    dom.send.textContent = isBusy ? "Thinking" : "Send";
  },

  addTyping() {
    const node = document.createElement("div");
    node.className = "message bot";
    node.id = "typing-message";
    node.innerHTML = '<span class="typing" aria-label="ArchiveBot is typing"><span></span><span></span><span></span></span>';
    dom.chat.appendChild(node);
    scrollToLatest();
  },

  removeTyping() {
    document.getElementById("typing-message")?.remove();
  }
};

function addMessage(text, sender) {
  const node = document.createElement("div");
  node.className = `message ${sender}`;
  node.textContent = text;
  dom.chat.appendChild(node);
  scrollToLatest();
  return node;
}

function scrollToLatest() {
  dom.chat.scrollTop = dom.chat.scrollHeight;
}

function setPage(page) {
  const nextPage = ["home", "chat", "privacy", "contact"].includes(page) ? page : "home";

  dom.pageViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.page === nextPage);
  });

  dom.navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === nextPage);
  });

  if (nextPage === "chat") {
    window.setTimeout(() => dom.input.focus(), 0);
  }
}

function syncRoute() {
  setPage((window.location.hash || "#home").slice(1));
}

function openAuth(mode = "signin") {
  setAuthMode(mode);
  dom.authModal.classList.remove("hidden");
  dom.authMessage.textContent = "";
  window.setTimeout(() => {
    const target = state.authMode === "signup" ? dom.authName : dom.authEmail;
    target.focus();
  }, 0);
}

function closeAuth() {
  dom.authModal.classList.add("hidden");
  dom.authForm.reset();
  dom.authMessage.textContent = "";
}

function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : "signin";
  const isSignup = state.authMode === "signup";

  dom.authTitle.textContent = isSignup ? "Create account" : "Sign in";
  dom.authModeLabel.textContent = isSignup ? "New account" : "Welcome back";
  dom.authSubmit.textContent = isSignup ? "Create account" : "Sign in";
  dom.authName.required = isSignup;
  dom.authPassword.autocomplete = isSignup ? "new-password" : "current-password";

  dom.signupOnly.forEach((item) => item.classList.toggle("hidden", !isSignup));
  dom.authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === state.authMode));
}

function renderAccount() {
  const signedIn = Boolean(state.user);
  const label = signedIn ? state.user.name : "Guest";

  dom.accountName.textContent = signedIn ? `Hi, ${state.user.name}` : "Guest mode";
  dom.signInOpen.classList.toggle("hidden", signedIn);
  dom.signOut.classList.toggle("hidden", !signedIn);
  dom.authReadout.textContent = label;
  dom.accessReadout.textContent = signedIn ? "Signed in" : "Guest enabled";
  dom.homeAccountReadout.textContent = signedIn ? state.user.email : "Optional";
}

async function readAccountResponse(response) {
  const data = await safeReadResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }

  return data;
}

function cleanAIText(text) {
  const withoutProviderNotices = String(text)
    .replace(/âš ï¸?\s*\*\*?important notice\*\*?[\s\S]*?anonymous requests to text\.pollinations\.ai are not affected and will continue to work normally\.?/gi, "")
    .replace(/the pollinations legacy text api is being deprecated[\s\S]*?continue to work normally\.?/gi, "")
    .replace(/please migrate to our new service at https:\/\/enter\.pollinations\.ai[\s\S]*?(latest models\.|$)/gi, "");

  return withoutProviderNotices
    .replace(/^ArchiveBot:\s*/i, "")
    .replace(/^Assistant:\s*/i, "")
    .trim();
}

function isProviderNotice(text) {
  return /pollinations legacy text api|enter\.pollinations\.ai|deprecation_notice|queue full for ip|authentication required/i.test(text);
}

async function safeReadResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  } catch {
    return "";
  }
}

function detectMood(text) {
  const lower = text.toLowerCase();
  const excitedWords = ["amazing", "awesome", "great", "excellent", "love", "brilliant", "congratulations", "!"];
  const happyWords = ["happy", "glad", "nice", "sure", "absolutely", "thanks", "welcome"];

  if (excitedWords.some((word) => lower.includes(word))) {
    return "excited";
  }

  if (happyWords.some((word) => lower.includes(word))) {
    return "happy";
  }

  return "talking";
}

function localFallback(userMessage) {
  const topic = userMessage.trim() || "that";
  return [
    "My external AI signal blinked, so I switched to local backup mode.",
    `Here is a useful starting point for "${topic}": break it into one clear goal, two constraints, and the next tiny action.`,
    "Try me again in a moment and I will reconnect to the free AI endpoint."
  ].join("\n\n");
}

async function handleUserMessage(rawText) {
  const text = rawText.trim();
  if (!text || state.busy) return;

  addMessage(text, "user");
  state.messages.push({ role: "user", content: text });
  dom.input.value = "";

  ChatUI.setBusy(true);
  ChatUI.addTyping();
  RobotUI.setMood("thinking");
  setStatus("Contacting external AI...", "thinking");

  try {
    const answer = await APIClient.ask(state.messages);
    ChatUI.removeTyping();
    state.messages.push({ role: "assistant", content: answer });
    addMessage(answer, "bot");
    setStatus("External AI connected", "ready");
    RobotUI.setMood(detectMood(answer));
    RobotUI.speakPreview(answer);
  } catch (error) {
    console.warn("ArchiveBot API fallback:", error);
    const fallback = localFallback(text);
    ChatUI.removeTyping();
    state.messages.push({ role: "assistant", content: fallback });
    addMessage(fallback, "bot");
    setStatus("Fallback mode active", "error");
    RobotUI.setMood("error");
    RobotUI.speakPreview("I lost the external signal, but I kept the conversation alive.");
  } finally {
    ChatUI.setBusy(false);
    dom.input.focus();
    window.setTimeout(() => {
      if (!state.busy && state.mood !== "error") {
        RobotUI.setMood("idle");
      }
    }, 3400);
  }
}

function setStatus(label, mode) {
  dom.status.lastChild.textContent = ` ${label}`;
  dom.apiReadout.textContent = mode === "error" ? "Fallback" : "Pollinations";
  dom.status.dataset.mode = mode;
}

function clearChat() {
  dom.chat.innerHTML = "";
  state.messages = [state.messages[0]];
  RobotUI.setMood("idle");
  setStatus("External AI ready", "ready");
  ChatUI.renderInitial();
  dom.input.focus();
}

async function submitAuth(event) {
  event.preventDefault();
  dom.authSubmit.disabled = true;
  dom.authMessage.textContent = state.authMode === "signup" ? "Creating account..." : "Signing in...";

  try {
    const email = dom.authEmail.value.trim();
    const password = dom.authPassword.value;
    const result = state.authMode === "signup"
      ? await AccountAPI.signUp(dom.authName.value.trim(), email, password)
      : await AccountAPI.signIn(email, password);

    state.user = result.user;
    renderAccount();
    closeAuth();
    addMessage(`Account ready: signed in as ${state.user.name}.`, "system");
    RobotUI.speakPreview(`Welcome, ${state.user.name}.`);
  } catch (error) {
    dom.authMessage.textContent = error.message || "Account request failed.";
  } finally {
    dom.authSubmit.disabled = false;
  }
}

async function handleSignOut() {
  dom.signOut.disabled = true;

  try {
    await AccountAPI.signOut();
    state.user = null;
    renderAccount();
    addMessage("Signed out. Guest chat is still available.", "system");
    RobotUI.speakPreview("Signed out. Guest mode remains ready.");
  } catch (error) {
    addMessage(error.message || "Sign out failed.", "system");
  } finally {
    dom.signOut.disabled = false;
  }
}

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  handleUserMessage(dom.input.value);
});

dom.clear.addEventListener("click", clearChat);
dom.signInOpen.addEventListener("click", () => openAuth("signin"));
dom.createAccountHero.addEventListener("click", () => openAuth("signup"));
dom.signOut.addEventListener("click", handleSignOut);
dom.authClose.addEventListener("click", closeAuth);
dom.authForm.addEventListener("submit", submitAuth);

dom.authModal.addEventListener("click", (event) => {
  if (event.target === dom.authModal) {
    closeAuth();
  }
});

dom.authTabs.forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.authMode);
    dom.authMessage.textContent = "";
  });
});

dom.suggestions.forEach((button) => {
  button.addEventListener("click", () => {
    window.location.hash = "chat";
    dom.input.value = button.dataset.prompt;
    handleUserMessage(dom.input.value);
  });
});

window.addEventListener("hashchange", syncRoute);

window.addEventListener("load", async () => {
  syncRoute();
  RobotUI.setMood("idle");
  RobotUI.startEyeTracking();

  try {
    const result = await AccountAPI.me();
    state.user = result.user || null;
  } catch {
    state.user = null;
  }

  renderAccount();
  ChatUI.renderInitial();

  if ((window.location.hash || "#home") === "#chat") {
    dom.input.focus();
  }

  window.setInterval(() => {
    if (!state.busy && state.mood === "idle") {
      RobotUI.speakPreview(Math.random() > 0.5 ? "Idle circuits humming." : "Ask me for a plan, a joke, or an explanation.");
    }
  }, 9000);
});
