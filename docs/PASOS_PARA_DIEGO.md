# Pasos para Diego

Todo lo que depende de ti, en orden. Los comandos son para una terminal **Ubuntu/WSL**. Copia y
pega cada bloque tal cual.

> **Antes de nada, léete esto:** el proyecto se llama **RAAN** en la web, no KESSLER. El motivo
> está en `docs/RESEARCH.md` §5 (ya existe una librería `kessler` de ML para colisiones ligada a
> la ESA, una empresa y un satélite con ese nombre). Si prefieres volver a KESSLER, mira el paso 8.

---

## 1. Fusionar el trabajo en `main` (5 minutos)

Todo el trabajo está en la rama `claude/epic-volta-jjkxwt`. La web solo se despliega desde `main`.

1. Abre <https://github.com/didimacveg/kessler/pull/new/claude/epic-volta-jjkxwt>
2. Haz clic en el botón verde **Create pull request**.
3. Espera a que aparezcan dos comprobaciones verdes (**CI / python** y **CI / web**). Tardan unos
   3 minutos.
4. Haz clic en **Merge pull request** y luego en **Confirm merge**.

## 2. Hacer público el repositorio (si no lo es)

GitHub Pages gratis solo funciona con repositorios públicos.

1. Abre <https://github.com/didimacveg/kessler/settings>
2. Baja hasta el final, a **Danger Zone**.
3. Si pone «This repository is currently private»: clic en **Change visibility** →
   **Change to public** → confirma.

## 3. Activar GitHub Pages (2 minutos)

1. Abre <https://github.com/didimacveg/kessler/settings/pages>
2. En **Build and deployment → Source**, elige **GitHub Actions** (no «Deploy from a branch»).
3. Abre <https://github.com/didimacveg/kessler/actions/workflows/pages.yml>
4. Clic en **Run workflow** (a la derecha) → **Run workflow** (botón verde).
5. Espera 3–4 minutos. Cuando el círculo se ponga verde, la web está en
   **<https://didimacveg.github.io/kessler/>**

A partir de ahí se actualiza sola cada día a las 05:17 UTC (catálogo nuevo + informe nuevo) y
guarda una copia diaria de los datos en la rama `data`.

**Si el paso «Store today's snapshot» falla con un error de permisos:**
<https://github.com/didimacveg/kessler/settings/actions> → abajo, **Workflow permissions** →
marca **Read and write permissions** → **Save**. Vuelve a lanzar el workflow.

## 4. Comprobar la web en un portátil de verdad (10 minutos) — importante

Yo solo he podido probarla en un navegador sin tarjeta gráfica. Tú tienes que comprobar:

1. Abre <https://didimacveg.github.io/kessler/> en Chrome. El globo debe aparecer en 2–3 s.
2. Abre <https://didimacveg.github.io/kessler/?stress=30000&fps=1>. Abajo a la derecha sale un
   contador. **Apunta los fps.** El objetivo era 60 con 30.000 objetos. Si salen menos de 50,
   dímelo en la próxima sesión (hay margen para optimizar).
3. Haz clic en un punto: debe abrirse la ficha con sus elementos, la fecha del dato y la fuente.
4. Mueve la barra de tiempo, cambia la velocidad, prueba los filtros.
5. Ábrela en el móvil.

## 5. Programar la primera publicación

1. Abre `content/CALENDARIO.md` y lee las «Antes de programar nada».
2. En LinkedIn: **Crear publicación** → pega el texto de la publicación 0 → icono de vídeo → sube
   `content/video/v1-catalogue.mp4`.
3. Clic en el **icono del reloj** (abajo a la derecha, junto a «Publicar») → martes 17 de
   noviembre de 2026, 08:45 → **Siguiente** → **Programar**.
4. El primer comentario no se puede programar: ponlo a mano justo después de que se publique.
5. Repite con las demás cuando quieras; puedes dejarlas todas programadas.

**Lee cada publicación antes de programarla y asegúrate de que la entiendes y la puedes
defender.** Están escritas en primera persona. Si alguien de GMV te pregunta por el bootstrap o
por la mediana de tres TLEs, tienes que saber contestar. Empieza por `docs/RESEARCH.md` y el PDF.

## 6. Opcional: instalar el proyecto en tu ordenador

```bash
sudo apt update
```

```bash
sudo apt install -y python3-venv python3-pip git make ffmpeg
```

Node 22 (si `node --version` no dice v20 o superior):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt install -y nodejs
```

Descargar y preparar:

```bash
git clone https://github.com/didimacveg/kessler.git
```

```bash
cd kessler
```

```bash
make setup
```

```bash
make data
```

```bash
make test
```

Ver la web en local:

```bash
cd web && npm run dev
```

Abre <http://localhost:5173>. Para parar: `Ctrl + C`.

Rehacer todos los resultados desde cero (unos 10 minutos):

```bash
cd ~/kessler && make reproduce
```

Regenerar imágenes y vídeos de LinkedIn (con `npm run dev` abierto en otra terminal):

```bash
cd ~/kessler/web && npm install -D playwright && npx playwright install chromium
```

```bash
node scripts/content.cjs all
```

## 7. Opcional: informe redactado por Claude

Sin clave, el informe usa plantillas (funciona igual, mismos números). Con clave, Claude redacta
y un verificador rechaza cualquier párrafo con un número que no esté en los datos.

**No he podido probar la llamada real a la API** (no tenía clave). La lógica de verificación sí
está probada con modelos simulados.

1. Crea una clave en <https://console.anthropic.com/settings/keys> (**Create Key**). Cuesta
   dinero por uso: céntimos por informe.
2. En local:

```bash
cd ~/kessler && cp .env.example .env
```

   Abre `.env` con `nano .env`, pega la clave detrás de `ANTHROPIC_API_KEY=`, guarda con
   `Ctrl + O`, `Enter`, `Ctrl + X`.

```bash
.venv/bin/pip install anthropic && set -a && . ./.env && set +a && make intel
```

3. Para el informe diario en GitHub:
   <https://github.com/didimacveg/kessler/settings/secrets/actions> → **New repository secret** →
   Name: `ANTHROPIC_API_KEY` → Secret: tu clave → **Add secret**.

## 8. Opcional: decisiones que he tomado por ti y cómo deshacerlas

* **Nombre RAAN → KESSLER.** Cambia el nombre en `web/src/brand.ts` y `raan/brand.py`, y luego:

```bash
cd ~/kessler && grep -rl "RAAN" README.md content web/index.html raan/report | xargs sed -i 's/RAAN/KESSLER/g'
```

  Después `make reproduce` y regenera las imágenes (paso 6).
* **Renombrar el repositorio** (por ejemplo a `raan`): <https://github.com/didimacveg/kessler/settings>
  → **Repository name** → **Rename**. La web pasará a `https://didimacveg.github.io/raan/`;
  cambia ese enlace en `content/CALENDARIO.md`, `README.md` y `raan/intel/agents.py` (`SITE`).
* **Catálogo completo (~35.000 objetos).** Hace falta una cuenta gratuita en
  <https://www.space-track.org/auth/createAccount>. No está implementado; es el siguiente paso
  natural y está descrito en `docs/RESEARCH.md` §1.3.
* **Entorno de Claude «kessler».** Creé un entorno en la nube con acceso a celestrak.org,
  zenodo.org, arxiv.org, kelvins.esa.int, space-track.org, github.com, ids-doris.org y
  repository.tudelft.nl. Puedes borrarlo o editarlo en los ajustes de entornos de Claude Code.

## 9. Cosas que deberías hacer tú, no una IA

* **Leer la tesis de TU Delft** sobre detección de maniobras
  (<https://repository.tudelft.nl/record/uuid:9e4d886c-fef2-4632-a3bd-7df0486a5a51>). No pude
  abrirla desde aquí y es justo lo que te pueden preguntar en una entrevista allí.
* **Escribir a David Shorten** (autor del benchmark de maniobras) contándole el proyecto y
  preguntando si le parece bien que publiques series derivadas de su dataset: su repositorio no
  tiene licencia. Es un correo de cinco líneas y además es un contacto.
* **Decir que lo has hecho con ayuda de IA.** El README y la publicación de lanzamiento ya lo
  dicen. Mi consejo es que no lo quites: en una entrevista se nota enseguida, y lo valioso que
  puedes defender es el criterio (qué se comprueba, qué no se afirma), no haber tecleado el código.
