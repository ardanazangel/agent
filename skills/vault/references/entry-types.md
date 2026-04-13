# Tipos de entradas — Guía de referencia

## El criterio fundamental

**Solo se guarda lo que no se puede deducir leyendo el proyecto.**

Si alguien nuevo puede llegar a la misma conclusión leyendo el código, los commits, el README o la documentación → no guardar.

---

## `issue` — Problema pendiente sin rastro en el código

No es un bug con un TODO en el código — eso ya está visible. Es un problema que existe pero no ha dejado ninguna marca en el proyecto.

**Guardar cuando:**
- Se deja algo roto intencionalmente por razones externas ("lo dejamos así porque el proveedor no lo soporta aún")
- Un fallo ocurre solo bajo condiciones de producción o datos reales específicos que no están en tests
- Hay una limitación conocida que nadie ha documentado

**No guardar:**
- Bugs con `TODO`, `FIXME` o issue en el tracker — ya están en el proyecto
- Errores evidentes que cualquiera vería leyendo el código

**Ejemplos válidos:**
- "El endpoint /export falla con más de 10k registros pero solo en el entorno del cliente, no en staging"
- "Dejamos la validación de email desactivada porque el cliente importó datos legacy con formatos inválidos"

---

## `pattern` — Error recurrente cuya causa no está documentada

No es "esto falla" — eso se ve en los logs. Es el contexto humano o de entorno que explica *por qué* sigue pasando.

**Guardar cuando:**
- Un error tiene una causa raíz que no es obvia y que ha aparecido más de una vez
- La solución existe pero no está en ningún sitio escrito
- El error depende de un comportamiento externo (librería, API, entorno) que no está documentado

**No guardar:**
- Errores que tienen documentación pública o que se explican solos con el stack trace
- Problemas que ya tienen tests que los cubren

**Ejemplos válidos:**
- "Cada vez que actualizamos la librería X, hay que hacer también Y — no está en su changelog"
- "El timeout de la API del banco se dispara los lunes por la mañana por procesos batch del proveedor"

---

## `architecture` — El *por qué* de una decisión, no la decisión en sí

La decisión se ve en el código. Lo que no se ve es la razón, especialmente si es externa al proyecto.

**Guardar cuando:**
- Se descartó una alternativa por razones de negocio, cliente o restricción externa que no están en ningún documento
- Una decisión técnica tiene una motivación humana o histórica que se perdería
- Hay una regla implícita sobre cómo se estructura el sistema que nunca se ha escrito

**No guardar:**
- Decisiones que son evidentes por la estructura de archivos o la tecnología elegida
- Arquitectura documentada en un ADR, README o wiki del proyecto

**Ejemplos válidos:**
- "Usamos polling en lugar de webhooks porque el servidor del cliente está detrás de un firewall corporativo sin IP fija"
- "No migramos a la v2 de la API porque el contrato con el cliente se negoció sobre la v1 y el cliente no quiere re-firmar"

---

## `convention` — Preferencias personales que nunca estarán escritas

No son convenciones de código — esas están en el linter o el README. Son preferencias del usuario sobre cómo trabajar juntos.

**Guardar cuando:**
- El usuario corrige el mismo patrón por segunda vez sin que haya una regla escrita que lo justifique
- Una preferencia personal influirá en cómo Claude debe comportarse en el futuro
- Hay una forma de trabajar implícita que el usuario da por sentada pero que Claude no puede inferir

**No guardar:**
- Convenciones que ya están en un linter, `.editorconfig`, README o guía de estilo
- Preferencias que son estándar del lenguaje o framework

**Ejemplos válidos:**
- "Prefiere que Claude no refactorice código que no está directamente relacionado con la tarea"
- "En este proyecto los mensajes de commit siempre van en inglés aunque el código tenga comentarios en español"
- "No le gusta que se añadan comentarios explicativos al código — prefiere que el código se explique solo"
