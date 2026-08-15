## Capítulo 6: Exposición de Bases de Datos {#cap-06}

Conectar un Modelo de Lenguaje a una base de datos relacional le otorga un poder analítico brutal, pero abre la puerta al vector de ataque más antiguo y letal de la industria: la Inyección SQL (SQLi). En este capítulo construiremos un servidor MCP de bases de datos empezando por SQLite —simple, sin servidor, ideal para auditar a nivel de bytes— y después lo llevaremos al mismo patrón sobre PostgreSQL en producción.

La arquitectura que diseñaremos aquí es agnóstica: la teoría y las defensas que apliquemos son exactamente las mismas que usarías en un clúster de PostgreSQL o MongoDB. Todo lo auditaremos localmente usando nuestro MCP Inspector, sin necesidad de conectar un LLM real todavía.

---

### 1. Arquitectura de seguridad (Zero-Trust DB)

Cuando un LLM genera consultas SQL de forma autónoma, el riesgo de que alucine un `DROP TABLE` o un `DELETE` masivo es inaceptable. La regla que gobierna todo este capítulo es sencilla y no admite excepciones: el modelo propone, la base de datos defiende. Nunca se confía en que la consulta que llega sea segura; se asume que no lo es y se bloquea en varias capas independientes.

Nuestra defensa constará de dos capas que no dependen una de la otra:

1. Defensa lógica (filtro de aplicación): rechazar cualquier consulta que no comience estrictamente con `SELECT`.
2. Defensa del motor (conexión de solo lectura): forzar la conexión a la base de datos en modo "solo lectura" a través de los drivers nativos, de modo que aunque la capa 1 fallara, el motor rechace por su cuenta cualquier escritura.

La clave de este diseño es que las dos capas son redundantes a propósito. Un filtro de texto se puede burlar con suficiente creatividad; una conexión abierta en modo `read-only` no ejecuta un `UPDATE` por mucho que el texto lo pida. La seguridad real no está en el filtro ni en el modo de conexión por separado, sino en que ambos tendrían que fallar a la vez para que ocurra un desastre.

---

### 2. Código del servidor SQLite (`src/db_server.py`)

Crea este archivo. Incluye una función de inicialización que genera una base de datos de prueba (`vertex_security.db`) con algunos registros tácticos para que tengamos algo que consultar.

```python
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

    # Datos de prueba (mock data)

    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (1, 'Login Failed', 'HIGH', '192.168.1.50')")

    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (2, 'Port Scan', 'CRITICAL', '10.0.0.5')")

    cursor.execute("INSERT OR IGNORE INTO security_logs VALUES (3, 'Token Expired', 'LOW', '127.0.0.1')")

    conn.commit()

    conn.close()
```

### Registrar Resource (el esquema, para dar contexto al LLM)

```python
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
```

### Registrar Tool (ejecución de consultas seguras)

```python
@server.list_tools()

async def list_tools() -> list[Tool]:

    return [

        Tool(

            name="run_select_query",

            description="Ejecuta una consulta SQL SELECT de solo lectura sobre la base de datos de seguridad. Solo admite SELECT.",

            inputSchema={

                "type": "object",

                "properties": {

                    "query": {"type": "string", "description": "Consulta SQL. Debe empezar por SELECT."}

                },

                "required": ["query"]

            }

        )

    ]

@server.call_tool()

async def call_tool(name: str, arguments: dict) -> list[TextContent]:

    if name == "run_select_query":

        query = arguments.get("query", "").strip()

        # HARDENING CAPA 1: bloqueo lógico de comandos destructivos

        if not query.upper().startswith("SELECT"):

            return [TextContent(type="text", text="BLOQUEO: operación denegada. El servidor solo admite sentencias SELECT.")]

        try:

            # HARDENING CAPA 2: conexión inmutable (URI read-only).

            # Aunque la capa 1 fallara, SQLite rechaza cualquier UPDATE/DROP.

            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)

            cursor = conn.cursor()

            cursor.execute(query)

            columns = [description[0] for description in cursor.description]

            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

            conn.close()

            return [TextContent(type="text", text=json.dumps(rows, indent=2))]

        except sqlite3.Error as e:

            # Resiliencia: atrapamos errores de sintaxis SQL generados por el LLM.

            # Sin este except, una consulta malformada tumbaría el servidor.

            return [TextContent(type="text", text=f"Error SQL (sintaxis/motor): {str(e)}")]

    raise ValueError(f"Tool desconocida: {name}")

async def main():

    init_db()

    async with stdio_server() as (read, write):

        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":

    asyncio.run(main())
```

### 3. Auditoría en el MCP Inspector

Como arquitectos, no confiaremos en este servidor hasta que intentemos vulnerarlo. Levanta el inspector apuntando al nuevo archivo:

```bash
npx @modelcontextprotocol/inspector python -m src.db_server
```

Matriz de pruebas (ejecutar en la interfaz web):

1. Lectura de recursos (contexto). Pestaña Resources → ejecuta `db://schema/security_logs`. Resultado: el Inspector devuelve el JSON con las columnas. Esto es lo que el LLM leería internamente antes de decidir cómo armar su consulta.

2. Ruta feliz (consulta válida). Pestaña Tools → `run_select_query`. Argumento: `{"query": "SELECT * FROM security_logs WHERE severity = 'CRITICAL'"}` Resultado: el servidor devuelve el registro del Port Scan.

3. Red teaming (intento de destrucción). Pestaña Tools → `run_select_query`. Argumento: `{"query": "DROP TABLE security_logs"}` Resultado: la capa 1 lo intercepta al instante y devuelve la alerta de bloqueo. El servidor mantiene la conexión viva; no se cae.

Vale la pena hacer una cuarta prueba, la más instructiva: intenta un `SELECT` malformado a propósito, como `SELECT * FROM tabla_que_no_existe`. Verás que el servidor no se cae; te devuelve el error de motor como texto. Un servidor que se cae ante la primera consulta torpe del modelo no sirve para producción, y esa resiliencia es tan importante como el bloqueo de escrituras.

---

### 4. De SQLite a PostgreSQL en producción

SQLite es perfecto para aprender y auditar, pero en producción vas a hablar con PostgreSQL, MySQL o un motor equivalente. La buena noticia es que el patrón no cambia: el modelo propone, la capa determinista valida, el motor defiende. Solo cambian dos cosas, y ambas mejoran la seguridad.

Esquema dinámico en vez de hardcodeado

En el servidor SQLite escribimos el esquema a mano dentro del código. Eso funciona con una tabla, pero no escala. En PostgreSQL puedes leer el esquema real de la base de datos y exponerlo como resource, de modo que el modelo siempre vea la estructura actual sin que tú la mantengas a mano:

```python
import asyncpg

import json

from mcp.server import Server

from mcp.types import TextContent, Resource

server = Server("postgres-db")

DB_URL = "postgresql://user:pass@localhost/mi_db"

@server.list_resources()

async def list_resources():

    return [

        Resource(

            uri="db://schema/tables",

            name="Esquema de todas las tablas",

            mimeType="application/json"

        )

    ]

@server.read_resource()

async def read_resource(uri: str):

    if uri == "db://schema/tables":

        conn = await asyncpg.connect(DB_URL)

        rows = await conn.fetch("""

            SELECT table_name, column_name, data_type

            FROM information_schema.columns

            WHERE table_schema = 'public'

            ORDER BY table_name, ordinal_position

        """)

        await conn.close()

        schema = {}

        for row in rows:

            schema.setdefault(row["table_name"], []).append({

                "column": row["column_name"],

                "type": row["data_type"]

            })

        return json.dumps(schema, indent=2)

    raise ValueError(
        f"Recurso no encontrado: {uri}")
```

#### Consultas parametrizadas: la defensa que SQLite escondía

En el servidor SQLite recibíamos la consulta entera como texto y la ejecutábamos tras filtrarla. Eso está bien para un `SELECT` de solo lectura sobre datos de prueba, pero en cuanto una consulta acepta valores del usuario —un id, un rango de fechas, un nombre— concatenar esos valores en el texto SQL es la puerta abierta a la inyección.

La regla de oro es no construir nunca SQL pegando cadenas. Se usan consultas parametrizadas, donde el valor viaja por un canal separado del texto de la consulta y el motor se encarga de escaparlo:

```python
# INSEGURO — nunca hagas esto.
# Un user_id de "1; DROP TABLE users"
# es un desastre.
rows = await conn.fetch(
    f"SELECT * FROM users WHERE id = {user_id}")

# SEGURO — el valor viaja aparte; el motor
# lo trata como dato, no como codigo.
rows = await conn.fetch(
    "SELECT * FROM users WHERE id = $1",
    user_id)
```

Este es el punto que conviene grabarse: el filtro `startswith("SELECT")` del servidor SQLite frena las escrituras, pero no frena una inyección dentro de un `SELECT`. Una consulta como `SELECT * FROM users WHERE nombre = 'x' OR '1'='1'` empieza por SELECT y pasa el filtro. La defensa real contra la inyección son las consultas parametrizadas y un usuario de base de datos con permisos de solo lectura. El filtro es la primera capa; las parametrizadas son la que de verdad aguanta.

Tres reglas para el servidor de producción

* Usuario de solo lectura a nivel de base de datos. Crea un rol de PostgreSQL con `GRANT SELECT` y nada más, y conéctate con él. Es la versión industrial del `mode=ro` de SQLite: aunque todo el código de aplicación fallara, el motor no ejecutaría una escritura porque el usuario no tiene el permiso.
* Lista blanca de tablas cuando puedas acotarla. Si el asistente solo debe consultar tres tablas, valida el nombre de tabla contra esa lista antes de ejecutar.
* Todo valor del usuario, siempre parametrizado. Sin excepción, por cómoda que parezca la concatenación en un caso concreto.

---

### 5. Ejercicio práctico: asistente de análisis de datos

> Objetivo: conecta el servidor a una base de datos con datos reales (los tuyos o un dataset de ejemplo) y, a través del Inspector primero y de un cliente MCP después, pídele que:
> * Analice la distribución de datos en las tablas principales.
> * Identifique anomalías: valores nulos, duplicados, outliers.
> * Genere un informe en markdown con una descripción de cada tabla.
> * Sugiera índices para las consultas que más se repiten.

Antes de conectar cualquier cliente, repite el red teaming del apartado 3 contra tu servidor de producción: intenta un `DROP`, intenta un `UPDATE`, intenta una inyección dentro de un `SELECT`. Si las tres se bloquean y el servidor sigue en pie, entonces —y solo entonces— puedes dárselo a un modelo.