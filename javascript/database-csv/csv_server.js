import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// ============ OBTENER DIRECTORIO DEL SCRIPT ============
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ CONFIGURACIÓN CON RUTA ABSOLUTA ============
// Ahora usamos una carpeta 'data' DENTRO de la carpeta donde está este script
const BASE_DIR = path.join(__dirname, 'data');
console.error(`[INFO] Directorio base CSV ABSOLUTO: ${BASE_DIR}`);

// Crear el directorio 'data' si no existe
try {
  await fs.mkdir(BASE_DIR, { recursive: true });
  console.error(`[INFO] Directorio base creado/verificado.`);
} catch (err) {
  console.error(`[ERROR] No se pudo crear el directorio base: ${err.message}`);
  process.exit(1);
}

// ============ UTILIDADES CON LOGS ============
function validarRuta(relativa) {
  const absoluta = path.resolve(BASE_DIR, relativa);
  console.error(`[DEBUG] validarRuta: relativa="${relativa}" -> absoluta="${absoluta}"`);
  if (!absoluta.startsWith(BASE_DIR)) {
    throw new Error(`❌ Acceso denegado: ruta "${relativa}" fuera del directorio permitido.`);
  }
  return absoluta;
}

async function leerCSV(ruta) {
  console.error(`[DEBUG] leerCSV: ${ruta}`);
  const contenido = await fs.readFile(ruta, 'utf-8');
  const registros = parse(contenido, { columns: true, skip_empty_lines: true });
  return registros;
}

async function escribirCSV(ruta, registros, columnas) {
  console.error(`[DEBUG] escribirCSV: ${ruta}, columnas=${columnas.join(',')}, filas=${registros.length}`);
  const salida = stringify(registros, { header: true, columns: columnas });
  await fs.writeFile(ruta, salida, 'utf-8');
  // Verificar que el archivo se creó
  const stats = await fs.stat(ruta);
  console.error(`[DEBUG] Archivo escrito, tamaño: ${stats.size} bytes`);
}

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {
  listar_base: {
    description: "Lista el contenido del directorio base (raíz del sandbox CSV).",
    schema: { type: "object", properties: {} },
    handler: async () => {
      const archivos = await fs.readdir(BASE_DIR);
      console.error(`[DEBUG] listar_base: ${archivos.length} elementos`);
      if (archivos.length === 0) return "El directorio base está vacío.";
      return archivos.join("\n");
    },
    format: (args, result) => `📂 Contenido de ${BASE_DIR}:\n${result}`
  },

  crear_csv: {
    description: "Crea un nuevo archivo CSV con las columnas especificadas.",
    schema: {
      type: "object",
      properties: {
        archivo: { type: "string" },
        columnas: { type: "array", items: { type: "string" } }
      },
      required: ["archivo", "columnas"]
    },
    handler: async (args) => {
      const ruta = validarRuta(args.archivo);
      console.error(`[INFO] crear_csv: ${ruta}`);
      await escribirCSV(ruta, [], args.columnas);
      return `✅ Archivo CSV creado correctamente en: ${ruta}`;
    },
    format: (args, result) => result
  },

  agregar_fila: {
    description: "Agrega una nueva fila a un archivo CSV.",
    schema: {
      type: "object",
      properties: {
        archivo: { type: "string" },
        fila: { type: "object" }
      },
      required: ["archivo", "fila"]
    },
    handler: async (args) => {
      const ruta = validarRuta(args.archivo);
      console.error(`[INFO] agregar_fila: ${ruta}`);
      const datos = await leerCSV(ruta);
      const cabeceras = Object.keys(datos[0] || args.fila);
      const nuevaFila = {};
      for (const col of cabeceras) {
        nuevaFila[col] = args.fila[col] || "";
      }
      datos.push(nuevaFila);
      await escribirCSV(ruta, datos, cabeceras);
      return `✅ Fila agregada a ${args.archivo} (ruta: ${ruta})`;
    },
    format: (args, result) => result
  },

  listar_csv: {
    description: "Lee y muestra todas las filas de un archivo CSV.",
    schema: {
      type: "object",
      properties: { archivo: { type: "string" } },
      required: ["archivo"]
    },
    handler: async (args) => {
      const ruta = validarRuta(args.archivo);
      console.error(`[INFO] listar_csv: ${ruta}`);
      const datos = await leerCSV(ruta);
      if (datos.length === 0) return "El archivo está vacío o solo tiene cabeceras.";
      const cabeceras = Object.keys(datos[0]);
      let tabla = cabeceras.join(" | ") + "\n" + "-".repeat(40) + "\n";
      for (const fila of datos) {
        tabla += cabeceras.map(c => fila[c] || "").join(" | ") + "\n";
      }
      return tabla;
    },
    format: (args, result) => `📊 ${args.archivo}:\n${result}`
  },

  buscar_csv: {
    description: "Busca filas donde una columna contenga un valor específico.",
    schema: {
      type: "object",
      properties: {
        archivo: { type: "string" },
        columna: { type: "string" },
        valor: { type: "string" }
      },
      required: ["archivo", "columna", "valor"]
    },
    handler: async (args) => {
      const ruta = validarRuta(args.archivo);
      console.error(`[INFO] buscar_csv: ${ruta}`);
      const datos = await leerCSV(ruta);
      const resultados = datos.filter(fila =>
        String(fila[args.columna] || "").toLowerCase().includes(args.valor.toLowerCase())
      );
      if (resultados.length === 0) return "No se encontraron coincidencias.";
      return resultados.map(f => JSON.stringify(f)).join("\n");
    },
    format: (args, result) => `🔍 Resultados en ${args.archivo}:\n${result}`
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-csv", version: "1.0.0" },
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