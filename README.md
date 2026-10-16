# Mi Boutique — App Android de ventas, caja e inventario

Aplicación móvil para un pequeño negocio de ropa, construida con **Vite + JavaScript** y empaquetada para Android con **Capacitor 8**. Funciona sin conexión: todos los datos se guardan en el propio teléfono.

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| **Primer uso** | Asistente que crea la tienda y la cuenta de administración (PIN de 8 dígitos con confirmación). Opción de cargar prendas de ejemplo. |
| **Ingreso** | Selección de usuaria con tarjetas y teclado numérico propio. Bloqueo de 30 s tras 5 intentos fallidos. PIN cifrados (SHA-256 con sal). |
| **Vender** | Catálogo con búsqueda, filtros por categoría, indicador de stock bajo, barra flotante del carrito. Descuento en S/ o %, pago en efectivo o Yape/Plin, **cálculo de vuelto** con montos rápidos y foto opcional del comprobante. |
| **Caja** | Apertura con conteo opcional de billetes y monedas, saldo esperado en tiempo real, registro de gastos con sugerencias y alerta si exceden el efectivo, cierre con indicador de **sobrante / faltante**. |
| **Historial** | Filtros Hoy / Ayer / 7 días / Todo / fecha, por turno; KPIs animados; detalle de ventas, turnos y gastos. El administrador puede anular ventas (devuelve stock), corregir cierres y editar gastos. |
| **Stock** (admin) | Alta y edición de prendas, ajuste rápido de stock, filtros de stock bajo y agotadas, valor total del inventario. |
| **Equipo** (admin) | Alta de vendedoras (PIN 4) y administradores (PIN 8), cambio de PIN y rol, protección para no eliminar al último administrador. |
| **Ajustes** | Nombre de la tienda, exportar respaldo `.json` (menú Compartir de Android) y restaurarlo. |

Detalles nativos: botón Atrás de Android cierra hojas y regresa a «Vender», vibración háptica, barra de estado clara, icono y pantalla de inicio propios.

## Requisitos

- Node.js 20 o superior
- Android Studio (Ladybug o superior) con JDK 21 y Android SDK 36

## Compilar en tu computadora

```bash
npm install
npm run android:sync      # compila la web y la copia al proyecto Android
npm run android:open      # abre Android Studio
```

En Android Studio: **Run ▶** con el teléfono conectado (depuración USB activada), o **Build › Build APK(s)** para obtener `app-debug.apk`.

Para publicar en Play Store: **Build › Generate Signed App Bundle** y crea tu propia llave (guárdala fuera del repositorio).

## Compilar sin Android Studio (GitHub)

El proyecto incluye `.github/workflows/android.yml`. Sube la carpeta a un repositorio de GitHub; en la pestaña **Actions** se generará el APK y podrás descargarlo desde los *artifacts* del flujo de trabajo.

## Probar en el navegador

```bash
npm run dev
```

## Estructura

```
src/main.js     Pantallas, flujo y lógica de negocio
src/store.js    Persistencia (Preferences + Filesystem), PIN, respaldo
src/ui.js       Hojas inferiores, diálogos, toasts, iconos, hápticos
src/styles.css  Sistema de diseño (tokens, componentes, animaciones)
android/        Proyecto nativo generado por Capacitor
assets/         Fuente del icono y splash (npx @capacitor/assets generate)
```

## Notas

- Si existen datos del prototipo HTML en el mismo navegador, se migran automáticamente la primera vez.
- Las fechas se registran en hora local (el prototipo usaba UTC, lo que movía al día siguiente las ventas posteriores a las 7 p. m.).
- Recomendación operativa: exportar un respaldo cada semana, pues los datos residen únicamente en el teléfono.
