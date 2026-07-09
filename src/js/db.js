import { state, TABLES } from "./state.js";
import { cleanMojibake } from "./security.js";

export async function fetchTable(name) {
  if (name === "holidays") {
    return state.store.select("holidays", { orderColumn: "date", ascending: true });
  }
  if (name === "periods") {
    return state.store.select("periods", { orderColumn: "month", ascending: false });
  }
  if (name === "columnConfigs") {
    return state.store.select("columnConfigs", { orderColumn: "display_order", ascending: true });
  }
  if (name === "personalImports") {
    return state.store.select("personalImports", { orderColumn: "uploaded_at", ascending: false });
  }
  return state.store.select(name);
}

export async function loadData(userRole) {
  const fetches = [
    fetchOptionalTable("users"),
    fetchOptionalTable("personal"),
    fetchOptionalTable("vacations"),
    fetchOptionalTable("holidays"),
    fetchOptionalTable("periods"),
    fetchOptionalTable("columnConfigs"),
    fetchOptionalTable("personalImports"),
    fetchOptionalTable("focalTasks"),
    fetchOptionalTable("focalRadar"),
    fetchOptionalTable("focalFollowups"),
    fetchOptionalTable("focalFollowupItems"),
    fetchOptionalTable("poclacSessions"),
    fetchOptionalTable("poclacDrafts")
  ];
  if (userRole === "admin") fetches.push(fetchOptionalTable("passwordRequests"));
  const [users, personal, vacations, holidays, periods, columnConfigs, personalImports, focalTasks, focalRadar, focalFollowups, focalFollowupItems, poclacSessions, poclacDrafts, passwordRequests] = await Promise.all(fetches);
  state.users = users;
  state.personal = personal;
  state.vacations = vacations;
  state.holidays = holidays;
  state.periods = periods || [];
  state.columnConfigs = columnConfigs || [];
  state.personalImports = personalImports || [];
  state.focalTasks = focalTasks;
  state.focalRadar = focalRadar;
  state.focalFollowups = focalFollowups;
  state.focalFollowupItems = focalFollowupItems;
  state.poclacSessions = poclacSessions;
  state.poclacDrafts = poclacDrafts;
  state.passwordRequests = passwordRequests || [];
  sanitizeLoadedText();
  state.dataLoaded = true;
}

async function fetchOptionalTable(name) {
  try {
    return await fetchTable(name);
  } catch {
    return [];
  }
}

function sanitizeLoadedText() {
  state.users = sanitizeRows(state.users);
  state.personal = sanitizeRows(state.personal);
  state.vacations = sanitizeRows(state.vacations);
  state.passwordRequests = sanitizeRows(state.passwordRequests);
  state.holidays = sanitizeRows(state.holidays);
  state.periods = sanitizeRows(state.periods);
  state.columnConfigs = sanitizeRows(state.columnConfigs);
  state.personalImports = sanitizeRows(state.personalImports);
  state.focalTasks = sanitizeRows(state.focalTasks);
  state.focalRadar = sanitizeRows(state.focalRadar);
  state.focalFollowups = sanitizeRows(state.focalFollowups);
  state.focalFollowupItems = sanitizeRows(state.focalFollowupItems);
  state.poclacSessions = sanitizeRows(state.poclacSessions);
  state.poclacDrafts = sanitizeRows(state.poclacDrafts);
}

function sanitizeRows(rows) {
  return (rows || []).map((row) => {
    const clean = { ...row };
    for (const key of Object.keys(clean)) {
      if (typeof clean[key] === "string") clean[key] = cleanMojibake(clean[key]);
    }
    return clean;
  });
}

export async function persist(name, row) {
  await state.store.insert(name, row);
}

export async function updateRecord(name, id, changes) {
  await state.store.update(name, id, changes);
  await loadData(state.currentUser?.role);
}

export async function deleteRecord(name, id) {
  await state.store.delete(name, id);
  await loadData(state.currentUser?.role);
}

export async function upsertPersonalRows(rows) {
  if (!rows.length) return;
  await state.store.batchUpsert("personal", rows);
}

export async function batchUpsertImportRows(rows) {
  if (!rows.length) return;
  await state.store.batchUpsert("personalImportRows", rows);
}

export async function batchMarkMissingPersonal(ids) {
  if (!ids.length) return;
  await state.store.batchUpdate("personal", ids, {
    missing_from_latest_import: true,
    status: "inactivo",
    updated_at: new Date().toISOString()
  });
}
