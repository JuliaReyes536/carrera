# Casos de uso de carreras a pie

## Preparar una competencia

El administrador registra corredores con nombre completo, equipo y categoría. Crea una carrera, configura la distancia real del circuito, establece la modalidad e inscribe personas con dorsales diferentes. El sistema valida que las personas estén activas y que no haya duplicados.

## Capturar vueltas

El operador inicia la carrera con al menos dos personas. Cuando un corredor cruza la línea de control, registra su vuelta. El servidor captura la marca acumulada, calcula la duración y actualiza posiciones, distancia y ritmo. Pausar impide nuevas capturas hasta reanudar.

## Gestionar una incidencia

El operador selecciona al corredor, elige el tipo de sanción o retiro y explica el motivo. El sistema registra al responsable y recalcula la clasificación. Un corredor excluido no puede registrar vueltas nuevas.

## Corregir un registro

El administrador introduce una marca coherente o anula la vuelta, siempre con justificación. Se conserva evidencia y se recalculan los parciales siguientes. Los resultados finalizados necesitan reapertura autorizada; las carreras archivadas quedan cerradas.

## Publicar resultados

El operador finaliza la carrera. El sistema detiene el reloj y calcula la clasificación según las reglas. Un empate con vueltas exige resolución justificada del administrador. Se muestran ganador y podio cuando se cumplen las condiciones de victoria, y pueden exportarse PDF/CSV.

## Consultar como espectador

Cualquier persona abre la vista pública y selecciona una competencia. Consulta el cronómetro, los corredores, los dorsales y los tiempos sin disponer de controles de escritura.

## Proteger la información

El administrador descarga un respaldo consistente. Para restaurarlo, aporta un archivo válido, motivo y confirmación. El sistema conserva una copia previa y cierra las sesiones después de restaurar.
