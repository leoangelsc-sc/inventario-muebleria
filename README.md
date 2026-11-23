# Inventario Mueblería

App web para llevar el inventario de la mueblería: tablero, buscador, registro de movimientos (ventas, compras, traspasos, producción, mermas), conteo físico e historial. Funciona en celular y computadora.

- **Frontend:** HTML + JavaScript sin compilación (se publica tal cual en Vercel).
- **Base de datos e inicio de sesión:** Supabase (PostgreSQL).
- **Catálogo inicial:** 167 artículos tomados de `invetario_muebleria.xlsx` y `Taller.xlsx`.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La página (diseño y estructura) |
| `app.js` | La lógica de la app |
| `config.js` | **Aquí van la URL y la clave pública de tu Supabase** |
| `vendor/` | Librería oficial de Supabase (v2.45.4), incluida para no depender de otro servidor |
| `supabase/01_esquema.sql` | Tablas, reglas de seguridad y cálculo de existencias |
| `supabase/02_catalogo.sql` | Los 167 artículos iniciales |

## Puesta en marcha (una sola vez, ~15 minutos)

> Los nombres de los botones en Supabase y Vercel pueden cambiar un poco con el tiempo.

### 1. Supabase: crear la base de datos

1. Entra a <https://supabase.com>, crea tu cuenta (puedes usar tu GitHub) y da clic en **New project**.
2. Nombre: `inventario-muebleria`. Escribe una contraseña de base de datos y **guárdala**. Región: la más cercana a México (por ejemplo, una de Estados Unidos).
3. Cuando termine de crearse, ve a **SQL Editor → New query**, pega todo el contenido de `supabase/01_esquema.sql` y da **Run**.
4. Abre otra consulta, pega `supabase/02_catalogo.sql` y da **Run**. Deben quedar 167 artículos.

### 2. Supabase: usuarios

1. **Authentication → Sign In / Providers** (o **Settings**): desactiva **Allow new users to sign up**. Así nadie se puede registrar por su cuenta.
2. **Authentication → Users → Add user → Create new user**: escribe el correo y una contraseña para cada persona del personal y marca **Auto Confirm User**.

Cualquier usuario con sesión iniciada puede ver y registrar. Si alguien deja de trabajar en la mueblería, bórralo o bloquéalo en esa misma pantalla.

### 3. Conectar la app con Supabase

1. En Supabase da clic en **Connect** (o **Project Settings → API**) y copia:
   - **Project URL** (algo como `https://abcdefghijkl.supabase.co`)
   - **anon / publishable key**
2. En GitHub abre `config.js`, da clic en el lápiz ✏️, pega los dos datos entre las comillas y da **Commit changes**.

> La clave *anon/publishable* es pública por diseño: lo que protege los datos es el inicio de sesión y las reglas de la base de datos. **Nunca** pongas la clave *service_role* / *secret*.

### 4. Vercel: publicar la página

1. Entra a <https://vercel.com> y crea tu cuenta **con GitHub**.
2. **Add New → Project**, elige el repositorio `inventario-muebleria` y da **Import**.
3. Framework Preset: **Other**. No cambies nada más y da **Deploy**.
4. Te dará una dirección como `https://inventario-muebleria.vercel.app`. Esa es la que compartes.

Cada vez que cambies algo en GitHub, Vercel vuelve a publicar solo en menos de un minuto.

### 5. Último ajuste en Supabase

**Authentication → URL Configuration → Site URL**: pega la dirección de Vercel. Sirve para que el enlace de "Olvidé mi contraseña" regrese a tu app.

## Cómo funciona

- **Existencias** = existencia de arranque + todos los movimientos no anulados. Se calculan en la base de datos (vista `existencias`).
- **Los movimientos no se editan ni se borran.** Si hubo un error se **anulan** desde Historial; queda registrado quién y cuándo.
- **Inventario físico:** eliges la ubicación, capturas lo contado y la app genera los ajustes por diferencia. La captura se guarda en el navegador hasta que la confirmas.
- **Tiempo real:** si alguien registra algo, los demás lo ven al momento.

## Pendientes antes de usarla en serio

1. Haz un **conteo físico** en la sección Inventario: las existencias de arranque vienen de los Excel originales, que tenían datos con decimales y números repetidos.
2. Captura **stock mínimo, costo y precio** en la ficha de cada producto.

## Planes gratuitos: lo que hay que saber

- **Supabase (plan gratis):** un proyecto que no se usa por varios días puede pausarse; se reactiva desde el panel. El plan gratis no incluye respaldos automáticos descargables: usa **Descargar existencias** y **Descargar movimientos** de vez en cuando. Revisa las condiciones actuales en <https://supabase.com/pricing>.
- **Vercel (plan Hobby):** suficiente para esta página. Revisa sus condiciones de uso comercial en <https://vercel.com/pricing>.
