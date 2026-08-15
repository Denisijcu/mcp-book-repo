#!/usr/bin/env python3
"""
Servidor MCP para sistema de archivos - Versión manual con receive/send
No usa decoradores, compatible con tu SDK.
"""
import asyncio
import json
import sys
from pathlib import Path
from mcp.server.stdio import stdio_server

# ---------- CONFIGURACIÓN ----------
# Directorio raíz: puedes cambiarlo o usar una variable de entorno
ROOT = Path.home() / "proyectos"  # Por defecto, ~/proyectos
# Si quieres una ruta fija, descomenta y modifica:
# ROOT = Path("C:/Users/denis/proyectos")

# Crear el directorio si no existe
ROOT.mkdir(exist_ok=True)

# ---------- HERRAMIENTAS ----------
TOOLS = [
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
        "description": "Lista archivos y carpetas en el directorio",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Ruta relativa al root (opcional, por defecto '.')"}
            }
        }
    }
]

# ---------- FUNCIONES AUXILIARES ----------
def resolve_path(relative_path: str) -> Path:
    """Convierte una ruta relativa al root en una ruta absoluta, con validación de seguridad."""
    target = ROOT / relative_path
    # Prevenir directory traversal
    if not str(target.resolve()).startswith(str(ROOT.resolve())):
        raise ValueError("Acceso denegado: fuera del directorio permitido")
    return target

# ---------- BUCLE PRINCIPAL ----------
async def main():
    async with stdio_server() as (read_stream, write_stream):
        while True:
            try:
                msg = await read_stream.receive()
                if msg is None:
                    break

                method = msg.method if hasattr(msg, 'method') else None
                req_id = msg.id if hasattr(msg, 'id') else None
                params = msg.params if hasattr(msg, 'params') else {}

                # Inicialización
                if method == "initialize":
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "protocolVersion": "0.1.0",
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "filesystem-mcp", "version": "1.0.0"}
                        }
                    }

                # Lista de herramientas
                elif method == "tools/list":
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"tools": TOOLS}
                    }

                # Llamada a herramienta
                elif method == "tools/call":
                    # Obtener nombre y argumentos (pueden ser dict o objeto)
                    if isinstance(params, dict):
                        name = params.get("name")
                        args = params.get("arguments", {})
                    else:
                        name = getattr(params, 'name', None)
                        args = getattr(params, 'arguments', {})

                    try:
                        # Procesar herramienta
                        if name == "read_file":
                            path = args.get("path")
                            if not path:
                                raise ValueError("Falta el parámetro 'path'")
                            target = resolve_path(path)
                            if not target.is_file():
                                raise FileNotFoundError(f"El archivo '{target}' no existe")
                            content = target.read_text(encoding='utf-8')
                            result = {"status": "success", "content": content}
                            response = {
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "result": {"content": [{"type": "text", "text": json.dumps(result)}]}
                            }

                        elif name == "write_file":
                            path = args.get("path")
                            content = args.get("content")
                            if not path or content is None:
                                raise ValueError("Faltan parámetros 'path' y/o 'content'")
                            target = resolve_path(path)
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_text(content, encoding='utf-8')
                            result = {"status": "success", "message": f"Archivo escrito: {target}"}
                            response = {
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "result": {"content": [{"type": "text", "text": json.dumps(result)}]}
                            }

                        elif name == "list_directory":
                            path = args.get("path", ".")
                            target = resolve_path(path)
                            if not target.is_dir():
                                raise NotADirectoryError(f"'{target}' no es un directorio")
                            items = []
                            for p in target.iterdir():
                                prefix = "[DIR]" if p.is_dir() else "[FILE]"
                                items.append(f"{prefix} {p.name}")
                            result = {"status": "success", "items": items}
                            response = {
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "result": {"content": [{"type": "text", "text": json.dumps(result)}]}
                            }

                        else:
                            response = {
                                "jsonrpc": "2.0",
                                "id": req_id,
                                "error": {"code": -32601, "message": f"Herramienta '{name}' no reconocida"}
                            }

                    except Exception as e:
                        response = {
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": {"code": -32000, "message": str(e)}
                        }

                else:
                    response = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32601, "message": f"Método no soportado: {method}"}
                    }

                await write_stream.send(response)

            except Exception as e:
                sys.stderr.write(f"[ERROR] {str(e)}\n")
                continue

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass