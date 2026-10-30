# Carrera de la Muerte — Arquitectura y documentación

## 1. Requerimientos funcionales
- Crear, consultar, editar y eliminar pilotos con nombre, alias, vehículo y número único.
- Cambiar el estado de un piloto: activo, penalizado, ganador o eliminado.
- Mostrar estadísticas por estado y total de vueltas; recalcularlas después de cada modificación o eliminación.
- Iniciar, pausar, reanudar y reiniciar un cronómetro global persistente.
- Registrar una vuelta con el tiempo acumulado exacto del cronómetro global calculado en el servidor.
- Consultar el historial de vueltas de cada piloto, editar sus tiempos y eliminar registros.
- Ordenar el dashboard automáticamente: activo → penalizado → ganador → eliminado.
- Persistir toda la información en SQLite sin LocalStorage.
- Validar entradas y presentar errores y confirmación antes de eliminar pilotos o reiniciar el reloj.

## 2. Casos de uso
### El administrador registra un piloto
Completa nombre, alias, vehículo y número. El servidor valida los campos y la unicidad del número, guarda al piloto como activo y devuelve su identificación. El dashboard actualiza tarjetas y estadísticas. Un número duplicado devuelve un error sin modificar datos.

### El administrador registra el tiempo de una vuelta
Pulsa «Registrar Vuelta». El servidor comprueba que existe el piloto, consulta el reloj global y guarda su tiempo acumulado en milisegundos junto con la fecha UTC. La tarjeta actualiza su historial. El tiempo representa una marca acumulada, no la duración individual de la vuelta. Se permite registrar con el reloj pausado.

### El sistema actualiza estadísticas al eliminar un piloto
El administrador confirma la eliminación. Una transacción SQLite elimina al piloto y, mediante la clave foránea con eliminación en cascada, sus vueltas. El cliente vuelve a consultar los datos y recalcula totales y estados.

### El administrador cambia el estado o controla el reloj
Un cambio de estado se valida en la API y provoca el reordenamiento automático del dashboard. Al pausar se consolida el tiempo transcurrido; al reanudar se guarda una nueva referencia temporal. Reiniciar pone a cero y pausa el reloj, conservando el historial de vueltas.

## 3. Modelo relacional (SQLite)
### Pilotos
| Campo | Tipo | Restricciones |
|---|---|---|
| id | INTEGER | PK autoincremental |
| nombre | TEXT | obligatorio, 1–100 caracteres |
| alias | TEXT | obligatorio, 1–100 caracteres |
| vehiculo | TEXT | obligatorio, 1–100 caracteres |
| numero | INTEGER | único, entre 0 y 999 |
| estado | TEXT | activo, penalizado, ganador o eliminado |

### Vueltas
| Campo | Tipo | Restricciones |
|---|---|---|
| id | INTEGER | PK autoincremental |
| piloto_id | INTEGER | FK a Pilotos.id, ON DELETE CASCADE |
| tiempo_registrado | INTEGER | milisegundos acumulados, >= 0 |
| fecha | TEXT | fecha UTC ISO 8601 |

### Cronometro
| Campo | Tipo | Restricciones |
|---|---|---|
| id | INTEGER | PK, singleton con valor 1 |
| tiempo_global | INTEGER | milisegundos consolidados, >= 0 |
| estado | TEXT | corriendo o pausado |
| iniciado_en | INTEGER | marca Unix en ms, nullable |

Pilotos tiene una relación uno a muchos con Vueltas. Cronometro es un registro global independiente compartido por todos los pilotos. `iniciado_en` permite recuperar el reloj tras reiniciar el servidor: mientras corre, tiempo actual = tiempo_global + (ahora − iniciado_en). El tiempo continúa transcurriendo con el servidor apagado. Se usa el reloj de pared del servidor; ajustes manuales de ese reloj pueden afectar el resultado. La API entrega `tiempo_global` ya calculado y `servidor_ahora`.

## 4. Arquitectura
Frontend React + TypeScript + Tailwind compilado con Vite; backend Express y better-sqlite3. La API valida entradas y SQLite aplica restricciones. El cliente consulta periódicamente el reloj y proyecta el tiempo entre consultas; el POST de vueltas siempre usa el tiempo del servidor. Las mutaciones del reloj y el registro de vueltas son transacciones síncronas. Base de datos local en backend/data/carrera.sqlite, excluida de Git.

## 5. API REST
Prefijo: http://localhost:3001/api. JSON en solicitudes y respuestas.

| Método | Ruta | Uso |
|---|---|---|
| GET | /health | disponibilidad |
| GET / POST | /pilotos | listar / crear |
| GET / PUT / DELETE | /pilotos/:id | consultar / editar / eliminar |
| GET / POST | /pilotos/:id/vueltas | historial / registrar marca actual del servidor (sin cuerpo) |
| PUT / DELETE | /vueltas/:id | editar tiempo_registrado / eliminar |
| GET | /cronometro | tiempo actual |
| POST | /cronometro | iniciar o reanudar (idempotente) |
| PUT | /cronometro | {"accion":"pausar"}, {"accion":"reanudar"} o {"accion":"reiniciar"} |

Crear piloto: `{"nombre":"Ana","alias":"Neon","vehiculo":"Interceptor","numero":7}`. PUT de piloto exige los mismos campos y `estado`. Respuestas 201 en creación, 204 en eliminación, 400 en validación, 404 si no existe, 409 para número duplicado. Errores: `{"error":"mensaje"}`.

## 6. Alcance y operación
Aplicación para administración local de confianza, sin autenticación. No exponer públicamente sin añadir autenticación, autorización y HTTPS. CORS permite por defecto http://localhost:5173; configurable mediante FRONTEND_ORIGIN. Un solo proceso y archivo SQLite sirven esta instalación. Copiar la base con el servidor detenido para respaldarla. Reiniciar el cronómetro no borra vueltas; eliminar un piloto sí borra las suyas.

Se conserva index.html como referencia histórica del original. La nueva aplicación se ejecuta desde frontend/ y no usa LocalStorage. Los registros del navegador antiguo no se importan automáticamente. Consultar README.md para instalación, pruebas y ejecución.
