# Pasos para Diego

Todo lo que depende de ti, en orden. Los comandos son para una terminal **Ubuntu/WSL**: copia y
pega cada bloque tal cual. Actualizado el 12-11-2026 tras la revisión independiente.

> **Lo primero que tienes que saber**
>
> 1. El proyecto se llama **RAAN** en la web; el repositorio sigue llamándose `kessler`.
> 2. La revisión **cambió las cifras de maniobras**: F1 0,81 / 0,74 / 0,52 (antes 0,79 / 0,73 /
>    0,51) sobre 803 eventos (antes 837). Las de colisiones no cambiaron. El motivo está en
>    `docs/DEFENSA.md`, pregunta 14.
> 3. Antes de publicar nada, **lee `docs/DEFENSA.md`**. Es tu guion.
> 4. El trabajo revisado está en la rama **`claude/raan-pre-launch-review-8qqz4h`**. Contiene
>    todo lo de `claude/epic-volta-jjkxwt` más las correcciones. Fusiona esta, no la otra.

Calendario recomendado: pasos 1 a 5 **hoy o mañana**; paso 6 el fin de semana; paso 7 el lunes.

---

## 1. Decide qué hacer con tu correo en el historial (2 minutos)

El primer commit del repositorio («Initial commit») lleva tu correo personal de Gmail como
autor. Al hacer público el repositorio, cualquiera puede verlo. No es una contraseña ni un
riesgo grave, pero puede traerte correo no deseado.

- **Si no te importa:** no hagas nada.
- **Para que no ocurra en commits futuros** (recomendado en cualquier caso): abre
  <https://github.com/settings/emails>, marca **Keep my email addresses private** y **Block
  command line pushes that expose my email**.
- **Para quitarlo del historial** hay que reescribir ese primer commit, y eso se hace mejor
  antes de hacer público el repositorio. No lo he hecho porque reescribir `main` es una
  decisión tuya y no tiene vuelta atrás. Si quieres hacerlo, pídemelo en una sesión nueva
  diciendo exactamente: «reescribe el autor del commit inicial de main con mi correo noreply
  de GitHub». No lo intentes con recetas de internet: es fácil estropear el historial.

Otra cosa que verás en el historial: cada commit de la IA termina con una línea
`Claude-Session: https://claude.ai/code/session_…`. Son enlaces a sesiones privadas tuyas; nadie
más puede abrirlas. No hay claves, contraseñas ni tokens en ningún commit (comprobado en todo
el historial).

## 2. Haz público el repositorio y activa Pages, en este orden (5 minutos)

El orden importa: si fusionas antes de activar Pages, el primer despliegue falla (no pasa nada,
se relanza, pero mejor evitarlo).

1. Abre <https://github.com/didimacveg/kessler/settings>, baja hasta **Danger Zone** →
   **Change visibility** → **Change to public** → confirma.
2. Abre <https://github.com/didimacveg/kessler/settings/pages>. En **Build and deployment →
   Source**, elige **GitHub Actions** (no «Deploy from a branch»).

No hace falta tocar los permisos de Actions: el workflow pide él mismo los mínimos que necesita.

## 3. Fusiona el trabajo en `main` (5 minutos)

1. Abre
   <https://github.com/didimacveg/kessler/pull/new/claude/raan-pre-launch-review-8qqz4h>
2. Clic en **Create pull request**.
3. Espera a que aparezcan dos comprobaciones en verde (**CI / python** y **CI / web**), unos 3
   minutos. Si alguna sale en rojo, no fusiones: copia el error y pásamelo.
4. Clic en **Merge pull request** → **Confirm merge**.
5. Al fusionar, el workflow **Site and daily data** arranca solo. Míralo en
   <https://github.com/didimacveg/kessler/actions/workflows/pages.yml>. Tiene tres trabajos:
   `build`, `archive` y `deploy`. Tarda unos 4 minutos.
6. Cuando `deploy` esté en verde, la web está en **<https://didimacveg.github.io/kessler/>**

**Si algo sale en amarillo o rojo:**

| Qué ves | Qué significa | Qué hacer |
|---|---|---|
| Aviso amarillo «CelesTrak data not refreshed» | CelesTrak rechazó la descarga (pasa a veces desde GitHub). Se publica la instantánea anterior. | Nada. Mañana lo intenta otra vez. |
| `deploy` en rojo con «Pages is not enabled» o similar | El paso 2 no está hecho. | Haz el paso 2 y pulsa **Re-run all jobs**. |
| `archive` en rojo | No pudo guardar la copia diaria en la rama `data`. La web se publica igual. | Pásame el error. Como apaño: <https://github.com/didimacveg/kessler/settings/actions> → **Workflow permissions** → **Read and write permissions** → **Save**, y relanza. |
| `build` en rojo | Fallo real. | Pásame el registro. |

A partir de ahí se actualiza sola cada día a las 05:17 UTC y guarda una copia diaria de los
datos en la rama `data`.

> Este workflow **no se ha ejecutado nunca en GitHub**. Lo he ensayado en local, orden por
> orden, en un clon limpio (incluido el caso de descarga rechazada y dos días seguidos de
> archivo), pero la primera ejecución real tienes que mirarla tú.

GitHub desactiva los workflows programados si el repositorio pasa 60 días sin actividad. Si
ocurre, te avisa por correo y se reactiva con un clic.

## 4. Comprueba la web en tu portátil y en tu móvil (15 minutos, importante)

Solo se ha podido medir en un navegador **sin tarjeta gráfica**. Ahí va a unos 30 fps en modo
ligero (antes de la optimización, 14; en una pantalla de alta densidad, 6 → 28; en móvil
simulado, 13 → 54). En un equipo real debería ir mejor, pero **no está medido**.

1. Abre <https://didimacveg.github.io/kessler/?fps=1> en Chrome en tu portátil. Abajo a la
   derecha sale un contador con los fps y el «tier» de calidad. **Apunta los dos números.**
2. Si en el panel derecho aparece «Light mode», es que el modo ligero se ha activado solo.
   Pulsa **Full quality** y apunta los fps también así.
3. Haz clic en un punto: se abre la ficha con sus elementos, la fecha del dato y la fuente.
4. Mueve la barra de tiempo, cambia la velocidad, prueba los filtros y el buscador.
5. Repite el punto 1 en tu móvil.
6. Abre las otras cuatro páginas (Collision Lab, Maneuvers, Intelligence, Research) y el PDF.

Si los fps reales están por debajo de 30, dímelo con los números. Y hasta que lo midas, **no
digas en ningún sitio a cuántos fps va**.

Para medirlo tú en local (opcional, necesita el paso 8):

```bash
cd ~/kessler/web && npm run build && (npx vite preview --port 4173 &) && sleep 3 && node scripts/perf.cjs
```

## 5. Lee el dossier y los dos artículos (3 a 4 horas, lo más importante)

1. `docs/DEFENSA.md`, entero, con la web abierta.
2. El artículo de la ESA: <https://arxiv.org/abs/2008.03069> (resumen, sección 4 y sección 6).
3. El de Shorten: <https://arxiv.org/abs/2212.08662> (resumen e introducción).
4. Las 13 publicaciones de `content/CALENDARIO.md`. **Si hay una frase que no entiendes o que
   no dirías tú, cámbiala o quítala.** Están escritas para que todo lo que afirman sea verdad
   tal como ocurrió (por ejemplo, la 7 dice que la línea con el fallo la escribió la IA).

## 6. Escribe a David Shorten (10 minutos)

Su conjunto de datos de maniobras no tiene licencia. El proyecto no lo copia: lo descarga al
ejecutarse y solo publica series derivadas (ni siquiera las horas de las maniobras, solo entre
qué dos datos orbitales cae cada una). Aun así, lo correcto es preguntar. Es un correo corto y
además es un contacto. Busca su dirección en el artículo o en su perfil de GitHub
(<https://github.com/dpshorten>). Borrador:

```text
Subject: Use of your TLE benchmark dataset in a student project

Dear Dr Shorten,

I am a 17-year-old student in Madrid. I have used your TLE observation benchmark dataset
(arXiv:2212.08662) in an open student project on manoeuvre detection:
https://github.com/didimacveg/kessler

Your repository has no licence file, so I do not redistribute it. The project downloads it at
a pinned commit when it runs, and publishes only derived results: detections, scores, mean
semi-major axis series, and for each reported manoeuvre the pair of element-set epochs around
it. The dataset and your paper are cited on every page that uses them.

Would you be happy with that? If you would prefer something different, I will change it.

The project was built with substantial help from an AI coding assistant, which I state openly.

Thank you for publishing the benchmark.

Diego Macías Vega
```

Si contesta que no le parece bien, dímelo: se retira la página de maniobras hasta arreglarlo.

## 7. Programa la primera publicación (lunes 16, 10 minutos)

Solo cuando la web esté desplegada (paso 3) y hayas hecho el paso 5.

1. Abre `content/CALENDARIO.md` y lee «Antes de programar nada».
2. En LinkedIn: **Crear publicación** → pega el texto de la publicación 0 → icono de vídeo →
   sube `content/video/v1-catalogue.mp4`.
3. Clic en el **icono del reloj** → martes 17 de noviembre de 2026, 08:45 → **Siguiente** →
   **Programar**.
4. El primer comentario no se puede programar: ponlo a mano justo después de que se publique.
5. Programa las demás de una en una, la víspera, después de releerlas. No las dejes todas
   programadas: si alguien te corrige algo en la primera, querrás ajustar las siguientes.

Los vídeos `v1` y `v2` y las imágenes `00` y `03` son de la instantánea del 11 de noviembre
(20.152 objetos). La web mostrará la cifra del día. Es normal y los textos lo dicen.

## 8. Opcional: instala el proyecto en tu ordenador

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip git make ffmpeg
```

Node 22 (si `node --version` no dice v20 o superior):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

Descargar y preparar (unos 10 minutos; descarga 221 MB de la ESA):

```bash
cd ~ && git clone https://github.com/didimacveg/kessler.git && cd kessler && make setup && make data && make test
```

Ver la web en local:

```bash
cd ~/kessler/web && npm run dev
```

Abre <http://localhost:5173>. Para parar: `Ctrl + C`.

Rehacer todos los resultados desde cero (unos 15 minutos):

```bash
cd ~/kessler && make reproduce
```

Tienen que salir las mismas cifras que en la tabla de `docs/DEFENSA.md`. Hacerlo tú una vez es
la mejor manera de poder decir «lo he reproducido yo».

Comprobar tú mismo la cifra de la ESA sin fiarte del código del proyecto (30 segundos):

```bash
cd ~/kessler && .venv/bin/python - <<'EOF'
import pandas as pd, numpy as np
te = pd.read_csv("data/raw/cac/test_data.csv")
pr = pd.read_csv("data/raw/cac/test_data_private.csv")
ultimo = te.loc[te.groupby("event_id").time_to_tca.idxmin()].set_index("event_id").risk.sort_index()
real = pr.groupby("event_id").true_risk.first().sort_index()
y, p = real.values, np.where(ultimo.values < -6, -6.001, ultimo.values)
alto, pred = y >= -6, p >= -6
vp, fp, fn = (alto & pred).sum(), (~alto & pred).sum(), (alto & ~pred).sum()
P, R = vp / (vp + fp), vp / (vp + fn)
F2 = 5 * P * R / (4 * P + R)
mse = ((y[alto] - p[alto]) ** 2).mean()
print(f"L = {mse / F2:.3f}  MSE = {mse:.3f}  F2 = {F2:.3f}")
EOF
```

Debe imprimir `L = 0.694  MSE = 0.513  F2 = 0.739`.

Reproducir el bug de la publicación 7:

```bash
cd ~/kessler && .venv/bin/python -m raan.collision.replay_bug
```

Regenerar imágenes y vídeos de LinkedIn:

```bash
cd ~/kessler/web && npm install -D playwright && npx playwright install chromium && npm run build && (npx vite preview --port 4173 &) && sleep 3 && BASE=http://localhost:4173/ node scripts/content.cjs all
```

**No ejecutes `make catalog` más de una vez cada dos horas.** Es la política de CelesTrak y
bloquean a quien la incumple.

## 9. Opcional: informe redactado por Claude

Sin clave, el informe usa plantillas (mismos números). Con clave, Claude puede reescribir cada
párrafo y un verificador descarta cualquiera con un número que no esté en los datos.

**Esta ruta no se ha probado nunca con una clave real.** Si la activas, lee el primer informe
entero antes de fiarte, y no digas que el informe lo escribe una IA hasta haberlo visto.

1. Crea una clave en <https://console.anthropic.com/settings/keys>. Cuesta dinero por uso
   (céntimos por informe).
2. En local:

```bash
cd ~/kessler && cp .env.example .env && nano .env
```

   Pega la clave detrás de `ANTHROPIC_API_KEY=`, guarda con `Ctrl + O`, `Enter`, `Ctrl + X`.
   El fichero `.env` está en `.gitignore`: no se sube. **Nunca pegues la clave en otro sitio.**

```bash
.venv/bin/pip install anthropic && set -a && . ./.env && set +a && make intel
```

3. Para el informe diario en GitHub:
   <https://github.com/didimacveg/kessler/settings/secrets/actions> → **New repository secret**
   → Name: `ANTHROPIC_API_KEY` → Secret: tu clave → **Add secret**.

## 10. Opcional: decisiones tomadas por ti y cómo deshacerlas

Todas están en `docs/DECISIONS.md`. Las que más te pueden importar:

* **Nombre RAAN → KESSLER.** Cambia el nombre en `web/src/brand.ts` y `raan/brand.py`, y luego:

```bash
cd ~/kessler && grep -rl "RAAN" README.md content web/index.html raan/report | xargs sed -i 's/RAAN/KESSLER/g'
```

  Después `make reproduce` y regenera las imágenes (paso 8).
* **Renombrar el repositorio** (por ejemplo a `raan`):
  <https://github.com/didimacveg/kessler/settings> → **Repository name** → **Rename**. La web
  pasará a `https://didimacveg.github.io/raan/`; cambia ese enlace en `content/CALENDARIO.md`,
  `README.md`, `raan/brand.py` y `raan/intel/agents.py` (`SITE`).
* **La frase de la IA en cada publicación.** Mi consejo es que no la quites.
* **Catálogo completo (unos 35.000 objetos).** Hace falta una cuenta gratuita en
  <https://www.space-track.org/auth/createAccount>. No está implementado.
* **Entorno de Claude «kessler».** La primera sesión creó un entorno en la nube con acceso a
  celestrak.org, zenodo.org, arxiv.org, kelvins.esa.int, space-track.org, github.com,
  ids-doris.org y repository.tudelft.nl. Puedes borrarlo o editarlo en los ajustes de entornos
  de Claude Code.

## 11. Cosas que deberías hacer tú, no una IA

* **Reescribir tú mismo dos piezas**, aunque sea en un cuaderno aparte: la métrica L
  (`raan/collision/metrics.py`, función `score`, 20 líneas) y el escalón con medianas
  (`raan/maneuver/detect.py`, función `level_shift`, 20 líneas). Si eres capaz de escribirlas
  sin mirar, puedes defender el proyecto delante de cualquiera.
* **Leer la tesis de TU Delft** sobre detección de maniobras
  (<https://repository.tudelft.nl/record/uuid:9e4d886c-fef2-4632-a3bd-7df0486a5a51>). Ninguna
  de las dos sesiones pudo abrirla y es justo lo que te pueden preguntar allí.
* **Comprobar lo de «Alpha-5»** (la variante del TLE con una letra en el número de catálogo)
  en la documentación de Space-Track antes de mencionarlo. No está verificado.
* **Pedir a un profesor de Física o de Matemáticas que te haga las 20 preguntas** de
  `docs/DEFENSA.md` en voz alta.
