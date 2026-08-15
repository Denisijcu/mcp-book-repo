import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import 'dotenv/config';

// ============ CONFIGURACIÓN ============
// Variables de entorno (crea un archivo .env o defínelas en el sistema)
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const OPENWEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';

// ============ UTILIDADES ============
async function hacerRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  return response.json();
}

// ============ DEFINICIÓN DE HERRAMIENTAS ============
const toolDefinitions = {
  obtener_chiste: {
    description: "Obtiene un chiste aleatorio en español desde una API pública.",
    schema: { type: "object", properties: {} },
    handler: async () => {
      // API pública de chistes (sin clave)
      const data = await hacerRequest('https://chistes-api.vercel.app/api/chistes/random');
      // La API devuelve { chiste: "...", ... }
      return data.chiste || data.texto || JSON.stringify(data);
    },
    format: (args, result) => `😂 Chiste:\n${result}`
  },

  obtener_clima: {
    description: "Obtiene el clima actual de una ciudad usando OpenWeatherMap.",
    schema: {
      type: "object",
      properties: {
        ciudad: { type: "string", description: "Nombre de la ciudad (ej: Madrid, London)" }
      },
      required: ["ciudad"]
    },
    handler: async (args) => {
      if (!OPENWEATHER_API_KEY) {
        throw new Error("❌ Falta la clave de OpenWeatherMap. Define OPENWEATHER_API_KEY en variables de entorno.");
      }
      const url = `${OPENWEATHER_URL}?q=${encodeURIComponent(args.ciudad)}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`;
      const data = await hacerRequest(url);
      const temp = data.main.temp;
      const desc = data.weather[0].description;
      const ciudad = data.name;
      return `🌡️ ${ciudad}: ${temp}°C, ${desc}`;
    },
    format: (args, result) => `📊 Clima:\n${result}`
  },

  obtener_bitcoin: {
    description: "Obtiene el precio actual de Bitcoin en USD desde CoinGecko.",
    schema: { type: "object", properties: {} },
    handler: async () => {
      const data = await hacerRequest('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const precio = data.bitcoin.usd;
      return `💰 Bitcoin: $${precio} USD`;
    },
    format: (args, result) => `📈 ${result}`
  },

  llamar_api: {
    description: "Realiza una solicitud HTTP a cualquier API. Útil para extender el servidor sin modificar el código.",
    schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa de la API" },
        metodo: { type: "string", enum: ["GET", "POST"], default: "GET" },
        headers: { type: "object", description: "Headers opcionales" },
        body: { type: "object", description: "Cuerpo para POST" }
      },
      required: ["url"]
    },
    handler: async (args) => {
      const options = { method: args.metodo || 'GET' };
      if (args.headers) options.headers = args.headers;
      if (args.body && options.method === 'POST') {
        options.body = JSON.stringify(args.body);
        options.headers = { 'Content-Type': 'application/json', ...options.headers };
      }
      const data = await hacerRequest(args.url, options);
      return JSON.stringify(data, null, 2);
    },
    format: (args, result) => `📡 Respuesta de ${args.url}:\n${result}`
  }
};

// ============ SERVIDOR ============
const server = new Server(
  { name: "mcp-api-externa", version: "1.0.0" },
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