import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

// ============ CONFIGURACIÓN ============
const CSV_PATH = 'H:/mcp-book/database-csv/data/clientes_actualizados.csv';
const DB_PATH = 'H:/mcp-book/database-sqlite/data.db';
const LOG_DIR = path.join(process.cwd(), 'logs');

// Crear directorio de logs
await fs.mkdir(LOG_DIR, { recursive: true });

// ============ UTILIDADES ============
function log(msg) {
  console.error(`[AUTOMATION] ${new Date().toISOString()} - ${msg}`);
}

async function leerCSV(ruta) {
  const contenido = await fs.readFile(ruta, 'utf-8');
  const lineas = contenido.split('\n').filter(l => l.trim());
  const cabeceras = lineas[0].split(',').map(h => h.trim());
  const filas = lineas.slice(1).map(l => l.split(',').map(c => c.trim()));
  const datos = filas.map(fila => {
    const obj = {};
    cabeceras.forEach((cab, i) => obj[cab] = fila[i] || '');
    return obj;
  });
  return { cabeceras, datos };
}

async function guardarResultadosSQLite(resultados) {
  // Simulamos la guardada en SQLite (en un caso real, usarías el servidor SQLite)
  // Aquí guardamos en un archivo JSON para demostración
  const logPath = path.join(LOG_DIR, 'analisis.json');
  const existing = await fs.readFile(logPath, 'utf-8').catch(() => '[]');
  const historial = JSON.parse(existing);
  historial.push({
    timestamp: new Date().toISOString(),
    ...resultados
  });
  await fs.writeFile(logPath, JSON.stringify(historial, null, 2), 'utf-8');
  return logPath;
}

// ============ HERRAMIENTA ORQUESTADORA ============
const toolDefinitions = {
  analizar_clientes: {
    description: "Lee clientes.csv, calcula estadísticas de edad y guarda el análisis en SQLite.",
    schema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["analizar", "guardar", "mostrar"], default: "analizar" }
      }
    },
    handler: async (args) => {
      const accion = args.accion || 'analizar';
      log(`Iniciando análisis de clientes (acción: ${accion})...`);

      // 1. Leer CSV
      const { cabeceras, datos } = await leerCSV(CSV_PATH);
      log(`CSV leído: ${datos.length} registros`);

      // 2. Extraer edades
      const edades = datos.map(d => parseInt(d.edad)).filter(e => !isNaN(e));
      if (edades.length === 0) throw new Error("❌ No se encontraron edades válidas.");

      // 3. Calcular estadísticas (usando lógica propia, pero en un flujo real usarías la calculadora)
      const media = edades.reduce((a, b) => a + b, 0) / edades.length;
      const sorted = [...edades].sort((a, b) => a - b);
      const mediana = sorted.length % 2 === 0 
        ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2 
        : sorted[Math.floor(sorted.length/2)];
      
      // Moda
      const freq = {};
      let maxFreq = 0;
      let moda = [];
      for (const edad of edades) {
        freq[edad] = (freq[edad] || 0) + 1;
        if (freq[edad] > maxFreq) {
          maxFreq = freq[edad];
          moda = [edad];
        } else if (freq[edad] === maxFreq) {
          moda.push(edad);
        }
      }

      // 4. Guardar en SQLite (simulado con JSON)
      const resultados = {
        total: datos.length,
        edades: {
          media,
          mediana,
          moda: moda.join(', ')
        },
        dominios: {
          gmail: datos.filter(d => d.email.includes('gmail')).length,
          outlook: datos.filter(d => d.email.includes('outlook')).length,
          otros: datos.filter(d => !d.email.includes('gmail') && !d.email.includes('outlook')).length
        }
      };

      // 5. Guardar en log
      const logPath = await guardarResultadosSQLite(resultados);
      log(`Resultados guardados en ${logPath}`);

      // 6. Construir resumen para el usuario
      const resumen = `
📊 **Análisis de Clientes**
==========================
Total de clientes: ${resultados.total}

📈 **Estadísticas de edad:**
- Media: ${resultados.edades.media.toFixed(2)}
- Mediana: ${resultados.edades.mediana}
- Moda: ${resultados.edades.moda}

📧 **Distribución por dominio de email:**
- Gmail: ${resultados.dominios.gmail}
- Outlook: ${resultados.dominios.outlook}
- Otros: ${resultados.dominios.otros}

✅ Análisis guardado en: ${logPath}
      `;

      return resumen;
    },
    format: (args, result) => result
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-real-automation", version: "1.0.0" },
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
    return { content: [{ type: "text", text: `❌ Error: ${error.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);