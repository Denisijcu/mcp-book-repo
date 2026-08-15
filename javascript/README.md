# Los mismos servidores, en JavaScript

El libro construye sus servidores en **Python**. Esta carpeta contiene los
mismos servidores implementados en **Node.js**.

No es una traducción línea por línea: son implementaciones independientes que
resuelven el mismo problema con las herramientas del ecosistema JavaScript.
El diseño es idéntico —las mismas jaulas, las mismas validaciones, los mismos
principios— pero el código es idiomático de Node.

Si trabajas en Node y el libro te está costando por el lenguaje, lee el
capítulo y luego mira aquí.

---

## Qué carpeta corresponde a qué capítulo

| Carpeta | Capítulo | Qué hace | Fichero principal |
|---|---|---|---|
| `manager-files/` | 5 | Sistema de archivos con sandbox y validación de rutas | `fs_server.js` |
| `seguridad/` | 5 y 16 | Hardening. Incluye `sala-prohibida/` para probar la evasión | `secure_server.js` |
| `database-csv/` | 6 | Base de datos sobre archivos CSV | `csv_server.js` |
| `database-sqlite/` | 6 | SQLite en modo solo lectura | `sqlite_server.js` |
| `api-externa/` | 7 | APIs externas: clima, Bitcoin, HTTP genérico | `api_server.js` |
| `google-mcp/` | 8 | Google Workspace vía Apps Script | `server.js` |

El servidor de `extras/automatizacion/` no tiene capítulo: procesa CSV y
genera notificaciones locales.

---

## Poner uno en marcha

```bash
cd javascript/manager-files
npm install
node fs_server.js
```

Para depurarlo sin conectar ningún modelo:

```bash
npx @modelcontextprotocol/inspector node fs_server.js
```

---

## Los que necesitan claves

Dos servidores leen configuración de un `.env`. En cada uno hay un
`.env.example` con las claves vacías:

```bash
cd javascript/api-externa
cp .env.example .env
```

| Carpeta | Variable | De dónde sale |
|---|---|---|
| `api-externa/` | `OPENWEATHER_API_KEY` | Cuenta gratuita en `openweathermap.org` |
| `google-mcp/` | `GOOGLE_APP_URL` | Tu despliegue de Apps Script, la URL que termina en `/exec` |

> **Ninguno de los dos tiene valor por defecto, y es a propósito.**
>
> Un servidor que arranca con una clave embebida como respaldo parece más
> cómodo, hasta que esa clave acaba publicada en un repositorio. Aquí, si
> falta la variable, el servidor se detiene y te lo dice. Un fallo ruidoso de
> configuración es mejor que un arranque silencioso con la clave de otro.

---

## Dos diferencias reales con la versión en Python

**`is_relative_to()` no existe en Node.** El capítulo 5 valida la jaula con
`Path.is_relative_to()`, disponible desde Python 3.9. En JavaScript hay que
resolver ambas rutas con `path.resolve()` y comparar con cuidado: `startsWith`
a secas aprueba `/home/user-malicioso` cuando la jaula es `/home/user`. La
comparación tiene que ir sobre el separador de directorio, no sobre el texto.

**Los esquemas se declaran a mano.** La versión Python usa decoradores que
derivan el `inputSchema` de la firma de la función. En Node se escribe el
objeto JSON Schema completo. Es más verboso y más fácil de desincronizar con
el código: si cambias un parámetro, acuérdate de cambiar el esquema.

---

## Nota sobre el origen

Estos servidores son de una etapa anterior del libro, cuando el material
estaba en JavaScript. Funcionan y están probados, pero **el texto del libro
explica la versión en Python**. Si encuentras una diferencia de
comportamiento, la de Python es la que manda.
