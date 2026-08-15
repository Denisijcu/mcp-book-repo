import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Reconstrucción de variables globales para ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inicializamos la instancia con verbose
const sqlite = sqlite3.verbose();

// 2. Hardening: Conexión estricta en modo 'Solo Lectura' (OPEN_READONLY)
const dbPath = path.resolve(__dirname, 'data.db');
const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (err) => {
    if (err) {
        console.error('[!] Error crítico conectando a SQLite:', err.message);
        process.exit(1);
    }
    console.log('[+] Conexión segura establecida con la base de datos (Modo Lectura).');
});

// 3. Template del mensaje
const generarTemplate = (nombre, id) => {
    return `
============================================================
ASUNTO: Acceso Confirmado - Vertex Intelligence Core (VIC)
============================================================

Saludos, ${nombre}:

Es un placer darte la bienvenida a nuestra infraestructura.
Tu identificador de despliegue asignado es: #${id}.

Por favor, conserva este ID para futuras auditorías o
asistencia técnica dentro de la plataforma.

Mantente seguro,
El equipo de Vertex Coders
============================================================
`;
};

// 4. Ejecución de la consulta
const query = `SELECT id, email, nombre, telefono FROM clientes`;

db.all(query, [], (err, rows) => {
    if (err) {
        console.error('[!] Error en la extracción de datos:', err.message);
        return;
    }

    if (rows.length === 0) {
        console.log('[-] La tabla no contiene registros.');
        return;
    }

    console.log(`[+] Procesando ${rows.length} registros para envío...\n`);

    rows.forEach((cliente) => {
        // Hardening: Sanitización básica de salida para prevenir XSS
        const nombreSeguro = cliente.nombre.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const emailSeguro = cliente.email;

        // Generamos el payload final
        const mensaje = generarTemplate(nombreSeguro, cliente.id);

        console.log(`[->] Simulando envío a: ${emailSeguro} (${cliente.telefono})`);
        console.log(mensaje);
    });
});

// 5. Cierre seguro de la conexión
db.close((err) => {
    if (err) {
        console.error('[!] Error al cerrar la conexión:', err.message);
    } else {
        console.log('[+] Conexión cerrada. Script finalizado con éxito.');
    }
});