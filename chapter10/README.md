```

# Parte 3: MCP con Modelos Locales {#parte-3}

---

## Capítulo 10: LM Studio como Cliente MCP {#cap-10}

### Que es LM Studio y por que usarlo

LM Studio es una aplicación de escritorio para ejecutar modelos de lenguaje localmente (GGUF, ONNX). Desde 2025 soporta MCP como host, permitiendote usar servidores MCP con modelos completamente offline.

> Ventajas:
> * Privacidad total: tus datos nunca salen de tu maquina
> * Sin costos por token
> * Latencia predecible
> * Funciona sin conexión a internet
> Limitaciones:
> * Capacidad de reasoning inferior a modelos cloud
> * Context window mas limitado
> * Function calling menos robusto en modelos pequenos

### Configurar LM Studio como MCP Host

En LM Studio, ve a Settings > MCP Servers y anade:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "python",
      "args": ["/ruta/a/servidor_filesystem.py"]
    },
    "sqlite": {
      "command": "python",
      "args": ["/ruta/a/servidor_sqlite.py"]
    }
  }
}
```

### Modelos locales compatibles

| Modelo | Tamano | Function Calling | Recomendacion |
| :---- | :---- | :---- | :---- |
| Qwen 2.5 | 7B-72B | Excelente | Mejor opcion para MCP |
| Llama 3.1 | 8B-70B | Bueno | Buen balance |
| Mistral Nemo | 12B | Bueno | Rápido y eficiente |
| Phi-4 | 14B | Regular | Para hardware limitado |

### Comparación: Claude Desktop vs LM Studio

| Caracteristica | Claude Desktop | LM Studio |
| :---- | :---- | :---- |
| Modelo | Claude (cloud) | Local (GGUF) |
| Costo | Por uso | Gratuito |
| Privacidad | Datos en cloud | 100% local |
| MCP Support | Nativo | Nativo desde 2025 |
| Rendimiento | Maximo | Depende de hardware |
| Offline | No | Si |

---