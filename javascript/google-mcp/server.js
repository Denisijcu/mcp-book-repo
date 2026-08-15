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
 * Plantillas válidas. DEBE coincidir con las claves de CONFIG.TEMPLATES
 * del Apps Script. Si añades una allá, añádela aquí.
 */
const TEMPLATES = ["bienvenida", "notificacion"];

/** Plantillas que exigen el campo `cuerpo` (texto libre escrito por el modelo). */
const TEMPLATES_CON_CUERPO = ["notificacion"];

/** Tope del cuerpo libre. Debe coincidir con CONFIG.MAX_CUERPO del Apps Script. */
const MAX_CUERPO = 2000;

const server = new Server(
    { name: "vertex-google-suite-mcp", version: "2.3.0" },
    { capabilities: { tools: {} } }
);

// ============================ CAPA DE TRANSPORTE ============================

async function googleApiCall(action, payload = {}, timeoutMs = 60000) {
    const rawPayload = JSON.stringify({ action, data: payload });
    const payloadSize = Buffer.byteLength(rawPayload, "utf8");

    let response;
    try {
        response = await axios.post(GOOGLE_APP_URL, rawPayload, {
            headers: {
                "Content-Type": "application/json",
                "Content-Length": payloadSize   // evita el 411 del WAF de Google
            },
            maxRedirects: 5,                    // Apps Script redirige a googleusercontent.com
            timeout: timeoutMs,                 // recon necesita mucho más que un alta
            transformResponse: [(d) => d]       // sin parsear: queremos inspeccionar el crudo
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

    // El backend responde 200 con status:"error". Sin este chequeo el fallo
    // llega al modelo disfrazado de éxito y se pone a improvisar.
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
    if (template === undefined) return { ok: true };
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

/**
 * El `cuerpo` es el único canal de texto libre del sistema: lo escribe el
 * modelo y lo lee un humano que confía en que viene de VIC. Se valida aquí
 * para fallar antes del round-trip a Google.
 */
function validateCuerpo(args) {
    const template = args.template;
    const cuerpo = args.cuerpo;

    if (!TEMPLATES_CON_CUERPO.includes(template)) return { ok: true };

    if (!cuerpo || !String(cuerpo).trim()) {
        return {
            ok: false,
            error_code: "MISSING_FIELDS",
            message: `La plantilla "${template}" requiere el campo 'cuerpo' con el texto del mensaje.`,
            retryable: false
        };
    }

    if (String(cuerpo).length > MAX_CUERPO) {
        return {
            ok: false,
            error_code: "CUERPO_TOO_LONG",
            message: `El cuerpo tiene ${String(cuerpo).length} caracteres; el máximo es ${MAX_CUERPO}. Resúmelo y vuelve a llamar.`,
            retryable: false
        };
    }

    return { ok: true };
}

/**
 * Valida dominio y límites antes de gastar un round-trip de hasta 5 minutos.
 * El backend vuelve a validar: esto es conveniencia, no la defensa real.
 */
function validateRecon(args) {
    const d = String(args.dominio || "").trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .split(":")[0];

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
        return {
            ok: false,
            error_code: "INVALID_DOMAIN",
            message: `"${args.dominio}" no es un dominio válido. Usa el formato 'ejemplo.com'. No aceptes IPs ni rutas.`,
            retryable: false
        };
    }

    if (args.max_hosts !== undefined) {
        const n = Number(args.max_hosts);
        if (isNaN(n) || n < 1 || n > RECON_MAX_HOSTS) {
            return {
                ok: false,
                error_code: "INVALID_RANGE",
                message: `max_hosts debe estar entre 1 y ${RECON_MAX_HOSTS}. Recibido: ${args.max_hosts}.`,
                retryable: false
            };
        }
    }

    return { ok: true };
}

// ============================ DEFINICIÓN DE TOOLS ============================

const TEMPLATE_PROP = {
    type: "string",
    enum: TEMPLATES,
    description: "Clave de la plantilla. 'bienvenida' trae su texto ya escrito y NO acepta cuerpo. 'notificacion' es una plantilla con hueco: EXIGE el campo 'cuerpo' con el texto que tú redactas. Si se omite se usa 'bienvenida'."
};

const CUERPO_PROP = {
    type: "string",
    maxLength: MAX_CUERPO,
    description: "Texto del mensaje. OBLIGATORIO con template='notificacion'; se ignora con 'bienvenida'. Escribe prosa dirigida al destinatario, sin saludo inicial ni firma: la plantilla ya pone 'Saludos, <nombre>' arriba y el cierre abajo. Máximo 2000 caracteres."
};

/** Tope duro de hosts a sondear. Debe coincidir con CONFIG_RECON.HARD_LIMIT_HOSTS. */
const RECON_MAX_HOSTS = 60;

/** Apps Script corta a los 6 min; damos margen de sobra al transporte. */
const RECON_TIMEOUT_MS = 360000;

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
            description: "Da de alta un cliente en Google Sheets. Si además hay que enviarle el correo de bienvenida, NO llames una segunda herramienta: pon notificar=true y esta misma llamada crea el registro y envía el correo. Rechaza duplicados por id o email.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Identificador único del cliente (ej: C-005)" },
                    email: { type: "string", description: "Correo electrónico del cliente" },
                    nombre: { type: "string", description: "Nombre completo del cliente" },
                    telefono: { type: "string", description: "Teléfono (opcional)" },
                    notificar: {
                        type: "boolean",
                        description: "true = enviar el correo de bienvenida inmediatamente tras crear el registro. Úsalo cuando el usuario pida crear el cliente y notificarlo en la misma petición. Por defecto false."
                    }
                },
                required: ["id", "email", "nombre"]
            }
        },
        {
            name: "enviar_correo_template",
            description: "Envía un correo a un cliente YA EXISTENTE usando una plantilla de Google Docs. Con template='bienvenida' el texto ya está escrito y no aportas nada. Con template='notificacion' TÚ redactas el mensaje en el campo 'cuerpo' — úsala para avisos, resultados de análisis o cualquier contenido variable. Si el cliente aún no está creado, usa add_cliente_sheet con notificar=true. Para enviar un PDF adjunto usa generar_enviar_pdf; estas herramientas NO son intercambiables.",
            inputSchema: {
                type: "object",
                properties: {
                    email: { type: "string", description: "Correo del destinatario" },
                    nombre: { type: "string", description: "Nombre del destinatario. Solo el nombre: no uses este campo para meter contenido del mensaje." },
                    template: TEMPLATE_PROP,
                    cuerpo: CUERPO_PROP
                },
                required: ["email", "nombre"]
            }
        },
        {
            name: "calcular_riesgo_avanzado",
            description: "Procesa métricas de exploits en el motor de cálculo de Google Sheets para evitar errores aritméticos del modelo. Devuelve riesgo residual y días estimados de mitigación. CRÍTICO: reporta los valores EXACTAMENTE como los devuelve la herramienta. No redondees, no conviertas unidades, no interpretes.",
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
            name: "auditar_dominio",
            description: "Ejecuta una auditoría PASIVA de superficie expuesta sobre un dominio y construye una hoja de cálculo completa con dashboard y gráficos. Consulta Certificate Transparency (crt.sh) para inventariar subdominios, DNS público para higiene de correo (SPF/DMARC/DNSSEC) y cabeceras de respuesta HTTP. NO hace escaneo de puertos ni pruebas activas: solo lee registros públicos. Tarda entre 40 y 300 segundos según max_hosts; avísale al usuario que espere. Devuelve cifras y la URL de la hoja — los gráficos están en la hoja, no en la respuesta. Reporta el score y los hallazgos tal como llegan, sin recalcular.",
            inputSchema: {
                type: "object",
                properties: {
                    dominio: {
                        type: "string",
                        description: "Dominio a auditar, por ejemplo 'ejemplo.com'. Se acepta con o sin https:// y con o sin www."
                    },
                    max_hosts: {
                        type: "number",
                        description: `Cuántos subdominios sondear por HTTP (1-${RECON_MAX_HOSTS}). Por defecto 25. Más hosts = más tiempo. Si el dominio tiene más subdominios que este límite, se auditan los más cercanos al apex y se reporta cuántos quedaron fuera.`
                    },
                    incluir_headers: {
                        type: "boolean",
                        description: "Si es false, omite el sondeo de cabeceras HTTP y solo hace inventario de certificados y DNS. Mucho más rápido. Por defecto true."
                    }
                },
                required: ["dominio"]
            }
        },
        {
            name: "generar_enviar_pdf",
            description: "Clona una plantilla de Google Docs, inyecta los datos del cliente, la compila a PDF, la envía por correo como adjunto y borra el clon temporal. Para enviar solo texto sin adjunto usa enviar_correo_template; estas herramientas NO son intercambiables.",
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
    diagnosticar_backend:    { action: "diag",            required: [] },
    get_clientes_sheet:      { action: "read",            required: [] },
    add_cliente_sheet: { action: "create", required: ["email", "nombre"] },
    enviar_correo_template:  { action: "send_email",      required: ["email", "nombre"], checkTemplate: true, checkCuerpo: true },
    calcular_riesgo_avanzado:{ action: "calcular_riesgo", required: ["severidad", "presupuesto"] },
    generar_enviar_pdf:      { action: "send_pdf_report", required: ["email", "nombre"], checkTemplate: true },
    auditar_dominio:         { action: "auditar_dominio", required: ["dominio"], checkRecon: true, timeout: RECON_TIMEOUT_MS }
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

    if (route.checkCuerpo) {
        const c = validateCuerpo(args);
        if (!c.ok) return toolError(c);
    }

    if (route.checkRecon) {
        const r = validateRecon(args);
        if (!r.ok) return toolError(r);
        console.error(`[+] Recon sobre ${args.dominio} — esto puede tardar varios minutos.`);
    }

    const result = await googleApiCall(route.action, args, route.timeout);

    if (!result.ok) {
        console.error(`[!] ${result.error_code}: ${result.message}`);
        return toolError(result);
    }

    // El alta puede tener éxito y el correo fallar. No es un error de la tool,
    // pero el modelo tiene que verlo para no reportar un envío que no ocurrió.
    if (result.data?.notificacion_error) {
        console.error(`[!] Alta OK pero notificación falló: ${result.data.notificacion_error}`);
    }

    return toolOk(result.data);
});

// ============================ ARRANQUE ============================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[+] Vertex Google Suite MCP Server v2.3.0 inicializado.");
    console.error(`[+] Templates permitidos: ${TEMPLATES.join(", ")}`);
    console.error(`[+] Con cuerpo libre: ${TEMPLATES_CON_CUERPO.join(", ")} (max ${MAX_CUERPO} chars)`);
    console.error("[+] Encadenamiento create+notificar activo.");
    console.error(`[+] VIC Recon activo (max ${RECON_MAX_HOSTS} hosts, timeout ${RECON_TIMEOUT_MS / 1000}s).`);
}

main().catch((err) => {
    console.error("[!] Fallo fatal al iniciar:", err);
    process.exit(1);
});