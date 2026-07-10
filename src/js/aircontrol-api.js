const SESSION_KEY = "aircontrol_session_token";

function getSessionToken() {
  return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "";
}

function normalizeFunctionError(message) {
  const text = String(message || "No se pudo completar la solicitud.");
  if (!isInvalidSessionError({ message: text })) return text;
  removeSessionToken();
  return "Tu sesión venció o ya no es válida. Vuelve a iniciar sesión e intenta nuevamente.";
}

function setSessionToken(token) {
  sessionStorage.setItem(SESSION_KEY, token);
  localStorage.removeItem(SESSION_KEY);
}

function removeSessionToken() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export class AirControlApi {
  constructor(client) {
    this.client = client;
    this.sessionToken = getSessionToken();
  }

  async call(action, payload = {}) {
    if (!this.client) throw new Error("Supabase no est\u00e1 configurado.");
    if (action !== "login") this.sessionToken = getSessionToken();
    const { data, error } = await this.client.functions.invoke("aircontrol-api", {
      body: { action, sessionToken: this.sessionToken, ...payload }
    });
    if (error) throw new Error(normalizeFunctionError(await functionErrorMessage(error)));
    if (data?.error) throw new Error(normalizeFunctionError(data.error));
    return data || {};
  }

  async signIn(email, password) {
    const data = await this.call("login", { email, password });
    this.sessionToken = data.sessionToken || "";
    if (this.sessionToken) setSessionToken(this.sessionToken);
    return data.user;
  }

  async signOut() {
    try {
      if (this.sessionToken) await this.call("logout");
    } finally {
      this.sessionToken = "";
      removeSessionToken();
    }
  }

  async currentSessionUser() {
    if (!this.sessionToken) return null;
    try {
      const data = await this.call("me");
      return data.user || null;
    } catch (error) {
      if (isInvalidSessionError(error)) {
        this.sessionToken = "";
        removeSessionToken();
      } else {
        console.warn("currentSessionUser: error inesperado al validar sesión:", error?.message || error);
      }
      return null;
    }
  }

  async updateOwnPassword(password) {
    await this.call("changePassword", { password });
  }

  async invokeTemporaryPassword(email, temporaryPassword) {
    return this.call("assignTemporaryPassword", { email, temporaryPassword });
  }

  async requestPasswordReset(email) {
    return this.call("requestPasswordReset", { email });
  }

  async select(table, options = {}) {
    const data = await this.call("select", { table, options });
    return data.rows || [];
  }

  async insert(table, row) {
    await this.call("insert", { table, row });
  }

  async update(table, id, changes) {
    await this.call("update", { table, id, changes });
  }

  async delete(table, id) {
    await this.call("delete", { table, id });
  }

  async batchUpsert(table, rows) {
    await this.call("batchUpsert", { table, rows });
  }

  async batchUpdate(table, ids, changes) {
    await this.call("batchUpdate", { table, ids, changes });
  }

  async revokeOtherSessions() {
    return this.call("revokeOtherSessions");
  }
}

async function functionErrorMessage(error) {
  const context = error?.context;
  const fallback = error?.message || "No se pudo completar la solicitud.";
  if (!context) return fallback;

  try {
    const clone = typeof context.clone === "function" ? context.clone() : context;
    const contentType = clone.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json") && typeof clone.json === "function") {
      const body = await clone.json();
      return body?.error || body?.message || fallback;
    }
    if (typeof clone.text === "function") {
      const text = await clone.text();
      if (!text) return fallback;
      try {
        const body = JSON.parse(text);
        return body?.error || body?.message || text;
      } catch {
        return text;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function isInvalidSessionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("sesion invalida")
    || message.includes("sesión inválida")
    || message.includes("sesi\u00f3n requerida")
    || message.includes("sesion requerida");
}
