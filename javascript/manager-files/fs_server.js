import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

// ============ CONFIGURACIÓN ============
// Normalizamos BASE_DIR para que no tenga barra final
const BASE_DIR = path.resolve(process.env.FS_BASE_DIR || 'H:/mcp-book/manager-files/');

// ============ FUNCIONES DE LOG ============
function logInfo(msg) {
  console.error(`[INFO] ${new Date().toISOString()} - ${msg}`);
}
function logError(msg, err) {
  console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`);
  if (err) console.error(err.stack || err);
}

// ============ INICIALIZACIÓN ============
try {
  logInfo(`Iniciando servidor de archivos MCP...`);
  logInfo(`Directorio base: ${BASE_DIR}`);
  await fs.mkdir(BASE_DIR, { recursive: true });
  logInfo(`Directorio base verificado/creado.`);
} catch (err) {
  logError(`Fallo al crear/verificar el directorio base`, err);
  process.exit(1);
}

// ============ UTILIDADES ============
function normalizarRuta(rutaUsuario) {
  // Si la ruta es undefined, null o vacía, usamos "."
  const rutaRelativa = rutaUsuario || ".";
  // Unir con BASE_DIR y resolver
  const rutaCompleta = path.join(BASE_DIR, rutaRelativa);
  const rutaResuelta = path.resolve(rutaCompleta);
  // Verificar que la ruta resuelta esté dentro de BASE_DIR (comparación robusta)
  // Normalizamos BASE_DIR también
  const baseNormalizada = path.resolve(BASE_DIR);
  if (!rutaResuelta.startsWith(baseNormalizada)) {
    throw new Error(`❌ Acceso denegado: la ruta "${rutaUsuario}" intenta salir del directorio permitido.`);
  }
  return rutaResuelta;
}

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {
  leer_archivo: {
    description: "Lee el contenido de un archivo de texto (UTF-8).",
    schema: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta relativa al archivo dentro del sandbox." }
      },
      required: ["ruta"]
    },
    handler: async (args) => {
      logInfo(`leer_archivo: ${JSON.stringify(args)}`);
      const ruta = normalizarRuta(args.ruta);
      const stats = await fs.stat(ruta);
      if (!stats.isFile()) throw new Error("❌ La ruta no es un archivo.");
      const contenido = await fs.readFile(ruta, "utf-8");
      return contenido;
    },
    format: (args, result) => {
      const preview = result.length > 500 ? result.slice(0, 500) + "...\n[Contenido truncado]" : result;
      return `📄 Contenido de "${args.ruta}":\n${preview}`;
    }
  },

  escribir_archivo: {
    description: "Escribe contenido en un archivo (sobrescribe si existe).",
    schema: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta relativa al archivo." },
        contenido: { type: "string", description: "Contenido a escribir (texto)." }
      },
      required: ["ruta", "contenido"]
    },
    handler: async (args) => {
      logInfo(`escribir_archivo: ${JSON.stringify(args)}`);
      const ruta = normalizarRuta(args.ruta);
      await fs.mkdir(path.dirname(ruta), { recursive: true });
      await fs.writeFile(ruta, args.contenido, "utf-8");
      return `✅ Archivo "${args.ruta}" escrito correctamente (${args.contenido.length} caracteres).`;
    },
    format: (args, result) => result
  },

  listar_directorio: {
    description: "Lista archivos y carpetas dentro de un directorio.",
    schema: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta relativa al directorio (por defecto el directorio base)." },
        recursivo: { type: "boolean", description: "Si es true, lista recursivamente." }
      }
    },
    handler: async (args) => {
      // args.ruta puede ser undefined, null o string vacío
      const rutaRelativa = args.ruta || ".";
      logInfo(`listar_directorio: ruta="${rutaRelativa}", recursivo=${args.recursivo || false}`);
      const ruta = normalizarRuta(rutaRelativa);
      const stats = await fs.stat(ruta);
      if (!stats.isDirectory()) throw new Error("❌ La ruta no es un directorio.");
      
      const listarRecursivo = async (dir, prefijo = "") => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        let resultado = [];
        for (const entry of entries) {
          const rutaCompleta = path.join(dir, entry.name);
          const esDir = entry.isDirectory();
          const linea = `${prefijo}${entry.name}${esDir ? "/" : ""}`;
          if (args.recursivo && esDir) {
            const sub = await listarRecursivo(rutaCompleta, prefijo + "  ");
            resultado.push(linea, ...sub);
          } else {
            resultado.push(linea);
          }
        }
        return resultado;
      };

      const lista = await listarRecursivo(ruta);
      return lista.join("\n") || "Directorio vacío.";
    },
    format: (args, result) => `📂 Contenido de "${args.ruta || '.'}":\n${result}`
  },

  eliminar_archivo: {
    description: "Elimina un archivo (permanente).",
    schema: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta relativa al archivo a eliminar." },
        confirmar: { type: "boolean", description: "Debe ser true para confirmar la eliminación." }
      },
      required: ["ruta", "confirmar"]
    },
    handler: async (args) => {
      logInfo(`eliminar_archivo: ${JSON.stringify(args)}`);
      if (!args.confirmar) throw new Error("❌ Debes confirmar la eliminación con 'confirmar: true'.");
      const ruta = normalizarRuta(args.ruta);
      const stats = await fs.stat(ruta);
      if (!stats.isFile()) throw new Error("❌ La ruta no es un archivo.");
      await fs.unlink(ruta);
      return `🗑️ Archivo "${args.ruta}" eliminado permanentemente.`;
    },
    format: (args, result) => result
  },

  crear_directorio: {
    description: "Crea una nueva carpeta (y todas las intermedias si es necesario).",
    schema: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta relativa de la carpeta a crear." }
      },
      required: ["ruta"]
    },
    handler: async (args) => {
      logInfo(`crear_directorio: ${JSON.stringify(args)}`);
      const ruta = normalizarRuta(args.ruta);
      await fs.mkdir(ruta, { recursive: true });
      return `📁 Carpeta "${args.ruta}" creada correctamente.`;
    },
    format: (args, result) => result
  },

  mover_archivo: {
    description: "Mueve o renombra un archivo/carpeta.",
    schema: {
      type: "object",
      properties: {
        origen: { type: "string", description: "Ruta relativa de origen." },
        destino: { type: "string", description: "Ruta relativa de destino." }
      },
      required: ["origen", "destino"]
    },
    handler: async (args) => {
      logInfo(`mover_archivo: ${JSON.stringify(args)}`);
      const origen = normalizarRuta(args.origen);
      const destino = normalizarRuta(args.destino);
      await fs.access(origen);
      try {
        await fs.access(destino);
        throw new Error("❌ El destino ya existe. No se puede sobrescribir.");
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      await fs.rename(origen, destino);
      return `📦 "${args.origen}" movido a "${args.destino}" correctamente.`;
    },
    format: (args, result) => result
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-filesystem", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  logInfo("Listando herramientas solicitado");
  const tools = Object.entries(toolDefinitions).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.schema
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  logInfo(`Llamada a herramienta: ${name} con args: ${JSON.stringify(args)}`);
  const tool = toolDefinitions[name];

  if (!tool) {
    logError(`Herramienta desconocida: ${name}`);
    return {
      content: [{ type: "text", text: `❌ Herramienta desconocida: ${name}` }],
      isError: true
    };
  }

  try {
    const result = await tool.handler(args);
    const text = tool.format(args, result);
    logInfo(`Herramienta ${name} ejecutada con éxito`);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    logError(`Error en herramienta ${name}`, error);
    return {
      content: [{ type: "text", text: error.message || "❌ Error inesperado" }],
      isError: true
    };
  }
});

// ============ INICIAR TRANSPORTE ============
try {
  logInfo("Creando transporte stdio...");
  const transport = new StdioServerTransport();
  logInfo("Conectando servidor...");
  await server.connect(transport);
  logInfo("✅ Servidor conectado y escuchando por stdio.");
} catch (err) {
  logError("Fallo al conectar el servidor", err);
  process.exit(1);
}