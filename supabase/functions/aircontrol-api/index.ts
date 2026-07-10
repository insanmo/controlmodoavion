import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://insanmo.github.io",
  "http://localhost:5173",
  "http://localhost:4173"
];

const TABLES: Record<string, string> = {
  users: "aircontrol_users",
  personal: "aircontrol_personal",
  vacations: "aircontrol_vacations",
  passwordRequests: "aircontrol_password_requests",
  holidays: "aircontrol_holidays",
  periods: "aircontrol_periods",
  columnConfigs: "aircontrol_column_config",
  personalImports: "aircontrol_personal_imports",
  personalImportRows: "aircontrol_personal_import_rows",
  audit: "aircontrol_audit_log",
  focalTasks: "aircontrol_focal_tasks",
  focalRadar: "aircontrol_focal_radar",
  focalFollowups: "aircontrol_focal_followups",
  focalFollowupItems: "aircontrol_focal_followup_items",
  poclacSessions: "aircontrol_poclac_sessions",
  poclacDrafts: "aircontrol_poclac_drafts",
  focalFormDrafts: "aircontrol_focal_form_drafts"
};

// Tablas que pertenecen a un focal y se filtran por focal_user_id.
const FOCAL_OWNED: string[] = ["focalTasks", "focalRadar", "focalFollowups", "poclacSessions"];
// Tablas con borrado lógico (deleted_at).
const SOFT_DELETE: string[] = ["personal", "vacations"];
// Tablas que el focal (y admin) pueden escribir. El supervisor es solo lectura.
const FOCAL_WRITE: string[] = [
  "focalTasks",
  "focalRadar",
  "focalFollowups",
  "focalFollowupItems",
  "poclacSessions",
  "poclacDrafts",
  "focalFormDrafts",
  "vacations"
];

// Tablas de borradores filtradas por user_id (no por focal_user_id).
const USER_OWNED: string[] = ["poclacDrafts", "focalFormDrafts"];

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOCK_DURATION_MS = 30 * 60 * 1000;

let _reqOrigin = "https://insanmo.github.io";
let _reqIp = "unknown";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": _reqOrigin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "content-type": "application/json"
    }
  });
}

function publicUser(row: Record<string, unknown>) {
  const { password_hash: _passwordHash, ...user } = row;
  return user;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateTemporaryPassword() {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = uppercase + lowercase + digits;
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  const password = Array.from(array).map((byte) => all[byte % all.length]).join("");
  return password.substring(0, 4) + "-" + password.substring(4, 8) + "-" + password.substring(8, 12);
}

function isCorporateEmail(email: string) {
  return /^[^\s@]+@(indra|indracompany)\.com$/i.test(email) || /^[^\s@]+@indra\.[^\s@]+$/i.test(email);
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  _reqOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "https://insanmo.github.io";
  _reqIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": _reqOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Missing Supabase function secrets" }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "login") return await login(db, body);
    if (action === "requestPasswordReset") return await requestPasswordReset(db, body);

    const session = await requireSession(db, body.sessionToken);
    if (action === "me") return json({ user: publicUser(session.user) });
    if (action === "logout") return await logout(db, body.sessionToken);
    if (action === "changePassword") return await changePassword(db, session.user, body);
    if (action === "assignTemporaryPassword") return await assignTemporaryPassword(db, session.user, body);
    if (action === "revokeOtherSessions") return await revokeOtherSessions(db, session);
    if (["select", "insert", "update", "delete"].includes(action)) return await tableAction(db, session.user, action, body);
    if (action === "batchUpsert") return await batchUpsert(db, session.user, body);
    if (action === "batchUpdate") return await batchUpdate(db, session.user, body);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, isSessionError(message) ? 401 : 500);
  }
});

function isSessionError(message: string) {
  const text = String(message || "").toLowerCase();
  return text.includes("sesion invalida")
    || text.includes("sesión inválida")
    || text.includes("sesión requerida")
    || text.includes("sesion requerida");
}

async function login(db: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!isCorporateEmail(email)) return json({ error: "Usa un correo corporativo autorizado." }, 400);

  // Check account lockout
  const { data: userData } = await db
    .from("aircontrol_users")
    .select("id, login_attempts, locked_until")
    .eq("email", email)
    .maybeSingle();

  if (userData?.locked_until && new Date(userData.locked_until) > new Date()) {
    return json({
      error: "Cuenta bloqueada temporalmente por múltiples intentos. Intenta de nuevo en 30 minutos."
    }, 423);
  }

  // Check rate limiting (max 5 failed attempts in 15 min)
  const { count } = await db
    .from("aircontrol_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("success", false)
    .gt("attempted_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString());

  if (count >= MAX_LOGIN_ATTEMPTS) {
    return json({
      error: "Demasiados intentos fallidos. Intenta de nuevo en 15 minutos."
    }, 429);
  }

  const { data, error } = await db.rpc("aircontrol_authenticate", { p_email: email, p_password: password });
  if (error) return json({ error: error.message }, 500);
  const user = Array.isArray(data) ? data[0] : data;

  // Record the attempt
  await db.from("aircontrol_login_attempts").insert({
    email,
    ip_address: _reqIp,
    attempted_at: new Date().toISOString(),
    success: Boolean(user)
  });

  if (!user) {
    // Increment failed attempts counter; lock account if threshold reached
    const newAttempts = (userData?.login_attempts || 0) + 1;
    const updates: Record<string, unknown> = { login_attempts: newAttempts };
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      updates.locked_until = new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS).toISOString();
    }
    await db.from("aircontrol_users").update(updates).eq("email", email);
    return json({ error: "Correo o contraseña incorrectos." }, 401);
  }

  // Success — reset counters
  await db.from("aircontrol_users").update({ login_attempts: 0, locked_until: null }).eq("id", user.id);

  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error: sessionError } = await db.from("aircontrol_sessions").insert({
    user_id: user.id,
    session_hash: sessionHash,
    expires_at: expiresAt
  });
  if (sessionError) return json({ error: sessionError.message }, 500);
  return json({ user: publicUser(user), sessionToken });
}

async function requireSession(db: ReturnType<typeof createClient>, token: unknown) {
  const sessionToken = String(token || "");
  if (!sessionToken) throw new Error("Sesión requerida.");
  const sessionHash = await sha256(sessionToken);
  const { data: session, error } = await db
    .from("aircontrol_sessions")
    .select("id, user_id, expires_at")
    .eq("session_hash", sessionHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) throw new Error("Sesion invalida.");
  const { data: user, error: userError } = await db.from("aircontrol_users").select("*").eq("id", session.user_id).maybeSingle();
  if (userError) throw new Error(userError.message);
  if (!user || user.active === false || user.deleted_at) throw new Error("Sesion invalida.");
  await db
    .from("aircontrol_sessions")
    .update({ expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() })
    .eq("id", session.id);
  return { sessionId: session.id, user };
}

async function logout(db: ReturnType<typeof createClient>, token: unknown) {
  const sessionHash = await sha256(String(token || ""));
  await db.from("aircontrol_sessions").delete().eq("session_hash", sessionHash);
  return json({ ok: true });
}

async function revokeOtherSessions(db: ReturnType<typeof createClient>, session: { sessionId: string; user: Record<string, unknown> }) {
  const { error } = await db
    .from("aircontrol_sessions")
    .delete()
    .eq("user_id", session.user.id)
    .neq("id", session.sessionId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function changePassword(db: ReturnType<typeof createClient>, user: Record<string, unknown>, body: Record<string, unknown>) {
  const password = String(body.password || "");
  if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  const { error } = await db.rpc("aircontrol_set_password", {
    p_user_id: user.id,
    p_password: password,
    p_must_change: false
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function requestPasswordReset(db: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!isCorporateEmail(email)) return json({ error: "Usa un correo corporativo autorizado." }, 400);
  // Rate limit: max 3 password reset requests per email per hour
  const { count } = await db
    .from("aircontrol_password_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gt("requested_at", new Date(Date.now() - 3600000).toISOString());
  if (count >= 3) {
    return json({ error: "Demasiadas solicitudes de recuperación. Intenta de nuevo en una hora." }, 429);
  }
  const { error } = await db.from("aircontrol_password_requests").insert({
    email,
    status: "pendiente",
    requested_at: new Date().toISOString()
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function assignTemporaryPassword(db: ReturnType<typeof createClient>, user: Record<string, unknown>, body: Record<string, unknown>) {
  if (user.role !== "admin") return json({ error: "Solo admin puede asignar claves temporales." }, 403);
  const email = String(body.email || "").trim().toLowerCase();
  if (!isCorporateEmail(email)) return json({ error: "Correo corporativo inválido." }, 400);
  let temporaryPassword = String(body.temporaryPassword || "");
  const autoGenerated = !temporaryPassword;
  if (autoGenerated) {
    temporaryPassword = generateTemporaryPassword();
  } else if (temporaryPassword.length < 8) {
    return json({ error: "La contraseña temporal debe tener al menos 8 caracteres." }, 400);
  }
  const { data: target, error: targetError } = await db.from("aircontrol_users").select("id").eq("email", email).maybeSingle();
  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: "No existe un usuario AirControl con ese correo." }, 404);
  const { error } = await db.rpc("aircontrol_set_password", {
    p_user_id: target.id,
    p_password: temporaryPassword,
    p_must_change: true
  });
  if (error) return json({ error: error.message }, 500);
  await db.from("aircontrol_sessions").delete().eq("user_id", target.id);
  await db.from("aircontrol_password_requests")
    .update({ status: "atendida", resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("email", email)
    .eq("status", "pendiente");
  return json({ ok: true, userId: target.id, temporaryPassword: autoGenerated ? temporaryPassword : undefined });
}

function assertTable(name: string) {
  const table = TABLES[name];
  if (!table) throw new Error("Tabla no permitida.");
  return table;
}

function canRead(user: Record<string, unknown>, name: string) {
  if (user.role === "admin") return true;
  if (["holidays", "personal", "vacations", "periods", "columnConfigs", "personalImports", "personalImportRows"].includes(name)) return true;
  if (["focalTasks", "focalRadar", "focalFollowups", "focalFollowupItems", "poclacSessions", "poclacDrafts", "focalFormDrafts"].includes(name)) return true;
  if (name === "users") return true;
  return false;
}

function canWrite(user: Record<string, unknown>, name: string) {
  if (user.role === "admin") return true;
  if (user.role === "focal" && FOCAL_WRITE.includes(name)) return true;
  if (user.role === "supervisor" && ["personal", "vacations", "periods", "personalImports", "personalImportRows"].includes(name)) return true;
  return false;
}

async function tableAction(db: ReturnType<typeof createClient>, user: Record<string, unknown>, action: string, body: Record<string, unknown>) {
  const name = String(body.table || "");
  const table = assertTable(name);
  if (action === "select") {
    if (!canRead(user, name)) return json({ error: "No autorizado." }, 403);
    const options = (body.options || {}) as Record<string, unknown>;
    let query = db.from(table).select("*");
    if (["users", "personal", "vacations"].includes(name)) query = query.is("deleted_at", null);
    if (name === "users" && user.role !== "admin") query = query.select("id,name,email,role,active,must_change_password,created_at,updated_at");
    if (user.role === "focal" && FOCAL_OWNED.includes(name)) query = query.eq("focal_user_id", user.id);
    if (USER_OWNED.includes(name) && user.role !== "admin") query = query.eq("user_id", user.id);
    if (name === "focalFollowupItems" && user.role === "focal") {
      const { data: owned } = await db.from("aircontrol_focal_followups").select("id").eq("focal_user_id", user.id);
      const ids = (owned || []).map((row: Record<string, unknown>) => row.id);
      query = query.in("followup_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
    const orderColumn = String(options.orderColumn || (name === "passwordRequests" ? "requested_at" : "created_at"));
    if (orderColumn) query = query.order(orderColumn, { ascending: Boolean(options.ascending), nullsFirst: false });
    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);
    let rows: Record<string, unknown>[] = name === "users" ? (data || []).map(publicUser) : (data || []);
    // Filtrado en backend: un FOCAL solo debe ver el personal de su propio equipo.
    // Supervisor y Admin ven todo el personal. Esto evita que un focal manipule la
    // API para acceder a colaboradores de otros equipos.
    if (name === "personal" && user.role === "focal") {
      const filtered: Record<string, unknown>[] = [];
      for (const person of rows) {
        if (await personBelongsToFocal(db, String(person.id), String(user.id), String(user.name || ""))) {
          filtered.push(person);
        }
      }
      rows = filtered;
    }
    return json({ rows });
  }

  if (!canWrite(user, name)) return json({ error: "No autorizado." }, 403);
  const lockError = await writeLockError(db, user, name);
  if (lockError) return json({ error: lockError }, 403);
  if (action === "insert") return await insertRow(db, user, name, table, (body.row || {}) as Record<string, unknown>);
  if (action === "update") return await updateRow(db, user, name, table, String(body.id || ""), (body.changes || {}) as Record<string, unknown>);
  if (action === "delete") return await deleteRow(db, user, name, table, String(body.id || ""));
  return json({ error: "Acción no permitida." }, 400);
}

async function insertRow(db: ReturnType<typeof createClient>, user: Record<string, unknown>, name: string, table: string, raw: Record<string, unknown>) {
  const row = { ...raw };
  if (name === "users") {
    const tempPassword = String(row.temp_password || "");
    if (tempPassword.length < 8) return json({ error: "La contraseña temporal debe tener al menos 8 caracteres." }, 400);
    const { error } = await db.rpc("aircontrol_create_user", {
      p_id: row.id,
      p_name: row.name,
      p_email: String(row.email || "").toLowerCase(),
      p_role: row.role,
      p_password: tempPassword
    });
    if (error) return json({ error: error.message }, 500);
    await db.from("aircontrol_audit_log").insert({
      user_id: user.id, action: "insert", entity: name,
      entity_id: String(row.id || ""),
      detail: { name: row.name, email: row.email, role: row.role }
    }).then().catch(() => {});
    return json({ ok: true });
  }
  if (name === "vacations" && !row.period_id) {
    const period = await activePeriod(db);
    if (period?.id) row.period_id = period.id;
  }
  if (user.role === "focal" && FOCAL_OWNED.includes(name)) row.focal_user_id = user.id;
  if (USER_OWNED.includes(name)) row.user_id = user.id;
  if (name === "focalRadar" && !row.person_id) return json({ error: "Selecciona personal desde Personal Asignado." }, 400);
  if (name === "focalFollowups" && !row.person_id) return json({ error: "Selecciona personal desde Personal Asignado." }, 400);
  if (user.role === "focal" && ["focalTasks", "focalRadar", "focalFollowups"].includes(name)) {
    const personId = name === "focalTasks" ? row.assigned_person_id : row.person_id;
    if (personId && !(await personBelongsToFocal(db, String(personId), String(user.id), String(user.name || "")))) {
      return json({ error: "No tienes acceso a ese colaborador." }, 403);
    }
  }
  if (user.role === "focal" && name === "vacations") {
    if (!(await personBelongsToFocal(db, String(row.collaborator_id || ""), String(user.id), String(user.name || "")))) {
      return json({ error: "No tienes acceso a ese colaborador." }, 403);
    }
    row.focal_user_id = user.id;
    row.created_by = user.id;
  }
  normalizeNullableUuidFields(row);
  const { data: inserted, error } = await db.from(table).insert(row).select("id").maybeSingle();
  if (error) return json({ error: error.message }, 500);
  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "insert", entity: name,
    entity_id: inserted?.id || ""
  }).then().catch(() => {});
  return json({ ok: true });
}

async function updateRow(db: ReturnType<typeof createClient>, user: Record<string, unknown>, name: string, table: string, id: string, raw: Record<string, unknown>) {
  const changes = { ...raw };
  if (name === "users") {
    delete changes.password_hash;
    if (id === String(user.id)) {
      delete changes.role;
      delete changes.active;
    } else if (!canWrite(user, name)) {
      return json({ error: "No autorizado." }, 403);
    }
  } else if (USER_OWNED.includes(name) && user.role === "focal") {
    const { data: existing, error: existingError } = await db.from(table).select("user_id").eq("id", id).maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.user_id !== user.id) return json({ error: "No autorizado." }, 403);
    changes.user_id = user.id;
  } else if (user.role === "focal" && FOCAL_OWNED.includes(name)) {
    const { data: existing, error: existingError } = await db.from(table).select("focal_user_id, deleted_at").eq("id", id).maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.focal_user_id !== user.id || existing.deleted_at) return json({ error: "No autorizado." }, 403);
    changes.focal_user_id = user.id;
  } else if (!canWrite(user, name)) {
    return json({ error: "No autorizado." }, 403);
  }
  if (user.role === "focal" && ["focalTasks", "focalRadar", "focalFollowups"].includes(name)) {
    const personId = name === "focalTasks" ? raw.assigned_person_id : raw.person_id;
    if (personId && !(await personBelongsToFocal(db, String(personId), String(user.id), String(user.name || "")))) {
      return json({ error: "No tienes acceso a ese colaborador." }, 403);
    }
  }
  if (user.role === "focal" && name === "vacations") {
    const { data: existing, error: existingError } = await db
      .from(table)
      .select("collaborator_id, focal_user_id, deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.deleted_at) return json({ error: "Registro no encontrado." }, 404);
    const canAccessExisting = await personBelongsToFocal(db, String(existing.collaborator_id || ""), String(user.id), String(user.name || ""));
    if (!canAccessExisting && existing.focal_user_id !== user.id) return json({ error: "No autorizado." }, 403);
    const nextCollaboratorId = String(changes.collaborator_id || existing.collaborator_id || "");
    if (!(await personBelongsToFocal(db, nextCollaboratorId, String(user.id), String(user.name || "")))) {
      return json({ error: "No tienes acceso a ese colaborador." }, 403);
    }
    changes.focal_user_id = user.id;
  }
  normalizeNullableUuidFields(changes);
  if (["personal", "vacations"].includes(name)) {
    const { data: checkDeleted } = await db.from(table).select("deleted_at").eq("id", id).maybeSingle();
    if (checkDeleted?.deleted_at) return json({ error: "Registro no encontrado." }, 404);
  }
  const { error } = await db.from(table).update(changes).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "update", entity: name,
    entity_id: id, detail: { changes }
  }).then().catch(() => {});
  return json({ ok: true });
}

function normalizeNullableUuidFields(row: Record<string, unknown>) {
  for (const key of ["focal_user_id", "created_by", "resolved_by", "period_id", "closed_by", "activated_by", "uploaded_by", "active_period_id", "last_import_id", "personal_id", "import_id", "person_id", "assigned_person_id", "followup_id", "session_id", "record_id"]) {
    if (row[key] === "") row[key] = null;
  }
}

// Valida que un colaborador (personal) pertenezca al equipo del focal autenticado.
// Evita que un focal asigne manualmente personal de otro equipo manipulando el frontend.
// Normaliza un texto para comparación de nombres (minúsculas + sin diacríticos),
// equivalente a normalizeKey() del frontend.
function normalizeName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function personBelongsToFocal(db: ReturnType<typeof createClient>, personId: string, userId: string, userName: string) {
  if (!personId) return true;
  const { data, error } = await db
    .from("aircontrol_personal")
    .select("focal_user_id, excel_fields")
    .eq("id", personId)
    .maybeSingle();
  if (error || !data) return false;
  if (data.focal_user_id === userId) return true;
  const excelFocal = data.excel_fields && (data.excel_fields["FOCAL"] ?? data.excel_fields["focal"]);
  if (excelFocal && String(excelFocal).trim() && normalizeName(String(excelFocal)) === normalizeName(userName || "")) return true;
  return false;
}

async function activePeriod(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from("aircontrol_periods")
    .select("id, month, status")
    .in("status", ["abierto"])
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function writeLockError(db: ReturnType<typeof createClient>, user: Record<string, unknown>, name: string) {
  if (user.role !== "focal" || name !== "vacations") return "";
  const { data: latest, error } = await db
    .from("aircontrol_periods")
    .select("id, month, status")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return "";
  if (latest && latest.status !== "abierto") {
    return "El periodo estÃ¡ cerrado. Los focales no pueden registrar ni editar vacaciones. Debe reabrirse el periodo para continuar.";
  }
  return "";
}

async function deleteRow(db: ReturnType<typeof createClient>, user: Record<string, unknown>, name: string, table: string, id: string) {
  if (name === "users") {
    return await deleteUser(db, user, id);
  }
  if (USER_OWNED.includes(name) && user.role === "focal") {
    const { data: existing, error: existingError } = await db.from(table).select("user_id").eq("id", id).maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.user_id !== user.id) return json({ error: "No autorizado." }, 403);
  } else if (user.role === "focal" && FOCAL_OWNED.includes(name)) {
    const { data: existing, error: existingError } = await db.from(table).select("focal_user_id, deleted_at").eq("id", id).maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.focal_user_id !== user.id || existing.deleted_at) return json({ error: "No autorizado." }, 403);
  } else if (user.role === "focal" && name === "vacations") {
    const { data: existing, error: existingError } = await db
      .from(table)
      .select("collaborator_id, focal_user_id, deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);
    if (!existing || existing.deleted_at) return json({ ok: true });
    const canAccessExisting = await personBelongsToFocal(db, String(existing.collaborator_id || ""), String(user.id), String(user.name || ""));
    if (!canAccessExisting && existing.focal_user_id !== user.id) return json({ error: "No autorizado." }, 403);
  }
  if (name === "focalFollowups") {
    await db.from("aircontrol_focal_followup_items").delete().eq("followup_id", id);
  }
  if (SOFT_DELETE.includes(name)) {
    const { error } = await db.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await db.from(table).delete().eq("id", id);
    if (error) return json({ error: error.message }, 500);
  }
  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "delete", entity: name,
    entity_id: id
  }).then().catch(() => {});
  return json({ ok: true });
}

async function deleteUser(db: ReturnType<typeof createClient>, user: Record<string, unknown>, id: string) {
  if (String(user.id) === id) return json({ error: "No puedes eliminar tu propio usuario." }, 400);

  const { data: target, error: targetError } = await db.from("aircontrol_users").select("id, deleted_at").eq("id", id).maybeSingle();
  if (targetError) return json({ error: targetError.message }, 500);
  if (!target || target.deleted_at) return json({ error: "Usuario no encontrado." }, 404);

  const { error } = await db.from("aircontrol_users").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return json({ error: error.message }, 500);

  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "delete", entity: "users",
    entity_id: id
  }).then().catch(() => {});

  return json({ ok: true });
}

async function batchUpsert(db: ReturnType<typeof createClient>, user: Record<string, unknown>, body: Record<string, unknown>) {
  const name = String(body.table || "");
  const table = assertTable(name);
  if (!canWrite(user, name)) return json({ error: "No autorizado." }, 403);
  const lockError = await writeLockError(db, user, name);
  if (lockError) return json({ error: lockError }, 403);

  const rows = (body.rows || []) as Record<string, unknown>[];
  if (!rows.length) return json({ ok: true });

  if (user.role === "focal" && FOCAL_OWNED.includes(name)) {
    for (const row of rows) row.focal_user_id = user.id;
  }
  if (USER_OWNED.includes(name)) {
    for (const row of rows) row.user_id = user.id;
  }
  for (const row of rows) normalizeNullableUuidFields(row);

  const { error } = await db.from(table).upsert(rows);
  if (error) return json({ error: error.message }, 500);

  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "batchUpsert", entity: name,
    entity_id: "", detail: { row_count: rows.length }
  }).then().catch(() => {});

  return json({ ok: true, count: rows.length });
}

async function batchUpdate(db: ReturnType<typeof createClient>, user: Record<string, unknown>, body: Record<string, unknown>) {
  const name = String(body.table || "");
  const table = assertTable(name);
  if (!canWrite(user, name)) return json({ error: "No autorizado." }, 403);
  const lockError = await writeLockError(db, user, name);
  if (lockError) return json({ error: lockError }, 403);

  const ids = (body.ids || []) as string[];
  const changes = (body.changes || {}) as Record<string, unknown>;
  if (!ids.length) return json({ ok: true });

  normalizeNullableUuidFields(changes);

  const { error } = await db.from(table).update(changes).in("id", ids);
  if (error) return json({ error: error.message }, 500);

  await db.from("aircontrol_audit_log").insert({
    user_id: user.id, action: "batchUpdate", entity: name,
    entity_id: "", detail: { row_count: ids.length, changes }
  }).then().catch(() => {});

  return json({ ok: true, count: ids.length });
}
