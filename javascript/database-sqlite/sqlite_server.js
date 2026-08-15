import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data.db');
console.error(`[INFO] Base de datos: ${DB_PATH}`);

// Abrir conexión a SQLite
const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database
});

// Crear tabla de ejemplo si no existe
await db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE,
    telefono TEXT
  )
`);
console.error(`[INFO] Tabla 'clientes' verificada/creada.`);

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {
  ejecutar_sql: {
    description: "Ejecuta una consulta SQL (SELECT, INSERT, UPDATE, DELETE) y devuelve el resultado.",
    schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Consulta SQL a ejecutar." }
      },
      required: ["sql"]
    },
    handler: async (args) => {
      console.error(`[INFO] ejecutar_sql: ${args.sql}`);
      const stmt = args.sql.trim().toUpperCase();
      
      // Determinar tipo de consulta
      if (stmt.startsWith("SELECT")) {
        const rows = await db.all(args.sql);
        return rows.map(r => JSON.stringify(r)).join("\n") || "Sin resultados.";
      } else if (stmt.startsWith("INSERT") || stmt.startsWith("UPDATE") || stmt.startsWith("DELETE")) {
        const result = await db.run(args.sql);
        const msg = `✅ Consulta ejecutada. Filas afectadas: ${result.changes || 0}`;
        if (result.lastID) {
          return `${msg} Último ID insertado: ${result.lastID}`;
        }
        return msg;
      } else {
        throw new Error("❌ Solo se permiten consultas SELECT, INSERT, UPDATE o DELETE.");
      }
    },
    format: (args, result) => `📊 Resultado:\n${result}`
  },

  insertar_cliente: {
    description: "Inserta un cliente en la tabla 'clientes'.",
    schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        email: { type: "string" },
        telefono: { type: "string" }
      },
      required: ["nombre"]
    },
    handler: async (args) => {
      console.error(`[INFO] insertar_cliente: ${JSON.stringify(args)}`);
      const { nombre, email, telefono } = args;
      const result = await db.run(
        "INSERT INTO clientes (nombre, email, telefono) VALUES (?, ?, ?)",
        [nombre, email || null, telefono || null]
      );
      return `✅ Cliente insertado con ID: ${result.lastID}`;
    },
    format: (args, result) => result
  },

  listar_clientes: {
    description: "Lista todos los clientes de la tabla 'clientes'.",
    schema: { type: "object", properties: {} },
    handler: async () => {
      const rows = await db.all("SELECT * FROM clientes");
      if (rows.length === 0) return "No hay clientes registrados.";
      return rows.map(r => JSON.stringify(r)).join("\n");
    },
    format: (args, result) => `📋 Clientes:\n${result}`
  },

  buscar_cliente: {
    description: "Busca clientes por nombre o email.",
    schema: {
      type: "object",
      properties: {
        termino: { type: "string" }
      },
      required: ["termino"]
    },
    handler: async (args) => {
      const term = `%${args.termino}%`;
      const rows = await db.all(
        "SELECT * FROM clientes WHERE nombre LIKE ? OR email LIKE ?",
        [term, term]
      );
      if (rows.length === 0) return "No se encontraron clientes.";
      return rows.map(r => JSON.stringify(r)).join("\n");
    },
    format: (args, result) => `🔍 Resultados:\n${result}`
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
    handler: async (args) => {
      if (!args.confirmar) throw new Error("❌ Debes confirmar con 'confirmar: true'.");
      const result = await db.run("DELETE FROM clientes WHERE id = ?", [args.id]);
      if (result.changes === 0) throw new Error(`❌ No se encontró cliente con ID ${args.id}.`);
      return `🗑️ Cliente con ID ${args.id} eliminado.`;
    },
    format: (args, result) => result
  },

  actualizar_cliente: {
    description: "Actualiza el email o teléfono de un cliente por ID.",
    schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        email: { type: "string" },
        telefono: { type: "string" }
      },
      required: ["id"]
    },
    handler: async (args) => {
      const updates = [];
      const params = [];
      if (args.email) { updates.push("email = ?"); params.push(args.email); }
      if (args.telefono) { updates.push("telefono = ?"); params.push(args.telefono); }
      if (updates.length === 0) throw new Error("❌ Debes proporcionar email o teléfono para actualizar.");
      params.push(args.id);
      const sql = `UPDATE clientes SET ${updates.join(", ")} WHERE id = ?`;
      const result = await db.run(sql, params);
      if (result.changes === 0) throw new Error(`❌ No se encontró cliente con ID ${args.id}.`);
      return `✅ Cliente con ID ${args.id} actualizado.`;
    },
    format: (args, result) => result
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-sqlite", version: "1.0.0" },
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