## Capítulo 8: Google Workspace — MCP contra un backend que no controlas {#cap-08}

Los tres capítulos anteriores tienen algo en común que no dije en voz alta: en todos controlabas los dos extremos. El servidor de archivos leía tu disco. El de base de datos hablaba con tu PostgreSQL. El de APIs externas envolvía servicios que, aunque ajenos, devolvían JSON limpio con códigos HTTP honestos.

Este capítulo rompe eso.

Vamos a construir un servidor MCP contra Google Workspace usando Apps Script como backend. Y Apps Script hace tres cosas que van a obligarte a reescribir todo lo que creías saber sobre manejo de errores:

1. Devuelve **HTTP 200 cuando ha fallado**, con el error escondido dentro del JSON.
2. Devuelve **HTML de una página de login** cuando esperabas JSON, sin avisar.
3. **Redirige** a otro dominio antes de responder, y si tu cliente no sigue la redirección, recibes vacío.

Un cliente HTTP normal se traga las tres. Y cuando eso pasa en un servidor MCP, el fallo no acaba en un log que alguien lee mañana: acaba en el contexto de un modelo que se lo cree, y que se pone a improvisar sobre datos que nunca existieron.

Ese es el tema real de este capítulo. Google Workspace es la excusa.

---

### 8.1 Por qué Apps Script y no la API de Google

La respuesta corta: porque no quieres gestionar credenciales.

La API oficial de Google Workspace exige una cuenta de servicio, un archivo JSON de credenciales, delegación a nivel de dominio si vas a actuar en nombre de usuarios, y rotación de claves. Para un producto en producción con muchos clientes, es lo correcto. Para un servidor MCP que corre en tu máquina y actúa **como tú**, es artillería pesada.

Apps Script te ofrece otro trato. Publicas un script como aplicación web con dos ajustes:

- **Ejecutar como:** Yo
- **Quién tiene acceso:** Cualquier usuario

A partir de ahí tienes un endpoint HTTP que ejecuta con **tus** permisos sobre **tus** documentos, sin una sola credencial en tu código. Tu servidor MCP hace un `POST`, y al otro lado hay un script que ya está autenticado.

El precio de esa comodidad es todo lo que viene a continuación. No es un mal trato, pero conviene saber qué firmas.

> **Cuándo NO usar este patrón**
>
> Si el servidor va a actuar en nombre de varios usuarios distintos, si necesitas auditar quién hizo qué, o si vas a desplegarlo para clientes, usa la API oficial con cuenta de servicio. Apps Script como aplicación web ejecuta siempre con **una sola** identidad: la tuya. Es una herramienta personal o de equipo pequeño, no multi-tenant.

---

### 8.2 Las cuatro trampas de Apps Script

Estas cuatro me costaron una tarde cada una. Van con la línea de código que las resuelve, para que a ti te cuesten cinco minutos.

#### Trampa 1: `/exec` frente a `/dev`

Al desplegar, Apps Script te da dos URLs. Son casi idénticas y hacen cosas completamente distintas:

- La que termina en **`/dev`** apunta al código más reciente del editor, pero **exige una sesión autenticada de Google**. Desde tu servidor MCP no la tienes. Recibes el HTML de la página de login.
- La que termina en **`/exec`** apunta a la **versión desplegada** y respeta el ajuste de acceso anónimo. Esa es la tuya.

El síntoma es cruel: la URL `/dev` funciona perfectamente cuando la pegas en el navegador —porque ahí sí tienes sesión— y falla siempre desde el código. Pasas media hora pensando que el problema está en tu cliente HTTP.

Por eso el servidor avisa al arrancar:

```js
if (!GOOGLE_APP_URL.endsWith("/exec")) {
    console.error(
      "[!] Advertencia: la URL no termina en " +
      "/exec. Las URLs /dev exigen sesión " +
      "autenticada y devolverán HTML de login."
    );
}
```

Cuatro líneas que ahorran una tarde. Este es el tipo de comprobación que merece la pena escribir aunque parezca obvia: el error que previene no se parece en nada a su causa.

#### Trampa 2: el despliegue no se actualiza solo

Editas el script, guardas, llamas desde tu servidor, y el comportamiento es el de antes. Vuelves a editar. Nada.

Apps Script separa el **código del editor** de la **versión desplegada**. Guardar no despliega. Para que tu cambio salga al mundo:

1. **Implementar → Gestionar implementaciones**
2. El icono del **lápiz** sobre la implementación existente
3. **Versión → Nueva versión**
4. **Implementar**

Si en vez de eso creas una implementación nueva, obtienes una **URL distinta** y la vieja sigue viva con el código viejo. Ahora tienes dos backends y no sabes cuál está contestando.

La regla: **una implementación, editada con el lápiz, versión nueva cada vez.**

#### Trampa 3: la redirección a `googleusercontent.com`

Apps Script no responde directamente. Responde con un **302** hacia `script.googleusercontent.com`, y el contenido real está allí.

Muchos clientes HTTP siguen redirecciones por defecto en un `GET`, pero se vuelven quisquillosos con `POST` — algunos no la siguen, otros la siguen pero pierden el cuerpo. El síntoma es una respuesta vacía o un `302` crudo que no sabes interpretar.

```js
maxRedirects: 5,  // Apps Script redirige a
                  // googleusercontent.com
```

#### Trampa 4: el WAF exige `Content-Length`

La infraestructura de Google delante de Apps Script rechaza con **HTTP 411 Length Required** las peticiones sin cabecera `Content-Length` explícita. Muchos clientes la calculan solos; conviene no confiar.

Y ojo con calcularla mal: `String.length` en JavaScript cuenta **unidades de código UTF-16**, no bytes. Con acentos, eñes o emojis, el número no coincide con lo que viaja por el cable, y el servidor corta el cuerpo por donde no debe. La forma correcta:

```js
const rawPayload = JSON.stringify({
    action, data: payload
});
const payloadSize = Buffer.byteLength(
    rawPayload, "utf8"
);
```

Escribiendo en español esto no es teórico: la primera vez que mandes una notificación con la palabra "gestión" y el JSON llegue truncado, te vas a acordar.

#### Bonus: que tu cliente no parsee por ti

Esta no es una trampa de Google sino de tu librería HTTP, y encaja aquí porque es la que hace posible detectar las otras.

`axios` intenta parsear la respuesta como JSON automáticamente. Cuando Apps Script te devuelve HTML de login, `axios` falla al parsear y lanza una excepción genérica que no te dice **qué** llegó. Y tú necesitas ver exactamente eso.

```js
transformResponse: [(d) => d]  // sin parsear:
                               // queremos inspeccionar
                               // el crudo
```

Con esa línea recibes la cadena tal cual llegó, y puedes decidir tú qué hacer con ella. Que es de lo que trata la sección siguiente.

---

### 8.3 Cinco formas de fallar, cinco respuestas distintas

Aquí está el corazón del servidor. Merece la pena leerlo entero antes de que lo desmenucemos:

```js
async function googleApiCall(
    action, payload = {}, timeoutMs = 60000
) {
    const rawPayload = JSON.stringify({
        action, data: payload
    });
    const payloadSize = Buffer.byteLength(
        rawPayload, "utf8"
    );

    let response;
    try {
        response = await axios.post(
            GOOGLE_APP_URL, rawPayload, {
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": payloadSize
                },
                maxRedirects: 5,
                timeout: timeoutMs,
                transformResponse: [(d) => d]
            }
        );
    } catch (err) {
        const status = err.response?.status;
        return {
            ok: false,
            error_code: status
                ? `HTTP_${status}`
                : "NETWORK_ERROR",
            message: err.message,
            retryable: !status || status >= 500,
            hint: "Fallo de red o HTTP. Reporta " +
                  "al usuario; no sustituyas la " +
                  "herramienta."
        };
    }

    const raw = typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);

    if (!raw.trim().startsWith("{")) {
        return {
            ok: false,
            error_code: "NON_JSON_RESPONSE",
            message: "El backend devolvió HTML en " +
                     "vez de JSON. Primeros 300 " +
                     "chars: " + raw.slice(0, 300),
            retryable: false,
            hint: "Revisa el deployment: " +
                  "'Ejecutar como: Yo' y 'Acceso: " +
                  "Cualquier usuario' (anónimo)."
        };
    }

    let json;
    try {
        json = JSON.parse(raw);
    } catch {
        return {
            ok: false,
            error_code: "MALFORMED_JSON",
            message: "JSON inválido del backend: " +
                     raw.slice(0, 300),
            retryable: false,
            hint: "Bug del Apps Script. Revisa los " +
                  "logs de Ejecuciones."
        };
    }

    // El backend responde 200 con status:"error".
    // Sin este chequeo el fallo llega al modelo
    // disfrazado de éxito y se pone a improvisar.
    if (json.status === "error") {
        return {
            ok: false,
            error_code: json.error_code
                || "BACKEND_ERROR",
            message: json.message,
            retryable: json.retryable === true,
            hint: json.agent_hint
                || "Reporta el error al usuario " +
                   "y detente."
        };
    }

    return { ok: true, data: json };
}
```

Fíjate en la estructura. No es un `try/catch` que envuelve todo y devuelve "algo falló". Son **cinco puertas en fila**, y cada una atrapa una clase distinta de fallo:

| Puerta | Qué atrapa | `retryable` |
|---|---|---|
| `catch` del `axios` | Red caída, timeout, 4xx, 5xx | Solo si 5xx o red |
| `startsWith("{")` | HTML de login: despliegue mal configurado | No |
| `JSON.parse` | JSON roto: bug en el Apps Script | No |
| `status === "error"` | Error de negocio con HTTP 200 | Lo dice el backend |
| — | Éxito real | — |

La cuarta puerta es la que de verdad importa, y por eso lleva comentario en el código. Apps Script **no** usa códigos HTTP para señalar errores de aplicación: si tu script lanza una excepción y tú la capturas para devolver un mensaje ordenado, el cliente recibe un **200 impecable** con `{"status": "error", ...}` dentro.

Sin ese chequeo, `googleApiCall` devuelve `ok: true` con un objeto de error como carga útil. El servidor MCP lo empaqueta como resultado exitoso. Y el modelo, que confía en la herramienta, redacta con toda naturalidad un "he dado de alta al cliente C-005 y le he enviado el correo de bienvenida".

No pasó nada de eso. Pero el usuario ya lo leyó.

> **Una verificación que no puede fallar no es una verificación.**
>
> Un `try/catch` que envuelve la llamada entera y devuelve "error de conexión" *parece* manejo de errores. Pero no distingue entre un despliegue mal configurado, un bug del backend y un cliente duplicado. Y como no distingue, no puede decirle al modelo qué hacer. Es un éxito silencioso con otro nombre.

---

### 8.4 Escribir errores para que los lea un modelo

Esta sección es la que más me costó entender, y es la que menos aparece en la documentación.

En un servidor tradicional, cuando algo falla escribes un mensaje para un humano: un `stack trace`, un código, una línea de log. El humano lo lee mañana, entiende el contexto y decide.

En un servidor MCP, **el primer lector de tu error es un modelo de lenguaje**, y lo lee ahora mismo, en mitad de una conversación con un usuario que está esperando. Ese lector no tiene tu contexto, no puede consultar el código, y —esto es lo importante— **va a intentar ser útil de todos modos**.

Un modelo que recibe "error al enviar el correo" tiene tres salidas plausibles: reintentar, probar otra herramienta que parezca equivalente, o contarle al usuario algo aproximado. Las tres pueden ser desastrosas. Reintentar un alta duplica el cliente. Sustituir `generar_enviar_pdf` por `enviar_correo_template` manda un correo sin el adjunto que el usuario pidió. Y "algo aproximado" es una mentira educada.

Así que el error no describe: **instruye**.

```js
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
                    ? "Fallo transitorio: puedes " +
                      "reintentar UNA vez esta " +
                      "misma herramienta."
                    : "NO reintentes. NO uses otra " +
                      "herramienta como sustituto. " +
                      "Informa al usuario y detente."
            }, null, 2)
        }]
    };
}
```

Tres decisiones deliberadas ahí dentro:

**`isError: true`.** Es el campo del protocolo MCP que marca el resultado como fallido. Sin él, el cliente trata la respuesta como éxito normal y el modelo no tiene ninguna señal estructural de que algo fue mal. Es la diferencia entre "aquí tienes el resultado" y "esto falló".

**`retryable` viene del backend, no del cliente.** Quien sabe si un error se puede reintentar es quien lo produjo. Un `MISSING_FIELDS` no se arregla reintentando; un timeout de red quizá sí. El servidor MCP propaga esa decisión, no la inventa.

**`INSTRUCCION` en mayúsculas y en imperativo.** No es elegante y no pretende serlo. Es la línea que el modelo va a seguir. Y prohíbe explícitamente la sustitución de herramienta, que es el comportamiento más peligroso y el más natural: si `generar_enviar_pdf` falla, mandar el correo sin adjunto parece un apaño razonable, y no lo es.

> **Diseña el error para el lector que lo va a leer.**
>
> Si el lector es un humano, escribe contexto. Si el lector es un modelo que va a actuar sobre lo que lea, escribe instrucciones. Y sé explícito con lo que **no** debe hacer: el modelo no conoce tus reglas de negocio, pero sí obedece una prohibición clara.

---

### 8.5 La descripción de la tool es prompt engineering

Un `inputSchema` bien tipado no basta. El modelo no valida contra tu esquema —eso lo haces tú— pero sí **lee las descripciones** y decide a partir de ellas.

Cada frase que sigue está escrita contra un fallo concreto que vi en producción:

**Contra la sustitución de herramienta.** Dos tools que suenan parecido se confunden. La descripción las separa a la fuerza:

> "Para enviar un PDF adjunto usa `generar_enviar_pdf`; estas herramientas **NO** son intercambiables."

**Contra la confusión de tipo.** El campo `template` espera una clave corta. El modelo, viendo que el sistema trabaja con Google Docs, tiende a meter un ID de documento:

> "Template inválido. Válidos: bienvenida, notificacion. **NO es un ID de documento**."

**Contra la reescritura de resultados.** Los modelos redondean, convierten unidades y "mejoran" cifras sin querer:

> "reporta los valores **EXACTAMENTE** como los devuelve la herramienta. No redondees, no conviertas unidades, no interpretes."

**Contra el desbordamiento de campo.** El campo `nombre` es para un nombre. Cuando el modelo tiene mucho que decir y solo un hueco a mano, mete el mensaje ahí:

> "Solo el nombre: no uses este campo para meter contenido del mensaje."

**Contra la espera silenciosa.** Una tool que tarda cinco minutos parece colgada:

> "Tarda entre 40 y 300 segundos según max_hosts; avísale al usuario que espere."

Observa el patrón: todas están en **imperativo**, muchas usan **mayúsculas para la prohibición**, y varias dicen explícitamente **qué no hacer**. No es el estilo de una documentación de API. Es el estilo correcto cuando el lector es un modelo.

Y hay una consecuencia práctica: **las descripciones se escriben después de ver fallar el sistema**, no antes. La primera versión describe lo que la tool hace. La versión buena describe además lo que el modelo se equivocó haciendo.

---

### 8.6 Lo que el modelo no debe decidir

Hay dos tools en este servidor que existen únicamente para quitarle decisiones al modelo. No son funcionalidad: son diseño defensivo.

#### Aritmética fuera del modelo

```js
{
  name: "calcular_riesgo_avanzado",
  description: "Procesa métricas de exploits en " +
    "el motor de cálculo de Google Sheets para " +
    "evitar errores aritméticos del modelo. ..."
}
```

Los modelos de lenguaje calculan mal. No siempre, pero lo suficiente como para que no puedas apoyar un número de negocio en ello. Un riesgo residual mal calculado en un informe de seguridad es peor que no tenerlo, porque nadie lo va a verificar.

La solución: la fórmula vive en **una celda de Google Sheets**. El modelo manda dos números, Sheets calcula, el resultado vuelve. El modelo transporta datos; no los produce.

Este patrón es más general de lo que parece. Cada vez que una tool devuelve algo que el modelo *podría* haber calculado, tienes una decisión de diseño delante: ¿quieres el resultado correcto, o el resultado plausible?

#### Encadenar para que no se olvide

```js
notificar: {
  type: "boolean",
  description: "true = enviar el correo de " +
    "bienvenida inmediatamente tras crear el " +
    "registro. Úsalo cuando el usuario pida " +
    "crear el cliente y notificarlo en la misma " +
    "petición. Por defecto false."
}
```

"Da de alta a este cliente y mándale la bienvenida" son dos operaciones. Si expones dos tools, el modelo tiene que acordarse de llamar a la segunda después de la primera. A veces lo hace. A veces la primera tiene éxito, algo interrumpe el turno, y el cliente se queda creado sin correo.

Con `notificar=true` es **una sola llamada** que hace las dos cosas al otro lado. El modelo ya no puede olvidarse de la mitad, porque no hay mitad que recordar.

La regla general: **si dos operaciones siempre van juntas, no expongas dos tools.** Cada punto donde el modelo tiene que decidir es un punto donde puede equivocarse.

#### La validación del cliente es conveniencia, no defensa

Antes de gastar un viaje de ida y vuelta que puede durar minutos, el servidor valida:

```js
/**
 * Valida dominio y límites antes de gastar un
 * round-trip de hasta 5 minutos. El backend
 * vuelve a validar: esto es conveniencia,
 * no la defensa real.
 */
```

Ese comentario es la parte importante. La validación del lado Node existe para fallar **rápido y con un mensaje útil**. La validación que de verdad protege está en el Apps Script, porque el endpoint es público y cualquiera puede hacerle `POST` sin pasar por tu servidor MCP.

Validar en los dos sitios no es duplicar código. Es entender que hacen trabajos distintos.

---

### 8.7 El éxito a medias

Este es el caso que casi nadie maneja, y el que mejor resume el capítulo.

`add_cliente_sheet` con `notificar=true` hace dos cosas. ¿Qué pasa si la primera funciona y la segunda falla? El cliente **está** creado. La operación no fue un fracaso. Pero tampoco fue un éxito.

```js
// El alta puede tener éxito y el correo fallar.
// No es un error de la tool, pero el modelo
// tiene que verlo para no reportar un envío
// que no ocurrió.
if (result.data?.notificacion_error) {
    console.error(
      "[!] Alta OK pero notificación falló: " +
      result.data.notificacion_error
    );
}
```

Y —esto es lo esencial— el campo `notificacion_error` **viaja dentro de la respuesta exitosa** hasta el modelo. No se convierte en un `isError`, porque el alta sí ocurrió y marcarlo como fallo invitaría a reintentar, duplicando el cliente. Pero tampoco se esconde.

El modelo recibe la verdad completa: *cliente creado, correo no enviado, esta es la razón*. Y puede decírselo al usuario tal cual.

Devolver solo "cliente creado" habría sido técnicamente cierto y prácticamente una mentira. Las dos cosas a la vez. Ese hueco entre lo técnicamente cierto y lo prácticamente honesto es donde viven la mayoría de los bugs que llegan a producción.

---

### 8.8 Caso completo: VIC Recon

Todo lo anterior junto, en una tool que hace trabajo de verdad.

`auditar_dominio` ejecuta una auditoría **pasiva** de superficie expuesta: consulta Certificate Transparency vía `crt.sh` para inventariar subdominios, mira DNS público para higiene de correo (SPF, DMARC, DNSSEC), sondea cabeceras HTTP, y **construye una hoja de cálculo con dashboard y gráficos**. Devuelve las cifras y la URL de la hoja.

Pasiva significa que solo lee registros públicos: nada de escaneo de puertos ni pruebas activas. Es una distinción legal, no solo técnica, y la descripción de la tool la hace explícita.

#### El límite de seis minutos

Apps Script corta la ejecución a los seis minutos. Esa es la restricción que domina todo el diseño:

```js
/** Tope duro de hosts a sondear. Debe coincidir
 *  con CONFIG_RECON.HARD_LIMIT_HOSTS. */
const RECON_MAX_HOSTS = 60;

/** Apps Script corta a los 6 min; damos margen
 *  de sobra al transporte. */
const RECON_TIMEOUT_MS = 360000;
```

De ahí salen tres decisiones encadenadas:

- **El tope de hosts** existe porque sondear demasiados subdominios agota el presupuesto de tiempo. Y el comentario señala que la constante está duplicada en el backend: si cambias una y no la otra, el modelo cree que puede pedir 60 y el backend corta en 40.
- **El timeout del transporte** es de seis minutos, no de sesenta segundos como el resto. Si tu cliente HTTP se rinde antes que el backend, pierdes el trabajo cuando ya estaba casi hecho.
- **El recorte se reporta.** Si el dominio tiene más subdominios que el límite, se auditan los más cercanos al apex **y se informa de cuántos quedaron fuera**. Una auditoría que dice "60 subdominios" cuando había 300 no es incompleta: es falsa.

#### Avisar de la espera

```
"Tarda entre 40 y 300 segundos según max_hosts;
 avísale al usuario que espere."
```

Sin esa frase, el modelo lanza la tool y se queda callado. El usuario ve un cursor parpadeando durante cuatro minutos y asume que se colgó.

#### No recalcules lo que ya viene calculado

```
"Devuelve cifras y la URL de la hoja — los
 gráficos están en la hoja, no en la respuesta.
 Reporta el score y los hallazgos tal como
 llegan, sin recalcular."
```

Dos instrucciones en una. La primera evita que el modelo intente describir gráficos que no ha visto. La segunda es la misma regla de `calcular_riesgo_avanzado`: el score de seguridad lo calcula el backend con una fórmula auditable, no el modelo con una intuición.

---

### Lo que te llevas de este capítulo

**Sobre Apps Script:** usa `/exec`, versiona cada despliegue con el lápiz, sigue las redirecciones, manda `Content-Length` en bytes reales, y desactiva el parseo automático de tu cliente HTTP.

**Sobre errores:** no basta con capturarlos. Hay que **clasificarlos**, porque un despliegue mal configurado, un bug del backend y un cliente duplicado exigen respuestas distintas. Y un HTTP 200 no significa que nada haya fallado.

**Sobre el modelo como lector:** tus mensajes de error los va a leer un sistema que actúa sobre lo que lee. Escríbele instrucciones, no descripciones. Dile explícitamente cuándo **no** reintentar y cuándo **no** sustituir una herramienta por otra.

**Sobre el diseño:** cada decisión que le dejas al modelo es una decisión que puede salir mal. Saca la aritmética. Encadena lo que siempre va junto. Y cuando algo funcione a medias, dilo — un éxito parcial reportado como éxito total es la forma más cara de mentir.

En el capítulo siguiente sistematizamos estos patrones y unos cuantos más, para que no tengas que redescubrirlos servidor a servidor.

---
