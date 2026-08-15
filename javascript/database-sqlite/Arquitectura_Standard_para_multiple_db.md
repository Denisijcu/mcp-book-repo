🏗️ Arquitectura estándar para servidores MCP de bases de datos
📁 Estructura de archivos
text
database-mcp/
├── package.json
├── config.js           # Configuración unificada
├── db-connector.js     # Adaptador de conexión (factory)
├── handlers.js         # Handlers de herramientas MCP
├── server.js           # Servidor MCP principal
└── README.md           # Documentación
📄 config.js
javascript
// config.js
export const DB_CONFIG = {
  // Para SQLite (embebido)
  sqlite: {
    type: 'sqlite',
    path: './data.db'
  },
  // Para PostgreSQL
  postgres: {
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'mcp_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  // Para MySQL
  mysql: {
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    database: 'mcp_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  // Para MongoDB
  mongodb: {
    type: 'mongodb',
    uri: 'mongodb://localhost:27017',
    database: 'mcp_db'
  }
};

// Seleccionar el motor activo (cambiar según necesidad)
export const ACTIVE_DB = 'sqlite'; // 'sqlite' | 'postgres' | 'mysql' | 'mongodb'
📄 db-connector.js (Factory Pattern)
javascript
// db-connector.js
import { DB_CONFIG, ACTIVE_DB } from './config.js';

let connection = null;

async function getConnection() {
  if (connection) return connection;

  const config = DB_CONFIG[ACTIVE_DB];
  if (!config) throw new Error(`Base de datos "${ACTIVE_DB}" no configurada.`);

  switch (ACTIVE_DB) {
    case 'sqlite': {
      const sqlite3 = await import('sqlite3');
      const { open } = await import('sqlite');
      const db = await open({
        filename: config.path,
        driver: sqlite3.Database
      });
      await db.exec(`
        CREATE TABLE IF NOT EXISTS clientes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          email TEXT UNIQUE,
          telefono TEXT
        )
      `);
      connection = db;
      break;
    }
    case 'postgres': {
      const { default: pkg } = await import('pg');
      const { Client } = pkg;
      const client = new Client(config);
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS clientes (
          id SERIAL PRIMARY KEY,
          nombre TEXT NOT NULL,
          email TEXT UNIQUE,
          telefono TEXT
        )
      `);
      connection = client;
      break;
    }
    case 'mysql': {
      const { default: mysql } = await import('mysql2/promise');
      const conn = await mysql.createConnection(config);
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS clientes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nombre TEXT NOT NULL,
          email TEXT UNIQUE,
          telefono TEXT
        )
      `);
      connection = conn;
      break;
    }
    case 'mongodb': {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(config.uri);
      await client.connect();
      const db = client.db(config.database);
      // Crear colección si no existe (MongoDB lo hace automáticamente al insertar)
      connection = { client, db };
      break;
    }
    default:
      throw new Error(`Motor "${ACTIVE_DB}" no soportado.`);
  }

  return connection;
}

export { getConnection };
📄 handlers.js (Handlers unificados)
javascript
// handlers.js
import { getConnection } from './db-connector.js';

// ============ UTILIDADES ============
function formatearResultado(rows) {
  if (!rows || rows.length === 0) return "Sin resultados.";
  return rows.map(row => JSON.stringify(row)).join("\n");
}

// ============ HANDLERS POR OPERACIÓN ============

export const handlers = {
  // ---- LISTAR ----
  listar_clientes: async () => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    let rows;

    switch (motor) {
      case 'sqlite':
        rows = await conn.all("SELECT * FROM clientes");
        break;
      case 'postgres':
        const pgResult = await conn.query("SELECT * FROM clientes");
        rows = pgResult.rows;
        break;
      case 'mysql':
        const [mysqlRows] = await conn.execute("SELECT * FROM clientes");
        rows = mysqlRows;
        break;
      case 'mongodb':
        rows = await conn.db.collection('clientes').find({}).toArray();
        break;
      default:
        throw new Error(`Motor "${motor}" no soportado para listar.`);
    }

    return formatearResultado(rows);
  },

  // ---- INSERTAR ----
  insertar_cliente: async (args) => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    const { nombre, email, telefono } = args;
    let result;

    switch (motor) {
      case 'sqlite':
        result = await conn.run(
          "INSERT INTO clientes (nombre, email, telefono) VALUES (?, ?, ?)",
          [nombre, email, telefono]
        );
        return `✅ Cliente insertado con ID: ${result.lastID}`;

      case 'postgres':
        const pgResult = await conn.query(
          "INSERT INTO clientes (nombre, email, telefono) VALUES ($1, $2, $3) RETURNING id",
          [nombre, email, telefono]
        );
        return `✅ Cliente insertado con ID: ${pgResult.rows[0].id}`;

      case 'mysql':
        const [mysqlResult] = await conn.execute(
          "INSERT INTO clientes (nombre, email, telefono) VALUES (?, ?, ?)",
          [nombre, email, telefono]
        );
        return `✅ Cliente insertado con ID: ${mysqlResult.insertId}`;

      case 'mongodb':
        const doc = { nombre, email, telefono, createdAt: new Date() };
        const mongoResult = await conn.db.collection('clientes').insertOne(doc);
        return `✅ Cliente insertado con ID: ${mongoResult.insertedId}`;

      default:
        throw new Error(`Motor "${motor}" no soportado para insertar.`);
    }
  },

  // ---- BUSCAR ----
  buscar_cliente: async (args) => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    const { termino } = args;
    const term = `%${termino}%`;
    let rows;

    switch (motor) {
      case 'sqlite':
        rows = await conn.all(
          "SELECT * FROM clientes WHERE nombre LIKE ? OR email LIKE ?",
          [term, term]
        );
        break;
      case 'postgres':
        const pgResult = await conn.query(
          "SELECT * FROM clientes WHERE nombre LIKE $1 OR email LIKE $1",
          [term]
        );
        rows = pgResult.rows;
        break;
      case 'mysql':
        const [mysqlRows] = await conn.execute(
          "SELECT * FROM clientes WHERE nombre LIKE ? OR email LIKE ?",
          [term, term]
        );
        rows = mysqlRows;
        break;
      case 'mongodb':
        rows = await conn.db.collection('clientes').find({
          $or: [
            { nombre: { $regex: termino, $options: 'i' } },
            { email: { $regex: termino, $options: 'i' } }
          ]
        }).toArray();
        break;
      default:
        throw new Error(`Motor "${motor}" no soportado para buscar.`);
    }

    return formatearResultado(rows);
  },

  // ---- ACTUALIZAR ----
  actualizar_cliente: async (args) => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    const { id, email, telefono } = args;
    let result;

    switch (motor) {
      case 'sqlite':
        result = await conn.run(
          "UPDATE clientes SET email = ?, telefono = ? WHERE id = ?",
          [email, telefono, id]
        );
        if (result.changes === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `✅ Cliente ${id} actualizado.`;

      case 'postgres':
        const pgResult = await conn.query(
          "UPDATE clientes SET email = $1, telefono = $2 WHERE id = $3",
          [email, telefono, id]
        );
        if (pgResult.rowCount === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `✅ Cliente ${id} actualizado.`;

      case 'mysql':
        const [mysqlResult] = await conn.execute(
          "UPDATE clientes SET email = ?, telefono = ? WHERE id = ?",
          [email, telefono, id]
        );
        if (mysqlResult.affectedRows === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `✅ Cliente ${id} actualizado.`;

      case 'mongodb':
        const mongoResult = await conn.db.collection('clientes').updateOne(
          { _id: new ObjectId(id) },
          { $set: { email, telefono } }
        );
        if (mongoResult.matchedCount === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `✅ Cliente ${id} actualizado.`;

      default:
        throw new Error(`Motor "${motor}" no soportado para actualizar.`);
    }
  },

  // ---- ELIMINAR ----
  eliminar_cliente: async (args) => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    const { id, confirmar } = args;
    if (!confirmar) throw new Error("Debes confirmar la eliminación con 'confirmar: true'.");
    let result;

    switch (motor) {
      case 'sqlite':
        result = await conn.run("DELETE FROM clientes WHERE id = ?", [id]);
        if (result.changes === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `🗑️ Cliente ${id} eliminado.`;

      case 'postgres':
        const pgResult = await conn.query("DELETE FROM clientes WHERE id = $1", [id]);
        if (pgResult.rowCount === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `🗑️ Cliente ${id} eliminado.`;

      case 'mysql':
        const [mysqlResult] = await conn.execute("DELETE FROM clientes WHERE id = ?", [id]);
        if (mysqlResult.affectedRows === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `🗑️ Cliente ${id} eliminado.`;

      case 'mongodb':
        const mongoResult = await conn.db.collection('clientes').deleteOne({ _id: new ObjectId(id) });
        if (mongoResult.deletedCount === 0) throw new Error(`No se encontró cliente con ID ${id}.`);
        return `🗑️ Cliente ${id} eliminado.`;

      default:
        throw new Error(`Motor "${motor}" no soportado para eliminar.`);
    }
  },

  // ---- EJECUTAR SQL (solo para SQL/relacionales) ----
  ejecutar_sql: async (args) => {
    const conn = await getConnection();
    const motor = process.env.ACTIVE_DB || 'sqlite';
    const { sql } = args;

    // Solo permitir SELECT, INSERT, UPDATE, DELETE
    const stmt = sql.trim().toUpperCase();
    if (!stmt.startsWith('SELECT') && !stmt.startsWith('INSERT') && 
        !stmt.startsWith('UPDATE') && !stmt.startsWith('DELETE')) {
      throw new Error("Solo se permiten consultas SELECT, INSERT, UPDATE o DELETE.");
    }

    let rows, result;

    switch (motor) {
      case 'sqlite':
        if (stmt.startsWith('SELECT')) {
          rows = await conn.all(sql);
          return formatearResultado(rows);
        } else {
          result = await conn.run(sql);
          return `✅ Ejecutado. Filas afectadas: ${result.changes || 0}`;
        }
      case 'postgres':
        const pgResult = await conn.query(sql);
        if (stmt.startsWith('SELECT')) {
          return formatearResultado(pgResult.rows);
        } else {
          return `✅ Ejecutado. Filas afectadas: ${pgResult.rowCount || 0}`;
        }
      case 'mysql':
        const [mysqlRows] = await conn.execute(sql);
        if (stmt.startsWith('SELECT')) {
          return formatearResultado(mysqlRows);
        } else {
          return `✅ Ejecutado. Filas afectadas: ${mysqlRows.affectedRows || 0}`;
        }
      case 'mongodb':
        throw new Error("MongoDB no soporta SQL directo. Usa las herramientas específicas.");
      default:
        throw new Error(`Motor "${motor}" no soportado para SQL.`);
    }
  }
};
📄 server.js (Servidor MCP)
javascript
// server.js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handlers } from './handlers.js';

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {
  listar_clientes: {
    description: "Lista todos los clientes de la base de datos.",
    schema: { type: "object", properties: {} },
    handler: handlers.listar_clientes,
    format: (args, result) => `📋 Clientes:\n${result}`
  },
  insertar_cliente: {
    description: "Inserta un nuevo cliente.",
    schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        email: { type: "string" },
        telefono: { type: "string" }
      },
      required: ["nombre"]
    },
    handler: handlers.insertar_cliente,
    format: (args, result) => result
  },
  buscar_cliente: {
    description: "Busca clientes por nombre o email.",
    schema: {
      type: "object",
      properties: { termino: { type: "string" } },
      required: ["termino"]
    },
    handler: handlers.buscar_cliente,
    format: (args, result) => `🔍 Resultados:\n${result}`
  },
  actualizar_cliente: {
    description: "Actualiza email o teléfono de un cliente.",
    schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        email: { type: "string" },
        telefono: { type: "string" }
      },
      required: ["id"]
    },
    handler: handlers.actualizar_cliente,
    format: (args, result) => result
  },
  eliminar_cliente: {
    description: "Elimina un cliente por ID (requiere confirmación).",
    schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        confirmar: { type: "boolean" }
      },
      required: ["id", "confirmar"]
    },
    handler: handlers.eliminar_cliente,
    format: (args, result) => result
  },
  ejecutar_sql: {
    description: "Ejecuta una consulta SQL (SELECT, INSERT, UPDATE, DELETE).",
    schema: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"]
    },
    handler: handlers.ejecutar_sql,
    format: (args, result) => `📊 Resultado:\n${result}`
  }
};

// ============ SERVIDOR MCP ============
const server = new Server(
  { name: "mcp-database", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = Object.entries(toolDefinitions).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.schema
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolDefinitions[name];
  if (!tool) {
    return { content: [{ type: "text", text: `❌ Herramienta desconocida: ${name}` }], isError: true };
  }
  try {
    const result = await tool.handler(args);
    const text = tool.format(args, result);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    console.error(`[ERROR] ${error.stack}`);
    return { content: [{ type: "text", text: `❌ Error: ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
📄 package.json (dependencias)
json
{
  "name": "mcp-database-standard",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "sqlite": "^5.1.1",
    "sqlite3": "^5.1.6",
    "pg": "^8.11.3",
    "mysql2": "^3.6.0",
    "mongodb": "^5.8.0"
  }
}
📝 Cómo usar este estándar
Elige el motor en config.js (cambia ACTIVE_DB).

Instala solo las dependencias necesarias para ese motor (puedes comentar el resto en package.json).

Ejecuta el servidor normalmente.

Ejemplo para cambiar a PostgreSQL:
javascript
export const ACTIVE_DB = 'postgres';
export const DB_CONFIG = {
  postgres: {
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'mcp_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
};
🧩 Extensiones posibles
Soporte para múltiples conexiones simultáneas (varias bases de datos).

Conexión por pool (para alta concurrencia).

Conexión con SSL/TLS (para bases en la nube).

Caching de resultados de consultas frecuentes.

Logging estructurado para auditoría.

📌 Nota para el libro
Este código está diseñado para ser didáctico y extensible, no para producción directa. En un entorno real, deberías añadir:

Manejo de variables de entorno (.env) para credenciales.

Timeouts y retries.

Validación de entrada más estricta.

Sistema de migraciones para esquemas.
