export const TABLES = {
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
  poclacDrafts: "aircontrol_poclac_drafts"
};

export const ROLES = {
  admin: "Admin",
  supervisor: "Supervisor",
  focal: "Focal"
};

export const TABS_BY_ROLE = {
  admin: ["dashboard", "vacations", "calendar", "consolidated", "personal", "users", "requests", "settings", "fc-tareas", "fc-radar", "fc-seguimientos", "fc-poclac"],
  supervisor: ["dashboard", "vacations", "calendar", "consolidated", "personal", "fc-tareas", "fc-radar", "fc-seguimientos", "fc-poclac"],
  focal: ["dashboard", "vacations", "calendar", "personal", "fc-tareas", "fc-radar", "fc-seguimientos", "fc-poclac"]
};

export const TAB_LABELS = {
  dashboard: "Dashboard",
  vacations: "Registro de vacaciones",
  calendar: "Calendario",
  consolidated: "Consolidado",
  personal: "Personal asignado",
  users: "Usuarios",
  settings: "Configuración",
  requests: "Recuperación",
  "fc-tareas": "Tareas",
  "fc-radar": "Radar de Equipo",
  "fc-seguimientos": "Seguimientos",
  "fc-poclac": "POCLAC"
};

export const NAV_ICONS = {
  dashboard: "home",
  vacations: "calendar",
  calendar: "calendarDays",
  consolidated: "bar",
  personal: "users",
  users: "user",
  requests: "clock",
  settings: "settings",
  "fc-tareas": "checklist",
  "fc-radar": "radar",
  "fc-seguimientos": "users",
  "fc-poclac": "notes"
};

// Estructura de navegación agrupada para el sidebar.
export const NAV_STRUCTURE = [
  { label: null, items: ["dashboard", "vacations", "calendar", "consolidated", "personal"] },
  { label: "Focal Command", items: ["fc-tareas", "fc-radar", "fc-seguimientos", "fc-poclac"] },
  { label: "Administración", items: ["users", "requests", "settings"] }
];

// Mapa de pestaña -> ruta (compatible con GitHub Pages vía hash).
export const TAB_ROUTES = {
  dashboard: "dashboard",
  vacations: "vacaciones",
  calendar: "calendario",
  consolidated: "consolidado",
  personal: "personal",
  users: "usuarios",
  requests: "recuperacion",
  settings: "configuracion",
  profile: "perfil",
  "fc-tareas": "focal-command/tareas",
  "fc-radar": "focal-command/radar",
  "fc-seguimientos": "focal-command/seguimientos",
  "fc-poclac": "focal-command/poclac"
};

export const ROUTE_TABS = Object.fromEntries(
  Object.entries(TAB_ROUTES).map(([tab, route]) => [route, tab])
);

export const state = {
  client: null,
  auth: null,
  store: null,
  currentUser: null,
  activeTab: "dashboard",
  previousTab: null,
  showVacationForm: false,
  editingVacationId: null,
  prefillVacationPersonId: null,
  prefillVacationDefaults: null,
  fcForm: { active: false, module: "", id: null },
  showNotifications: false,
  dataLoaded: false,
  renderId: 0,
  users: [],
  personal: [],
  vacations: [],
  passwordRequests: [],
  holidays: [],
  periods: [],
  columnConfigs: [],
  personalImports: [],
  personalImportRows: [],
  focalTasks: [],
  focalRadar: [],
  focalFollowups: [],
  focalFollowupItems: [],
  poclacSessions: [],
  poclacDrafts: [],
  filters: {},
  importedFocalCredentials: [],
  filterRenderTimer: null,
  holidayFilterRenderTimer: null
};

export function isIndraEmail(email) {
  return /^[^\s@]+@(indra|indracompany)\.com$/i.test(email) || /^[^\s@]+@indra\.[^\s@]+$/i.test(email);
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function allowedTabsForUser(user = state.currentUser) {
  return [...(TABS_BY_ROLE[user?.role] || TABS_BY_ROLE.focal), "profile"];
}

export function resetSessionViewForUser(user = state.currentUser, options = {}) {
  const allowed = allowedTabsForUser(user);
  if (!allowed.includes(state.activeTab)) state.activeTab = allowed[0] || "dashboard";
  if (!allowed.includes(state.previousTab)) state.previousTab = null;
  if (options.clearState) {
    state.showVacationForm = false;
    state.editingVacationId = null;
    state.prefillVacationPersonId = null;
    state.prefillVacationDefaults = null;
    state.filters = {};
  }
}
