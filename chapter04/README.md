
```markdown
# Capítulo 4: Tu Primer Servidor MCP (Arquitectura Base)

Este directorio contiene el código oficial correspondiente al Capítulo 4. Demuestra la implementación de un servidor Model Context Protocol (MCP) desde cero, utilizando la API de bajo nivel (`mcp.server`) para exponer herramientas, recursos y plantillas de contexto a modelos de lenguaje (LLMs).

## 🏗️ Arquitectura del Servidor

El script principal (`src/server.py`) implementa las tres primitivas fundamentales del protocolo bajo una estricta validación de tipos:

1. **Tool (`saludar`)**: Una función asíncrona que el LLM puede invocar pasando parámetros JSON. Incluye mitigación contra excepciones de clave (`KeyError`).
2. **Resource (`config://app`)**: Un recurso estático que expone metadatos (como la versión de la aplicación) directamente al contexto del modelo.
3. **Prompt (`experto-sql`)**: Una plantilla de sistema parametrizada que fuerza al LLM a adoptar un rol específico (DBA Senior) cumpliendo con el esquema de roles del estándar MCP.

## ⚙️ Requisitos Previos

- Python 3.11 o superior.
- [Node.js](https://nodejs.org/) (Exclusivo para levantar el MCP Inspector en fase de pruebas).

## 🚀 Instalación y Ejecución

1. **Instalar el SDK oficial de MCP:**
   ```bash
   pip install mcp

```

2. **Ejecutar el servidor localmente:**
El servidor utiliza el transporte `stdio`. Al ejecutarlo, no abrirá puertos de red, sino que se quedará a la espera de instrucciones JSON-RPC a través de la entrada estándar.
```bash
python -m src.server

```


*(Nota: Es normal que la terminal se quede parpadeando sin mostrar logs. Esto indica que el servidor está en silencio táctico operando correctamente).*

## 🕵️‍♂️ Auditoría y Pruebas (Red Teaming)

Para auditar la comunicación y simular las peticiones de un cliente (Host), utilizamos el Inspector oficial de Model Context Protocol.

Ejecuta el siguiente comando desde la raíz de este directorio:

```bash
npx @modelcontextprotocol/inspector python -m src.server

```

Una vez ejecutado, accede a la URL local generada (usualmente `http://localhost:5173`) para interactuar con la interfaz visual, ejecutar comandos y validar la serialización del JSON.

## 🛡️ Estándar de Seguridad (Vertex Coders)

* **Aislamiento de Transporte:** Al utilizar `stdio_server()`, la superficie de ataque de red es nula.
* **Resiliencia de Inputs:** La herramienta `saludar` utiliza extracción segura (`arguments.get()`) en lugar de acceso directo por índice. Si el modelo de lenguaje sufre una alucinación y envía un *payload* vacío (`{}`), el servidor absorbe el impacto y devuelve un valor por defecto sin interrumpir el ciclo de vida de la aplicación.

