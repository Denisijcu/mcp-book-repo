 Pruebas para SQLite (desde LM Studio)
#	Pregunta	Herramienta esperada
1	"Inserta un cliente con nombre 'Carlos', email 'carlos@mail.com' y teléfono '123456789'"	insertar_cliente
2	"Lista todos los clientes"	listar_clientes
3	"Busca clientes que contengan 'Carlos'"	buscar_cliente
4	"Actualiza el email del cliente con ID 1 a 'carlosnuevo@mail.com'"	actualizar_cliente
5	"Elimina el cliente con ID 1 (confirmar: true)"	eliminar_cliente
6	"Ejecuta SQL: SELECT * FROM clientes WHERE email LIKE '%gmail%'"	ejecutar_sql
7	"Ejecuta SQL: INSERT INTO clientes (nombre) VALUES ('Prueba')"	ejecutar_sql