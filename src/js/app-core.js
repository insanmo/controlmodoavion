import { state, ROLES, TABS_BY_ROLE, NAV_ICONS, TAB_LABELS, NAV_STRUCTURE, TAB_ROUTES, ROUTE_TABS, allowedTabsForUser, resetSessionViewForUser } from "./state.js";
import { safeCell, svgIcon } from "./utils.js";
import { cleanMojibake } from "./security.js";
import { loadData } from "./db.js";
import { initStorage, restoreSession, onLogin, onForgotPassword, saveNewPassword, logout, toggleForgot, openChangePasswordDialog } from "./auth.js";
import { renderFocalCommand, flushPoclacDraft, setRenderActiveTab } from "./components/focal-command.js";
import { dashboardTemplate } from "./components/dashboard.js";
import { renderVacationForm, renderConsolidated, saveVacation, removeVacation, markFormalRegistered, openDetail, exportExcel, bindCollaboratorSearch, syncEmbeddedVacationDerivedFields } from "./components/vacations.js";
import { renderPersonal, openPersonalDialog, importPersonalFromExcel, exportPersonalExcel, sortPersonalBy, startPeriodClose, activateNextPeriod, reopenPeriod } from "./components/personal.js";
import { minStartDateForType } from "./components/common.js";
import { renderCalendar, shiftCalendarMonth } from "./components/calendar.js";
import { renderUsers, saveUser, resetUserPassword, sortUsersBy, editUser, cancelUserEdit, toggleUserActive, removeUser } from "./components/users.js";
import { renderRequests, resolveRequest } from "./components/requests.js";
import { renderSettings, saveHoliday, removeHoliday, saveColumnConfig, disableColumnConfig, cancelColumnEdit, editColumnRow, cancelColumnRowEdit, saveColumnConfigRow, editHolidayRow, cancelHolidayRowEdit, saveHolidayRow } from "./components/settings.js";
import { renderProfilePage, saveProfilePage, cancelProfilePage, revokeSessions } from "./components/profile.js";
import { filterToolbar, visiblePersonal } from "./components/common.js";
import { notificationItems, dismissedNotificationKeys, saveDismissedNotificationKeys } from "./notifications.js";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  showLoadingView();
  await initStorage();
  bindBaseEvents();
  window.addEventListener("hashchange", onHashChange);
  await restoreSession();
  if (state.currentUser) {
    hideLoadingView();
    showMainView();
    setRenderActiveTab(renderActiveTab);
    applyInitialRoute();
    renderApp();
  } else {
    hideLoadingView();
    showLoginView();
  }
}

function showLoadingView() {
  document.getElementById("loadingView")?.classList.remove("hidden");
}

function hideLoadingView() {
  document.getElementById("loadingView")?.classList.add("hidden");
}

function showLoginView() {
  document.getElementById("loginView")?.classList.remove("hidden");
  document.getElementById("mainView")?.classList.add("hidden");
}

function showMainView() {
  document.getElementById("loginView")?.classList.add("hidden");
  document.getElementById("mainView")?.classList.remove("hidden");
}

export async function renderApp(options = {}) {
  const forceReload = options === true || options.forceReload === true;
  const renderId = (state.renderId || 0) + 1;
  state.renderId = renderId;

  if (forceReload || !state.dataLoaded) {
    await loadData(state.currentUser?.role);
    if (renderId !== state.renderId) return;
  }

  if (state.currentUser) {
    state.currentUser = state.users.find((user) => user.id === state.currentUser.id) || state.currentUser;
    resetSessionViewForUser(state.currentUser);
  }

  renderAppHeader();
  renderNav();
  renderAlerts();
  renderActiveTab();

  const expectedHash = `#/${TAB_ROUTES[state.activeTab] || ""}`;
  if (location.hash && location.hash !== expectedHash) {
    history.replaceState(null, "", expectedHash);
  }
}

function renderAppHeader() {
  document.body.dataset.activeTab = state.activeTab;
  const firstName = String(state.currentUser.name || "Usuario").split(/\s+/)[0];
    const titles = {
      dashboard: [`¡Hola, ${firstName}!`, "Aquí tienes el resumen de vacaciones del equipo."],
      vacations: ["Registro de vacaciones", "Gestiona y da seguimiento a las vacaciones del equipo."],
      calendar: ["Calendario", "Consulta las vacaciones programadas por mes."],
      consolidated: ["Consolidado", "Revisa y actualiza la base consolidada de registros de vacaciones."],
      personal: ["Personal asignado", "Administra los colaboradores asignados."],
      users: ["Usuarios", "Administra accesos y roles del sistema."],
      requests: ["Recuperación", "Atiende solicitudes de recuperación de contraseña."],
      settings: ["Configuración", "Administra feriados usados para calcular la fecha de retorno."],
      profile: ["Mi perfil", "Actualiza tus datos de usuario y contraseña."],
      "fc-tareas": ["Focal Command · Tareas", "Gestiona las actividades de tu equipo."],
      "fc-radar": ["Focal Command · Radar de Equipo", "Personal con riesgo de liberación."],
      "fc-seguimientos": ["Focal Command · Seguimientos", "Compromisos por persona."],
      "fc-poclac": ["Focal Command · POCLAC", "Sesiones y acuerdos POCLAC / reuniones clave."]
    };
  const [title, subtitle] = titles[state.activeTab] || titles.dashboard;
  document.getElementById("greetingTitle").textContent = title;
  document.getElementById("greetingSubtitle").textContent = subtitle;
  document.getElementById("profileInitials").textContent = userInitials(state.currentUser);
  document.getElementById("profileNameLabel").textContent = state.currentUser.name || state.currentUser.email;
  document.getElementById("profileRoleLabel").textContent = ROLES[state.currentUser.role] || state.currentUser.role || "";
  document.getElementById("notificationCount").textContent = String(notificationCount());
}

function userInitials(user) {
  const source = user?.name || user?.email || "Usuario";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function renderActiveTab() {
  const content = document.getElementById("content");
  if (!content) return;
  content.innerHTML = "";
  const allowed = allowedTabsForUser();
  if (!allowed.includes(state.activeTab)) state.activeTab = allowed[0] || "dashboard";

  try {
    switch (state.activeTab) {
      case "dashboard": content.innerHTML = dashboardTemplate(); break;
      case "vacations": renderVacationForm(content); break;
      case "calendar": renderCalendar(content); break;
      case "consolidated": renderConsolidated(content); break;
      case "personal": renderPersonal(content); break;
      case "users": renderUsers(content); break;
      case "requests": renderRequests(content); break;
      case "settings": renderSettings(content); break;
      case "profile": renderProfilePage(content); break;
      case "fc-tareas":
      case "fc-radar":
      case "fc-seguimientos":
      case "fc-poclac":
        renderFocalCommand(state.activeTab, content); break;
      default: state.activeTab = "dashboard"; content.innerHTML = dashboardTemplate();
    }
  } catch (error) {
    console.error("Render error", error);
    content.innerHTML = `<section class="dashboard-card render-error-card"><div class="dashboard-card-header"><div><h3>No se pudo cargar esta pantalla</h3><p>${safeCell(error.message || "Error inesperado.")}</p></div></div></section>`;
  }

  bindDynamicEvents();
  cleanupDomText(content);
}

function renderNav() {
  const nav = document.getElementById("navTabs");
  if (!nav) return;
  nav.innerHTML = "";
  const allowed = allowedTabsForUser();
  for (const group of NAV_STRUCTURE) {
    const items = group.items.filter((tab) => allowed.includes(tab));
    if (!items.length) continue;
    if (group.label) {
      const label = document.createElement("div");
      label.className = "nav-group-label";
      label.textContent = group.label;
      nav.appendChild(label);
    }
    for (const tab of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = state.activeTab === tab ? "active" : "";
      button.innerHTML = `<span class="nav-icon">${svgIcon(NAV_ICONS[tab])}</span><span>${TAB_LABELS[tab]}</span>`;
      button.addEventListener("click", () => navigateToTab(tab));
      nav.appendChild(button);
    }
  }
}

// Navegación basada en hash para compatibilidad con GitHub Pages (sin rewrites de servidor).
function navigateToTab(tab) {
  if (state.activeTab === tab) return;
  flushPoclacDraft();
  const route = TAB_ROUTES[tab] || tab;
  location.hash = `#/${route}`;
}

function onHashChange() {
  const route = String(location.hash || "").replace(/^#\/?/, "");
  const tab = ROUTE_TABS[route];
  if (!tab) return;
  if (!allowedTabsForUser().includes(tab)) {
    history.replaceState(null, "", `#/${TAB_ROUTES[state.activeTab] || ""}`);
    return;
  }
  if (tab === state.activeTab) return;
  flushPoclacDraft();
  state.activeTab = tab;
  state.showVacationForm = false;
  state.prefillVacationPersonId = null;
  state.prefillVacationDefaults = null;
  renderApp();
}

function applyInitialRoute() {
  const route = String(location.hash || "").replace(/^#\/?/, "");
  const tab = ROUTE_TABS[route];
  if (tab && allowedTabsForUser().includes(tab)) state.activeTab = tab;
}

function bindBaseEvents() {
  document.getElementById("loginForm")?.addEventListener("submit", onLogin);
  document.getElementById("forgotBtn")?.addEventListener("click", () => toggleForgot(true));
  document.getElementById("backLoginBtn")?.addEventListener("click", () => toggleForgot(false));
  document.getElementById("forgotForm")?.addEventListener("submit", onForgotPassword);
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("profileBtn")?.addEventListener("click", openProfilePage);
  document.getElementById("profileChevronBtn")?.addEventListener("click", openProfilePage);
  document.querySelector(".user-summary")?.addEventListener("click", openProfilePage);
  document.getElementById("changePasswordForm")?.addEventListener("submit", saveNewPassword);
  document.getElementById("notificationBtn")?.addEventListener("click", () => {
    state.showNotifications = !state.showNotifications;
    renderAlerts();
  });
}

function openProfilePage() {
  state.previousTab = state.activeTab === "profile" ? "dashboard" : state.activeTab;
  state.activeTab = "profile";
  renderApp();
}

function bindDynamicEvents() {
  // Vacation form
  document.getElementById("newVacationBtn")?.addEventListener("click", () => {
    state.showVacationForm = true; state.editingVacationId = null; state.prefillVacationPersonId = null; state.prefillVacationDefaults = null; renderActiveTab();
  });
  const embeddedForm = document.getElementById("embeddedVacationForm");
  if (embeddedForm) {
    embeddedForm.addEventListener("submit", saveVacation);
    bindCollaboratorSearch(embeddedForm);
    embeddedForm.querySelectorAll("[name='start_date'], [name='end_date']").forEach((input) =>
      input.addEventListener("change", syncEmbeddedVacationDerivedFields)
    );
    syncEmbeddedVacationDerivedFields();
    const typeSelect = embeddedForm.querySelector("[name='type']");
    if (typeSelect) {
      typeSelect.addEventListener("change", () => {
        const gabinCheck = document.getElementById("gabinCheckField");
        if (gabinCheck) gabinCheck.style.display = typeSelect.value === "descanso médico" ? "" : "none";
        const minForType = minStartDateForType(typeSelect.value);
        const startInput = embeddedForm.elements.start_date;
        const endInput = embeddedForm.elements.end_date;
        if (startInput) {
          startInput.min = minForType;
          if (startInput.value && startInput.value < minForType) startInput.value = "";
        }
        if (endInput) {
          endInput.min = startInput.value || minForType;
          if (endInput.value && endInput.value < endInput.min) endInput.value = "";
        }
        syncEmbeddedVacationDerivedFields();
      });
    }
  }
  document.querySelectorAll("#cancelEmbeddedVacationBtn, #cancelEmbeddedVacationBtn2").forEach((btn) =>
    btn.addEventListener("click", () => { state.showVacationForm = false; state.editingVacationId = null; state.prefillVacationPersonId = null; state.prefillVacationDefaults = null; renderActiveTab(); })
  );

  // Profile
  document.getElementById("profilePageForm")?.addEventListener("submit", saveProfilePage);
  document.getElementById("cancelProfilePageBtn")?.addEventListener("click", cancelProfilePage);
  document.getElementById("revokeSessionsBtn")?.addEventListener("click", revokeSessions);

  // Holidays
  document.getElementById("holidayForm")?.addEventListener("submit", saveHoliday);
  document.getElementById("cancelHolidayBtn")?.addEventListener("click", () => { state.filters.editHolidayId = null; renderApp(); });
  document.getElementById("columnConfigForm")?.addEventListener("submit", saveColumnConfig);
  document.getElementById("cancelColumnBtn")?.addEventListener("click", cancelColumnEdit);
  document.querySelectorAll("[data-edit-holiday-row]").forEach((btn) => btn.addEventListener("click", () => editHolidayRow(btn.dataset.editHolidayRow)));
  document.querySelectorAll("[data-cancel-holiday-row]").forEach((btn) => btn.addEventListener("click", () => cancelHolidayRowEdit()));
  document.querySelectorAll("[data-save-holiday-row]").forEach((btn) => btn.addEventListener("click", () => saveHolidayRow(btn.dataset.saveHolidayRow, btn.closest("tr"))));
  document.querySelectorAll("[data-delete-holiday]").forEach((btn) => btn.addEventListener("click", () => removeHoliday(btn.dataset.deleteHoliday)));
  document.querySelectorAll("[data-edit-column-row]").forEach((btn) => btn.addEventListener("click", () => editColumnRow(btn.dataset.editColumnRow)));
  document.querySelectorAll("[data-cancel-column-row]").forEach((btn) => btn.addEventListener("click", () => cancelColumnRowEdit()));
  document.querySelectorAll("[data-save-column-row]").forEach((btn) => btn.addEventListener("click", () => saveColumnConfigRow(btn.dataset.saveColumnRow, btn.closest("tr"))));
  document.querySelectorAll("[data-disable-column]").forEach((btn) => btn.addEventListener("click", () => disableColumnConfig(btn.dataset.disableColumn)));
  bindTableScrollProxies();
  document.querySelectorAll("[data-holiday-filter]").forEach((input) => {
    input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => scheduleHolidayFilterRender(input));
  });

  // Users
  document.getElementById("userForm")?.addEventListener("submit", saveUser);
  document.getElementById("cancelUserEditBtn")?.addEventListener("click", cancelUserEdit);
  document.querySelectorAll("[data-edit-user]").forEach((btn) => btn.addEventListener("click", () => editUser(btn.dataset.editUser)));
  document.querySelectorAll("[data-toggle-user]").forEach((btn) => btn.addEventListener("click", () => toggleUserActive(btn.dataset.toggleUser)));
  document.querySelectorAll("[data-delete-user]").forEach((btn) => btn.addEventListener("click", () => removeUser(btn.dataset.deleteUser)));
  document.querySelectorAll("[data-reset-user]").forEach((btn) => btn.addEventListener("click", () => resetUserPassword(btn.dataset.resetUser)));
  document.querySelectorAll("[data-user-sort]").forEach((btn) => btn.addEventListener("click", () => sortUsersBy(btn.dataset.userSort)));

  // Personal
  document.getElementById("exportBtn")?.addEventListener("click", exportExcel);
  document.getElementById("clearFiltersBtn")?.addEventListener("click", () => { state.filters = {}; renderActiveTab(); });
  document.querySelectorAll("[data-calendar-prev]").forEach((btn) => btn.addEventListener("click", () => shiftCalendarMonth(-1)));
  document.querySelectorAll("[data-calendar-next]").forEach((btn) => btn.addEventListener("click", () => shiftCalendarMonth(1)));
  document.getElementById("newPersonalBtn")?.addEventListener("click", () => openPersonalDialog());
  document.getElementById("startPeriodCloseBtn")?.addEventListener("click", startPeriodClose);
  document.getElementById("activatePeriodBtn")?.addEventListener("click", activateNextPeriod);
  document.getElementById("reopenPeriodBtn")?.addEventListener("click", reopenPeriod);
  const importBtn = document.getElementById("importPersonalBtn");
  const excelInput = document.getElementById("personalExcelInput");
  if (importBtn && excelInput) importBtn.addEventListener("click", () => excelInput.click());
  if (excelInput) excelInput.addEventListener("change", importPersonalFromExcel);
  document.getElementById("exportPersonalBtn")?.addEventListener("click", exportPersonalExcel);
  document.querySelectorAll("[data-personal-sort]").forEach((btn) => btn.addEventListener("click", () => sortPersonalBy(decodeURIComponent(btn.dataset.personalSort))));

  // Navigation & actions
  document.querySelectorAll("[data-goto-tab]").forEach((btn) => btn.addEventListener("click", () => {
    const tab = btn.dataset.gotoTab;
    if (!allowedTabsForUser().includes(tab)) return;
    state.activeTab = tab;
    renderApp();
  }));
  document.querySelectorAll("[data-edit-personal]").forEach((btn) => btn.addEventListener("click", () => openPersonalDialog(btn.dataset.editPersonal)));
  document.querySelectorAll("[data-register-vacation]").forEach((btn) => btn.addEventListener("click", () => startVacationForPerson(btn.dataset.registerVacation)));
  document.querySelectorAll("[data-register-birthday-rest]").forEach((btn) => btn.addEventListener("click", () => startVacationForPerson(btn.dataset.registerBirthdayRest, {
    type: "tarde libre",
    start_date: btn.dataset.birthdayDate,
    end_date: btn.dataset.birthdayDate,
    status: "Pendiente"
  })));
  document.querySelectorAll("[data-edit-vacation]").forEach((btn) => btn.addEventListener("click", () => {
    state.showVacationForm = true; state.editingVacationId = btn.dataset.editVacation; state.prefillVacationPersonId = null; state.prefillVacationDefaults = null; renderActiveTab();
  }));
  document.querySelectorAll("[data-delete-vacation]").forEach((btn) => btn.addEventListener("click", () => removeVacation(btn.dataset.deleteVacation)));
  document.querySelectorAll("[data-toggle-formal]").forEach((cb) => cb.addEventListener("change", () => markFormalRegistered(cb)));
  document.querySelectorAll("[data-detail]").forEach((btn) => { if (btn.dataset.detail) btn.addEventListener("click", () => openDetail(btn.dataset.detail)); });
  document.querySelectorAll("[data-resolve-request]").forEach((btn) => btn.addEventListener("click", () => resolveRequest(btn.dataset.resolveRequest)));
  document.querySelectorAll("[data-filter]").forEach((input) => {
    const eventName = input.tagName === "SELECT" || input.type === "month" ? "change" : "input";
    input.addEventListener(eventName, () => scheduleFilterRender(input));
  });
  document.getElementById("clearPersonalFiltersBtn")?.addEventListener("click", () => { state.filters.personalPo = ""; state.filters.personalProject = ""; state.filters.personalName = ""; renderActiveTab(); });
  document.querySelectorAll("[data-personal-filter]").forEach((input) => {
    const key = `personal${input.dataset.personalFilter.charAt(0).toUpperCase()}${input.dataset.personalFilter.slice(1)}`;
    input.addEventListener("input", () => {
      state.filters[key] = input.value;
      clearTimeout(state.personalFilterTimer);
      const pos = input.selectionStart;
      state.personalFilterTimer = setTimeout(() => {
        renderActiveTab();
        const next = document.querySelector(`[data-personal-filter="${input.dataset.personalFilter}"]`);
        if (next) { next.focus(); if (typeof pos === "number") next.setSelectionRange(pos, pos); }
      }, 350);
    });
  });
}

function startVacationForPerson(personId, defaults = null) {
  const person = visiblePersonal().find((item) => item.id === personId);
  if (!person) return;
  state.activeTab = "vacations";
  state.showVacationForm = true;
  state.editingVacationId = null;
  state.prefillVacationPersonId = person.id;
  state.prefillVacationDefaults = defaults;
  renderApp();
}

function scheduleFilterRender(input) {
  state.filters[input.dataset.filter] = input.value;
  clearTimeout(state.filterRenderTimer);
  if (input.tagName === "SELECT" || input.type === "month") { renderActiveTab(); return; }
  const key = input.dataset.filter;
  const position = input.selectionStart;
  state.filterRenderTimer = setTimeout(() => {
    renderActiveTab();
    const next = document.querySelector(`[data-filter="${key}"]`);
    if (next) { next.focus(); if (typeof position === "number") next.setSelectionRange(position, position); }
  }, 350);
}

function scheduleHolidayFilterRender(input) {
  state.filters[input.dataset.holidayFilter] = input.value;
  if (input.tagName === "SELECT") { renderApp(); return; }
  const key = input.dataset.holidayFilter;
  const position = input.selectionStart;
  clearTimeout(state.holidayFilterRenderTimer);
  state.holidayFilterRenderTimer = setTimeout(() => {
    renderApp();
    const next = document.querySelector(`[data-holiday-filter="${key}"]`);
    if (next) { next.focus(); if (typeof position === "number") next.setSelectionRange(position, position); }
  }, 350);
}

function bindTableScrollProxies() {
  document.querySelectorAll("[data-scroll-proxy]").forEach((proxy) => {
    const key = proxy.dataset.scrollProxy;
    const target = document.querySelector(`[data-scroll-target="${key}"]`);
    const spacer = proxy.firstElementChild;
    const table = target?.querySelector("table");
    if (!target || !spacer || !table) return;
    const syncWidth = () => { spacer.style.width = `${table.scrollWidth}px`; };
    syncWidth();
    let syncing = false;
    proxy.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      target.scrollLeft = proxy.scrollLeft;
      syncing = false;
    });
    target.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      proxy.scrollLeft = target.scrollLeft;
      syncing = false;
    });
    window.addEventListener("resize", syncWidth, { once: true });
  });
}

function editHolidayInternal(id) {
  state.filters.editHolidayId = id;
  renderApp();
}

// --- Notifications ---

function renderAlerts() {
  const alertsBar = document.getElementById("alertsBar");
  if (!alertsBar) return;
  if (!state.showNotifications) { alertsBar.innerHTML = ""; alertsBar.classList.remove("notifications-open"); return; }
  const items = notificationItems();
  alertsBar.classList.add("notifications-open");
  alertsBar.innerHTML = `
    <div class="notifications-panel">
      <div class="notifications-header">
        <strong>Notificaciones</strong>
        <div class="row-actions">
          <button class="ghost-btn compact-btn" id="dismissNotificationsBtn" type="button">Descartar visibles</button>
          <button class="ghost-btn compact-btn" id="closeNotificationsBtn" type="button">Cerrar</button>
        </div>
      </div>
      <div class="notifications-list">
        ${items.map((item) => `<article class="notification-item ${item.tone}"><div><strong>${safeCell(item.title)}</strong><span>${safeCell(item.text)}</span></div><button class="ghost-btn compact-btn" data-dismiss-notification="${safeCell(item.key)}" type="button">Descartar</button></article>`).join("") || `<article class="notification-item"><strong>Sin alertas</strong><span>No hay notificaciones pendientes.</span></article>`}
      </div>
    </div>
  `;
  document.querySelectorAll("[data-dismiss-notification]").forEach((btn) => {
    btn.addEventListener("click", () => dismissNotification(btn.dataset.dismissNotification));
  });
  document.getElementById("dismissNotificationsBtn")?.addEventListener("click", () => dismissVisibleNotifications(items));
  document.getElementById("closeNotificationsBtn")?.addEventListener("click", () => {
    state.showNotifications = false;
    renderAlerts();
  });
}

function notificationCount() {
  return notificationItems().length;
}

function dismissNotification(key) {
  const keys = dismissedNotificationKeys();
  keys.add(key);
  saveDismissedNotificationKeys(keys);
  renderAppHeader();
  renderAlerts();
}

function dismissVisibleNotifications(items) {
  const keys = dismissedNotificationKeys();
  items.forEach((item) => keys.add(item.key));
  saveDismissedNotificationKeys(keys);
  renderAppHeader();
  renderAlerts();
}

// --- DOM cleanup ---

function cleanupDomText(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const fixed = cleanMojibake(node.nodeValue);
    if (fixed !== node.nodeValue) node.nodeValue = fixed;
  });
  root.querySelectorAll("input, textarea, option, button, label, h1, h2, h3, p, span, td, th").forEach((el) => {
    for (const attr of ["placeholder", "title", "aria-label", "value"]) {
      if (el.hasAttribute?.(attr)) {
        const current = el.getAttribute(attr);
        const fixed = cleanMojibake(current);
        if (fixed !== current) el.setAttribute(attr, fixed);
      }
    }
  });
}
