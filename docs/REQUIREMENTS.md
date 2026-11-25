# Alcance de carreras a pie

Carrera de la Muerte administra competencias entre personas. La adaptación conserva autenticación, cronometraje, clasificación, historial y auditoría, y define a los participantes como corredores con dorsales. La especificación funcional vigente se ajusta a esta indicación del usuario.

## Funciones

- Registrar personas con nombre completo, equipo o club opcional, categoría y estado.
- Buscar corredores por nombre, equipo, categoría o dorsal utilizado en una competencia.
- Crear carreras por vueltas, contrarreloj, eliminación o resistencia y configurar la longitud real de la vuelta.
- Inscribir corredores sin duplicar persona ni dorsal dentro de una carrera.
- Requerir al menos dos personas habilitadas para iniciar.
- Controlar cronómetro de servidor con pausas, reanudación e intentos independientes.
- Registrar marcas y parciales, calcular vueltas válidas, mejor vuelta, promedio, distancia y ritmo por kilómetro.
- Rechazar capturas en pausa o cierre, duplicadas o de participantes excluidos.
- Aplicar sanciones justificadas, retiros, eliminaciones y descalificaciones.
- Resolver empates con autorización, oficializar resultados, consultar podio y conservar historial.
- Exportar PDF/CSV de corredores, dorsales y tiempos.
- Administrar usuarios, permisos, auditoría, configuración y respaldos.
- Adaptar datos anteriores preservando evidencia y sin inferir distancias históricas.

## Fuera del alcance

No se integran sensores, chips de cronometraje, RFID, GPS ni telemetría. Los cruces se capturan manualmente. No hay cuentas individuales para corredores ni captura de datos médicos o de identidad oficial.

## Criterios de aceptación

La organización puede registrar personas, crear una carrera, asignar dorsales únicos, capturar vueltas y publicar resultados sin requerir un catálogo de equipamiento. Las distancias y ritmos corresponden a la longitud configurada. Los permisos se verifican en servidor y el historial persiste tras reinicios.

Las metas de disponibilidad, carga, recuperación y accesibilidad de la propuesta necesitan pruebas específicas. Los respaldos periódicos y HTTPS requieren configuración operativa; no se presentan como funciones certificadas.
