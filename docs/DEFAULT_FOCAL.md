# Asignación de personal sin focal

Rosa Hernandez (cuenta activa con rol supervisor, nombre normalizado sin acentos) es la responsable inicial. En Usuarios, un administrador puede cambiarla mediante la columna “Recibe personal sin focal”. Solo puede seleccionarse un usuario activo. Se exige elegir otro responsable antes de eliminar o desactivar la cuenta seleccionada.

La preferencia se comparte entre navegadores mediante una fila reservada de la tabla de configuración existente `aircontrol_column_config`: `excel_header = __aircontrol_default_focal__`, `display_name = UUID del usuario`. Se separa de las columnas Excel al cargar datos y no requiere migraciones ni cambios de la función remota. Sin una preferencia guardada se utiliza Rosa; si una preferencia guardada deja de ser válida, se pide seleccionar otro usuario, sin elegir una cuenta arbitraria.

Al cargar datos con rol admin o supervisor, los colaboradores con `focal_user_id` vacío se guardan con el responsable predeterminado. Las asignaciones existentes se conservan. Las importaciones usan el mismo responsable para celdas vacías o marcadores como “Sin focal”, “Sin asignar” y “N/A”.

Antes de importar y de editar personal se vuelven a consultar los usuarios. La importación solo utiliza cuentas activas existentes por nombre normalizado. Un nombre desconocido o abreviado sin cuenta propia (por ejemplo, Rosa H.) se asigna al responsable predeterminado; no se crean cuentas ni se cambian contraseñas desde la carga Excel. Las cuentas nuevas se administran desde Usuarios. Si no hay un responsable predeterminado válido, se indica cómo seleccionarlo antes de guardar la importación.

La tabla y exportación de personal muestran el nombre de la cuenta realmente asignada. El nombre original del archivo se conserva en los campos e historial de importación, junto con una advertencia sobre el uso del responsable predeterminado. El mensaje de éxito informa cuántos colaboradores usaron esa asignación.

Verificación: `npm test` cubre el caso Rosa H. sin cuenta, cuentas abreviadas existentes o inactivas, cambios del responsable predeterminado y ausencia de un responsable válido. El archivo suministrado se verificó localmente con el lector de la aplicación: 180 filas, cero altas de cuentas y cuatro filas Rosa H. asignadas al predeterminado. No se incluye el archivo ni datos de colaboradores en el repositorio.

## Protección en la base de datos

El trigger `aircontrol_personal_resolve_focal` resuelve antes de la validación de FK los IDs ausentes o inexistentes. Conserva cualquier asignación cuyo usuario realmente exista, también si la cuenta se desactiva posteriormente. Para referencias inválidas busca el nombre exacto normalizado del Excel entre usuarios activos; si no hay coincidencia, usa el responsable predeterminado. No une abreviaturas ni crea cuentas y no cambia el contenido original de las celdas.

`Repair personnel focal assignment` instala el trigger, prueba inserciones y actualizaciones con el rol `service_role` y confirma la transacción únicamente si pasa la verificación. Los registros de prueba se revierten antes del commit. Conserva la FK original validada y guarda la selección inicial de Rosa en la configuración compartida. Puede recibir los nombres de focales como entrada para verificar todas las categorías del archivo sin subir datos de los colaboradores.
