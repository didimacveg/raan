# Pasos para Diego

Todo lo que depende de ti, en orden. Los comandos son para una terminal **Ubuntu/WSL**: copia y
pega cada bloque tal cual. Actualizado el 14-11-2026 para el cambio de nombre a `raan`.

> **Lo primero que tienes que saber**
>
> 1. El repositorio pasa a llamarse **`raan`**. La web se muda de
>    `https://didimacveg.github.io/kessler/` a **`https://didimacveg.github.io/raan/`**. GitHub
>    Pages **no redirige** la dirección antigua: dejará de funcionar en cuanto renombres.
> 2. El PR #1 (la revisión) ya está fusionado y la web se desplegó una vez con el nombre antiguo.
> 3. La revisión **cambió las cifras de maniobras**: F1 0,81 / 0,74 / 0,52 (antes 0,79 / 0,73 /
>    0,51) sobre 803 eventos (antes 837). Las de colisiones no cambiaron. El motivo está en
>    `docs/DEFENSA.md`, pregunta 14.
> 4. Antes de publicar nada, **lee `docs/DEFENSA.md`**. Es tu guion.

---

## 1. Renombra el repositorio a `raan`, en este orden exacto (15 minutos)

Necesitas la herramienta `gh` con tu cuenta. Compruébalo con:

```bash
gh auth status
```

Si dice «command not found», instálala siguiendo la sección *Debian, Ubuntu Linux* de
<https://github.com/cli/cli/blob/trunk/docs/install_linux.md> y luego:

```bash
gh auth login
```

(Elige **GitHub.com**, **HTTPS**, **Login with a web browser**, y pega el código que te dé.)

### 1.1 Fusiona el pull request del cambio de nombre

1. Abre la lista de pull requests: <https://github.com/didimacveg/kessler/pulls> y entra en
   **«Prepare the site for the repository rename to raan»**.
2. Espera a que las comprobaciones **CI / python** y **CI / web** estén en verde (unos 3
   minutos). Si alguna sale en rojo, no fusiones: copia el error y pásamelo.
3. Clic en **Merge pull request** → **Confirm merge**.

Al fusionar arranca solo el workflow **Site and daily data**. **Esa ejecución todavía usa el
nombre antiguo** (`/kessler/`): no la tengas en cuenta, la repetirás en el paso 1.3.

### 1.2 Renombra el repositorio

```bash
gh repo rename raan -R didimacveg/kessler --yes
```

Si `gh` no reconoce `--yes`, tu versión es antigua: actualízala, o hazlo en la web:
<https://github.com/didimacveg/kessler/settings> → **Repository name** → escribe `raan` →
**Rename**.

Desde este momento `https://didimacveg.github.io/kessler/` deja de funcionar. Los enlaces a
`github.com/didimacveg/kessler` (código, issues, `git clone`) sí redirigen solos.

### 1.3 Relanza el workflow y comprueba que usa `/raan/`

Lánzalo a mano para que la web se compile con el nombre nuevo:

```bash
gh workflow run pages.yml -R didimacveg/raan
```

Espera unos segundos y síguelo hasta el final (tarda unos 4 minutos):

```bash
sleep 10 && gh run watch --exit-status -R didimacveg/raan $(gh run list -R didimacveg/raan -w pages.yml -e workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
```

Tiene que acabar con los tres trabajos (`build`, `archive`, `deploy`) en verde; `archive` puede
salir como *skipped* si CelesTrak no dio datos nuevos, y no pasa nada. Comprueba la ruta base:

```bash
gh run view --log -R didimacveg/raan $(gh run list -R didimacveg/raan -w pages.yml -e workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId') | grep "base path"
```

Debe imprimir `base path: /raan/`. Si imprime `base path: ./`, el workflow no pudo leer la
configuración de Pages; la web funciona igual (con rutas relativas), pero pásame el registro.

También puedes verlo en la web: <https://github.com/didimacveg/raan/actions/workflows/pages.yml>.

**Si algo sale en amarillo o rojo:**

| Qué ves | Qué significa | Qué hacer |
|---|---|---|
| Aviso amarillo «CelesTrak data not refreshed» | CelesTrak rechazó la descarga (pasa a veces desde GitHub). Se publica la instantánea anterior. | Nada. Mañana lo intenta otra vez. |
| `deploy` en rojo con «Pages is not enabled» o similar | Pages se desactivó. | <https://github.com/didimacveg/raan/settings/pages> → **Source: GitHub Actions** → **Re-run all jobs**. |
| `archive` en rojo | No pudo guardar la copia diaria en la rama `data`. La web se publica igual. | Pásame el error. Como apaño: <https://github.com/didimacveg/raan/settings/actions> → **Workflow permissions** → **Read and write permissions** → **Save**, y relanza. |
| `build` en rojo | Fallo real. | Pásame el registro. |

### 1.4 Abre la dirección nueva

Abre **<https://didimacveg.github.io/raan/>**. Comprueba:

1. El globo aparece en unos segundos (si se queda en blanco, algún recurso no carga: abre la
   consola con `F12` → pestaña **Console** y pásame los errores en rojo).
2. Las cinco páginas del menú cargan sus gráficos.
3. El PDF abre: <https://didimacveg.github.io/raan/RAAN_technical_report.pdf>.

A partir de ahí la web se actualiza sola cada día a las 05:17 UTC.

GitHub desactiva los workflows programados si el repositorio pasa 60 días sin actividad. Si
ocurre, te avisa por correo y se reactiva con un clic.

## 2. Decide qué hacer con tu correo en el historial (2 minutos)

El primer commit del repositorio («Initial commit») lleva tu correo personal de Gmail como
autor. Si haces público el repositorio, cualquiera puede verlo. No es una contraseña ni un
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

Otra cosa que verás en el historial: los commits hechos por la IA en sesiones anteriores
terminan con una línea `Claude-Session: https://claude.ai/code/session_…`. Son enlaces a
sesiones privadas tuyas; nadie más puede abrirlas. No hay claves, contraseñas ni tokens en
ningún commit.

## 3. Haz público el repositorio (2 minutos)

Ahora mismo el repositorio es **privado**. Para que una universidad o una empresa pueda ver el
código que enlazas desde la web, el README y LinkedIn, tiene que ser público:
<https://github.com/didimacveg/raan/settings> → baja hasta **Danger Zone** → **Change
visibility** → **Change to public** → confirma. Hazlo después del paso 2 si vas a limpiar el
historial.

## 4. Comprueba la web en tu portátil y en tu móvil (15 minutos, importante)

Solo se ha podido medir en un navegador **sin tarjeta gráfica**. Ahí va a unos 30 fps en modo
ligero (antes de la optimización, 14; en una pantalla de alta densidad, 6 → 28; en móvil
simulado, 13 → 54). En un equipo real debería ir mejor, pero **no está medido**.

1. Abre <https://didimacveg.github.io/raan/?fps=1> en Chrome en tu portátil. Abajo a la
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
cd ~/raan/web && npm run build && (npx vite preview --port 4173 &) && sleep 3 && node scripts/perf.cjs
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
https://github.com/didimacveg/raan

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

Solo cuando la web esté desplegada con el nombre nuevo (paso 1) y hayas hecho el paso 5.

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
cd ~ && git clone https://github.com/didimacveg/raan.git && cd raan && make setup && make data && make test
```

Si ya lo habías clonado antes con el nombre antiguo (carpeta `~/kessler`), no hace falta volver
a descargarlo: cambia el nombre de la carpeta y la dirección del repositorio remoto.

```bash
mv ~/kessler ~/raan && cd ~/raan && git remote set-url origin https://github.com/didimacveg/raan.git && git pull
```

Si ya tenías creado el entorno de Python (`.venv`), recréalo tras mover la carpeta, porque guarda
la ruta antigua:

```bash
cd ~/raan && rm -rf .venv && make setup
```

Ver la web en local:

```bash
cd ~/raan/web && npm run dev
```

Abre <http://localhost:5173>. Para parar: `Ctrl + C`.

Rehacer todos los resultados desde cero (unos 15 minutos):

```bash
cd ~/raan && make reproduce
```

Tienen que salir las mismas cifras que en la tabla de `docs/DEFENSA.md`. Hacerlo tú una vez es
la mejor manera de poder decir «lo he reproducido yo».

Comprobar tú mismo la cifra de la ESA sin fiarte del código del proyecto (30 segundos):

```bash
cd ~/raan && .venv/bin/python - <<'EOF'
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
cd ~/raan && .venv/bin/python -m raan.collision.replay_bug
```

Regenerar imágenes y vídeos de LinkedIn:

```bash
cd ~/raan/web && npm install -D playwright && npx playwright install chromium && npm run build && (npx vite preview --port 4173 &) && sleep 3 && BASE=http://localhost:4173/ node scripts/content.cjs all
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
cd ~/raan && cp .env.example .env && nano .env
```

   Pega la clave detrás de `ANTHROPIC_API_KEY=`, guarda con `Ctrl + O`, `Enter`, `Ctrl + X`.
   El fichero `.env` está en `.gitignore`: no se sube. **Nunca pegues la clave en otro sitio.**

```bash
.venv/bin/pip install anthropic && set -a && . ./.env && set +a && make intel
```

3. Para el informe diario en GitHub:
   <https://github.com/didimacveg/raan/settings/secrets/actions> → **New repository secret**
   → Name: `ANTHROPIC_API_KEY` → Secret: tu clave → **Add secret**.

## 10. Opcional: decisiones tomadas por ti y cómo deshacerlas

Todas están en `docs/DECISIONS.md`. Las que más te pueden importar:

* **Nombre RAAN → KESSLER.** Cambia el nombre en `web/src/brand.ts` y `raan/brand.py`, y luego:

```bash
cd ~/raan && grep -rl "RAAN" README.md content web/index.html raan/report | xargs sed -i 's/RAAN/KESSLER/g'
```

  Después `make reproduce` y regenera las imágenes (paso 8).
* **Volver a renombrar el repositorio** algún día: cambia solo `REPO_NAME` en `raan/brand.py`
  y `repoName` en `web/src/brand.ts` (de ahí salen las URL del README de la web, del informe y
  del PDF), y las URL escritas a mano en `README.md`, `content/CALENDARIO.md` y este fichero.
  La ruta base de la web no hay que tocarla: el workflow se la pregunta a GitHub Pages en cada
  despliegue. Y repite los pasos 1.1–1.4.
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
