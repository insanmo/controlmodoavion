# Asignación de personal sin focal

Rosa Hernandez (cuenta activa con rol supervisor, nombre normalizado sin acentos) es la responsable inicial. En Usuarios, un administrador puede cambiarla mediante la columna “Recibe personal sin focal”. Solo puede seleccionarse un usuario activo. Se exige elegir otro responsable antes de eliminar o desactivar la cuenta seleccionada.

La preferencia se comparte entre navegadores mediante una fila reservada de la tabla de configuración existente `aircontrol_column_config`: `excel_header = __aircontrol_default_focal__`, `display_name = UUID del usuario`. Se separa de las columnas Excel al cargar datos y no requiere migraciones ni cambios de la función remota. Sin una preferencia guardada se utiliza Rosa; si una preferencia guardada deja de ser válida, se pide seleccionar otro usuario, sin elegir una cuenta arbitraria.

Al cargar datos con rol admin o supervisor, los colaboradores con `focal_user_id` vacío se guardan con el responsable predeterminado. Las asignaciones existentes se conservan. Las importaciones usan el mismo responsable para celdas vacías o marcadores como “Sin focal”, “Sin asignar” y “N/A”.

Antes de importar y de editar personal se vuelven a consultar los usuarios. Después de crear un focal, se consulta su cuenta persistida por correo: nunca se asigna el UUID optimista. El RPC de creación puede reutilizar una cuenta por correo, conservando un UUID diferente. Si ya existe ese correo, se reutiliza sin invocar el RPC que podría cambiar su contraseña.

Verificación: `npm test` cubre IDs distintos entre cliente y base, reutilización por nombre y correo, preferencia compartida, Rosa como opción inicial y asignación de colaboradores sin focal. `npm run build` genera el sitio de Pages. No se ejecutan scripts de fusión o eliminación de cuentas para esta corrección.

## Protección en la base de datos

El trigger `aircontrol_personal_resolve_focal` resuelve antes de la validación de FK los IDs ausentes o inexistentes. Conserva cualquier asignación cuyo usuario realmente exista, también si la cuenta se desactiva posteriormente. Para referencias inválidas busca el nombre exacto normalizado del Excel entre usuarios activos; si no hay coincidencia, usa el responsable predeterminado. No une abreviaturas ni crea cuentas y no cambia el contenido original de las celdas.

`Repair personnel focal assignment` instala el trigger, prueba inserciones y actualizaciones con el rol `service_role` y confirma la transacción únicamente si pasa la verificación. Los registros de prueba se revierten antes del commit. Conserva la FK original validada y guarda la selección inicial de Rosa en la configuración compartida. Puede recibir los nombres de focales como entrada para verificar todas las categorías del archivo sin subir datos de los colaboradores.
