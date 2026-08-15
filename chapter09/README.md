## Capítulo 9: Patrones de Diseño para Servidores MCP {#cap-09}

### Estructura modular y reutilizable

Organiza tu servidor en módulos:

mi-servidor-mcp/
├── src/
│   ├── __init__.py
│   ├── server.py          # Inicializacion del servidor
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── filesystem.py
│   │   └── database.py
│   ├── resources/
│   │   ├── __init__.py
│   │   └── schema.py
│   └── utils/
│       ├── auth.py
│       └── validation.py
├── tests/
├── Dockerfile
└── pyproject.toml

### Manejo de estado y context

Evita estado global. Usa dependency injection:

```python
class ServerContext:
    def __init__(self, db_pool, cache, config):
        self.db_pool = db_pool
        self.cache = cache
        self.config = config

async def create_server(ctx: ServerContext):
    server = Server("modular-server")

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        if name == "query_db":
            async with ctx.db_pool.acquire() as conn:
                return await conn.fetch(arguments["sql"])
```

### Logging y observabilidad

```python
import structlog

logger = structlog.get_logger()

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    logger.info("tool_called", tool=name, arguments=arguments)
    try:
        result = await execute(name, arguments)
        logger.info("tool_success", tool=name, result_size=len(str(result)))
        return result
    except Exception as e:
        logger.error("tool_failed", tool=name, error=str(e))
        raise
```

### Versionado de Tools y Resources

Nunca rompas compatibilidad sin aviso. Usa versioning en nombres:

### Correcto
{"name": "query_v2", "description": "Versión 2 con soporte para paginacion"}
### El modelo puede usar query_v2 mientras mantienes query_v1 para compatibilidad

### Incorrecto
{"name": "query", "inputSchema": {...cambio completamente...}}  # Rompe clientes existentes

### Testing de servidores MCP (pytest)

```python
import pytest
from mcp.client import ClientSession
from mcp.server import Server

@pytest.fixture
async def server():
    s = Server("test-server")
    @s.list_tools()
    async def list_tools():
        return [{"name": "echo", "description": "Echo", "inputSchema": {"type": "object"}}]
    return s

@pytest.mark.asyncio
async def test_list_tools(server):
    tools = await server.request("tools/list", {})
    assert len(tools["tools"]) == 1
    assert tools["tools"][0]["name"] == "echo"

---