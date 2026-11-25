# Requisitos funcionales de carreras a pie

| Área | Requisitos |
| --- | --- |
| Acceso | Configuración inicial, login/logout, contraseñas, sesiones y roles |
| Corredores | Alta, edición, búsqueda, equipo/club, categoría, baja lógica y reactivación |
| Competencias | Fecha, modalidad, distancia de vuelta, vueltas objetivo o duración |
| Inscripciones | Corredor activo y dorsal únicos por competencia |
| Cronometraje | Inicio, pausa, reanudación, reinicio por intento y recuperación |
| Vueltas | Marca de servidor, duración, idempotencia, corrección y anulación con evidencia |
| Estadísticas | Vueltas válidas, mejor vuelta, promedio, distancia y ritmo min/km |
| Incidencias | Tiempo añadido, retiro, eliminación, descalificación y motivo |
| Clasificación | Orden, desempate autorizado, resultados oficiales y podio |
| Consulta | Dashboard, clasificación pública, filtros e historial |
| Reportes | PDF y CSV identificados por corredor y dorsal |
| Administración | Usuarios, permisos, auditoría, configuración y respaldo/restauración |

Las carreras necesitan dos participantes habilitados para iniciar. La captura de vueltas exige estado en ejecución. Las reglas solo se modifican antes del inicio y las correcciones de resultados requieren permisos y justificación.
