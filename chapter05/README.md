
```markdown
# Capítulo 5: Sistema de Archivos Enjaulado (Zero-Trust Sandbox)

Este directorio contiene la implementación de un servidor Model Context Protocol (MCP) diseñado para permitir a un modelo de lenguaje (LLM) interactuar con el sistema de archivos local. 

Dado el riesgo crítico que supone otorgar acceso de lectura/escritura a una inteligencia artificial, este servidor implementa una arquitectura **Zero-Trust** con una jaula criptográfica (*Sandbox*) que mitiga vectorialmente ataques de *Path Traversal* (OWASP LLM06).

## 🏗️ Arquitectura de Seguridad

El núcleo del servidor (`src/fs_server.py`) expone tres *Tools* (`read_file`, `write_file`, `list_directory`) bajo las siguientes directivas de *hardening*:
*   **Aislamiento de Directorio (Sandbox):** El servidor restringe matemáticamente todas las operaciones al directorio `./secure_sandbox/`. 
*   **Validación de Rutas (Pathlib):** Utiliza la resolución de rutas relativas absolutas (`is_relative_to()`) para interceptar inyecciones maliciosas (ej. `../../../etc/passwd` o rutas absolutas de Windows) antes de que interactúen con el SO.
*   **Manejo de Excepciones:** Atrapa errores nativos de permisos o archivos inexistentes, devolviendo alertas en formato `TextContent` para evitar la caída del proceso `stdio`.

## ⚙️ Requisitos Previos

- Python 3.11 o superior.
- Librería oficial: `mcp`.
- MCP Inspector (para auditoría).

## 📂 Estructura del Directorio

```text
cap05_filesystem/
├── src/
│   └── server.py           # Core del servidor y validación criptográfica
├── secure_sandbox/            # EL ÚNICO DIRECTORIO ACCESIBLE
│   └── users.csv              # Archivo de prueba para lectura/escritura
└── README.md

```

## 🚀 Despliegue en Claude Desktop (Host)

Para integrar este servidor directamente en Claude Desktop de forma silenciosa y persistente, inyecta la siguiente configuración en el archivo de manifiesto del Host:

* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vertex-filesystem": {
      "command": "python",
      "args": ["-m", "src.server"],
      "env": {
        "PYTHONPATH": "/ruta/absoluta/a/tu/proyecto/cap05_filesystem"
      }
    }
  }
}

```

## 🕵️‍♂️ Auditoría y Red Teaming (MCP Inspector)

Para certificar la resistencia de la jaula perimetral sin conectar el LLM, levantamos el servidor localmente con el Inspector:

```bash
npx @modelcontextprotocol/inspector python -m src.fs_server

```

### Matriz de Fuzzing (Pruebas de Seguridad Estática)

Utiliza la interfaz web del Inspector para disparar los siguientes *payloads* y verificar la resiliencia del sistema:

| Vector de Ataque (Tool) | Payload JSON (Input) | Comportamiento Esperado del Servidor | Estado |
| --- | --- | --- | --- |
| **Lectura Legítima** (`read_file`) | `{"path": "users.csv"}` | Devuelve el contenido íntegro del CSV. | ✅ Éxito |
| **Path Traversal** (`read_file`) | `{"path": "../../../Windows/System32/drivers/etc/hosts"}` | Intercepta la resolución. Devuelve: *🚨 BLOQUEO: Intento de Path Traversal...* | 🛡️ Bloqueado |
| **Bypass Codificado** (`read_file`) | `{"path": "..%2f..%2f..%2fetc%2fpasswd"}` | La librería de SO resuelve la codificación; la jaula bloquea el intento. | 🛡️ Bloqueado |
| **Inyección de Comando** (`read_file`) | `{"path": "users.csv; whoami"}` | Devuelve un error controlado indicando que el archivo no existe. No ejecuta `whoami`. | 🛡️ Bloqueado |

```

```