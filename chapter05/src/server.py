from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from pathlib import Path
import asyncio

server = Server("vertex-filesystem")

# 1. Definición del Perímetro de Seguridad (Sandbox)
# En producción, esto debe ser inyectado vía variables de entorno.
ROOT = Path("./secure_sandbox").resolve()
#ROOT = Path("H:/mcp-book-repo/chapter05").resolve()
ROOT.mkdir(exist_ok=True) # Garantiza que la jaula exista

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="read_file",
            description="Lee el contenido de un archivo de texto en la jaula.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Ruta relativa al root"}
                },
                "required": ["path"]
            }
        ),
        Tool(
            name="write_file",
            description="Escribe o sobrescribe contenido en un archivo.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }
        ),
        Tool(
            name="list_directory",
            description="Lista archivos y carpetas del directorio.",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "default": "."}
                }
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    # HARDENING: Extracción segura con defaults
    req_path = arguments.get("path", ".")
    target = (ROOT / req_path).resolve()

    # VALIDACIÓN MATEMÁTICA: Path Traversal Block (OWASP LLM06)
    if not target.is_relative_to(ROOT):
        return [TextContent(type="text", text="🚨 BLOQUEO: Intento de Path Traversal detectado y denegado.")]

    try:
        if name == "read_file":
            if not target.is_file():
                return [TextContent(type="text", text="Error: El archivo no existe o es un directorio.")]
            content = target.read_text(encoding='utf-8')
            return [TextContent(type="text", text=content)]

        elif name == "write_file":
            content = arguments.get("content", "")
            target.write_text(content, encoding='utf-8')
            return [TextContent(type="text", text=f"Archivo escrito exitosamente: {target.name}")]

        elif name == "list_directory":
            if not target.is_dir():
                return [TextContent(type="text", text="Error: La ruta no es un directorio válido.")]
            
            items = [f"[DIR] {p.name}" if p.is_dir() else f"[FILE] {p.name}" for p in target.iterdir()]
            resultado = "\n".join(items) if items else "Directorio vacío."
            return [TextContent(type="text", text=resultado)]
            
    except Exception as e:
        # Resiliencia: Si ocurre un error de SO, el servidor MCP no debe colapsar
        return [TextContent(type="text", text=f"Error del sistema de archivos: {str(e)}")]

    raise ValueError(f"Tool desconocida: {name}")

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())