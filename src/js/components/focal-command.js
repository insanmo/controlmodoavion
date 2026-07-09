import { state, TABLES } from "../state.js";
import { visiblePersonal } from "./common.js";
import { safeCell, dateText, toDateInput, personInitials, svgIcon } from "../utils.js";
import { notify, confirmAction } from "../ui.js";
import { loadData } from "../db.js";
import {
  draftKeyFor,
  parseDraftKey,
  setActiveDraft,
  clearActiveDraft,
  scheduleDraftSave,
  flushDrafts,
  saveActiveDraftNow,
  getDraftFor,
  getAnyDraftForModule,
  deleteDraftByKey,
  deleteDraftById,
  applyFormData
} from "../draft-store.js";

const FOCAL_STATUSES = ["Por hacer", "En progreso", "Completada"];
const TASK_PRIORITIES = ["Sin prioridad", "Alta", "Media", "Baja"];
const POCLAC_TYPES = ["POCLAC", "Reunión cliente", "One-on-one", "Otro"];
const POCLAC_STATUSES = ["Pendiente", "Completado"];
const SEG_STATUSES = ["Activo", "En espera", "Cerrado"];

let fcTaskSearchTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function currentUserId() {
  return state.currentUser?.id;
}

function isFocal() {
  return state.currentUser?.role === "focal";
}

function canWriteFocal() {
  return state.currentUser?.role === "admin" || state.currentUser?.role === "focal";
}

function focalOptions() {
  if (isFocal()) return [[state.currentUser.id, state.currentUser.name]];
  return state.users.filter((u) => u.role === "focal").map((u) => [u.id, u.name]);
}

function personSelectOptions(selectedId = "") {
  const people = visiblePersonal();
  if (!people.length) return `<option value="">— sin personal —</option>`;
  return people
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${safeCell(p.name)}</option>`)
    .join("");
}

function personName(id) {
  return state.personal.find((p) => p.id === id)?.name || "Personal no encontrado";
}

function riskLevel(percent) {
  const p = Number(percent || 0);
  if (p >= 70) return "Alto";
  if (p >= 40) return "Medio";
  return "Bajo";
}

async function refresh() {
  await loadData(state.currentUser?.role);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

function statusBadge(status) {
  const map = { "Por hacer": "pendiente", "En progreso": "reprogramado", "Completada": "completado", "Pendiente": "pendiente", "Completado": "completado" };
  const tone = map[status] || "pendiente";
  return `<span class="status ${tone}">${safeCell(status)}</span>`;
}

function priorityBadge(priority) {
  const map = { "Alta": "b-al", "Media": "b-me", "Baja": "b-ba" };
  const tone = map[priority] || "b-no";
  const label = priority === "Sin prioridad" ? "—" : priority;
  return `<span class="badge ${tone}">${safeCell(label)}</span>`;
}

function kpiCard({ icon, label, value, tone }) {
  return `<div class="fc-kpi-card ${tone}">
    <div class="fc-kpi-ico">${svgIcon(icon)}</div>
    <div class="fc-kpi-body">
      <span class="fc-kpi-label">${safeCell(label)}</span>
      <strong class="fc-kpi-value">${value}</strong>
    </div>
  </div>`;
}

function draftBannerHTML(module) {
  if (state.fcForm.active) return "";
  const draft = getAnyDraftForModule(module);
  if (!draft) return "";
  return `
    <div class="fc-draft-banner" data-fc-draft-key="${safeCell(draft.draft_key)}">
      <div class="fc-draft-banner-text">
        <i class="fc-ico">${svgIcon("file")}</i>
        <span>Se encontró un borrador sin guardar. ¿Deseas restaurarlo?</span>
      </div>
      <div class="fc-draft-banner-actions">
        <button type="button" class="ghost-btn compact-btn" data-fc-draft-discard>Descartar borrador</button>
        <button type="button" class="primary-btn compact-btn" data-fc-draft-restore>Restaurar</button>
      </div>
    </div>`;
}

function bindDraftBanner(content, module) {
  content.querySelectorAll("[data-fc-draft-restore]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const key = btn.closest("[data-fc-draft-key]")?.dataset.fcDraftKey;
      const { recordId } = parseDraftKey(key);
      state.fcForm = { active: true, module, id: recordId };
      renderActiveTabLocal();
    })
  );
  content.querySelectorAll("[data-fc-draft-discard]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const key = btn.closest("[data-fc-draft-key]")?.dataset.fcDraftKey;
      const { module: m, recordId } = parseDraftKey(key);
      await deleteDraftByKey(m, recordId);
      renderActiveTabLocal();
    })
  );
}

// ===========================================================================
// Dispatcher
// ===========================================================================
export function renderFocalCommand(tab, content) {
  if (tab === "fc-tareas") return renderTasksPage(content);
  if (tab === "fc-radar") return renderRadarPage(content);
  if (tab === "fc-seguimientos") return renderFollowupsPage(content);
  if (tab === "fc-poclac") return renderPoclacPage(content);
  content.innerHTML = `<div class="dashboard-card"><div class="dashboard-card-header"><h3>Focal Command</h3></div><p class="panel-copy">Sección no encontrada.</p></div>`;
}

// ===========================================================================
// 1. TAREAS
// ===========================================================================
function renderTasksPage(content) {
  const tasks = state.focalTasks.slice();
  const total = tasks.length;
  const done = tasks.filter((t) => t.is_done || t.status === "Completada").length;
  const inProgress = tasks.filter((t) => !t.is_done && t.status === "En progreso").length;
  const high = tasks.filter((t) => !t.is_done && t.priority === "Alta").length;

  const filter = state.filters.fcTasksFilter || "all";
  const search = String(state.filters.fcTasksSearch || "").toLowerCase();
  const filtered = tasks.filter((t) => {
    if (search && !`${t.title} ${t.notes || ""} ${t.people_text || ""}`.toLowerCase().includes(search)) return false;
    if (filter === "done") return t.is_done || t.status === "Completada";
    if (filter === "Alta") return t.priority === "Alta" && !t.is_done;
    if (filter === "all") return true;
    return t.status === filter && !t.is_done;
  });
  const highList = filtered.filter((t) => t.priority === "Alta" && !t.is_done);
  const restList = filtered.filter((t) => !(t.priority === "Alta" && !t.is_done));

  const filtersBar = `
    <div class="focal-filters">
      ${["all", "En progreso", "Por hacer", "done", "Alta"].map((f) => `<button class="fbtn ${filter === f ? "active" : ""}" data-fc-task-filter="${f}">${f === "all" ? "Todas" : f === "done" ? "Completadas" : f === "Alta" ? "Alta prioridad" : f}</button>`).join("")}
      <div class="sw"><i class="fc-ico">${svgIcon("search")}</i><input id="fcTaskSearch" placeholder="Buscar tarea..." value="${safeCell(state.filters.fcTasksSearch || "")}"></div>
      ${canWriteFocal() ? `<button class="btn-add" id="fcNewTaskBtn"><i class="fc-ico">${svgIcon("plus")}</i> Nueva tarea</button>` : ""}
    </div>`;

  const taskRow = (t) => {
    const doneFlag = t.is_done || t.status === "Completada";
    const assigned = t.assigned_person_id ? personName(t.assigned_person_id) : (t.people_text || "—");
    return `<div class="trow ${doneFlag ? "done" : ""}" data-fc-task="${t.id}">
      <div class="tchk ${doneFlag ? "done" : ""}" data-fc-task-toggle="${t.id}">${doneFlag ? svgIcon("check") : ""}</div>
      <div class="tname ${doneFlag ? "done" : ""}">${safeCell(t.title)}</div>
      ${statusBadge(t.status)}
      ${priorityBadge(t.priority)}
      <div class="tdate ${t.due_date && !doneFlag && new Date(t.due_date) < new Date() ? "ov" : ""}">${t.due_date ? dateText(t.due_date) : "—"}</div>
      <div class="tppl">${safeCell(assigned)}</div>
    </div>`;
  };

  let listHtml = "";
  if (!filtered.length) {
    listHtml = `<div class="empty">Sin tareas en esta vista.</div>`;
  } else {
    if (highList.length) listHtml += `<div class="ssep">Alta prioridad</div>${highList.map(taskRow).join("")}`;
    if (restList.length) {
      if (highList.length) listHtml += `<div class="ssep">Resto de actividades</div>`;
      listHtml += restList.map(taskRow).join("");
    }
  }

  const kpis = `
    <div class="fc-kpi-grid">
      ${kpiCard({ icon: "checklist", label: "Total tareas", value: total, tone: "blue" })}
      ${kpiCard({ icon: "clock", label: "En progreso", value: inProgress, tone: "sky" })}
      ${kpiCard({ icon: "alert", label: "Alta prioridad", value: high, tone: "rose" })}
      ${kpiCard({ icon: "check", label: "Completadas", value: done, tone: "green" })}
    </div>`;

  const formHtml = (state.fcForm.active && state.fcForm.module === "tasks") ? tasksFormHTML() : "";

  content.innerHTML = `
    <section class="focal-command dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>Tareas</h3><p>Gestiona las actividades de tu equipo.</p></div>
      </div>
      ${kpis}
      ${draftBannerHTML("tasks")}
      ${filtersBar}
      ${formHtml}
      <div class="col-hdr"><span></span><span>Actividad</span><span>Estado</span><span>Prioridad</span><span>Vence</span><span>Personas</span></div>
      <div id="fcTaskList">${listHtml}</div>
    </section>`;

  content.querySelector("#fcNewTaskBtn")?.addEventListener("click", () => openForm("tasks", null));
  content.querySelector("#fcTaskSearch")?.addEventListener("input", (e) => {
    state.filters.fcTasksSearch = e.target.value;
    const pos = e.target.selectionStart;
    clearTimeout(fcTaskSearchTimer);
    fcTaskSearchTimer = setTimeout(() => {
      saveActiveDraftNow().catch(() => {});
      renderFocalCommand("fc-tareas", content);
      const next = content.querySelector("#fcTaskSearch");
      if (next) { next.focus(); if (typeof pos === "number") next.setSelectionRange(pos, pos); }
    }, 300);
  });
  content.querySelectorAll("[data-fc-task-filter]").forEach((btn) =>
    btn.addEventListener("click", () => { state.filters.fcTasksFilter = btn.dataset.fcTaskFilter; renderFocalCommand("fc-tareas", content); })
  );
  content.querySelectorAll("[data-fc-task-toggle]").forEach((el) =>
    el.addEventListener("click", (ev) => { ev.stopPropagation(); toggleTaskDone(el.dataset.fcTaskToggle); })
  );
  content.querySelectorAll("[data-fc-task]").forEach((el) =>
    el.addEventListener("click", () => openForm("tasks", el.dataset.fcTask))
  );

  bindDraftBanner(content, "tasks");
  if (formHtml) bindTasksForm(content);
}

function tasksFormHTML() {
  const id = state.fcForm.id;
  const t = id ? state.focalTasks.find((x) => x.id === id) : null;
  const draft = getDraftFor("tasks", id);
  const src = (draft?.draft_data) || (t || {});

  const personValue = src.assigned_person_id || t?.assigned_person_id || "";
  const personField = visiblePersonal().length
    ? `<label class="span-2">Personal asignado (opcional)<select name="assigned_person_id">${`<option value="">— ninguno —</option>`}${personSelectOptions(personValue)}</select></label>`
    : "";

  const focalField = isFocal()
    ? `<input type="hidden" name="focal_user_id" value="${currentUserId()}">`
    : `<label>Focal asignado<select name="focal_user_id" required>${focalOptions().map(([v, txt]) => `<option value="${v}" ${v === (src.focal_user_id || t?.focal_user_id || currentUserId()) ? "selected" : ""}>${safeCell(txt)}</option>`).join("")}</select></label>`;

  return `
    <section class="fc-form-panel dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>${t ? "Editar tarea" : "Nueva tarea"}</h3><p>Los cambios se autoguardan como borrador.</p></div>
        <button type="button" class="ghost-btn compact-btn" data-fc-form-cancel>Cancelar edición</button>
      </div>
      <form id="fcTaskForm" class="form-grid fc-embedded-form">
        <input type="hidden" name="id" value="${t?.id || ""}">
        ${focalField}
        <label class="span-4">Actividad<input name="title" required value="${safeCell(src.title || "")}" placeholder="Descripción de la actividad"></label>
        <label>Estado<select name="status">${FOCAL_STATUSES.map((s) => `<option value="${s}" ${s === (src.status || "Por hacer") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>Prioridad<select name="priority">${TASK_PRIORITIES.map((p) => `<option value="${p}" ${p === (src.priority || "Sin prioridad") ? "selected" : ""}>${p === "Sin prioridad" ? "—" : p}</option>`).join("")}</select></label>
        <label>Fecha de vencimiento<input type="date" name="due_date" value="${src.due_date || ""}"></label>
        ${personField}
        <label class="span-4">Personas (texto libre, opcional)<input name="people_text" value="${safeCell(src.people_text || "")}" placeholder="PO, CL, Focal..."></label>
        <label class="span-4">Notas y comentarios<textarea name="notes" rows="3" placeholder="Notas...">${safeCell(src.notes || "")}</textarea></label>
        <div class="fc-form-actions span-4">
          <button type="button" class="ghost-btn compact-btn" data-fc-form-clear>Nuevo / Limpiar</button>
          ${t ? `<button type="button" class="danger-btn compact-btn" data-fc-form-delete><i class="fc-ico">${svgIcon("trash")}</i> Eliminar</button>` : ""}
          <button type="submit" class="primary-btn compact-btn">Guardar</button>
        </div>
      </form>
    </section>`;
}

function bindTasksForm(content) {
  const form = content.querySelector("#fcTaskForm");
  if (!form) return;
  form.addEventListener("submit", (e) => saveTask(e, state.fcForm.id));
  content.querySelector("[data-fc-form-cancel]")?.addEventListener("click", () => closeForm());
  form.querySelector("[data-fc-form-clear]")?.addEventListener("click", () => clearForm("tasks"));
  form.querySelector("[data-fc-form-delete]")?.addEventListener("click", () => removeTask(state.fcForm.id));
  setActiveDraft({ module: "tasks", recordId: state.fcForm.id, draftKey: draftKeyFor("tasks", state.fcForm.id), readForm: () => collectTasksForm() });
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
}

function collectTasksForm() {
  const form = document.getElementById("fcTaskForm");
  if (!form) return null;
  return Object.fromEntries(new FormData(form).entries());
}

async function saveTask(event, id) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!form.title?.trim()) return notify("Ingresa el título de la tarea.");
  const isDone = form.status === "Completada";
  const row = {
    title: form.title.trim(),
    status: form.status,
    priority: form.priority,
    due_date: form.due_date || null,
    people_text: form.people_text || "",
    notes: form.notes || "",
    is_done: isDone,
    assigned_person_id: form.assigned_person_id || null,
    focal_user_id: form.focal_user_id || currentUserId(),
    updated_by: currentUserId(),
    updated_at: nowIso()
  };
  try {
    if (id) {
      await state.store.update("focalTasks", id, row);
    } else {
      await state.store.insert("focalTasks", { id: crypto.randomUUID(), ...row, created_by: currentUserId(), created_at: nowIso() });
    }
    await deleteDraftByKey("tasks", id || "new");
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify(id ? "Tarea actualizada." : "Tarea guardada.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo guardar la tarea.");
  }
}

async function removeTask(id) {
  if (!await confirmAction("¿Eliminar esta tarea? Esta acción no se puede deshacer.", { title: "Eliminar tarea", confirmText: "Eliminar" })) return;
  try {
    await state.store.delete("focalTasks", id);
    await deleteDraftByKey("tasks", id);
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify("Tarea eliminada.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo eliminar la tarea.");
  }
}

async function toggleTaskDone(id) {
  const task = state.focalTasks.find((t) => t.id === id);
  if (!task) return;
  const isDone = !(task.is_done || task.status === "Completada");
  const changes = { is_done: isDone, status: isDone ? "Completada" : (task.status === "Completada" ? "En progreso" : task.status), updated_by: currentUserId(), updated_at: nowIso() };
  try {
    await state.store.update("focalTasks", id, changes);
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo actualizar la tarea.");
  }
}

// ===========================================================================
// 2. RADAR DE EQUIPO
// ===========================================================================
function renderRadarPage(content) {
  const people = visiblePersonal();
  const rows = state.focalRadar.slice().sort((a, b) => Number(b.release_risk_percent || 0) - Number(a.release_risk_percent || 0));
  const alto = rows.filter((r) => riskLevel(r.release_risk_percent) === "Alto").length;
  const medio = rows.filter((r) => riskLevel(r.release_risk_percent) === "Medio").length;
  const bajo = rows.filter((r) => riskLevel(r.release_risk_percent) === "Bajo").length;

  if (!people.length) {
    content.innerHTML = `
      <section class="focal-command dashboard-card">
        <div class="dashboard-card-header"><div><h3>Radar de Equipo</h3><p>Personal con riesgo de liberación.</p></div></div>
        <div class="empty">Primero carga o asigna personal desde <strong>Personal Asignado</strong> para usar el Radar de Equipo.</div>
      </section>`;
    return;
  }

  const rowsHtml = rows.length
    ? rows.map((r) => {
        const level = riskLevel(r.release_risk_percent);
        const rc = level === "Alto" ? "r-alto" : level === "Medio" ? "r-medio" : "r-bajo";
        const pct = Number(r.release_risk_percent || 0);
        return `<div class="radar-row ${rc}" data-fc-radar="${r.id}">
          <div><div class="eng-name">${safeCell(personName(r.person_id))}</div><div class="eng-proj">${safeCell(r.current_project || "—")}</div></div>
          <div>${r.estimated_close_date ? dateText(r.estimated_close_date) : "—"}</div>
          <div><div class="risk-bar"><div class="risk-fill" style="width:${pct}%"></div></div><span class="risk-pct">${pct}% riesgo</span></div>
          <div><span class="r-badge">${level}</span></div>
          <div class="radar-action">${safeCell(r.recommended_action || "—")}</div>
        </div>`;
      }).join("")
    : `<div class="empty">Aún no hay personal en el radar. Usa <strong>Agregar personal</strong>.</div>`;

  const kpis = `
    <div class="fc-kpi-grid fc-kpi-grid-3">
      ${kpiCard({ icon: "alert", label: "Riesgo alto (≥70%)", value: alto, tone: "rose" })}
      ${kpiCard({ icon: "flag", label: "Riesgo medio", value: medio, tone: "amber" })}
      ${kpiCard({ icon: "shield", label: "Riesgo bajo", value: bajo, tone: "green" })}
    </div>`;

  const formHtml = (state.fcForm.active && state.fcForm.module === "radar") ? radarFormHTML() : "";

  content.innerHTML = `
    <section class="focal-command dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>Radar de Equipo</h3><p>Personal con riesgo de liberación.</p></div>
        ${canWriteFocal() ? `<button class="btn-add" id="fcAddRadarBtn"><i class="fc-ico">${svgIcon("plus")}</i> Agregar personal</button>` : ""}
      </div>
      ${kpis}
      ${draftBannerHTML("radar")}
      ${formHtml}
      <div class="radar-hdr"><span>Personal / Proyecto</span><span>Cierre est.</span><span>Riesgo release</span><span>Nivel</span><span>Acción recomendada</span></div>
      <div id="fcRadarList">${rowsHtml}</div>
    </section>`;

  content.querySelector("#fcAddRadarBtn")?.addEventListener("click", () => openForm("radar", null));
  content.querySelectorAll("[data-fc-radar]").forEach((el) =>
    el.addEventListener("click", () => openForm("radar", el.dataset.fcRadar))
  );

  bindDraftBanner(content, "radar");
  if (formHtml) bindRadarForm(content);
}

function radarFormHTML() {
  const id = state.fcForm.id;
  const r = id ? state.focalRadar.find((x) => x.id === id) : null;
  const draft = getDraftFor("radar", id);
  const src = (draft?.draft_data) || (r || {});

  const focalField = isFocal()
    ? `<input type="hidden" name="focal_user_id" value="${currentUserId()}">`
    : `<label>Focal asignado<select name="focal_user_id" required>${focalOptions().map(([v, txt]) => `<option value="${v}" ${v === (src.focal_user_id || r?.focal_user_id || currentUserId()) ? "selected" : ""}>${safeCell(txt)}</option>`).join("")}</select></label>`;

  return `
    <section class="fc-form-panel dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>${r ? "Editar personal del radar" : "Agregar personal"}</h3><p>Selecciona personal desde Personal Asignado.</p></div>
        <button type="button" class="ghost-btn compact-btn" data-fc-form-cancel>Cancelar edición</button>
      </div>
      <form id="fcRadarForm" class="form-grid fc-embedded-form">
        <input type="hidden" name="id" value="${r?.id || ""}">
        ${focalField}
        <label class="span-2">Personal<select name="person_id" required ${r ? "disabled" : ""}>${personSelectOptions(src.person_id || r?.person_id || "")}</select></label>
        <label>Proyecto actual<input name="current_project" value="${safeCell(src.current_project || "")}"></label>
        <label>Fecha estimada de cierre<input type="date" name="estimated_close_date" value="${src.estimated_close_date || ""}"></label>
        <label class="span-2">% Riesgo de liberación<input type="number" name="release_risk_percent" min="0" max="100" value="${Number(src.release_risk_percent || 0)}"></label>
        <label class="span-2">Acción recomendada<textarea name="recommended_action" rows="2" placeholder="¿Qué acción tomar?">${safeCell(src.recommended_action || "")}</textarea></label>
        <label class="span-4">Notas<textarea name="notes" rows="2" placeholder="Notas...">${safeCell(src.notes || "")}</textarea></label>
        <div class="fc-form-actions span-4">
          <button type="button" class="ghost-btn compact-btn" data-fc-form-clear>Nuevo / Limpiar</button>
          ${r ? `<button type="button" class="danger-btn compact-btn" data-fc-form-delete><i class="fc-ico">${svgIcon("trash")}</i> Eliminar</button>` : ""}
          <button type="submit" class="primary-btn compact-btn">Guardar</button>
        </div>
      </form>
    </section>`;
}

function bindRadarForm(content) {
  const form = content.querySelector("#fcRadarForm");
  if (!form) return;
  form.addEventListener("submit", (e) => saveRadar(e, state.fcForm.id));
  content.querySelector("[data-fc-form-cancel]")?.addEventListener("click", () => closeForm());
  form.querySelector("[data-fc-form-clear]")?.addEventListener("click", () => clearForm("radar"));
  form.querySelector("[data-fc-form-delete]")?.addEventListener("click", () => removeRadar(state.fcForm.id));
  setActiveDraft({ module: "radar", recordId: state.fcForm.id, draftKey: draftKeyFor("radar", state.fcForm.id), readForm: () => collectRadarForm() });
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
}

function collectRadarForm() {
  const form = document.getElementById("fcRadarForm");
  if (!form) return null;
  return Object.fromEntries(new FormData(form).entries());
}

async function saveRadar(event, id) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!form.person_id) return notify("Selecciona personal desde Personal Asignado.");
  const focal = form.focal_user_id || currentUserId();
  if (id) {
    const existing = state.focalRadar.find((x) => x.id === id);
    if (existing && existing.person_id !== form.person_id) {
      const dup = state.focalRadar.find((x) => x.person_id === form.person_id && x.focal_user_id === focal);
      if (dup) return notify("Ese personal ya está en tu radar. Ábrelo para editarlo.");
    }
  } else {
    const dup = state.focalRadar.find((x) => x.person_id === form.person_id && x.focal_user_id === focal);
    if (dup) return notify("Ese personal ya está en tu radar. Ábrelo para editarlo.");
  }
  const pct = Number(form.release_risk_percent || 0);
  const row = {
    person_id: form.person_id,
    focal_user_id: focal,
    current_project: form.current_project || "",
    estimated_close_date: form.estimated_close_date || null,
    release_risk_percent: pct,
    risk_level: riskLevel(pct),
    recommended_action: form.recommended_action || "",
    notes: form.notes || "",
    updated_by: currentUserId(),
    updated_at: nowIso()
  };
  try {
    if (id) {
      await state.store.update("focalRadar", id, row);
    } else {
      await state.store.insert("focalRadar", { id: crypto.randomUUID(), ...row, created_by: currentUserId(), created_at: nowIso() });
    }
    await deleteDraftByKey("radar", id || "new");
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify(id ? "Registro de radar actualizado." : "Personal agregado al radar.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo guardar el radar.");
  }
}

async function removeRadar(id) {
  if (!await confirmAction("¿Eliminar este personal del radar?", { title: "Eliminar radar", confirmText: "Eliminar" })) return;
  try {
    await state.store.delete("focalRadar", id);
    await deleteDraftByKey("radar", id);
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify("Registro eliminado.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo eliminar.");
  }
}

// ===========================================================================
// 3. SEGUIMIENTOS
// ===========================================================================
function renderFollowupsPage(content) {
  const people = visiblePersonal();
  const followups = state.focalFollowups.slice();
  if (!people.length) {
    content.innerHTML = `
      <section class="focal-command dashboard-card">
        <div class="dashboard-card-header"><div><h3>Seguimientos</h3><p>Compromisos por persona.</p></div></div>
        <div class="empty">Primero carga o asigna personal desde <strong>Personal Asignado</strong> para crear seguimientos.</div>
      </section>`;
    return;
  }

  const cards = followups.map((f) => {
    const items = state.focalFollowupItems.filter((i) => i.followup_id === f.id);
    const pend = items.filter((i) => !i.is_done).length;
    const itemsHtml = items.length
      ? items.map((i) => `<div class="seg-item ${i.is_done ? "done" : ""}" data-fc-seg-item="${i.id}">
          <span class="seg-check ${i.is_done ? "done" : ""}">${i.is_done ? svgIcon("check") : ""}</span>
          <span>${safeCell(i.item_text)}</span>
        </div>`).join("")
      : `<div class="seg-empty">Sin compromisos.</div>`;
    return `<div class="seg-card" data-fc-seg="${f.id}">
      <div class="seg-card-head">
        <div class="seg-avatar">${personInitials(personName(f.person_id))}</div>
        <div><div class="seg-name">${safeCell(personName(f.person_id))}</div><div class="seg-count">${pend} pendiente${pend !== 1 ? "s" : ""}</div></div>
      </div>
      <div class="seg-title">${safeCell(f.title || "Seguimiento")}</div>
      ${f.due_date ? `<div class="seg-meta">Vence: ${dateText(f.due_date)}</div>` : ""}
      ${itemsHtml}
      ${canWriteFocal() ? `<div class="seg-actions"><button class="ghost-btn compact-btn" data-fc-seg-edit="${f.id}">Editar</button></div>` : ""}
    </div>`;
  }).join("");

  const formHtml = (state.fcForm.active && state.fcForm.module === "followups") ? followupFormHTML() : "";

  content.innerHTML = `
    <section class="focal-command dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>Seguimientos</h3><p>Compromisos por persona.</p></div>
        ${canWriteFocal() ? `<button class="btn-add" id="fcAddSegBtn"><i class="fc-ico">${svgIcon("plus")}</i> Agregar personal</button>` : ""}
      </div>
      ${draftBannerHTML("followups")}
      ${formHtml}
      <div class="seg-grid">${cards || `<div class="empty">Sin seguimientos. Usa <strong>Agregar personal</strong>.</div>`}</div>
    </section>`;

  content.querySelector("#fcAddSegBtn")?.addEventListener("click", () => openForm("followups", null));
  content.querySelectorAll("[data-fc-seg]").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-fc-seg-edit]") || e.target.closest("[data-fc-seg-item]")) return;
    openForm("followups", el.dataset.fcSeg);
  }));
  content.querySelectorAll("[data-fc-seg-edit]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openForm("followups", el.dataset.fcSegEdit); }));
  content.querySelectorAll("[data-fc-seg-item]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); toggleSegItem(el.dataset.fcSegItem); }));

  bindDraftBanner(content, "followups");
  if (formHtml) bindFollowupForm(content);
}

function followupFormHTML() {
  const id = state.fcForm.id;
  const f = id ? state.focalFollowups.find((x) => x.id === id) : null;
  const draft = getDraftFor("followups", id);
  const src = (draft?.draft_data) || (f || {});

  let items = (src.items && Array.isArray(src.items)) ? src.items : (f ? state.focalFollowupItems.filter((i) => i.followup_id === f.id).map((i) => ({ item_text: i.item_text, is_done: i.is_done })) : []);
  const itemsHtml = items.map((it, i) => `
    <div class="seg-item-row" data-seg-idx="${i}">
      <input value="${safeCell(it.item_text || "")}" data-seg-item-text placeholder="Compromiso...">
      <label class="check-inline"><input type="checkbox" data-seg-item-done ${it.is_done ? "checked" : ""}> Listo</label>
      <button type="button" class="danger-btn compact-btn" data-seg-item-remove="${i}">×</button>
    </div>`).join("");

  const focalField = isFocal()
    ? `<input type="hidden" name="focal_user_id" value="${currentUserId()}">`
    : `<label>Focal asignado<select name="focal_user_id" required>${focalOptions().map(([v, txt]) => `<option value="${v}" ${v === (src.focal_user_id || f?.focal_user_id || currentUserId()) ? "selected" : ""}>${safeCell(txt)}</option>`).join("")}</select></label>`;

  return `
    <section class="fc-form-panel dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>${f ? "Editar seguimiento" : "Nueva persona"}</h3><p>Registra compromisos por persona.</p></div>
        <button type="button" class="ghost-btn compact-btn" data-fc-form-cancel>Cancelar edición</button>
      </div>
      <form id="fcSegForm" class="form-grid fc-embedded-form">
        <input type="hidden" name="id" value="${f?.id || ""}">
        ${focalField}
        <label class="span-2">Personal<select name="person_id" required>${personSelectOptions(src.person_id || f?.person_id || "")}</select></label>
        <label>Título / tema<select name="status">${SEG_STATUSES.map((s) => `<option value="${s}" ${s === (src.status || "Activo") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>Prioridad<select name="priority">${TASK_PRIORITIES.map((p) => `<option value="${p}" ${p === (src.priority || "Sin prioridad") ? "selected" : ""}>${p === "Sin prioridad" ? "—" : p}</option>`).join("")}</select></label>
        <label>Fecha de vencimiento<input type="date" name="due_date" value="${src.due_date || ""}"></label>
        <label class="span-4">Descripción<textarea name="description" rows="3" placeholder="Descripción del seguimiento...">${safeCell(src.description || "")}</textarea></label>
        <label class="span-4">Compromisos de seguimiento
          <div id="fcSegItems">${itemsHtml}</div>
          <button type="button" class="btn-add-sec" id="fcSegAddItemBtn"><i class="fc-ico">${svgIcon("plus")}</i> Agregar item</button>
        </label>
        <div class="fc-form-actions span-4">
          <button type="button" class="ghost-btn compact-btn" data-fc-form-clear>Nuevo / Limpiar</button>
          ${f ? `<button type="button" class="danger-btn compact-btn" data-fc-form-delete><i class="fc-ico">${svgIcon("trash")}</i> Eliminar</button>` : ""}
          <button type="submit" class="primary-btn compact-btn">Guardar</button>
        </div>
      </form>
    </section>`;
}

function bindFollowupForm(content) {
  const form = content.querySelector("#fcSegForm");
  if (!form) return;
  form.addEventListener("submit", (e) => saveFollowup(e, state.fcForm.id));
  content.querySelector("[data-fc-form-cancel]")?.addEventListener("click", () => closeForm());
  form.querySelector("[data-fc-form-clear]")?.addEventListener("click", () => clearForm("followups"));
  form.querySelector("[data-fc-form-delete]")?.addEventListener("click", () => removeFollowup(state.fcForm.id));
  form.querySelector("#fcSegAddItemBtn")?.addEventListener("click", addSegItemRow);
  form.querySelectorAll("[data-seg-item-remove]").forEach((btn) =>
    btn.addEventListener("click", () => btn.closest(".seg-item-row")?.remove())
  );
  setActiveDraft({ module: "followups", recordId: state.fcForm.id, draftKey: draftKeyFor("followups", state.fcForm.id), readForm: () => collectFollowupForm() });
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
}

function addSegItemRow() {
  const wrap = document.getElementById("fcSegItems");
  if (!wrap) return;
  const idx = wrap.children.length;
  const div = document.createElement("div");
  div.className = "seg-item-row";
  div.dataset.segIdx = String(idx);
  div.innerHTML = `<input value="" data-seg-item-text placeholder="Compromiso..."><label class="check-inline"><input type="checkbox" data-seg-item-done> Listo</label><button type="button" class="danger-btn compact-btn" data-seg-item-remove="${idx}">×</button>`;
  div.querySelector("[data-seg-item-remove]").addEventListener("click", () => div.remove());
  div.addEventListener("input", scheduleDraftSave);
  wrap.appendChild(div);
  scheduleDraftSave();
}

function collectFollowupForm() {
  const form = document.getElementById("fcSegForm");
  if (!form) return null;
  const base = Object.fromEntries(new FormData(form).entries());
  const itemRows = Array.from(form.querySelectorAll("#fcSegItems .seg-item-row"));
  const items = itemRows
    .map((row) => ({
      item_text: row.querySelector("[data-seg-item-text]").value.trim(),
      is_done: row.querySelector("[data-seg-item-done]").checked
    }))
    .filter((it) => it.item_text);
  base.items = items;
  return base;
}

async function saveFollowup(event, id) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!form.person_id) return notify("Selecciona personal desde Personal Asignado.");
  const itemRows = Array.from(document.querySelectorAll("#fcSegItems .seg-item-row"));
  const items = itemRows
    .map((row) => ({
      text: row.querySelector("[data-seg-item-text]").value.trim(),
      done: row.querySelector("[data-seg-item-done]").checked
    }))
    .filter((it) => it.text);
  const row = {
    person_id: form.person_id,
    focal_user_id: form.focal_user_id || currentUserId(),
    title: form.status || "Activo",
    description: form.description || "",
    status: form.status || "Activo",
    priority: form.priority || "Sin prioridad",
    due_date: form.due_date || null,
    updated_by: currentUserId(),
    updated_at: nowIso()
  };
  try {
    let followupId = id;
    if (id) {
      await state.store.update("focalFollowups", id, row);
    } else {
      followupId = crypto.randomUUID();
      await state.store.insert("focalFollowups", { id: followupId, ...row, created_by: currentUserId(), created_at: nowIso() });
    }
    await syncFollowupItems(followupId, items);
    await deleteDraftByKey("followups", id || "new");
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify(id ? "Seguimiento actualizado." : "Seguimiento creado.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo guardar el seguimiento.");
  }
}

async function syncFollowupItems(followupId, items) {
  const existing = state.focalFollowupItems.filter((i) => i.followup_id === followupId);
  for (const it of existing) {
    await state.store.delete("focalFollowupItems", it.id).catch(() => {});
  }
  if (items.length) {
    const incoming = items.map((it) => ({ id: crypto.randomUUID(), followup_id: followupId, item_text: it.text, is_done: it.done, created_at: nowIso(), updated_at: nowIso() }));
    await state.store.batchUpsert("focalFollowupItems", incoming);
  }
}

async function removeFollowup(id) {
  if (!await confirmAction("¿Eliminar este seguimiento y sus compromisos?", { title: "Eliminar seguimiento", confirmText: "Eliminar" })) return;
  try {
    await state.store.delete("focalFollowups", id);
    await deleteDraftByKey("followups", id);
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify("Seguimiento eliminado.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo eliminar.");
  }
}

async function toggleSegItem(itemId) {
  const item = state.focalFollowupItems.find((i) => i.id === itemId);
  if (!item) return;
  try {
    await state.store.update("focalFollowupItems", itemId, { is_done: !item.is_done, updated_at: nowIso() });
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo actualizar el compromiso.");
  }
}

// ===========================================================================
// 4. POCLAC
// ===========================================================================
function renderPoclacPage(content) {
  const sessions = state.poclacSessions.slice().sort((a, b) => {
    if (!!b.is_pinned !== !!a.is_pinned) return (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
    return String(b.session_date || "").localeCompare(String(a.session_date || ""));
  });
  const cards = sessions.map((p) => `
    <div class="poc-card ${p.is_pinned ? "pinned" : ""}" data-fc-poc="${p.id}">
      <div class="poc-meta">
        <span class="poc-date">${p.session_date ? dateText(p.session_date) : "—"}</span>
        <span class="poc-type">${safeCell(p.session_type || "POCLAC")}</span>
        ${statusBadge(p.status || "Pendiente")}
        ${p.is_pinned ? svgIcon("pin") + `<span class="poc-pin">Anclado</span>` : ""}
      </div>
      <div class="poc-title">${safeCell(p.title || "Sin título")}</div>
      <div class="poc-body">${safeCell((p.body || "").slice(0, 220))}${(p.body || "").length > 220 ? "…" : ""}</div>
      <div class="poc-tags">${(p.tags || []).map((t) => `<span class="poc-tag">${safeCell(t)}</span>`).join("")}</div>
      ${canWriteFocal() ? `<div class="poc-actions"><button class="ghost-btn compact-btn" data-fc-poc-edit="${p.id}">Editar</button></div>` : ""}
    </div>`).join("");

  const formHtml = (state.fcForm.active && state.fcForm.module === "poclac") ? poclacFormHTML() : "";

  content.innerHTML = `
    <section class="focal-command dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>POCLAC</h3><p>Sesiones y acuerdos POCLAC / reuniones clave.</p></div>
        ${canWriteFocal() ? `<button class="btn-add" id="fcNewPocBtn"><i class="fc-ico">${svgIcon("plus")}</i> Nueva sesión</button>` : ""}
      </div>
      ${draftBannerHTML("poclac")}
      ${formHtml}
      <div id="fcPocList">${cards || `<div class="empty">Sin sesiones POCLAC. Usa <strong>Nueva sesión</strong>.</div>`}</div>
    </section>`;

  content.querySelector("#fcNewPocBtn")?.addEventListener("click", () => openForm("poclac", null));
  content.querySelectorAll("[data-fc-poc]").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-fc-poc-edit]")) return;
    openForm("poclac", el.dataset.fcPoc);
  }));
  content.querySelectorAll("[data-fc-poc-edit]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openForm("poclac", el.dataset.fcPocEdit); }));

  bindDraftBanner(content, "poclac");
  if (formHtml) bindPoclacForm(content);
}

function poclacFormHTML() {
  const id = state.fcForm.id;
  const p = id ? state.poclacSessions.find((x) => x.id === id) : null;
  const draft = getDraftFor("poclac", id);
  const src = (draft?.draft_data) || (p || {});

  const focalField = isFocal()
    ? `<input type="hidden" name="focal_user_id" value="${currentUserId()}">`
    : `<label>Focal asignado<select name="focal_user_id" required>${focalOptions().map(([v, txt]) => `<option value="${v}" ${v === (src.focal_user_id || p?.focal_user_id || currentUserId()) ? "selected" : ""}>${safeCell(txt)}</option>`).join("")}</select></label>`;

  const tagsValue = Array.isArray(src.tags) ? src.tags.join(", ") : (src.tags || "");

  return `
    <section class="fc-form-panel dashboard-card">
      <div class="dashboard-card-header">
        <div><h3>${p ? "Editar sesión" : "Nueva sesión"}</h3><p>Los borradores se autoguardan automáticamente.</p></div>
        <button type="button" class="ghost-btn compact-btn" data-fc-form-cancel>Cancelar edición</button>
      </div>
      <form id="fcPocForm" class="form-grid fc-embedded-form">
        <input type="hidden" name="id" value="${p?.id || ""}">
        ${focalField}
        <label>Tipo de sesión<select name="session_type">${POCLAC_TYPES.map((t) => `<option value="${t}" ${t === (src.session_type || "POCLAC") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Fecha<input type="date" name="session_date" value="${src.session_date || toDateInput(new Date())}"></label>
        <label class="span-2">Título / tema principal<input name="title" required value="${safeCell(src.title || "")}" placeholder="Título de la sesión"></label>
        <label class="span-4">Acuerdos y notas clave<textarea name="body" class="fc-wide-textarea" rows="8" placeholder="Acuerdos, notas clave...">${safeCell(src.body || "")}</textarea></label>
        <label class="span-2">Tags (separados por coma)<input name="tags" value="${safeCell(tagsValue)}"></label>
        <label>Estado<select name="status">${POCLAC_STATUSES.map((s) => `<option value="${s}" ${s === (src.status || "Pendiente") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label class="check-inline span-1">Anclar sesión<input type="checkbox" name="is_pinned" ${src.is_pinned ? "checked" : ""}></label>
        <div class="fc-form-actions span-4">
          <button type="button" class="ghost-btn compact-btn" data-fc-form-clear>Nuevo / Limpiar</button>
          ${p ? `<button type="button" class="danger-btn compact-btn" data-fc-form-delete><i class="fc-ico">${svgIcon("trash")}</i> Eliminar</button>` : ""}
          <button type="submit" class="primary-btn compact-btn">Guardar sesión</button>
        </div>
      </form>
    </section>`;
}

function bindPoclacForm(content) {
  const form = content.querySelector("#fcPocForm");
  if (!form) return;
  form.addEventListener("submit", (e) => savePoclacSession(e, state.fcForm.id));
  content.querySelector("[data-fc-form-cancel]")?.addEventListener("click", () => closeForm());
  form.querySelector("[data-fc-form-clear]")?.addEventListener("click", () => clearForm("poclac"));
  form.querySelector("[data-fc-form-delete]")?.addEventListener("click", () => removePoclac(state.fcForm.id));
  setActiveDraft({ module: "poclac", recordId: state.fcForm.id, draftKey: draftKeyFor("poclac", state.fcForm.id), readForm: () => collectPoclacForm() });
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
}

function collectPoclacForm() {
  const form = document.getElementById("fcPocForm");
  if (!form) return null;
  const data = Object.fromEntries(new FormData(form).entries());
  data.tags = (data.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  data.is_pinned = form.querySelector("[name='is_pinned']").checked;
  return data;
}

async function savePoclacSession(event, id) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!form.title?.trim()) return notify("Ingresa el título de la sesión.");
  const tags = String(form.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const row = {
    focal_user_id: isFocal() ? currentUserId() : (form.focal_user_id || currentUserId()),
    session_type: form.session_type || "POCLAC",
    session_date: form.session_date || toDateInput(new Date()),
    title: form.title.trim(),
    body: form.body || "",
    tags,
    status: form.status || "Pendiente",
    is_pinned: Boolean(form.is_pinned),
    updated_by: currentUserId(),
    updated_at: nowIso()
  };
  try {
    if (id) {
      await state.store.update("poclacSessions", id, row);
    } else {
      await state.store.insert("poclacSessions", { id: crypto.randomUUID(), ...row, created_by: currentUserId(), created_at: nowIso() });
    }
    await deleteDraftByKey("poclac", id || "new");
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify(id ? "Sesión actualizada." : "Sesión guardada.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo guardar la sesión.");
  }
}

async function removePoclac(id) {
  if (!await confirmAction("¿Eliminar esta sesión POCLAC?", { title: "Eliminar sesión", confirmText: "Eliminar" })) return;
  try {
    await state.store.delete("poclacSessions", id);
    await deleteDraftByKey("poclac", id);
    clearActiveDraft();
    state.fcForm = { active: false, module: "", id: null };
    notify("Sesión eliminada.");
    await refresh();
  } catch (error) {
    notify(error.message || "No se pudo eliminar.");
  }
}

// ===========================================================================
// Form helpers (open / close / clear) + draft hooks
// ===========================================================================
function openForm(module, id) {
  saveActiveDraftNow().catch(() => {});
  state.fcForm = { active: true, module, id: id || null };
  renderActiveTabLocal();
}

function closeForm() {
  deleteDraftByKey(state.fcForm.module, state.fcForm.id).catch(() => {});
  clearActiveDraft();
  state.fcForm = { active: false, module: "", id: null };
  renderActiveTabLocal();
}

function clearForm(module) {
  deleteDraftByKey(module, state.fcForm.id).catch(() => {});
  state.fcForm = { active: true, module, id: null };
  renderActiveTabLocal();
}

// Re-render the active tab via app-core (avoids a circular import at module load).
let _renderActiveTab = null;
export function setRenderActiveTab(fn) {
  _renderActiveTab = fn;
}
function renderActiveTabLocal() {
  if (_renderActiveTab) {
    _renderActiveTab();
  } else {
    import("../app-core.js").then((m) => { _renderActiveTab = m.renderActiveTab; _renderActiveTab(); }).catch(() => {});
  }
}

window.addEventListener("beforeunload", () => {
  flushDrafts().catch(() => {});
});

export function flushPoclacDraft() {
  return flushDrafts();
}
