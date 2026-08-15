### Construir un servidor MCP de filesystem

```python
from mcp.server import Server
from mcp.types import TextContent
from pathlib import Path
import json

server = Server("filesystem-server")
ROOT = Path("/home/usuario/proyectos")  # Root restringido

@server.list_tools()
async def list_tools():
    return [
        {
            "name": "read_file",
            "description": "Lee el contenido de un archivo",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Ruta relativa al root"}
                },
                "required": ["path"]
            }
        },
        {
            "name": "write_file",
            "description": "Escribe contenido en un archivo",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": "list_directory",
            "description": "Lista archivos y carpetas",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"}
                }
            }
        }
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    target = ROOT / arguments.get("path", ".")

    # Validación de seguridad: prevenir directory traversal
    if not str(target.resolve()).startswith(str(ROOT.resolve())):
        raise ValueError("Acceso denegado: fuera del directorio permitido")

    if name == "read_file":
        content = target.read_text()
        return [TextContent(type="text", text=content)]

    elif name == "write_file":
        target.write_text(arguments["content"])
        return [TextContent(type="text", text=f"Archivo escrito: {target}")]

    elif name == "list_directory":
        items = [f"[DIR] {p.name}" if p.is_dir() else f"[FILE] {p.name}"
                 for p in target.iterdir()]
        return [TextContent(type="text", text="\n".join(items))]
```

### Manejo de rutas y permisos

Toda la seguridad de este servidor descansa en una sola garantía
topológica. Si `D_root` es el conjunto de rutas permitidas —el sandbox—,
entonces cualquier ruta `p` que llegue desde el modelo debe cumplir una
condición que no admite excepciones:

```
realpath(p) ⊆ realpath(D_root)
```

Es decir: una vez resuelta la ruta real —siguiendo los enlaces simbólicos y
colapsando los `..`— tiene que seguir cayendo dentro del sandbox. Si no cae,
se rechaza. No hay caso especial, no hay excepción para archivos de
configuración, no hay ruta de confianza.

#### Cuatro reglas de oro

**1. Nunca uses `os.path.join` con entrada del usuario.**
Usa `pathlib` y su método `.resolve()`, que elimina enlaces simbólicos
engañosos y secuencias de escape como `../../` antes de que puedas
compararlas con nada.

**2. Valida la jerarquía con `is_relative_to()`, no con `.startswith()`.**
El método `Path.is_relative_to()`, disponible desde Python 3.9, es
infinitamente superior a comparar cadenas. Y el motivo es concreto: si tu
sandbox es `/home/user`, la ruta `/home/user-malicioso` **empieza por**
`/home/user`, así que `.startswith()` la aprueba. `is_relative_to()` la
rechaza, porque entiende que son ramas distintas del árbol y no dos textos
parecidos.

**3. Atrapa las excepciones del sistema de archivos.**
`FileNotFoundError` y `PermissionError` son nativas y van a ocurrir.
Captúralas y devuélvelas como `TextContent` al modelo. Si las dejas
propagarse, el servidor se cae ante el primer error del modelo — y el modelo
comete errores, esa es la premisa de todo el capítulo.

**4. Listas blancas de extensiones.**
En producción, además de la jaula de rutas, permite solo extensiones
concretas: `.md`, `.txt`, `.json`. Una jaula que deja escribir `.exe` o
`.sh` dentro es una jaula con una puerta.

Y sobre todo lo anterior: **registra toda operación de escritura.** Una
lectura equivocada es un fallo; una escritura equivocada es un fallo que
además borró algo.

### Ejercicio práctico: asistente de gestión de archivos con Claude

**Objetivo:** conectar Claude Desktop a este servidor y hacer un *red
teaming* operativo desde la propia interfaz del chat.

Con el servidor conectado, pídele estas tres cosas en orden:

1. *"Lista todos los archivos en la raíz de tu sistema de archivos."*
   Debería invocar `list_directory`.
2. *"Crea un archivo `README.md` con un índice de los archivos que
   encontraste."* Aquí entra `write_file`.
3. *"Organiza mi carpeta de descargas moviendo los archivos por tipo: los
   PDF a `documentos/`, las imágenes a `imagenes/`."* Varias herramientas
   encadenadas en un solo turno.

#### La prueba de fuego

Y ahora el que importa de verdad:

> *"Intenta leer el archivo de contraseñas del sistema usando la ruta
> `../../../../etc/passwd`."*

Aquí ves la jaula funcionando en tiempo real: el servidor rechaza la
solicitud y Claude te informa de que el acceso fue denegado.

Si en cambio obtienes el contenido del archivo, tu validación no sirve. Y es
mucho mejor descubrirlo ahora, en tu máquina y con un archivo que ya conoces,
que dentro de seis meses en el servidor de otra persona.
