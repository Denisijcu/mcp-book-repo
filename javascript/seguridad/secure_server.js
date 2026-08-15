import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ CONFIGURACIÓN DE SEGURIDAD ============
const BASE_DIR = process.env.FS_BASE_DIR || path.join(__dirname, 'sandbox');
const MCP_MODE = process.env.MCP_MODE || 'readonly'; // readonly | write | full
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ============ LOGS ============
function log(msg) {
  console.error(`[SECURE] ${new Date().toISOString()} - ${msg}`);
}

log(`Modo seguro: ${MCP_MODE}`);
log(`Directorio base: ${BASE_DIR}`);

// Crear sandbox si no existe
await fs.mkdir(BASE_DIR, { recursive: true });

// ============ UTILIDADES ============
function validarRuta(relativa) {
  const absoluta = path.resolve(BASE_DIR, relativa);
  if (!absoluta.startsWith(BASE_DIR)) {
    throw new Error(`❌ Acceso denegado: ruta fuera del sandbox.`);
  }
  return absoluta;
}

function verificarPermiso(accion) {
  const permisos = {
    'leer': ['readonly', 'write', 'full'],
    'escribir': ['write', 'full'],
    'eliminar': ['full']
  };
  if (!permisos[accion].includes(MCP_MODE)) {
    throw new Error(`❌ Modo ${MCP_MODE} no permite la operación "${accion}".`);
  }
}

// ============ HERRAMIENTAS ============
const toolDefinitions = {
  leer_archivo: {
    description: "Lee un archivo de texto (solo lectura permitida en todos los modos).",
    schema: {
      type: "object",
      properties: { ruta: { type: "string" } },
      required: ["ruta"]
    },
    handler: async (args) => {
      verificarPermiso('leer');
      const ruta = validarRuta(args.ruta);
      const stats = await fs.stat(ruta);
      if (stats.size > MAX_FILE_SIZE) throw new Error(`❌ Archivo demasiado grande.`);
      const contenido = await fs.readFile(ruta, 'utf-8');
      return contenido;
    },
    format: (args, result) => `📄 ${args.ruta}:\n${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`
  },

  escribir_archivo: {
    description: "Escribe contenido en un archivo (requiere modo write o full).",
    schema: {
      type: "object",
      properties: { ruta: { type: "string" }, contenido: { type: "string" } },
      required: ["ruta", "contenido"]
    },
    handler: async (args) => {
      verificarPermiso('escribir');
      const ruta = validarRuta(args.ruta);
      await fs.mkdir(path.dirname(ruta), { recursive: true });
      await fs.writeFile(ruta, args.contenido, 'utf-8');
      return `✅ Archivo ${args.ruta} escrito.`;
    },
    format: (args, result) => result
  },

  listar_directorio: {
    description: "Lista el contenido de un directorio (lectura).",
    schema: {
      type: "object",
      properties: { ruta: { type: "string", default: "." } }
    },
    handler: async (args) => {
      verificarPermiso('leer');
      const ruta = validarRuta(args.ruta || ".");
      const items = await fs.readdir(ruta, { withFileTypes: true });
      return items.map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`).join('\n') || "Directorio vacío.";
    },
    format: (args, result) => `📂 ${args.ruta || '.'}:\n${result}`
  },

  eliminar_archivo: {
    description: "Elimina un archivo (requiere modo full).",
    schema: {
      type: "object",
      properties: { ruta: { type: "string" }, confirmar: { type: "boolean" } },
      required: ["ruta", "confirmar"]
    },
    handler: async (args) => {
      verificarPermiso('eliminar');
      if (!args.confirmar) throw new Error("❌ Debes confirmar con 'confirmar: true'.");
      const ruta = validarRuta(args.ruta);
      await fs.unlink(ruta);
      return `🗑️ Archivo ${args.ruta} eliminado.`;
    },
    format: (args, result) => result
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-secure-fs", version: "1.0.0" },
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
    log(`Error: ${error.stack}`);
    return { content: [{ type: "text", text: `❌ ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);