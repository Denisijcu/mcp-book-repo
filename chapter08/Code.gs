/**
 * =========================================================================
 * VIC — Vertex Intelligence Core
 * Backend serverless (Google Apps Script) para el MCP `vertex-google-suite`
 *
 * v2.2 — Cuerpo libre
 *  - Plantilla `notificacion` con hueco {{EMAIL-BODY}} que rellena el modelo.
 *    Es el ÚNICO canal de texto libre del sistema, así que se acota:
 *    longitud máxima y neutralización de placeholders antes de salir.
 *  - Regex de reemplazo escapados: las llaves son metacaracteres y el guion
 *    de EMAIL-BODY hace el caso frágil si se deja sin escapar.
 *
 * v2.1 — Encadenamiento de notificación
 *  - `create` acepta `notificar: true` y dispara el correo de bienvenida
 *    en el mismo round-trip. La orquestación vive aquí (determinista),
 *    no en el modelo (que se degrada con tareas compuestas).
 *  - Aviso interno al administrador en TODA alta: es auditoría, no negocio,
 *    así que no depende de `notificar`.
 *  - El id lo genera el backend. El modelo inventaba formatos (C-101 contra
 *    una serie 1,2,3): si el servidor puede saberlo, no lo decide el modelo.
 *  - Ningún fallo de correo revierte el alta ni tumba al otro correo.
 *
 * v2.0
 *  - El `docId` NUNCA viaja en el payload del modelo. Se resuelve server-side
 *    desde una whitelist (CONFIG.TEMPLATES). El modelo solo manda una clave.
 *  - Errores estructurados con `error_code` + `retryable` para que el cliente
 *    MCP sepa si reintentar o abortar (evita que el LLM sustituya herramientas).
 *  - Limpieza de archivos temporales garantizada con try/finally.
 *  - Router por mapa de handlers en vez de cadena de `if`.
 *  - Acción `diag` para verificar scopes sin adivinar.
 * =========================================================================
 */

// ============================== CONFIGURACIÓN ==============================



const CONFIG = {
  SHEET_CLIENTES: 'Clientes',
  SHEET_CALCULO: 'MotorCalculo',

  TIMEZONE: 'America/New_York',

  /**
   * Whitelist de plantillas. El modelo manda la CLAVE, nunca un docId.
   * Cada entrada define su propio asunto: con un asunto global salían
   * correos de bienvenida titulados "Reporte de Auditoría".
   *
   * REGLA: si la clave aparece aquí, el documento debe existir y su contenido
   * debe corresponder al nombre. Una clave que promete algo que el doc no
   * tiene traba al modelo (y con razón: el enum es documentación para él).
   */
  TEMPLATES: {
    bienvenida: {
      id: 'Sheet-ID here',
      asunto: 'Acceso Confirmado - Vertex Intelligence Core (VIC)'
    },
    notificacion: {
      id: 'sheet-ID here',
      asunto: 'Notificación - Vertex Intelligence Core (VIC)',
      requiereCuerpo: true
    }
  },

  /** Plantilla usada por `create` cuando `notificar: true`. */
  TEMPLATE_BIENVENIDA: 'bienvenida',

  /** Tope de caracteres del cuerpo libre que escribe el modelo. */
  MAX_CUERPO: 2000,

  REMITENTE: 'VIC Automator',
  EMAIL_ADMIN: '',

  CALC: { IN_SEVERIDAD: 'B1', IN_PRESUPUESTO: 'B2', OUT_RIESGO: 'B10', OUT_DIAS: 'B11' }
};

const ERR = {
  BAD_PAYLOAD: { code: 'BAD_PAYLOAD', retryable: false },
  UNKNOWN_ACTION: { code: 'UNKNOWN_ACTION', retryable: false },
  MISSING_FIELDS: { code: 'MISSING_FIELDS', retryable: false },
  UNKNOWN_TEMPLATE: { code: 'UNKNOWN_TEMPLATE', retryable: false },
  SHEET_NOT_FOUND: { code: 'SHEET_NOT_FOUND', retryable: false },
  DRIVE_PERMISSION: { code: 'DRIVE_PERMISSION', retryable: false },
  INVALID_NUMBER: { code: 'INVALID_NUMBER', retryable: false },
  DUPLICATE: { code: 'DUPLICATE', retryable: false },
  INTERNAL: { code: 'INTERNAL', retryable: true }
};

function AppError(errType, message) {
  const e = new Error(message);
  e.appCode = errType.code;
  e.retryable = errType.retryable;
  return e;
}

// ================================ ENDPOINTS ================================

function doGet(e) {
  try {
    return ok({ data: leerClientes() });
  } catch (err) {
    return fail(err);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw AppError(ERR.BAD_PAYLOAD, 'Payload vacío o malformado.');
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw AppError(ERR.BAD_PAYLOAD, 'El body no es JSON válido.');
    }

    const action = payload.action;
    const data = payload.data || {};
    const handler = HANDLERS[action];

    if (!handler) {
      throw AppError(
        ERR.UNKNOWN_ACTION,
        'Acción desconocida: "' + action + '". Válidas: ' + Object.keys(HANDLERS).join(', ')
      );
    }

    return ok(handler(data));
  } catch (err) {
    return fail(err);
  }
}

// ================================ HANDLERS =================================

const HANDLERS = {
  diag: handleDiag,
  read: handleRead,
  create: handleCreate,
  send_email: handleSendEmail,
  send_pdf_report: handleSendPdfReport,
  calcular_riesgo: handleCalcularRiesgo,
  auditar_dominio: handleAuditarDominio
};

/**
 * Diagnóstico de scopes. Llamar esto PRIMERO cuando algo falle:
 *  - drive_read OK + drive_write FAIL  -> scope es `drive.file`, falta `drive`
 *  - ambos FAIL                        -> no re-autorizaste o deployment viejo
 *  - effective_user vacío              -> "Ejecutar como" mal configurado
 */
function handleDiag(data) {
  const out = { effective_user: '', drive_read: '', drive_write: '', templates: {} };

  try {
    out.effective_user = Session.getEffectiveUser().getEmail() || '(vacío)';
  } catch (err) {
    out.effective_user = 'FAIL: ' + err.message;
  }

  Object.keys(CONFIG.TEMPLATES).forEach(function (key) {
    try {
      out.templates[key] = DriveApp.getFileById(CONFIG.TEMPLATES[key].id).getName();
    } catch (err) {
      out.templates[key] = 'FAIL: ' + err.message;
    }
  });

  const refId = CONFIG.TEMPLATES[CONFIG.TEMPLATE_BIENVENIDA].id;

  try {
    out.drive_read = DriveApp.getFileById(refId).getName();
  } catch (err) {
    out.drive_read = 'FAIL: ' + err.message;
  }

  // makeCopy es lo que revienta con scope insuficiente. Es la prueba real.
  let probe = null;
  try {
    probe = DriveApp.getFileById(refId).makeCopy('vic_probe_borrar');
    out.drive_write = 'OK (id=' + probe.getId() + ')';
  } catch (err) {
    out.drive_write = 'FAIL: ' + err.message;
  } finally {
    if (probe) {
      try { probe.setTrashed(true); } catch (ignored) { }
    }
  }

  return { diag: out };
}

function handleRead(data) {
  return { data: leerClientes() };
}

/**
 * Alta de cliente, con notificación opcional encadenada.
 *
 * El encadenamiento vive aquí y no en el modelo a propósito: pedirle a un
 * modelo pequeño "crea y luego notifica" en un turno degrada la calidad de
 * ambas subtareas. Aquí es una sola llamada y la secuencia es determinista.
 */
function handleCreate(data) {
  // `id` ya NO se pide: lo genera el backend. Si el modelo lo manda, se ignora.
  requireFields(data, ['email', 'nombre']);

  const email = String(data.email).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw AppError(ERR.MISSING_FIELDS, 'El email "' + email + '" no tiene formato válido.');
  }

  const sheet = getSheet(CONFIG.SHEET_CLIENTES);

  // Idempotencia: si el modelo reintenta, no queremos filas duplicadas ni un
  // segundo correo al mismo cliente. Solo se compara por email: el id lo
  // genera el backend y por construcción no puede chocar.
  const existentes = sheet.getDataRange().getValues().slice(1);
  const duplicado = existentes.some(function (row) {
    return String(row[1]).trim().toLowerCase() === email.toLowerCase();
  });

  if (duplicado) {
    throw AppError(
      ERR.DUPLICATE,
      'Ya existe un cliente con el email ' + email + '. No se creó nada ni se envió correo.'
    );
  }

  const id = siguienteId(sheet);
  sheet.appendRow([id, email, data.nombre, data.telefono || '']);

  const resultado = {
    id: id,
    notificado: false,
    admin_notificado: false
  };

  // 1. Bienvenida al cliente (opcional: lo decide quien llama).
  if (data.notificar === true) {
    try {
      enviarTemplate(email, data.nombre, CONFIG.TEMPLATE_BIENVENIDA);
      resultado.notificado = true;
    } catch (err) {
      // El alta ya está hecha. Un fallo de correo no la revierte.
      resultado.notificacion_error = err.message;
    }
  }

  // 2. Aviso interno al admin (SIEMPRE: es auditoría, no negocio).
  //    Si dependiera de `notificar`, las altas silenciosas pasarían sin registro,
  //    que es justo cuando más quieres enterarte.
  try {
    notificarAdmin(id, email, data.nombre, data.telefono || '(no indicado)', resultado.notificado);
    resultado.admin_notificado = true;
  } catch (err) {
    resultado.admin_error = err.message;
  }

  resultado.message = construirMensaje(id, email, resultado);
  return resultado;
}

function handleSendEmail(data) {
  requireFields(data, ['email', 'nombre']);
  const key = data.template || CONFIG.TEMPLATE_BIENVENIDA;
  enviarTemplate(data.email, data.nombre, key, data.cuerpo);
  return { message: 'Correo enviado a ' + data.email, template: key };
}

function handleSendPdfReport(data) {
  requireFields(data, ['email', 'nombre']);
  const key = data.template || CONFIG.TEMPLATE_BIENVENIDA;
  const tpl = resolveTemplate(key);

  if (tpl.requiereCuerpo && (!data.cuerpo || !String(data.cuerpo).trim())) {
    throw AppError(
      ERR.MISSING_FIELDS,
      'La plantilla "' + key + '" requiere el campo `cuerpo`. Sin él el PDF saldría ' +
      'con el placeholder {{EMAIL-BODY}} visible.'
    );
  }

  const original = safeDrive(function () { return DriveApp.getFileById(tpl.id); });

  let tempFile = null;
  try {
    tempFile = safeDrive(function () {
      return original.makeCopy('Reporte_Temporal_' + data.nombre + '_' + Date.now());
    });

    const tempDoc = DocumentApp.openById(tempFile.getId());
    const body = tempDoc.getBody();

    // replaceText() interpreta el patrón como regex: las llaves van escapadas.
    body.replaceText('\\{\\{NOMBRE\\}\\}', data.nombre);
    body.replaceText('\\{\\{FECHA\\}\\}', fechaHoy());
    body.replaceText('\\{\\{EMAIL-BODY\\}\\}', sanearCuerpo(data.cuerpo));

    tempDoc.saveAndClose();

    const pdfBlob = tempFile.getAs('application/pdf')
      .setName('Reporte_' + data.nombre + '.pdf');

    GmailApp.sendEmail(
      data.email,
      tpl.asunto,
      'Adjunto encontrarás el reporte generado por VIC.',
      { attachments: [pdfBlob], name: CONFIG.REMITENTE }
    );

    return { message: 'PDF enviado a ' + data.email, template: key };
  } finally {
    // Corre aunque Gmail falle: cero archivos huérfanos en el Drive.
    if (tempFile) {
      try { tempFile.setTrashed(true); } catch (ignored) { }
    }
  }
}

/**
 * Motor de cálculo. Devuelve STRINGS ya formateados a propósito: un float
 * crudo invita al modelo a "redondearlo" y ahí se pierde la fidelidad que
 * justifica tener el motor en Sheets. (Pasó: 5.021341371 se reportó como 1.42.)
 */
function handleCalcularRiesgo(data) {
  const sheet = getSheet(CONFIG.SHEET_CALCULO);

  const severidad = toNumber(data.severidad, 'severidad');
  const presupuesto = toNumber(data.presupuesto, 'presupuesto');

  sheet.getRange(CONFIG.CALC.IN_SEVERIDAD).setValue(severidad);
  sheet.getRange(CONFIG.CALC.IN_PRESUPUESTO).setValue(presupuesto);
  SpreadsheetApp.flush(); // recálculo síncrono antes de leer

  return {
    inputs_validados: { severidad: severidad, presupuesto: presupuesto },
    resultados: {
      riesgo_residual: Number(sheet.getRange(CONFIG.CALC.OUT_RIESGO).getValue()).toFixed(4),
      dias_estimados: Number(sheet.getRange(CONFIG.CALC.OUT_DIAS).getValue()).toFixed(3)
    }
  };
}

// ============================ CORREO / PLANTILLAS ==========================

/**
 * Envío de plantilla como cuerpo de correo. Compartido por create y send_email.
 * `cuerpoLibre` solo aplica a plantillas con requiereCuerpo (ej: notificacion).
 */
function enviarTemplate(email, nombre, templateKey, cuerpoLibre) {
  const tpl = resolveTemplate(templateKey);

  if (tpl.requiereCuerpo && (!cuerpoLibre || !String(cuerpoLibre).trim())) {
    throw AppError(
      ERR.MISSING_FIELDS,
      'La plantilla "' + templateKey + '" requiere el campo `cuerpo` con el texto del mensaje.'
    );
  }

  let texto = safeDrive(function () {
    return DocumentApp.openById(tpl.id).getBody().getText();
  });

  // Llaves escapadas: en regex son metacaracteres de cuantificador. Sin escapar
  // funciona por tolerancia del motor, no por diseño.
  texto = texto
    .replace(/\{\{NOMBRE\}\}/g, nombre)
    .replace(/\{\{FECHA\}\}/g, fechaHoy())
    .replace(/\{\{EMAIL-BODY\}\}/g, sanearCuerpo(cuerpoLibre));

  GmailApp.sendEmail(email, tpl.asunto, texto, { name: CONFIG.REMITENTE });
}

/**
 * El cuerpo es el único campo de texto libre del sistema: lo escribe el modelo
 * y lo lee un humano que confía en que viene de VIC. Por eso se acota antes de
 * salir: se corta a MAX_CUERPO, se neutralizan placeholders para que el texto
 * no se auto-sustituya en el siguiente pase, y se colapsan saltos excesivos.
 */
function sanearCuerpo(txt) {
  if (!txt) return '';
  return String(txt)
    .slice(0, CONFIG.MAX_CUERPO)
    .replace(/\{\{/g, '{ {')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Aviso interno de alta. Texto plano generado en código, no plantilla de Docs:
 * es correo operativo, no necesita branding y así no gasta una llamada a Drive.
 */
function notificarAdmin(id, email, nombre, telefono, clienteNotificado) {
  const cuerpo =
    'Se ha dado de alta un nuevo cliente en VIC_DB.\n\n' +
    'ID:        ' + id + '\n' +
    'Nombre:    ' + nombre + '\n' +
    'Email:     ' + email + '\n' +
    'Teléfono:  ' + telefono + '\n' +
    'Fecha:     ' + fechaHoy() + '\n' +
    'Bienvenida enviada al cliente: ' + (clienteNotificado ? 'SÍ' : 'NO') + '\n\n' +
    '-- Aviso automático generado por VIC Automator.';

  GmailApp.sendEmail(
    CONFIG.EMAIL_ADMIN,
    '[VIC] Nuevo cliente: ' + nombre + ' (' + id + ')',
    cuerpo,
    { name: CONFIG.REMITENTE }
  );
}

/**
 * Mensaje único que refleja lo que pasó de verdad con los dos correos.
 * Con dos envíos opcionales hay cuatro combinaciones: armar el texto de una
 * sola vez al final evita decir "enviado" cuando el segundo falló.
 */
function construirMensaje(id, email, r) {
  let msg = 'Cliente ' + id + ' creado correctamente.';

  if (r.notificado) {
    msg += ' Bienvenida enviada a ' + email + '.';
  } else if (r.notificacion_error) {
    msg += ' FALLÓ el correo de bienvenida: ' + r.notificacion_error + '.';
  }

  if (r.admin_error) {
    msg += ' FALLÓ el aviso al administrador: ' + r.admin_error + '.';
  }

  return msg;
}

// ================================ HELPERS ==================================

function fechaHoy() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
}

function leerClientes() {
  const values = getSheet(CONFIG.SHEET_CLIENTES).getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (header, i) {
      obj[header] = row[i] !== '' ? row[i] : null;
    });
    return obj;
  });
}

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw AppError(ERR.SHEET_NOT_FOUND, 'No existe la hoja "' + name + '" (case sensitive).');
  }
  return sheet;
}

/**
 * Siguiente ID secuencial. El modelo no decide formatos: inventaba C-101
 * contra una serie 1,2,3,4. Si el backend puede saberlo, no lo decide el LLM.
 * El regex lee el número final, así que tolera tanto "6" como "C-006".
 */
function siguienteId(sheet) {
  const ids = sheet.getDataRange().getValues().slice(1)
    .map(function (row) {
      const m = String(row[0]).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : 0;
    });
  const max = ids.length ? Math.max.apply(null, ids) : 0;
  return 'C-' + String(max + 1).padStart(3, '0');
}

/** Resuelve la clave del modelo a { id, asunto, requiereCuerpo }. Nunca IDs crudos. */
function resolveTemplate(key) {
  const k = key || CONFIG.TEMPLATE_BIENVENIDA;
  const tpl = CONFIG.TEMPLATES[k];
  if (!tpl) {
    throw AppError(
      ERR.UNKNOWN_TEMPLATE,
      'Template "' + k + '" no existe. Válidos: ' + Object.keys(CONFIG.TEMPLATES).join(', ')
    );
  }
  return tpl;
}

function requireFields(data, fields) {
  const missing = fields.filter(function (f) {
    return data[f] === undefined || data[f] === null || String(data[f]).trim() === '';
  });
  if (missing.length) {
    throw AppError(ERR.MISSING_FIELDS, 'Faltan campos requeridos: ' + missing.join(', '));
  }
}

function toNumber(value, label) {
  const n = Number(value);
  if (isNaN(n)) {
    throw AppError(ERR.INVALID_NUMBER, 'El campo "' + label + '" no es numérico.');
  }
  return n;
}

/** Traduce fallos de scope de Drive a un código con el fix ya escrito. */
function safeDrive(fn) {
  try {
    return fn();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/permission|permiso|authoriz|autoriza|access denied|no tienes/i.test(msg)) {
      throw AppError(
        ERR.DRIVE_PERMISSION,
        'Scope de Drive insuficiente. Falta https://www.googleapis.com/auth/drive, ' +
        're-autorizar y desplegar NUEVA VERSIÓN. Original: ' + msg
      );
    }
    throw err;
  }
}

// ============================== RESPUESTAS =================================

function ok(payload) {
  const body = { status: 'success' };
  Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
  return json(body);
}

function fail(err) {
  const code = err.appCode || ERR.INTERNAL.code;
  const retryable = err.retryable === true;

  return json({
    status: 'error',
    error_code: code,
    message: err.message,
    retryable: retryable,
    // Sin esta instrucción el modelo intenta sustituir la herramienta que falló.
    agent_hint: retryable
      ? 'Fallo transitorio. Puedes reintentar UNA vez la misma herramienta.'
      : 'NO reintentes y NO uses otra herramienta como sustituto. Reporta este error al usuario y detente.'
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================ AUTORIZACIÓN =================================

/**
 * Ejecutar A MANO desde el editor después de tocar los scopes, y aceptar el
 * diálogo de consentimiento. Guardar el archivo NO basta: hay que re-autorizar
 * Y desplegar nueva versión para que el /exec sirva los scopes nuevos.
 */
function forzarPermisos() {
  DriveApp.getRootFolder().getName();
  SpreadsheetApp.getActiveSpreadsheet().getName();
  DocumentApp.openById(CONFIG.TEMPLATES[CONFIG.TEMPLATE_BIENVENIDA].id).getName();
  GmailApp.getRemainingDailyQuota();
  Logger.log('Permisos otorgados para: ' + Session.getEffectiveUser().getEmail());
}

function verEstado() {
  Logger.log('TEMPLATES: ' + JSON.stringify(CONFIG.TEMPLATES, null, 2));
  Logger.log('BIENVENIDA: ' + CONFIG.TEMPLATE_BIENVENIDA);
  Logger.log('MAX_CUERPO: ' + CONFIG.MAX_CUERPO);
  Logger.log('HANDLERS: ' + Object.keys(HANDLERS).join(', '));
  Logger.log('enviarTemplate params: ' + enviarTemplate.length);
  Logger.log('sanearCuerpo existe: ' + (typeof sanearCuerpo === 'function'));
  Logger.log('siguienteId existe: ' + (typeof siguienteId === 'function'));
  Logger.log('notificarAdmin existe: ' + (typeof notificarAdmin === 'function'));
}

function probarEnvioDirecto() {
  try {
    enviarTemplate('', 'Prueba Directa', 'notificacion',
      'Esto salió del editor, no del MCP.');
    Logger.log('OK — el código funciona. El problema es el deployment.');
  } catch (err) {
    Logger.log('FALLA en el código: ' + err.message);
  }
}

function probarCrtshUA() {
  const url = 'https://crt.sh/?q=%25.vertexcoders.com&output=json';

  ['sin UA', 'con UA'].forEach(function (etiqueta, i) {
    const opts = { muteHttpExceptions: true, followRedirects: true };
    if (i === 1) {
      opts.headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json'
      };
    }
    try {
      const r = UrlFetchApp.fetch(url, opts);
      Logger.log(etiqueta + ' → HTTP ' + r.getResponseCode() + ' | ' + r.getContentText().slice(0, 80));
    } catch (err) {
      Logger.log(etiqueta + ' → EXCEPCIÓN: ' + err.message);
    }
  });
}