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
