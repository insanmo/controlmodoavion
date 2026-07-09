# Configuración local con Supabase (Control Modo Avión / AirControl)

Este documento explica cómo trabajar en **local** usando la base de datos **Supabase ya desplegada**,
preparando el proyecto para **GitHub Pages** sin romper rutas ni variables.

> Estado: la implementación de **Focal Command** (Tareas, Radar de Equipo, Seguimientos, POCLAC)
> está completa en el código. Para probarla en local es necesario desplegar la migración SQL y la
> Edge Function en Supabase (ver "Despliegue en Supabase" al final). El código no se sube a GitHub.

---

## 1. Variables de entorno

El proyecto NO hardcodea URLs ni keys. Todo se lee desde variables `VITE_*` con `import.meta.env`.

Archivos:

- `.env.local` — **solo local** (está en `.gitignore`, no se sube). Define `VITE_BASE_PATH=/`.
- `.env.production` — **se versiona** (usa la anon key pública). Define `VITE_BASE_PATH=/NOMBRE_REPO/`.
- `.env.example` — plantilla de referencia.

Variables:

| Variable | Local | Producción (GitHub Pages) |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | URL de tu proyecto Supabase | igual |
| `VITE_SUPABASE_ANON_KEY` | anon key pública | igual (pública, segura en frontend) |
| `VITE_APP_ENV` | `local` | `production` |
| `VITE_BASE_PATH` | `/` | `/NOMBRE_REPO/` (p.ej. `/controlmodoavion/`) |

> ⚠️ **`VITE_BASE_PATH` debe coincidir con el nombre del repositorio en GitHub.**
> Si publicas en `https://USUARIO.github.io/aircontrol/` entonces usa `/aircontrol/`.
> El repo actual es `controlmodoavion`, por eso `.env.production` usa `/controlmodoavion/`.
> Si tu repo se llama distinto, cambia `VITE_BASE_PATH` en `.env.production`.

Edita `.env.local` con la URL y anon key de tu proyecto (ya viene precargado con el proyecto remoto).

---

## 2. Cómo correr en local

```bash
npm install        # si es la primera vez
npm run dev        # servidor de desarrollo en http://localhost:5173
```

`npm run dev` usa el modo `development`, que carga `.env.local` (base `/`).
El cliente de Supabase se crea centralizado en `src/lib/supabaseClient.js` leyendo `import.meta.env`.

---

## 3. Probar el build de producción (antes de subir)

```bash
npm run build:prod   # build con modo production -> usa .env.production (base /NOMBRE_REPO/)
npm run preview      # sirve el build en http://localhost:4173
```

También puedes probar un build "local" (base `/`) con:

```bash
npm run build:local  # build con modo development -> base /
```

Abre `http://localhost:4173` y verifica que la app carga y se conecta a Supabase.

---

## 4. Qué revisar antes de subir a GitHub Pages

- [ ] Probar login en local (y con cada rol: admin, supervisor, focal).
- [ ] Probar CRUD de vacaciones.
- [ ] Probar Personal Asignado (cargar Excel).
- [ ] **Probar Focal Command**: Tareas, Radar, Seguimientos, POCLAC.
- [ ] Probar roles: admin ve todo; supervisor solo lectura de Focal Command; focal ve solo su equipo.
- [ ] **Refrescar una página interna** (p.ej. `/#/focal-command/tareas`) no rompe (hash routing).
- [ ] `npm run build:prod` y `npm run preview` sin errores.
- [ ] Confirmar que no hay rutas rotas ni errores en consola.
- [ ] Confirmar que Supabase recibe/lee datos correctamente.

---

## 5. Supabase Auth — URLs permitidas

En el panel de Supabase (**Authentication > URL Configuration**) agrega:

**Local:**
- Site URL: `http://localhost:5173`
- Redirect URLs: `http://localhost:5173`
- (opcional) `http://localhost:4173` para `npm run preview`

**GitHub Pages:**
- Site URL: `https://USUARIO.github.io/NOMBRE_REPO/`
- Redirect URLs: `https://USUARIO.github.io/NOMBRE_REPO/`

Además, la Edge Function `aircontrol-api` tiene `ALLOWED_ORIGINS` en
`supabase/functions/aircontrol-api/index.ts`. Asegúrate de incluir ambos orígenes:

```ts
const ALLOWED_ORIGINS = [
  "https://USUARIO.github.io",
  "http://localhost:5173",
  "http://localhost:4173"
];
```

---

## 6. Seguridad

- Se usa **solo la anon key** en el frontend (`VITE_SUPABASE_ANON_KEY`).
- **Nunca** se usa la service role key en el frontend.
- Toda la lógica de acceso pasa por la **Edge Function `aircontrol-api`** (que usa la service role).
- Las nuevas tablas tienen **RLS habilitado** para bloquear acceso directo con la anon key.
- El control por rol/focal (focal solo ve su equipo; supervisor lectura; admin todo) lo hace la Edge Function.

---

## 7. Despliegue en Supabase (necesario para probar Focal Command)

> El código ya está listo. Para que las tablas y la API existan en tu proyecto remoto,
> despliega la migración y la función con Supabase CLI (requiere login con tu cuenta):

```bash
# 1) Instalar e iniciar sesión en Supabase CLI
npm i -g supabase
supabase login

# 2) Vincular al proyecto (ref: qibhnkzgbnzavyelybgd)
supabase link --project-ref qibhnkzgbnzavyelybgd

# 3) Crear las tablas aircontrol_focal_* y aircontrol_poclac_*
supabase db push
# (o aplica solo la migración:)
# supabase migration up 20260709000002_focal_command

# 4) Desplegar la Edge Function actualizada (incluye los nuevos permisos/tablas)
supabase functions deploy aircontrol-api
```

Después de esto, recarga la app en local y Focal Command funcionará contra la BD remota.

---

## 8. Estructura de rutas (hash routing, compatible con GitHub Pages)

Se usa **hash routing** (`#/ruta`) para no depender de rewrites del servidor en GitHub Pages:

- `#/focal-command/tareas`
- `#/focal-command/radar`
- `#/focal-command/seguimientos`
- `#/focal-command/poclac`

El sidebar agrupa estas 4 bajo la sección **Focal Command**.

---

## 9. Tablas creadas (prefijo `aircontrol_`)

- `aircontrol_focal_tasks`
- `aircontrol_focal_radar`
- `aircontrol_focal_followups`
- `aircontrol_focal_followup_items`
- `aircontrol_poclac_sessions`
- `aircontrol_poclac_drafts`
