import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import axios from "axios";
import { Buffer } from "buffer";

dotenv.config();

const GOOGLE_APP_URL = process.env.GOOGLE_APP_URL;

if (!GOOGLE_APP_URL) {
    console.error("[!] Error Crítico: GOOGLE_APP_URL no está definido en el .env");
    process.exit(1);
}

if (!GOOGLE_APP_URL.endsWith("/exec")) {
    console.error("[!] Advertencia: la URL no termina en /exec. Las URLs /dev exigen sesión autenticada y devolverán HTML de login.");
}

/**
 * Templates válidos. DEBE coincidir con CONFIG.TEMPLATES del Apps Script.
 * El modelo manda la clave, nunca un docId. Si añades uno allá, añádelo aquí.
 */
const TEMPLATES = ["bienvenida"];

const server = new Server(
    { name: "vertex-google-suite-mcp", version: "2.0.0" },
    { capabilities: { tools: {} } }
);

// ============================ CAPA DE TRANSPORTE ============================

/**
 * Llama al backend de Apps Script.
 * Devuelve SIEMPRE { ok, data } o { ok:false, error_code, message, retryable, hint }.
 * Nunca lanza: la clasificación del fallo se hace aquí, no en el handler.
 */
async function googleApiCall(action, payload = {}) {
    const rawPayload = JSON.stringify({ action, data: payload });

    // Content-Length explícito: evita el 411 del WAF de Google.
    const payloadSize = Buffer.byteLength(rawPayload, "utf8");

    let response;
    try {
        response = await axios.post(GOOGLE_APP_URL, rawPayload, {
            headers: {
                "Content-Type": "application/json",
                "Content-Length": payloadSize
            },
            maxRedirects: 5,        // Apps Script siempre redirige a googleusercontent.com
            timeout: 60000,         // makeCopy + PDF puede tardar
            transformResponse: [(d) => d]  // no parsear: queremos inspeccionar el crudo
        });
    } catch (err) {
        const status = err.response?.status;
        return {
            ok: false,
            error_code: status ? `HTTP_${status}` : "NETWORK_ERROR",
            message: err.message,
            retryable: !status || status >= 500,
            hint: "Fallo de red o HTTP. Reporta al usuario; no sustituyas la herramienta."
        };
    }

    const raw = typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);

    // Detección de página de login: el síntoma clásico de "access: usuarios con cuenta Google".
    if (!raw.trim().startsWith("{")) {
        return {
            ok: false,
            error_code: "NON_JSON_RESPONSE",
            message: `El backend devolvió HTML en vez de JSON. Primeros 300 chars: ${raw.slice(0, 300)}`,
            retryable: false,
            hint: "Revisa el deployment: 'Ejecutar como: Yo' y 'Acceso: Cualquier usuario' (anónimo)."
        };
    }

    let json;
    try {
        json = JSON.parse(raw);
    } catch {
        return {
            ok: false,
            error_code: "MALFORMED_JSON",
            message: `JSON inválido del backend: ${raw.slice(0, 300)}`,
            retryable: false,
            hint: "Bug del Apps Script. Revisa los logs de Ejecuciones."
        };
    }

    // EL FIX: el backend devuelve 200 con status:"error". Sin esto pasa como éxito.
    if (json.status === "error") {
        return {
            ok: false,
            error_code: json.error_code || "BACKEND_ERROR",
            message: json.message,
            retryable: json.retryable === true,
            hint: json.agent_hint || "Reporta el error al usuario y detente."
        };
    }

    return { ok: true, data: json };
}

// ============================ RESPUESTAS MCP ============================

function toolOk(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * isError:true es lo que hace que el cliente MCP trate esto como fallo real.
 * Sin esa bandera el modelo lo lee como dato y empieza a improvisar.
 */
function toolError(result) {
    return {
        isError: true,
        content: [{
            type: "text",
            text: JSON.stringify({
                error_code: result.error_code,
                message: result.message,
                retryable: result.retryable,
                INSTRUCCION: result.retryable
                    ? "Fallo transitorio: puedes reintentar UNA vez esta misma herramienta."
                    : "NO reintentes. NO uses otra herramienta como sustituto. Informa al usuario y detente."
            }, null, 2)
        }]
    };
}

/** Valida args localmente para no gastar un round-trip a Google. */
function validate(args, required) {
    const missing = required.filter(f => {
        const v = args?.[f];
        return v === undefined || v === null || String(v).trim() === "";
    });
    if (missing.length) {
        return {
            ok: false,
            error_code: "MISSING_FIELDS",
            message: `Faltan parámetros: ${missing.join(", ")}`,
            retryable: false
        };
    }
    return { ok: true };
}

function validateTemplate(template) {
    if (template === undefined) return { ok: true };  // el backend usa 'bienvenida'
    if (!TEMPLATES.includes(template)) {
        return {
            ok: false,
            error_code: "UNKNOWN_TEMPLATE",
            message: `Template "${template}" inválido. Válidos: ${TEMPLATES.join(", ")}. NO es un ID de documento.`,
            retryable: false
        };
    }
    return { ok: true };
}

// ============================ DEFINICIÓN DE TOOLS ============================

const TEMPLATE_PROP = {
    type: "string",
    enum: TEMPLATES,
    description: "Clave de la plantilla a usar. NO es un ID de documento; el backend lo resuelve. Si se omite se usa 'bienvenida'."
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "diagnosticar_backend",
            description: "Verifica la salud del backend de Google: usuario efectivo, permisos de lectura y escritura en Drive, y acceso a las plantillas. Usa esto PRIMERO si otra herramienta falla con error de permisos.",
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "get_clientes_sheet",
            description: "Obtiene la lista de clientes desde la base de datos en Google Sheets.",
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "add_cliente_sheet",
            description: "Agrega un nuevo cliente a la base de datos de Google Sheets.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Identificador único del cliente" },
                    email: { type: "string", description: "Correo electrónico" },
                    nombre: { type: "string", description: "Nombre completo" },
                    telefono: { type: "string", description: "Teléfono (opcional)" }
                },
                required: ["id", "email", "nombre"]
            }
        },
        {
            name: "enviar_correo_template",
            description: "Envía un correo a un cliente usando una plantilla de Google Docs como cuerpo del mensaje. Para enviar un PDF adjunto usa generar_enviar_pdf en su lugar; estas dos herramientas NO son intercambiables.",
            inputSchema: {
                type: "object",
                properties: {
                    email: { type: "string", description: "Correo del destinatario" },
                    nombre: { type: "string", description: "Nombre a inyectar en la plantilla" },
                    template: TEMPLATE_PROP
                },
                required: ["email", "nombre"]
            }
        },
        {
            name: "calcular_riesgo_avanzado",
            description: `Procesa métricas de exploits en el motor de cálculo de Google Sheets para evitar errores aritméticos del modelo. Devuelve riesgo residual y días estimados de mitigación. CRÍTICO: reporta los valores EXACTAMENTE como los devuelve la herramienta. No redondees, no interpretes. Reporta el valor tal cual llega.`,
            inputSchema: {
                type: "object",
                properties: {
                    severidad: { type: "number", description: "Puntuación CVSS del exploit (1.0 a 10.0)" },
                    presupuesto: { type: "number", description: "Presupuesto en USD para mitigación" }
                },
                required: ["severidad", "presupuesto"]
            }
        },
        {
            name: "generar_enviar_pdf",
            description: "Clona una plantilla de Google Docs, inyecta los datos del cliente, la compila a PDF, la envía por correo como adjunto y borra el clon temporal. Para enviar solo texto sin adjunto usa enviar_correo_template; estas dos herramientas NO son intercambiables.",
            inputSchema: {
                type: "object",
                properties: {
                    email: { type: "string", description: "Correo del destinatario" },
                    nombre: { type: "string", description: "Nombre a inyectar en el PDF" },
                    template: TEMPLATE_PROP
                },
                required: ["email", "nombre"]
            }
        }
    ]
}));

// ============================ ENRUTADOR ============================

const ROUTES = {
    diagnosticar_backend: {
        action: "diag",
        required: []
    },
    get_clientes_sheet: {
        action: "read",
        required: []
    },
    add_cliente_sheet: {
        action: "create",
        required: ["id", "email", "nombre"]
    },
    enviar_correo_template: {
        action: "send_email",
        required: ["email", "nombre"],
        checkTemplate: true
    },
    calcular_riesgo_avanzado: {
        action: "calcular_riesgo",
        required: ["severidad", "presupuesto"]
    },
    generar_enviar_pdf: {
        action: "send_pdf_report",
        required: ["email", "nombre"],
        checkTemplate: true
    }
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    console.error(`[+] Tool invocada: ${name}`);

    const route = ROUTES[name];
    if (!route) {
        return toolError({
            error_code: "UNKNOWN_TOOL",
            message: `Tool desconocida: ${name}. Disponibles: ${Object.keys(ROUTES).join(", ")}`,
            retryable: false
        });
    }

    const v = validate(args, route.required);
    if (!v.ok) return toolError(v);

    if (route.checkTemplate) {
        const t = validateTemplate(args.template);
        if (!t.ok) return toolError(t);
    }

    const result = await googleApiCall(route.action, args);

    if (!result.ok) {
        console.error(`[!] ${result.error_code}: ${result.message}`);
        return toolError(result);
    }

    return toolOk(result.data);
});

// ============================ ARRANQUE ============================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[+] Vertex Google Suite MCP Server v2.0.0 inicializado.");
    console.error(`[+] Templates permitidos: ${TEMPLATES.join(", ")}`);
    console.error("[+] Propagación de errores MCP (isError) activa.");
}

main().catch((err) => {
    console.error("[!] Fallo fatal al iniciar:", err);
    process.exit(1);
});
