# El Protocolo MCP — Código fuente del libro

Código, diagramas y material complementario del libro **El Protocolo MCP: De lo
Básico a lo Profundo**, de Denis Sanchez Leyva (Vertex Coders LLC, 2026).

Si llegaste aquí desde el libro: **esta página es el índice**. Cada capítulo
tiene su carpeta con el código listo para ejecutar y el diagrama a tamaño
completo. Los diagramas no van dentro del ebook a propósito — en una pantalla
de tinta electrónica serían ilegibles. Aquí se leen.

---

## Estado

El repositorio se completa a medida que se publican los capítulos. Esta tabla
dice exactamente qué hay hoy.

| Cap. | Título | Código | Diagrama | Guía |
|---|---|:---:|:---:|:---:|
| 01 | ¿Qué es el Model Context Protocol? | — | ✅ | — |
| 02 | Arquitectura del Protocolo | — | ✅ | — |
| 03 | Transportes | — | ✅ | — |
| 04 | Tu Primer Servidor MCP | ✅ | ✅ | ✅ |
| 05 | MCP con Claude Desktop — Sistema de Archivos | ✅ | ✅ | ✅ |
| 06 | Exposición de Bases de Datos | 🚧 | ✅ | 🚧 |
| 07 | MCP con Claude Desktop — APIs Externas | 🚧 | ✅ | — |
| 08–25 | — | 🚧 | 🚧 | 🚧 |

✅ disponible · 🚧 en preparación · — no aplica

Los capítulos 1 a 3 son conceptuales y no llevan código.

---

## Servidores MCP con hardware — material extra

El libro se centra en servidores que manejan datos: archivos, bases de datos,
APIs, Google Workspace. Estos cuatro hacen otra cosa — mueven cosas en el
mundo físico, o las miden. No cabían en el libro, y están completos aquí.

Si el libro te enseñó a construir servidores MCP, estos te enseñan a
construirlos cuando **un bug tiene consecuencias físicas**.

| Repositorio | Qué controla | Por qué merece la pena |
|---|---|---|
| [mcp-tello](https://github.com/Denisijcu/mcp-tello) | Un drone DJI Tello por UDP | Separa las tools en SEGURAS y DE VUELO. `plan_flight` valida una secuencia y devuelve un `plan_id`, pero **no vuela**: la aprobación es humana. Incluye simulador para desarrollar sin drone. |
| [obd2-mcp](https://github.com/Denisijcu/obd2-mcp) | La centralita de un coche por OBD-II | Telemetría real desde el bus del vehículo: códigos de avería, sensores en vivo. Solo lectura, y por una buena razón. |
| [plc-mcp](https://github.com/Denisijcu/plc-mcp) | Un PLC industrial por Modbus TCP | El protocolo que mueve fábricas. Fija `pymodbus==3.6.9`: la rama 3.14 eliminó el datastore clásico. |
| [mcp-calculadora](https://github.com/Denisijcu/mcp-calculadora) | Aritmética determinista | El servidor más pequeño del conjunto y buen punto de partida. Existe porque los modelos calculan mal. |

### La lección que comparten

En un servidor MCP de lectura, lo peor que provoca un bug es una respuesta
equivocada. Cuando el actuador vuela, gira un motor o abre una válvula, el
mismo bug tiene otra factura.

De ahí salen tres patrones que verás repetidos en los cuatro:

- **Separación por riesgo.** Las tools que solo consultan y las que actúan no
  se tratan igual. Las segundas se dejan en modo *Ask* y se aprueban una a una.
- **Planificar no es ejecutar.** El modelo propone una secuencia y recibe un
  identificador. Ejecutarla es una llamada distinta, que autoriza un humano.
- **La latencia es parte del diseño.** Si el modelo tarda treinta segundos en
  decidir, esos treinta segundos ocurren entre tu orden y su ejecución. En un
  drone en el aire, eso no es un detalle.

Es el mismo principio del capítulo 8 llevado al límite: **si el backend puede
saberlo, no lo decide el modelo.** Solo que aquí, cuando el modelo decide mal,
se oye el golpe.

---

## Requisitos

- **Python 3.11 o superior**
- El SDK de MCP, fijado a la rama 1.x:

```bash
python -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate
pip install "mcp[cli]>=1.10,<2"
```

> La versión 2.0.0 del paquete `mcp` reorganizó `FastMCP` y
> `mcp.server.fastmcp`. Los ejemplos de este repositorio están escritos
> contra la rama 1.x. Respeta el rango de versiones o no arrancarán.

Para depurar cualquier servidor sin necesidad de un modelo:

```bash
npx @modelcontextprotocol/inspector python -m src.server
```

Es lo primero que debes abrir cuando un servidor no responde como esperas.

---

## Cómo ejecutar un capítulo

```bash
cd chapter04
python -m src.server
```

Cada carpeta con código incluye su propio `README.md` con los detalles
específicos: qué tools expone, cómo conectarlo a Claude Desktop o a LM Studio,
y qué probar.

---

## Conectar a Claude Desktop

El archivo de configuración vive en:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Dos cosas que cuestan horas si no se saben:

1. **Usa rutas absolutas.** Claude Desktop no expande `%PATH%`; lo trata como
   texto literal.
2. **Después de añadir un servidor, reinicia y abre un chat nuevo.** En una
   conversación que ya estaba abierta, el servidor no aparece.

Para ver qué está fallando:

```powershell
Get-Content "$env:APPDATA\Claude\logs\mcp-server-NOMBRE.log" -Tail 20
```

---

## Estructura

```
chapterNN/
├── README.md      guía del capítulo
├── src/           código ejecutable
└── images/        diagrama a tamaño completo
```

---

## Licencia

Código bajo licencia [MIT](LICENSE) — úsalo, modifícalo y publícalo con
libertad.

Los diagramas y el texto del libro son © 2026 Denis Sanchez Leyva, todos los
derechos reservados.

---

## Erratas

¿Encontraste un error en el libro o un ejemplo que no arranca? Abre un
[issue](https://github.com/Denisijcu/mcp-book-repo/issues). Las correcciones
entran en la siguiente edición.
