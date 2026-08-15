import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

// ============ CONFIGURACIÓN ============
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'webhook.log');

// ============ LOGS ============
function log(msg) {
  console.error(`[AUTOMATION] ${new Date().toISOString()} - ${msg}`);
}

log("Iniciando servidor de automatización (modo local)...");

// Crear directorio de logs si no existe
try {
  await fs.mkdir(LOG_DIR, { recursive: true });
  log(`Directorio de logs: ${LOG_DIR}`);
} catch (err) {
  log(`Error al crear directorio de logs: ${err.message}`);
  process.exit(1);
}

// ============ UTILIDADES ============
async function guardarWebhook(data) {
  const entrada = {
    timestamp: new Date().toISOString(),
    ...data
  };
  const linea = JSON.stringify(entrada) + '\n';
  await fs.appendFile(LOG_FILE, linea, 'utf-8');
  log(`Webhook guardado en ${LOG_FILE}`);
  return linea;
}

async function leerWebhookLog(limite = 10) {
  try {
    const contenido = await fs.readFile(LOG_FILE, 'utf-8');
    const lineas = contenido.split('\n').filter(l => l.trim());
    const ultimas = lineas.slice(-limite);
    return ultimas.join('\n');
  } catch (err) {
    return 'No hay registros aún.';
  }
}

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {

  procesar_y_notificar: {
    description: "Procesa datos en formato CSV y guarda un resumen en el log local.",
    schema: {
      type: "object",
      properties: {
        datos: { type: "string", description: "Datos en formato CSV (con cabecera)" },
        resumen: { type: "string", description: "Resumen o comentario del modelo" }
      },
      required: ["datos", "resumen"]
    },
    handler: async (args) => {
      log(`procesar_y_notificar llamado`);
      const lineas = args.datos.split('\n').filter(l => l.trim());
      if (lineas.length < 2) throw new Error("❌ Se necesitan al menos cabecera y una fila de datos.");
      
      const cabeceras = lineas[0].split(',').map(h => h.trim());
      const filas = lineas.slice(1).map(l => l.split(',').map(c => c.trim()));
      
      const idxEmail = cabeceras.indexOf('email');
      if (idxEmail === -1) throw new Error("❌ No se encontró columna 'email' en el CSV.");
      
      const dominios = { gmail: 0, outlook: 0, otros: 0 };
      for (const fila of filas) {
        const email = fila[idxEmail] || '';
        if (email.includes('gmail')) dominios.gmail++;
        else if (email.includes('outlook')) dominios.outlook++;
        else if (email.includes('@')) dominios.otros++;
      }
      
      const total = filas.length;
      
      const mensaje = `
📊 Resumen del análisis:
- Total de registros: ${total}
- Dominios Gmail: ${dominios.gmail}
- Dominios Outlook: ${dominios.outlook}
- Otros dominios: ${dominios.otros}

📝 Comentario del modelo: ${args.resumen}
      `;

      await guardarWebhook({
        tipo: 'analisis_csv',
        total,
        dominios,
        resumen: args.resumen,
        mensaje
      });

      return `✅ Resumen guardado en log local.\n${mensaje}`;
    },
    format: (args, result) => result
  },

  enviar_webhook: {
    description: "Guarda un mensaje personalizado en el log local (simula envío a webhook).",
    schema: {
      type: "object",
      properties: {
        mensaje: { type: "string" },
        datos_extra: { type: "object" }
      },
      required: ["mensaje"]
    },
    handler: async (args) => {
      log(`enviar_webhook: ${args.mensaje}`);
      const payload = {
        tipo: 'mensaje_personalizado',
        mensaje: args.mensaje,
        datos_extra: args.datos_extra || {}
      };
      await guardarWebhook(payload);
      return `✅ Mensaje guardado en log local.`;
    },
    format: (args, result) => result
  },

  ver_logs: {
    description: "Muestra las últimas entradas del log de webhook.",
    schema: {
      type: "object",
      properties: {
        limite: { type: "integer", default: 10 }
      }
    },
    handler: async (args) => {
      const limite = args.limite || 10;
      const contenido = await leerWebhookLog(limite);
      return `📋 Últimas ${limite} entradas del log:\n${contenido}`;
    },
    format: (args, result) => result
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-automation", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("Listando herramientas solicitado");
  const tools = Object.entries(toolDefinitions).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.schema
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log(`Llamada a herramienta: ${name}`);
  const tool = toolDefinitions[name];
  if (!tool) {
    log(`Herramienta desconocida: ${name}`);
    return { content: [{ type: "text", text: `❌ Herramienta desconocida: ${name}` }], isError: true };
  }
  try {
    const result = await tool.handler(args);
    const text = tool.format(args, result);
    log(`Herramienta ${name} ejecutada con éxito`);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    log(`Error en ${name}: ${error.stack}`);
    return { content: [{ type: "text", text: `❌ Error: ${error.message}` }], isError: true };
  }
});

// ============ INICIAR ============
try {
  log("Creando transporte stdio...");
  const transport = new StdioServerTransport();
  log("Conectando servidor...");
  await server.connect(transport);
  log("✅ Servidor conectado y escuchando por stdio.");
} catch (error) {
  log(`❌ Error al conectar: ${error.stack}`);
  process.exit(1);
}