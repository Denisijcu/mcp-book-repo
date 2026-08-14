import sqlite3
import json
import asyncio
from pathlib import Path
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, Resource

server = Server("vertex-sqlite-db")
DB_PATH = "vertex_security.db"

def init_db():
    """Genera una base de datos local para pruebas si no existe."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS security_logs (
            id INTEGER PRIMARY KEY, 
            event TEXT, 
            severity TEXT, 
            ip_address TEXT
        )
    ''')
    # Insertar datos de prueba (Mock Data)
    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (1, 'Login Failed', 'HIGH', '192.168.1.50')")
    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (2, 'Port Scan', 'CRITICAL', '10.0.0.5')")
    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (3, 'Token Expired', 'LOW', '127.0.0.1')")
    conn.commit()
    conn.close()

# 1. Registrar Resource (El esquema de la DB para darle contexto al LLM)
@server.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="db://schema/security_logs",
            name="Esquema de la tabla security_logs",
            mimeType="application/json"
        )
    ]

@server.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "db://schema/security_logs":
        schema = {
            "table": "security_logs",
            "columns": ["id (INT)", "event (TEXT)", "severity (TEXT)", "ip_address (TEXT)"]
        }
        return json.dumps(schema, indent=2)
    raise ValueError(f"Recurso no encontrado: {uri}")

# 2. Registrar Tool (Ejecución de consultas seguras)
@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="run_select_query",
            description="Ejecuta una consulta SQL SELECT en la base de datos de seguridad.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Consulta SQL. Obligatorio usar SELECT."}
                },
                "required": ["query"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "run_select_query":
        query = arguments.get("query", "").strip()
        
        # HARDENING CAPA 1: Bloqueo lógico de comandos destructivos
        if not query.upper().startswith("SELECT"):
            return [TextContent(type="text", text="🚨 BLOQUEO: Operación denegada. El servidor solo admite sentencias SELECT.")]
        
        try:
            # HARDENING CAPA 2: Conexión inmutable (URI Read-Only)
            # Esto evita que incluso si la Capa 1 falla, SQLite rechace un UPDATE/DROP
            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
            cursor = conn.cursor()
            cursor.execute(query)
            
            # Formatear resultados
            columns = [description[0] for description in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            conn.close()
            
            return [TextContent(type="text", text=json.dumps(rows, indent=2))]
            
        except sqlite3.Error as e:
            # Resiliencia: Atrapamos errores de sintaxis SQL generados por el LLM
            return [TextContent(type="text", text=f"Error SQL (Syntax/Engine): {str(e)}")]
            
    raise ValueError(f"Tool desconocida: {name}")

async def main():
    init_db() # Levantar la base de datos de prueba
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())