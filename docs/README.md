# Documentación funcional — Carrera de la Muerte

Esta documentación describe la aplicación autónoma servida desde `../index.html`. Los datos se guardan en `localStorage` del navegador. El modelo relacional documenta la estructura lógica equivalente; la aplicación no requiere un servidor SQL.

## Contenido

- [Requisitos funcionales](requisitos-funcionales.md)
- [Casos de uso](casos-de-uso.md)
- [Modelo relacional](modelo-relacional.md)

## Persistencia

El navegador guarda pilotos en `cdm_racers`, el estado del cronómetro en `cdm_clock` y las vueltas en `cdm_laps`. El reloj en marcha persiste su instante de inicio, por lo que sigue avanzando aunque se cierre la pestaña. Los datos son locales al navegador y origen; borrar sus datos elimina esta información.
