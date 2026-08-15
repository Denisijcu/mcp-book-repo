🧪 Batería de pruebas para el servidor CSV (desde LM Studio)
1. Listar el contenido del directorio base
"Lista el contenido del directorio base del servidor CSV"
→ Usa listar_base y te mostrará clientes.csv.

2. Mostrar el contenido del archivo CSV
"Lista el contenido de clientes.csv"
→ Usa listar_csv. Deberías ver una tabla con los datos que ya tienes.

3. Agregar una nueva fila
"Agrega una fila a clientes.csv con id=8, nombre='Sofía', email='sofia@mail.com'"
→ Usa agregar_fila. Luego vuelve a listar para confirmar.

4. Buscar por columna
"Busca en clientes.csv la columna email que contenga 'gmail'"
→ Usa buscar_csv. Te mostrará las filas con emails de Gmail.

5. Crear un nuevo archivo CSV
"Crea un archivo CSV llamado 'productos.csv' con columnas: id, nombre, precio"
→ Usa crear_csv. Luego lista el directorio base para ver que existe.

6. Agregar datos al nuevo archivo
"Agrega una fila a productos.csv con id=1, nombre='Laptop', precio=1200"
→ Usa agregar_fila apuntando a productos.csv.

7. Buscar en productos
"Busca en productos.csv la columna nombre que contenga 'Laptop'"
→ Usa buscar_csv.

8. Manejo de errores
"Intenta leer un archivo que no existe, como 'no_existe.csv'"
→ El servidor debe devolver un error claro que el modelo comunicará.

📝 Lo que debes incluir en tu libro (Sección 3 – CSV)
Explicación del servidor: código, dependencias, estructura.

Ejemplos de herramientas: crear_csv, listar_csv, agregar_fila, buscar_csv, listar_base.

Logs: muestra fragmentos de logs (como los que viste en la terminal) para demostrar que cada operación se ejecuta correctamente.

Seguridad: cómo se protege el sistema usando validarRuta.

Limitaciones: el CSV es simple, no soporta relaciones complejas; eso lo resuelve SQLite.