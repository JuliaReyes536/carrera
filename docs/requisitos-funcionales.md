# Requisitos funcionales

| ID | Requisito | Criterio observable |
|---|---|---|
| RF-01 | Registrar piloto | Capturar nombre, alias y número; el nuevo piloto inicia como activo. |
| RF-02 | Validar datos | Exigir los tres campos y aceptar números de corredor entre 0 y 999, únicos entre los pilotos. |
| RF-03 | Consultar participantes | Mostrar una tarjeta por piloto con sus datos, estado y controles. |
| RF-04 | Consultar estadísticas | Mostrar total registrado, activos y eliminados; actualizar tras cada cambio. |
| RF-05 | Cambiar estado | Permitir activo, eliminado, penalizado y ganador; reflejar el cambio en estadísticas y orden. |
| RF-06 | Ordenar participantes | Presentar activos, penalizados, ganadores y eliminados, en ese orden. |
| RF-07 | Editar piloto | Modificar sus datos y conservar su estado e historial de vueltas. |
| RF-08 | Eliminar piloto | Pedir confirmación y eliminarlo permanentemente, junto con su historial de vueltas. |
| RF-09 | Controlar cronómetro | Iniciar, pausar, reanudar implícitamente con Iniciar y reiniciar el tiempo global. |
| RF-10 | Registrar vuelta | Capturar el tiempo transcurrido del cronómetro global al pulsar el botón del piloto y mostrar el historial en su tarjeta. |
| RF-11 | Persistir sesión | Conservar pilotos, vueltas y estado/tiempo del reloj después de recargar o cerrar la pestaña, mediante LocalStorage. |
| RF-12 | Adaptar interfaz | Permitir uso en móviles y escritorio, con controles accesibles por teclado y animación reducida si así lo prefiere el sistema. |
| RF-13 | Simular posiciones | Mostrar a los corredores en una ruta ovalada; sus posiciones avanzan según el tiempo del cronómetro y ritmos simulados. |

## Reglas de negocio

- Cada número de corredor identifica como máximo a un piloto.
- Los pilotos nuevos comienzan en estado `activo`.
- El contador de eliminados cuenta pilotos con estado `eliminado`; borrar un piloto reduce el total.
- Una vuelta es una marca del tiempo global acumulado, no un intervalo calculado entre dos vueltas.
- La ruta muestra una simulación ilustrativa basada en el cronómetro y el número de corredor; no usa GPS ni datos de ubicación reales.
- Reiniciar el cronómetro no borra los registros de vueltas existentes.
- El reloj avanza mientras está iniciado, incluso con la página cerrada, porque se calcula desde una marca de tiempo persistida.
