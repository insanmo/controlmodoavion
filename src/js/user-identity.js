import { state } from "./state.js";
import { normalizeName, normalizePersonDisplayName } from "./utils.js";

export function userIdentityKey(name) {
  return normalizeName(normalizePersonDisplayName(name));
}

export function findUserByName(name, users = state.users) {
  const key = userIdentityKey(name);
  if (!key) return null;
  const priority = { admin: 3, supervisor: 2, focal: 1 };
  return users.filter((user) => userIdentityKey(user.name) === key)
    .sort((a, b) => (priority[b.role] || 0) - (priority[a.role] || 0)
      || Number(b.active !== false) - Number(a.active !== false)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

// Ser responsable de personal no requiere una segunda cuenta con rol focal.
export function focalUsers() {
  const assignedIds = new Set(state.personal.map((person) => person.focal_user_id).filter(Boolean));
  const assignedNames = new Set(state.personal.flatMap((person) => Object.entries(person.excel_fields || {})
    .filter(([header]) => normalizeName(header) === "focal")
    .map(([, name]) => userIdentityKey(name))).filter(Boolean));
  const candidates = state.users.filter((user) => user.role === "focal"
    || assignedIds.has(user.id) || assignedNames.has(userIdentityKey(user.name)));
  const names = new Set(candidates.map((user) => userIdentityKey(user.name)));
  return [...names].map((name) => findUserByName(name)).filter(Boolean);
}

// Persisted in the existing configuration table so all browsers share the choice.
export const DEFAULT_FOCAL_CONFIG = "__aircontrol_default_focal__";

export function defaultFocalUser() {
  const active = state.users.filter((user) => user.active !== false && !user.deleted_at);
  const configured = state.defaultFocalConfig?.display_name;
  if (configured) return active.find((user) => user.id === configured) || null;
  return findUserByName("Rosa Hernandez", active.filter((user) => user.role === "supervisor")) || null;
}

export function resolvePersonalFocal(person, focalName) {
  const active = state.users.filter((user) => user.active !== false && !user.deleted_at);
  const named = String(focalName ?? "").trim();
  if (named) {
    const matched = findUserByName(named, active);
    if (matched) return matched;
  }
  return active.find((user) => user.id === person.focal_user_id) || defaultFocalUser();
}

export function isUnassignedFocalName(name) {
  return ["", "-", "--", "sin focal", "sin asignar", "no asignado", "n/a", "na", "pendiente"].map(userIdentityKey).includes(userIdentityKey(name));
}
