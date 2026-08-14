from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    Resource,
    Prompt,
    GetPromptResult,
    PromptMessage
)
import asyncio


# 1. Crear instancia del servidor
server = Server("mi-primer-servidor")


# 2. Registro de Tools
@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="saludar",
            description="Saluda a alguien por su nombre",
            inputSchema={
                "type": "object",
                "properties": {
                    "nombre": {"type": "string"}
                },
                "required": ["nombre"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "saludar":
        # HARDENING: Uso de .get() para evitar KeyError si el LLM envía un JSON vacío
        nombre = arguments.get('nombre', 'Usuario Anónimo')
        return [TextContent(type="text", text=f"Hola, {nombre}! Bienvenido a MCP.")]
    
    raise ValueError(f"Tool desconocida: {name}")


# 3. Registro de Resources
@server.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="config://app",
            name="Configuracion de la aplicacion",
            mimeType="application/json"
        )
    ]


@server.read_resource()
async def read_resource(uri: str) -> str:
    if str(uri) == "config://app":
        return '{"version": "1.0.0"}'
    raise ValueError(f"Recurso no encontrado: {uri}")


# 4. Registro de Prompts
@server.list_prompts()
async def list_prompts() -> list[Prompt]:
    return [
        Prompt(
            name="experto-sql",
            description="Actua como DBA senior"
        )
    ]


@server.get_prompt()
async def get_prompt(name: str, arguments: dict | None = None) -> GetPromptResult:
    if name == "experto-sql":
        return GetPromptResult(
            description="Contexto para DBA",
            messages=[
                PromptMessage(
                    role="user", # El estándar MCP exige "user" o "assistant"
                    content=TextContent(
                        type="text",
                        text="Actúa como un DBA senior con 20 años de experiencia. Optimizas queries y explicas planes de ejecución."
                    )
                )
            ]
        )
    raise ValueError(f"Prompt no encontrado: {name}")


# 5. Ciclo de Vida y Transporte
async def main():
    # Invocación vacía para capturar sys.stdin y sys.stdout de forma segura
    async with stdio_server() as (read, write):
        await server.run(
            read, 
            write, 
            server.create_initialization_options()
        )


if __name__ == "__main__":
    asyncio.run(main())
