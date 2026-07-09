import { state } from "./state.js";

// Borradores de formularios de Focal Command.
// Usa la tabla aircontrol_poclac_drafts (ya soportada por la Edge Function) como
// almacén unificado. El módulo se codifica en draft_key: `${module}:${recordId|'new'}`.

const TABLE = "poclacDrafts";
const SAVE_DELAY = 2000;

let activeDraft = null; // { module, recordId, draftKey, readForm, timer }

export function draftKeyFor(module, recordId) {
  return `${module}:${recordId || "new"}`;
}

export function parseDraftKey(key) {
  const parts = String(key || "").split(":");
  const module = parts[0];
  const rawRecordId = parts.slice(1).join(":");
  const recordId = rawRecordId === "new" || rawRecordId === "" ? null : rawRecordId;
  return { module, recordId: recordId || null };
}

function findDraft(draftKey) {
  const userId = state.currentUser?.id;
  return state.poclacDrafts.find((d) => d.user_id === userId && d.draft_key === draftKey);
}

export function setActiveDraft({ module, recordId, draftKey, readForm }) {
  clearActiveDraft();
  activeDraft = { module, recordId, draftKey, readForm, timer: null };
}

export function clearActiveDraft() {
  if (activeDraft && activeDraft.timer) clearTimeout(activeDraft.timer);
  activeDraft = null;
}

export function scheduleDraftSave() {
  if (!activeDraft) return;
  if (activeDraft.timer) clearTimeout(activeDraft.timer);
  activeDraft.timer = setTimeout(() => {
    saveActiveDraftNow().catch(() => {});
  }, SAVE_DELAY);
}

export async function saveActiveDraftNow() {
  if (!activeDraft || typeof activeDraft.readForm !== "function") return;
  const data = activeDraft.readForm();
  if (!data) return;
  await upsertDraft(activeDraft.module, activeDraft.recordId, activeDraft.draftKey, data);
}

export async function flushDrafts() {
  await saveActiveDraftNow();
}

export async function upsertDraft(module, recordId, draftKey, data) {
  const userId = state.currentUser?.id;
  if (!userId) return;
  const existing = findDraft(draftKey);
  const base = { draft_key: draftKey, draft_data: data, updated_at: new Date().toISOString() };
  try {
    if (existing) {
      await state.store.update(TABLE, existing.id, base);
    } else {
      const rec = { id: crypto.randomUUID(), user_id: userId, session_id: recordId || null, created_at: base.updated_at, ...base };
      state.poclacDrafts.push(rec);
      await state.store.insert(TABLE, rec);
    }
  } catch (error) {
    console.warn("No se pudo guardar el borrador:", error);
  }
}

export function getDraftFor(module, recordId) {
  return findDraft(draftKeyFor(module, recordId));
}

export function getAnyDraftForModule(module) {
  const userId = state.currentUser?.id;
  return state.poclacDrafts.find((d) => d.user_id === userId && String(d.draft_key || "").startsWith(`${module}:`)) || null;
}

export async function deleteDraftByKey(module, recordId) {
  const existing = findDraft(draftKeyFor(module, recordId));
  if (existing) await deleteDraftById(existing.id);
}

export async function deleteDraftById(id) {
  try {
    await state.store.delete(TABLE, id);
  } catch (error) {
    console.warn("No se pudo eliminar el borrador:", error);
  }
  state.poclacDrafts = state.poclacDrafts.filter((d) => d.id !== id);
}

// Aplica un objeto de datos a un formulario por nombre de campo.
export function applyFormData(form, data) {
  if (!form || !data) return;
  for (const [key, value] of Object.entries(data)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(value);
    } else if (typeof value === "string" || typeof value === "number") {
      el.value = value;
    }
  }
}
