import json
import asyncio
import urllib.request
import urllib.error
from urllib.parse import urlparse
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("vertex-api-gateway")

# HARDENING: Lista blanca estricta de dominios permitidos
ALLOWED_DOMAINS = {"jsonplaceholder.typicode.com"}

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="fetch_external_data",
            description="Obtiene telemetría de usuarios desde una API externa.",
            inputSchema={
                "type": "object",
                "properties": {
                    "endpoint": {
                        "type": "string", 
                        "description": "Ruta del endpoint (ej. /users/1)"
                    }
                },
                "required": ["endpoint"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "fetch_external_data":
        endpoint = arguments.get("endpoint", "/").strip()
        
        # Construcción de la URL (Fijando el protocolo y dominio por diseño)
        # Nunca permitimos que el LLM inyecte el dominio completo
        target_url = f"https://jsonplaceholder.typicode.com{endpoint}"
        
        # VALIDACIÓN SSRF: Doble chequeo analizando la URL final
        parsed_url = urlparse(target_url)
        if parsed_url.netloc not in ALLOWED_DOMAINS:
            return [TextContent(type="text", text="🚨 BLOQUEO SSRF: Intento de acceso a dominio no autorizado.")]
        
        try:
            # Ejecución de la petición HTTP con timeout (Mitigación de DoS)
            req = urllib.request.Request(target_url, headers={'User-Agent': 'VertexCoders-MCP/1.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                return [TextContent(type="text", text=json.dumps(data, indent=2))]
                
        except urllib.error.URLError as e:
            return [TextContent(type="text", text=f"Error de red: {str(e)}")]
        except json.JSONDecodeError:
            return [TextContent(type="text", text="Error: La respuesta de la API no es JSON válido.")]

    raise ValueError(f"Tool desconocida: {name}")

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())