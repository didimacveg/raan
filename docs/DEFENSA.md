# Dossier de defensa de RAAN

Para Diego. Escrito el 12-11-2026 por la sesión de revisión independiente, después de leer todo
el código, volver a ejecutar los experimentos y recalcular las métricas por separado.

**Cómo usarlo.** Léelo entero una vez con la web abierta al lado. Después, quédate con tres
cosas: la sección 1 (lo que dices en 60 segundos), la sección 4 (lo que nunca debes afirmar) y,
antes de cada publicación, sus preguntas de la sección 5. Si te preguntan algo que no sabes, la
respuesta correcta es siempre: «No lo sé; lo miro y te contesto». Esa frase no te deja mal.
Inventar sí.

**La regla de oro.** El proyecto está hecho con mucha ayuda de una IA, que escribió casi todo
el código. Eso está dicho en el README, en el informe y en todas las publicaciones. Lo que tú
defiendes no es haber tecleado el código, sino entender qué hace, qué se comprobó y qué no se
puede afirmar. Si no entiendes un apartado de este documento, no publiques la parte
correspondiente hasta entenderlo.

---

## 0. Las cifras que tienes que saberte

Todas salen de ficheros del repositorio. La columna «Dónde» te dice cuál.

| Cifra | Valor | Dónde |
|---|---|---|
| Objetos en el globo (instantánea 11-11-2026) | 20.152 de 35.194 en órbita (57 %) | `web/public/data/catalog.json` → `meta` |
| Objetos con número de 6 dígitos | 1.373 | ídem, `six_digit_ids` |
| Starlink | 11.195 (66 % de los 16.894 activos) | ídem |
| Edad mediana de los datos | 16 h; 312 objetos con más de 5 días | ídem |
| SGP4 contra Vallado (lector TLE) | 666 vectores, máx. 1,2 × 10⁻⁷ km (0,12 mm) | `verification.json` |
| SGP4 contra Vallado (campos OMM, lo que usa la web) | máx. 3,5 × 10⁻⁵ km (3,5 cm) | `verification.json` |
| Referencia ingenua de la ESA (LRP) | L = 0,694 (MSE 0,513; F2 0,739) | `collision.json` → `results` |
| Referencia constante (CRP) | L = 2,50 | ídem |
| LightGBM «puerta + valor» en test | L = 0,627 (13 fallos, 185 falsas alarmas) | ídem |
| Lo mismo en validación cruzada | 0,98 frente a 0,80 de la referencia; 1,23 con validación anidada | `selection` |
| Bootstrap | gana en el 86 % de remuestreos; intervalo de la diferencia [−0,19; +0,05] | `results` |
| GRU / regresión directa | L = 1,32 / 2,37 | `results` |
| Eventos de alto riesgo | entrenamiento 66 de 8.293 (0,8 %); test 150 de 2.167 (6,9 %) | `dataset` |
| Maniobras: eventos evaluados | 803 (de 941 maniobras notificadas; 54 quedan fuera de los datos) | `maneuvers.json` → `totals` |
| F1 clasificador / física / CUSUM | 0,81 / 0,74 / 0,52 | `summary` |
| Solo semieje mayor | F1 0,79 | `physics_ablation.a` |
| Saltos simples (primer diseño) | F1 0,35 | `physics_ablation.jump` |
| Azar (mismas detecciones en momentos aleatorios) | F1 0,09 (clasificador) | `chance` |
| Ruido del estadístico en días tranquilos | mediana 0,4 m; percentil 95: 4,1 m | `noise_floor_leo_m` |
| Maniobras de 1 a 3 m encontradas | 29 de 66 | `recall_by_size_leo` |

Cifras que **cambiaron** en la revisión del 12-11-2026 (por si alguien vio las antiguas):
F1 0,79 / 0,73 / 0,51 → **0,81 / 0,74 / 0,52**; 837 eventos → **803**; «5 de 45 maniobras de
menos de 1 m» → retirada (eran 11, no 45). El motivo está en la pregunta 14 y en la decisión 16
de `docs/DECISIONS.md`. Las cifras de colisiones no cambiaron: se reprodujeron idénticas.

---

## 1. RAAN en 60 segundos (apréndetelo con tus palabras)

> RAAN es un laboratorio abierto sobre datos orbitales públicos. Tiene tres partes. Un globo 3D
> que dibuja unos 20.000 objetos calculando su posición con SGP4 a partir de los elementos
> orbitales que publica CelesTrak; son predicciones, no observaciones. Un experimento con los
> mensajes de conjunción reales que publicó la ESA, donde primero se reproduce exactamente la
> referencia publicada, 0,694, y después se comprueba si algún modelo la mejora: uno saca 0,627
> en test, pero pierde en validación cruzada, así que no lo doy por bueno. Y un detector de
> maniobras probado con 803 maniobras que los operadores notificaron, con F1 de 0,81, donde casi
> todo el mérito es de una sola magnitud física, el salto del semieje mayor. No es una
> herramienta operativa. Lo hice con mucha ayuda de una IA; lo que he aprendido es a comprobar
> y a no afirmar de más.

---

## 2. Cada concepto, desde cero

### 2.1 Elementos orbitales

Una órbita alrededor de la Tierra es, en primera aproximación, una elipse con la Tierra en un
foco (primera ley de Kepler). Para saber dónde está un satélite hacen falta seis números. Los
clásicos son:

| Elemento | Qué dice | Imagen mental |
|---|---|---|
| **Semieje mayor, a** | El tamaño de la elipse (la mitad de su diámetro largo). | Fija el periodo: órbita más grande, vuelta más lenta (tercera ley de Kepler, T² ∝ a³). ISS: a ≈ 6.795 km, 92 min. GEO: 42.164 km, 1 día. |
| **Excentricidad, e** | La forma. 0 = círculo; cerca de 1 = elipse muy alargada. | Starlink: 0,0001. Molniya: 0,7. |
| **Inclinación, i** | El ángulo entre el plano de la órbita y el ecuador. | 0° = sobre el ecuador; 90° = pasa por los polos; 98° = heliosíncrona. |
| **RAAN, Ω** (ascensión recta del nodo ascendente) | Hacia dónde está girado el plano orbital, medido sobre el ecuador desde una dirección fija en las estrellas (el punto Aries) hasta el punto donde el satélite cruza el ecuador de sur a norte. | Si la inclinación es cuánto se inclina una puerta, el RAAN es hacia qué punto cardinal mira la bisagra. De ahí viene el nombre del proyecto. |
| **Argumento del perigeo, ω** | Dentro del plano, hacia dónde apunta el punto más bajo de la elipse (el perigeo), medido desde el nodo ascendente. | Orienta la elipse dentro de su plano. |
| **Anomalía media, M** | En qué punto de la vuelta está el satélite en el instante de referencia, expresado como un ángulo que crece uniformemente con el tiempo. | Es un reloj: 0° en el perigeo, 180° a media vuelta en tiempo (no en ángulo real). |

En los datos públicos, en vez de `a` viene el **movimiento medio, n**: vueltas por día. Es lo
mismo dicho de otra forma: a = (μ / n²)^(1/3), con μ = 398.600,8 km³/s² (el parámetro
gravitatorio de la Tierra) y n en radianes por segundo. El código lo hace en
`raan/catalog/classify.py`, función `semi_major_axis_km`.

Además viene la **época** (el instante al que corresponden los números) y **B\*** («B estrella»),
un coeficiente que resume cuánto frena la atmósfera a ese objeto.

**Perigeo y apogeo**: altura mínima y máxima. Perigeo = a(1 − e) − R, apogeo = a(1 + e) − R, con
R = 6.378,135 km.

**Regímenes** (los filtros de la web): LEO, apogeo por debajo de 2.000 km; GEO, periodo de un
día sidéreo ± 30 min y e < 0,05; HEO, e ≥ 0,25; MEO, lo que queda en medio. Son reglas del
proyecto (`classify.py`), razonables pero no un estándar oficial: si te preguntan, dilo así.

**«Medios» frente a «osculadores».** Los elementos publicados son *elementos medios*: están
promediados quitando las oscilaciones rápidas que provoca el achatamiento de la Tierra. No son
la elipse real en ese instante (esa sería la «osculadora»). Solo tienen sentido usados con el
modelo con el que se ajustaron, que es SGP4. Meterlos en la fórmula de Kepler a pelo da errores
de kilómetros.

### 2.2 TLE y OMM

**TLE** (*two-line element set*): el formato de los años sesenta. Dos líneas de 69 caracteres
con los elementos medios, la época y B\*, en columnas fijas. El número de catálogo ocupa 5
caracteres, así que no admite más de 99.999.

**OMM** (*Orbit Mean-elements Message*): el formato moderno, estándar del CCSDS. Contiene **los
mismos elementos medios**, pero con campos con nombre (CSV, JSON, XML), no en columnas fijas. No
es más preciso físicamente: es otra forma de escribir lo mismo, sin el límite de 5 dígitos y
con la época con más decimales.

**Por qué importa.** Según CelesTrak, los números de 5 dígitos se acabaron el 11-07-2026. Los
objetos nuevos tienen 6 dígitos y no se pueden escribir como TLE. En la instantánea del 11 de
noviembre son 1.373 de 20.152. Por eso el proyecto lee OMM en CSV.

**GP** (*general perturbations*): el nombre genérico de estos datos (elementos medios para
SGP4), en el formato que sea. **SATCAT**: el catálogo con los metadatos de cada objeto (tipo,
país, fecha de lanzamiento).

**De dónde salen.** Los calcula el 18.º Escuadrón de Defensa Espacial de EE. UU. (18 SDS) con
su red de radares y telescopios, y los publica en Space-Track. CelesTrak (Dr. T. S. Kelso) los
redistribuye sin necesidad de cuenta.

### 2.3 SGP4

Es el **modelo matemático** que convierte unos elementos medios en posición y velocidad en
cualquier instante. Es analítico: fórmulas, no simulación paso a paso. Tiene en cuenta el
achatamiento de la Tierra (J2 y otros términos), el frenado atmosférico a través de B\* y, en
órbitas altas (periodo de más de 225 min), la atracción de la Luna y el Sol.

- **Entrada:** elementos medios + minutos transcurridos desde la época.
- **Salida:** posición y velocidad en un sistema de ejes llamado **TEME**, que está centrado en
  la Tierra y no gira con ella. Para pasar a latitud y longitud hay que girar con el ángulo de
  rotación de la Tierra (tiempo sidéreo, **GMST**); lo hace `web/src/twin/sgp4.ts`.
- **Precisión:** del orden de 1 km en la época, y empeora entre 1 y 3 km por día. No es culpa
  del código: es el límite del modelo y de los datos. Para evitar colisiones de verdad no vale.

**Qué se ha verificado.** Vallado y otros publicaron en 2006 (AIAA 2006-6753) la salida de la
implementación de referencia para 33 conjuntos de elementos: 666 vectores de posición. El
proyecto usa librerías existentes (satellite.js en la web, `sgp4` en Python) y comprueba que
dan lo mismo: diferencia máxima 0,12 mm.

**Ojo con lo que significa.** Verificar es «el código calcula bien SGP4». **No** es «SGP4 dice
dónde está el satélite de verdad». Son dos cosas distintas y la segunda no se ha medido.

**El matiz de los 3,5 cm.** Ese test lee TLE. La web lee OMM. Por esa ruta la diferencia máxima
es 3,5 cm en una órbita extrema (14 días de periodo, e = 0,97), porque la librería lee la época
con precisión de milisegundo. Además, la hora de cada punto se guarda redondeada al milisegundo:
medio milisegundo a 7,5 km/s son unos 4 metros a lo largo de la órbita. Irrelevante para un
globo; pero no digas que la web tiene precisión de 0,12 mm.

### 2.4 El sistema RTN

Para describir errores o diferencias cerca de un satélite se usan tres ejes pegados a él:

- **R, radial:** de la Tierra hacia el satélite (arriba y abajo).
- **T, transversal** (*along-track*): hacia donde avanza (delante y detrás).
- **N, normal** (*cross-track*): perpendicular al plano de la órbita (izquierda y derecha).

**Por qué es útil.** Los errores no son iguales en las tres direcciones. La incertidumbre crece
sobre todo en T: un pequeño error en el periodo se acumula vuelta tras vuelta y el satélite va
quedando adelantado o retrasado. Una maniobra que cambia el periodo aparece como un error que
crece en T.

**En el proyecto:** el «residuo RTN» es la posición que predecían los elementos de ayer para hoy
menos la que dan los de hoy, en esos tres ejes (`raan/maneuver/tle.py`, `rtn_residual`). En los
datos de la ESA, las columnas `relative_position_r/t/n` y `sigma_r/t/n` usan el mismo sistema.

### 2.5 Mensajes de conjunción (CDM)

Una **conjunción** es un acercamiento previsto entre dos objetos. Un **CDM** (*Conjunction Data
Message*) es el aviso estándar que recibe un operador. Trae: el instante de máximo acercamiento
(**TCA**), la distancia de paso (*miss distance*), la velocidad relativa, la posición y
velocidad de los dos objetos y, sobre todo, su **covarianza**, es decir, cuánta incertidumbre
tiene cada posición. Con todo eso se calcula el riesgo.

Para un mismo acercamiento llegan **varios CDM a lo largo de los días**, porque cada nueva
observación mejora las órbitas. El riesgo cambia con cada uno. Un «evento» en el dataset es esa
serie temporal de CDM.

El dataset de la ESA: 162.634 CDM de entrenamiento (13.154 eventos) y 24.484 de test (2.167
eventos), de sus satélites en LEO entre 2015 y 2019, anonimizados, con 103 columnas.

### 2.6 Probabilidad de colisión

No sabemos dónde está exactamente cada objeto: tenemos la mejor estimación y una «nube» de
incertidumbre alrededor (la covarianza; piensa en una campana de Gauss en 3D con forma de puro,
alargada en la dirección T). La **probabilidad de colisión (Pc)** es la probabilidad de que, en
el momento del acercamiento, los dos objetos estén a menos distancia que la suma de sus tamaños.

Matemáticamente: como el encuentro dura décimas de segundo, se proyecta todo sobre el plano
perpendicular a la velocidad relativa, se suman las dos incertidumbres y se integra esa campana
sobre un círculo cuyo radio es la suma de los radios de los dos objetos.

Consecuencias que debes entender:

- Depende de la **distancia de paso** y de la **incertidumbre**, no solo de la distancia. Pasar
  a 200 m con órbitas muy bien conocidas puede ser seguro; pasar a 1 km con mucha incertidumbre,
  no.
- **Efecto de dilución:** si la incertidumbre es enorme, la campana es tan ancha que la Pc sale
  pequeña. Una Pc baja con datos malos no significa seguridad.
- **Umbrales típicos:** se suele plantear maniobrar en torno a 10⁻⁴ (1 entre 10.000). El reto de
  la ESA llama «alto riesgo» a Pc ≥ 10⁻⁶.
- En el dataset, `risk` es **log₁₀(Pc)**: −6 significa 10⁻⁶; −30 es el suelo («prácticamente
  cero»).
- **No hay ninguna colisión en los datos.** El riesgo es un número calculado, nunca un suceso
  observado.

En RAAN **no se calcula ninguna Pc**. Se usa la que ya viene calculada por la ESA en cada CDM.

### 2.7 El reto de la ESA y la métrica L

**La tarea.** Con los CDM disponibles hasta **2 días antes** del TCA (cuando el operador tiene
que decidir), predecir el riesgo del **último** CDM del evento (emitido a menos de 1 día).

**La métrica** (menor es mejor):

> L = MSE_HR / F2

- **MSE_HR:** el error cuadrático medio de la predicción (en log₁₀), calculado **solo sobre los
  eventos que de verdad acaban en alto riesgo** (riesgo final ≥ −6). Mide cuánto te equivocas
  en el valor, donde importa.
- **F2:** una nota entre 0 y 1 de lo bien que **clasificas** alto frente a bajo riesgo, dando al
  recall cuatro veces más peso que a la precisión (apartado 2.11). Mide si te enteras de los
  peligrosos.
- Dividir por F2 castiga dos veces: si te equivocas en el valor (numerador grande) y si no
  detectas los de alto riesgo (denominador pequeño).
- **Recorte:** como por debajo de −6 da igual el valor, toda predicción menor que −6 se pone en
  −6,001. Lo propone el propio artículo de la ESA.

**Las referencias** (*baselines*):

- **LRP** (*latest risk prediction*): «el riesgo final será igual al último conocido». L = 0,694.
  Según el artículo, de 97 equipos solo 12 la superaron.
- **CRP:** «siempre −5». L = 2,5.
- Ganador de 2019 (equipo *sesc*): 0,556.

**Reproducido aquí.** L = 0,69396, con MSE_HR 0,5129 y F2 0,7391 (115 aciertos, 63 falsas
alarmas, 35 fallos). En la revisión se recalculó con un script independiente escrito desde cero
a partir de los CSV, sin usar el código del proyecto, y da lo mismo.

### 2.8 Sesgo de selección del dataset

Un dataset tiene **sesgo de selección** cuando sus ejemplos no se han elegido al azar, de forma
que lo que aprendes en él no representa la realidad.

Aquí lo dice la propia ESA: los conjuntos se eligieron «a mano» para que hubiera más eventos de
alto riesgo. Y además **entrenamiento y test no son iguales entre sí**:

- En condiciones de test (último CDM a menos de 1 día, entradas a 2 días o más), en
  entrenamiento hay 66 eventos de alto riesgo de 8.293 (**0,8 %**); en test, 150 de 2.167
  (**6,9 %**). Casi nueve veces más.
- Misma entrada, distinto resultado: de los eventos cuyo último riesgo conocido está entre 10⁻⁶
  y 10⁻⁵, acaban en alto riesgo el **13 %** en entrenamiento y el **61 %** en test.

**Por qué importa.** Un modelo entrenado con el 0,8 % aprende a ser prudente al dar alarmas. Al
ajustar el umbral con esos datos sale un umbral que en test, donde hay muchos más positivos,
resulta casualmente favorable. Es la explicación más probable de que el modelo «gane» en test y
pierda en validación cruzada. No está demostrado; es una hipótesis apoyada en esas dos medidas.
El artículo de la ESA cuenta el mismo problema: la mayoría de equipos se quejó de la mala
correlación entre entrenamiento y test.

### 2.9 LightGBM

Un **árbol de decisión** es una cadena de preguntas de sí o no («¿el último riesgo es mayor que
−7?», «¿hay más de 5 CDM?») que termina en una predicción. Un solo árbol es tosco.

El ***gradient boosting*** construye muchos árboles pequeños **en serie**: cada árbol nuevo se
entrena para corregir los errores que cometen los anteriores juntos, y la predicción final es
la suma de todos. **LightGBM** es una librería (de Microsoft) rápida para hacerlo. Funciona muy
bien con datos en forma de tabla, que es lo que hay aquí.

**En colisiones** hay dos usos:

1. **«Puerta + valor»:** un clasificador (300 árboles de 8 hojas como máximo) estima la
   probabilidad de que el evento acabe en alto riesgo, a partir de unas 55 características del
   evento: el último CDM, tamaños de covarianza, estadísticas de las observaciones y resúmenes
   de la historia del riesgo. Si esa probabilidad supera un umbral τ, se predice un valor con
   una recta de dos parámetros sobre el último riesgo; si no, −6,001. τ se elige con validación
   cruzada en entrenamiento. Resultado: 0,627 en test.
2. **Regresión directa:** predecir el número directamente. Resultado: 2,37, mucho peor.

**En maniobras:** un clasificador (250 árboles) decide, para cada intervalo entre dos conjuntos
de elementos, si contiene una maniobra.

**Importancia de las variables** (*gain*): qué parte de la mejora total aporta cada variable al
partir los árboles. En colisiones la primera es la media de la historia del riesgo (27 %); en
maniobras, el salto del semieje mayor (36 %). Indica qué usa el modelo, no causa y efecto.

### 2.10 GRU

Una **red neuronal recurrente** lee una secuencia elemento a elemento manteniendo una «memoria»
(un vector de números) que actualiza en cada paso. La **GRU** (*gated recurrent unit*) es un
tipo con «compuertas» que deciden qué parte de la memoria conservar y cuál sustituir, lo que le
permite recordar cosas de pasos lejanos.

**Aquí:** lee los últimos 8 CDM de cada evento (12 variables por CDM), con memoria de 32 números
y dos salidas: una probabilidad de alto riesgo y un valor. Son 4.578 parámetros. Se entrena tres
veces con semillas distintas y se promedia.

**Resultado:** L = 1,32, peor que no usar modelo. Con 66 ejemplos positivos, 4.578 parámetros
son demasiados: **sobreajusta**, es decir, memoriza los ejemplos en vez de aprender una regla
general. Se publica como resultado negativo.

### 2.11 Precisión, exhaustividad (*recall*), F1 y F2

Un detector da alarmas. Hay cuatro casos:

| | Había algo | No había nada |
|---|---|---|
| **Da alarma** | acierto (verdadero positivo, VP) | falsa alarma (falso positivo, FP) |
| **No da alarma** | fallo (falso negativo, FN) | correcto (verdadero negativo, VN) |

- **Precisión** = VP / (VP + FP): de las alarmas que doy, cuántas son verdad.
- **Exhaustividad** o *recall* = VP / (VP + FN): de lo que había, cuánto encuentro.
- Siempre tiran en sentidos opuestos: si doy alarma por todo, recall del 100 % y precisión
  pésima.
- **F1** = 2 · P · R / (P + R): la media armónica de las dos. Solo es alta si las dos lo son.
- **F2:** igual, pero dando al recall cuatro veces más peso: F2 = 5 · P · R / (4 · P + R). Se
  usa cuando un fallo es mucho más grave que una falsa alarma, como en colisiones.

Ejemplo con los números reales del clasificador de maniobras: VP = 640, FP = 134, FN = 163.
Precisión = 640 / 774 = 0,83. Recall = 640 / 803 = 0,80. F1 = 0,81.

### 2.12 CUSUM

**Suma acumulada** (Page, 1954). Sirve para detectar un cambio pequeño pero **persistente** que
ninguna medida aislada delataría. En cada paso se suma «cuánto se desvía el dato de lo normal,
menos un margen»; si la suma baja de cero, se deja en cero. Si el proceso no ha cambiado, la
suma se queda cerca de cero. Si ha cambiado de nivel, las desviaciones se acumulan y la suma
crece hasta cruzar un umbral.

**Aquí** se aplica a los cambios diarios del semieje mayor y de la inclinación. Sale F1 = 0,52,
el peor de los tres: acumula también las rachas de datos ruidosos y da muchas falsas alarmas
(precisión 0,49). Es un resultado negativo de esta implementación con estos datos, no una
demostración de que CUSUM sea malo en general.

### 2.13 El detector «físico» (el que más importa)

Idea: un dato malo es un **pico** (salta y vuelve); una maniobra es un **escalón** (salta y se
queda).

Para cada intervalo se calcula: la mediana de los 3 conjuntos de elementos posteriores, menos
la mediana de los 3 anteriores, menos lo que habría bajado la órbita de todas formas por el
rozamiento atmosférico (estimado con los 30 intervalos previos). La mediana de tres no se mueve
por un solo dato malo. Ese «escalón» se divide por el ruido habitual de ese satélite (medido con
la **MAD**, la mediana de las desviaciones absolutas, que tampoco se deja engañar por valores
extremos) y se obtiene cuántas «sigmas» vale. Si supera un umbral, hay detección.

Dos cosas que debes decir si te preguntan:

- Usa los 3 conjuntos **posteriores**, así que detecta la maniobra unos tres días **después**.
  Es retrospectivo, no una alerta.
- El primer diseño, sin la mediana (umbral sobre saltos sueltos y residuos RTN), dio F1 = 0,35.

### 2.14 Validación dejando un satélite fuera (LOSO)

**Validar** es comprobar un modelo con datos que no vio al entrenarse. Si se mezclan datos del
mismo satélite en entrenamiento y en prueba, el modelo puede aprenderse las manías de ese
satélite y parecer mejor de lo que es.

***Leave-one-satellite-out*:** con 15 satélites, se entrena con 14 y se evalúa en el que queda
fuera; se repite 15 veces, una por satélite, y se suman los resultados. Así cada número de un
satélite sale de un modelo y de un umbral que **nunca vieron sus etiquetas**.

El umbral de decisión del clasificador también se elige solo con los otros 14 (con una
validación interna). Para los detectores sin entrenamiento (física y CUSUM), el umbral se elige
con los demás satélites del mismo régimen.

**El límite honesto.** El *diseño* del detector (ventanas de 30, medianas de 3, la regla de
emparejamiento) se fue ajustando mirando estos mismos 15 satélites. Los umbrales y el modelo
están fuera de muestra; el diseño, no. Los números son optimistas para satélites distintos.

**En colisiones** se usa otra variante: validación cruzada de 5 grupos **agrupada por evento**
(todos los datos de un evento van al mismo grupo), solo dentro del conjunto de entrenamiento.

### 2.15 Validación cruzada, anidada, y fuga de datos

**Validación cruzada de 5 grupos:** se parte el entrenamiento en 5 trozos; se entrena con 4 y se
evalúa en el quinto; se repite 5 veces. Da una estimación del rendimiento sin tocar el test.

**Fuga de datos** (*leakage*): cuando información del conjunto de prueba se cuela en el
entrenamiento o en el ajuste, y el resultado sale mejor de lo que es. Lo que se comprobó en la
revisión:

- Las etiquetas de test no se usan para entrenar ni para ajustar nada. Verificado leyendo el
  código línea a línea.
- Las características usan solo CDM de 2 días o más antes del TCA. Hay un test que lo comprueba.
- La normalización de la GRU se calcula solo con entrenamiento.
- **Sí había un optimismo, pero en la validación cruzada, no en el test:** el umbral τ se elegía
  con las mismas predicciones con las que luego se puntuaba, y la recta de valor se ajustaba con
  todos los eventos. Eso favorece al modelo. Por eso se añadió la **validación anidada**:
  dentro de cada grupo, τ y la recta se eligen solo con los otros cuatro. Resultado: **1,23**
  en vez de 0,98. La conclusión (el modelo pierde contra 0,80) no cambia; se refuerza.

**El test no es virgen.** Se puntuó más de una vez durante el desarrollo (por ejemplo, antes y
después del bug de la publicación 7). No se usó para ajustar, pero no puedes decir «solo lo
miré una vez».

### 2.16 Bootstrap

Con solo 150 eventos de alto riesgo en test, un resultado puede deberse a la suerte. El
**bootstrap** lo mide: se crean 2.000 conjuntos de test «alternativos» eligiendo eventos al
azar **con repetición** del test real, y se recalcula L en cada uno para el modelo y para la
referencia.

- El modelo gana en el **86 %** de los remuestreos.
- El intervalo del 95 % de la diferencia (modelo − referencia) es **[−0,19; +0,05]**. Incluye
  el cero: no se puede descartar que no haya diferencia.

Límite: solo mide la suerte del conjunto de test. No incluye la variación que habría al
reentrenar el modelo.

### 2.17 Calibración

Un modelo que da probabilidades está **calibrado** si, de todas las veces que dice «30 %»,
ocurre aproximadamente el 30 %. Se mira con un **diagrama de fiabilidad** (probabilidad
predicha frente a frecuencia observada) y se resume con el **ECE** (*expected calibration
error*, la diferencia media entre ambas) y el **Brier** (error cuadrático medio de la
probabilidad).

**Aquí:** el clasificador está bien calibrado en entrenamiento (ECE 0,005) y mal en test (ECE
0,037): da probabilidades demasiado bajas, porque en test hay nueve veces más positivos. Es
otra forma de ver el sesgo de 2.8.

### 2.18 Ablación

Quitar o aislar piezas de un sistema para ver cuánto aporta cada una. El nombre viene de la
medicina.

**Aquí,** el detector físico usaba dos señales, semieje mayor e inclinación:

| Variante | F1 |
|---|---|
| Saltos sueltos + residuo RTN (primer diseño) | 0,35 |
| **Solo escalón en el semieje mayor** | **0,79** |
| Semieje mayor o inclinación (la «referencia» declarada) | 0,74 |
| Lo anterior, confirmado por residuo RTN | 0,66 |

La lección: el clasificador (0,81) parece mejorar 7 puntos sobre «la física» (0,74), pero la
mejor regla simple ya da 0,79. La mejora real del aprendizaje automático es de unos **2
puntos**. Comparar con una referencia floja infla el resultado.

### 2.19 Cómo se cuenta un acierto en maniobras

- Las maniobras notificadas con menos de 1,5 días de separación cuentan como **un evento** (con
  un dato al día no se pueden distinguir). De 941 maniobras quedan 803 eventos evaluables.
- 54 maniobras están fuera del periodo con datos del satélite (casi todas antes de su primer
  dato). No se pueden detectar y **no se cuentan**.
- Una detección «explica» un evento si la maniobra cae entre 2 días antes de su inicio y su
  final. Una detección, un evento.
- Esa ventana es ancha, así que se mide el **suelo de azar**: las mismas detecciones movidas a
  momentos aleatorios dan F1 = 0,09 (clasificador), 0,12 (física) y 0,23 (CUSUM).

### 2.20 El informe y el «guardián de números»

Tres programas pequeños (en el código se llaman *agentes*, pero **son código normal, no IA**)
leen los ficheros de resultados y registran «hechos»: un valor y el fichero del que sale. Un
revisor rechaza cualquier frase que cite un hecho inexistente o que contenga un número que no
esté en sus hechos citados. El texto se escribe con plantillas fijas.

Opcionalmente, un modelo de lenguaje (Claude) puede reescribir un párrafo. Entonces se comprueba
que cada número del párrafo coincida con un hecho citado; si no, se descarta y se usa la
plantilla. Las advertencias nunca se dejan en manos del modelo.

Límites: compara **números**, no significados (un número correcto pegado a una afirmación
equivocada pasaría). Y **la ruta con Claude no se ha probado con una clave real**: el informe
de la web es el de plantillas.

---

## 3. Las 20 preguntas más probables

Respuestas pensadas para decirlas en voz alta. No las recites: entiéndelas.

**1. ¿Cuánto has hecho tú y cuánto la IA?**
«El código lo escribió casi todo un asistente de IA, Claude Code, en sesiones largas siguiendo
mis instrucciones; una segunda sesión independiente lo revisó, encontró fallos y los corrigió.
Lo digo en el README, en el informe y en cada publicación. Mi parte es haber definido qué quería
construir y con qué reglas, entender cada pieza y poder explicar qué se comprobó y qué no. No me
presento como autor del código. Si quieres, te explico cualquier parte y me dices si la
entiendo.»

**2. ¿Para qué sirve? ¿Lo podría usar un operador?**
«No. No es operativo y lo pone en todas las páginas. Usa elementos públicos con errores de
kilómetros, no calcula probabilidades de colisión propias y no tiene datos de seguimiento. Sirve
para aprender y como ejemplo reproducible de cómo evaluar con honestidad: referencias
reproducidas antes de entrenar y resultados negativos publicados.»

**3. ¿Por qué SGP4 y no un propagador numérico?**
«Porque los datos públicos son elementos medios ajustados con SGP4, y solo tienen sentido con
ese modelo. Un propagador numérico necesita un estado inicial preciso y parámetros físicos del
objeto que no son públicos. Con otros datos, por ejemplo efemérides de los operadores, lo
correcto sería otro propagador.»

**4. ¿Qué precisión tienen las posiciones del globo?**
«La de SGP4 con datos públicos: del orden de un kilómetro en la época y entre uno y tres más por
día. No la he medido yo; es el valor que da la bibliografía. Lo que sí está medido es que el
código reproduce la implementación de referencia: 0,12 mm por la ruta TLE y 3,5 cm por la ruta
OMM que usa la web.»

**5. ¿Por qué solo 20.000 objetos si hay más de 35.000 en órbita?**
«Porque CelesTrak no ofrece una consulta de todo el catálogo. Uso lo que da en bloque: activos,
objetos de analista y tres nubes de fragmentos. La mayoría de los restos y etapas de cohete
requieren una cuenta de Space-Track. Preferí enseñar el 57 % y decirlo en pantalla.»

**6. ¿Has calculado tú la probabilidad de colisión?**
«No. Uso el riesgo que ya viene en cada CDM, calculado por la ESA. Entiendo el concepto: se
integra la incertidumbre combinada de las dos posiciones sobre un círculo del tamaño de los dos
objetos, en el plano del encuentro. Pero no lo he implementado.»

**7. Explícame la métrica L. ¿Por qué se divide por F2?**
«L es el error cuadrático medio sobre los eventos de alto riesgo, dividido por F2. El numerador
mide cuánto te equivocas en el valor donde importa; el denominador, entre 0 y 1, mide si
detectas los eventos peligrosos, dando cuatro veces más peso a no dejarte ninguno que a no dar
falsas alarmas. Al dividir, un modelo que se deja eventos peligrosos queda penalizado dos veces.
El propio artículo reconoce que mezclar dos objetivos en un número es discutible.»

**8. Tu modelo saca 0,627 y la referencia 0,694. ¿Por qué dices que no mejora?**
«Por tres razones. En validación cruzada sobre el entrenamiento pierde: 0,98 contra 0,80, y 1,23
si la validación es anidada. Con 150 eventos positivos el intervalo de la diferencia incluye el
cero; gana en el 86 % de los remuestreos, no en el 95 %. Y hay una explicación plausible que no
tiene que ver con que el modelo sea bueno: el test tiene nueve veces más eventos de alto riesgo
que el entrenamiento, y el umbral elegido resulta favorable por eso.»

**9. ¿Seguro que no hay fuga de datos del test?**
«Las etiquetas de test no se usan para entrenar ni para ajustar nada; se revisó línea a línea.
Lo que sí encontró la revisión fue un optimismo en la validación cruzada, porque el umbral se
elegía con las mismas predicciones que se puntuaban. Se añadió una validación anidada y el
resultado del modelo empeora a 1,23, que va en contra del modelo, no a favor. Y hay que decir
otra cosa: el test se puntuó varias veces durante el desarrollo. No es un conjunto virgen.»

**10. El artículo de la ESA ya probó LightGBM. ¿Qué aportas?**
«Nada nuevo en el método, y no lo pretendo. El artículo ya cuenta que entrenaron miles de
modelos y casi ninguno superaba la referencia en entrenamiento y test a la vez. Lo que hago es
reproducir la referencia exacta y llegar por mi cuenta a la misma conclusión, enseñando el
porqué con los datos. Es un ejercicio de reproducción.»

**11. ¿Por qué 66 eventos positivos si el dataset tiene 13.000 eventos?**
«Porque solo cuento los comparables con el test: los que tienen un CDM a menos de un día del
acercamiento, que da el objetivo, y alguno a dos días o más, que da las entradas. Quedan 8.293,
y de esos solo 66 acaban en alto riesgo. En total hay 365 eventos de alto riesgo, pero la
mayoría no cumple esas condiciones.»

**12. ¿De dónde salen las etiquetas de maniobras? ¿Son fiables?**
«Del conjunto de referencia de Shorten y otros, de 2023. Para los diez satélites en órbita baja
son las maniobras que los operadores publican a través del Servicio Internacional DORIS, con
precisión de minutos. Para los cinco Fengyun geoestacionarios vienen de otra fuente y son menos
precisas. Una maniobra no notificada me cuenta como falsa alarma, así que la precisión puede
estar algo infravalorada.»

**13. Un F1 de 0,81, ¿es bueno? ¿Con qué lo comparas?**
«Con tres cosas. Con el azar: las mismas detecciones en momentos aleatorios dan 0,09. Con la
regla más simple, el escalón del semieje mayor: 0,79. Y con mi primer diseño: 0,35. Así que el
aprendizaje automático aporta unos dos puntos. No lo he comparado con los métodos del artículo
de Shorten ni con otros publicados, porque usan protocolos de evaluación distintos; no puedo
decir que sea mejor ni peor que el estado del arte.»

**14. Las cifras de maniobras cambiaron respecto a una versión anterior. ¿Por qué?**
«La revisión encontró que 54 maniobras notificadas caían fuera del periodo con datos orbitales,
casi todas antes del primer dato de cada satélite. Era imposible detectarlas y se contaban como
fallos. Además, como su tamaño medido salía cero, aparecían en la categoría de "menos de un
metro" e inflaban una conclusión falsa sobre un límite de detección de un metro. Se excluyeron,
se recalculó todo y se corrigieron la web, el informe y las publicaciones: F1 pasó de 0,79 a
0,81 y de 837 eventos a 803.»

**15. Entonces, ¿cuál es la maniobra más pequeña que detectas?**
«No hay un corte limpio. Entre 1 y 3 metros de cambio en el semieje mayor se encuentra menos de
la mitad, 29 de 66; entre 3 y 10 metros, tres de cada cuatro. El motivo es que en días sin
maniobra el mismo estadístico ya oscila 0,4 metros de mediana y 4 metros en el percentil 95. Por
debajo de un metro solo hay 11 casos, demasiado pocos para afirmar nada.»

**16. ¿Funcionaría con Starlink o con propulsión eléctrica?**
«No lo sé, y probablemente no tal cual. Está probado con 15 satélites científicos y
meteorológicos muy bien seguidos que hacen maniobras impulsivas. El empuje continuo y débil no
produce un escalón sino una rampa, y el detector busca escalones. No está validado para eso y lo
pone en la página.»

**17. ¿Detecta en tiempo real?**
«No. Usa los tres conjuntos de elementos posteriores, así que ve la maniobra unos tres días
después. Es un análisis retrospectivo.»

**18. ¿Por qué mezclas LEO y GEO en el mismo clasificador?**
«Las señales están normalizadas respecto al ruido de cada satélite, y hay una variable que
indica el régimen. Aun así es discutible: son dinámicas distintas y solo hay cinco GEO. Por eso
publico los resultados separados: en GEO la regla física (0,89) queda por encima del
clasificador (0,87).»

**19. ¿Los «agentes» son IA?**
«No. Son programas deterministas que leen ficheros y rellenan plantillas. El nombre viene del
diseño por papeles: analistas, revisor, editor. Lo único con IA es un paso opcional en el que
un modelo de lenguaje puede reescribir un párrafo, con una comprobación automática de que no
aparezca ningún número que no esté en los datos. Esa ruta no la he probado con una clave real.»

**20. ¿Qué harías distinto, o qué harías después?**
«Tres cosas. En colisiones, predecir una distribución del riesgo final en vez de un valor, y
evaluarla suponiendo una proporción realista de eventos peligrosos. En maniobras, usar el
archivo diario que el proyecto empezó a guardar y probar con efemérides de operadores, para
estudiar el empuje débil. Y sobre todo, reescribir yo mismo las partes centrales, la métrica y
el detector físico, para dejar de depender de código que no he tecleado.»

### Preguntas trampa cortas

- **«¿Qué es el RAAN?»** El ángulo, medido sobre el ecuador desde el punto Aries, hasta donde la
  órbita cruza el ecuador hacia el norte. Orienta el plano orbital.
- **«¿En qué sistema de referencia da SGP4 la posición?»** TEME: centrado en la Tierra, sin
  girar con ella.
- **«¿Qué es B\*?»** El coeficiente que resume el frenado atmosférico en SGP4.
- **«¿Qué es el síndrome de Kessler?»** La hipótesis (Kessler y Cour-Palais, 1978) de que, por
  encima de cierta densidad de objetos, las colisiones generan fragmentos que provocan más
  colisiones, en cadena. El proyecto **no** lo simula; solo era su nombre provisional.
- **«¿Por qué F2 y no F1 en colisiones?»** Porque dejarse un evento peligroso es mucho peor que
  una falsa alarma.
- **«¿Qué licencia tienen los datos?»** ESA: CC BY 4.0. Elementos orbitales: datos básicos de
  Space-Track, redistribuibles citando la fuente; CelesTrak no publica licencia formal. Conjunto
  de maniobras: sin licencia, por eso no se copia y solo se publican series derivadas.

---

## 4. Lo que nunca debes afirmar

Cada frase de la izquierda es falsa o indefendible. Usa la de la derecha.

| No digas | Di |
|---|---|
| «Mi modelo mejora la referencia de la ESA» / «habría quedado sexto» | «Saca 0,627 en test, pero pierde en validación cruzada; no lo considero una mejora.» (Lo del sexto puesto solo como «tentador», nunca como logro.) |
| «Predice colisiones» / «calcula el riesgo de colisión» | «Intenta predecir cómo evolucionará un riesgo que ya calculó la ESA.» |
| «Seguimiento en tiempo real» / «dónde están los satélites» | «Predicciones con SGP4 a partir de elementos publicados hace horas.» |
| «Todos los objetos en órbita» / «30.000 objetos» | «20.152 de 35.194: los que CelesTrak publica en bloque.» |
| «Precisión de 0,12 mm» (a secas) | «El código coincide con la implementación de referencia en 0,12 mm; la posición real tiene errores de kilómetros.» |
| «Detecta maniobras de Starlink» / «de cualquier satélite» | «Probado en 15 satélites con maniobras impulsivas notificadas.» |
| «Detecta maniobras en tiempo real» | «Unos tres días después.» |
| «El límite de detección es 1 m» | «Entre 1 y 3 m encuentra menos de la mitad; el ruido es de 0,4 a 4 m.» |
| «El aprendizaje automático supera a la física» | «Añade unos 2 puntos sobre la mejor regla física simple.» |
| «Mejor que el estado del arte» / «mejor que Shorten» | «No lo he comparado con métodos publicados.» |
| «Agentes de IA escriben el informe» | «Programas con plantillas; un modelo de lenguaje es opcional y no lo he probado en real.» |
| «Es imposible que el informe contenga un error» | «Cada número debe coincidir con un dato citado; el significado no se comprueba.» |
| «Lo programé yo» / «lo hice yo solo» | «Lo hice con mucha ayuda de una IA, que escribió casi todo el código.» |
| «Fijé la regla antes de mirar el test» / «solo evalué una vez en test» | «La regla es exigir que gane en validación cruzada. El test se puntuó varias veces, sin usarlo para ajustar.» |
| «Va a 60 fps con 30.000 objetos» | «Medido solo en un navegador sin tarjeta gráfica: unos 30 fps en modo ligero.» (Hasta que lo midas tú; ver `PASOS_PARA_DIEGO.md`.) |
| «La ESA / GMV usa esto» o «validado por…» | Nada. No lo ha validado nadie externo. |
| «Simula el síndrome de Kessler» | «No simula nada de eso.» |
| «Demuestro que el sesgo explica la mejora» | «Es la explicación más probable; no está demostrada.» |
| «SGP4 lo he implementado yo» | «Uso satellite.js y la librería sgp4 de Python, y verifico que dan el resultado de referencia.» |

Y tres comportamientos:

1. **No cites un número de memoria si dudas.** Abre la web y léelo.
2. **No defiendas el proyecto de una crítica correcta.** «Tienes razón, lo apunto» es la mejor
   respuesta posible ante un ingeniero.
3. **No discutas con quien critique el uso de IA.** Responde una vez, con la respuesta 1, y
   déjalo.

---

## 5. Por publicación: qué te pueden preguntar y qué contestar

Las respuestas están en español para que las entiendas; contesta en inglés con tus palabras.

### 0 · Lanzamiento
- **«¿Qué parte hiciste tú?»** → Respuesta 1 de la sección 3. Sin adornos.
- **«¿En qué se diferencia de KeepTrack o Stuff in Space?»** → «Como visor, es peor y más
  pequeño; ellos son mucho más completos. El globo solo da contexto. Lo que quería enseñar son
  los dos experimentos y cómo están evaluados.»
- **«¿Por qué se llama RAAN? En el historial aparece kessler.»** → «Kessler era el nombre
  provisional. Ya existe una librería de aprendizaje automático para colisiones con ese nombre,
  vinculada a la ESA, y no quería confusión, así que cambié el nombre del proyecto y después el
  del repositorio. RAAN es un elemento orbital.»

### 1 · El formato TLE
- **«¿Entonces el TLE ha muerto?»** → «No. Para los objetos con número de 5 dígitos sigue
  publicándose. Lo que no puede es representar los nuevos. Existe una variante, Alpha-5, que
  mete una letra en el primer carácter y llega hasta 339.999; CelesTrak recomienda pasar a OMM.»
  *(Lo de Alpha-5 no lo he verificado en esta revisión: compruébalo en la documentación de
  Space-Track antes de decirlo.)*
- **«¿OMM es más preciso que TLE?»** → «No. Son los mismos elementos medios; cambia el formato,
  con más decimales en la época y sin el límite de dígitos.»
- **«¿Por qué no usas Space-Track directamente?»** → «Exige cuenta y aceptar un acuerdo de
  usuario; quería que cualquiera pudiera reproducirlo sin cuentas. Sería el siguiente paso para
  tener el catálogo completo.»

### 2 · Verificación de SGP4
- **«¿0,12 mm? SGP4 no tiene esa precisión.»** → «Exacto. Ese número mide que el código coincide
  con la implementación de referencia, no la precisión respecto a la realidad, que es de
  kilómetros. Lo digo en la propia publicación.»
- **«¿Has escrito tú el SGP4?»** → «No, uso satellite.js. Lo que hay es un test que lo compara
  con los 666 vectores de Vallado en cada cambio.»
- **«¿Por qué dos números, 0,12 mm y 3,5 cm?»** → «El primero es leyendo TLE; el segundo,
  leyendo campos OMM como hace la web. La librería lee la época con precisión de milisegundo, y
  en una órbita muy excéntrica de 14 días eso mueve el resultado unos centímetros.»

### 3 · No es «en directo»
- **«¿Cuánto error tiene un punto?»** → «Del orden de un kilómetro si el dato es reciente, y
  crece cada día. No lo he medido; es el valor habitual de SGP4. Por eso cada ficha enseña la
  antigüedad del dato.»
- **«¿Por qué faltan tantos restos?»** → «CelesTrak solo da en bloque los activos, los objetos
  de analista y tres nubes de fragmentos. El resto necesita cuenta en Space-Track.»
- **«¿El 66 % de los satélites activos son Starlink?»** → «En la instantánea del 11 de
  noviembre, 11.195 de 16.894 objetos de la lista de activos de CelesTrak tienen un nombre que
  empieza por STARLINK. Incluye los que están subiendo o bajando de órbita.»

### 4 · Reproducir la referencia
- **«¿Qué es exactamente L?»** → Apartado 2.7.
- **«¿Por qué es tan difícil superar "el riesgo no cambia"?»** → «Porque el último riesgo
  conocido ya resume casi toda la información disponible, y lo que lo cambia son observaciones
  nuevas de los dos últimos días, que no están en las entradas. El artículo de la ESA lo dice:
  la previsión ingenua es un predictor muy fuerte.»
- **«¿97 o 96 equipos?»** → «El artículo dice 96 en el resumen y 97 en el texto. Uso 97 porque
  es la cifra de la frase "12 de 97 superaron la referencia".»

### 5 · El modelo gana en test y no lo reclamo
- **«Si gana en test, ¿por qué no vale? El test es lo que cuenta.»** → Respuesta 8.
- **«86 % es bastante, ¿no?»** → «Significa que en uno de cada siete tests alternativos
  perdería. El criterio habitual es el 95 %. Y la validación cruzada dice lo contrario.»
- **«¿Elegiste el umbral mirando el test?»** → «No. Se elige con validación cruzada en el
  entrenamiento. En la web hay un control para moverlo, y ahí pone que eso es ajustar sobre el
  test y que no es un resultado.»
- **«¿Qué es la validación anidada?»** → Apartado 2.15.

### 6 · El sesgo del dataset
- **«¿Cómo sabes que está sesgado?»** → «Lo dice la ESA en la página del reto: los conjuntos se
  eligieron para tener más eventos de alto riesgo. Yo solo lo he medido: 0,8 % frente a 6,9 %.»
- **«¿Por qué no reequilibras el entrenamiento?»** → «El modelo ya da diez veces más peso a los
  positivos. El problema no es solo la proporción: con la misma entrada, el resultado es
  distinto en los dos conjuntos, 13 % frente a 61 %. Eso no se arregla con pesos.»
- **«¿Es un defecto del dataset?»** → «No lo diría así. Es un dataset de competición con pocos
  eventos peligrosos. El propio artículo recomienda cuidar mejor el reparto en el futuro.»

### 7 · Un bug que cazó un test
- **«¿El bug lo metió la IA?»** → «Sí, esa línea la escribió el asistente, y lo digo en la
  publicación. Un test con datos pequeños hechos a mano lo destapó. La lección me vale igual:
  nada te avisa de que una variable está mal.»
- **«¿Cómo sé que el 0,607 es real?»** → «En el repositorio hay un script que vuelve a poner el
  bug y reentrena: `python -m raan.collision.replay_bug`. Da 0,607.»
- **«¿Por qué empeoró al arreglarlo?»** → «Por casualidad. Con 150 eventos positivos, una
  diferencia de 0,02 está dentro del ruido. Una variable rota puede "ayudar" por suerte en un
  test concreto.»

### 8 · Resultados negativos
- **«¿Probaste una red más grande, o un Transformer?»** → «No. Con 66 ejemplos positivos, el
  problema es la falta de datos, no la falta de capacidad. Una red más grande sobreajustaría
  más.»
- **«¿Por qué la regresión es tan mala?»** → «El 99 % de los eventos son de bajo riesgo, así
  que aprende a predecir valores bajos, y la métrica solo mide el error en los de alto riesgo.»
- **«Los que no se pueden predecir, ¿cómo lo sabes?»** → «No lo sé con certeza. 11 de los 35
  fallos tenían un riesgo por debajo de 10⁻¹⁰ dos días antes. Con esas entradas no veo cómo
  distinguirlos; con otros datos quizá sí.»

### 9 · El primer detector falló
- **«¿Por qué la mediana de tres?»** → «Porque un dato malo aislado no puede mover la mediana de
  tres valores, y una maniobra sí, porque cambia los tres.»
- **«¿Y si hay dos datos malos seguidos?»** → «Entonces sí da falsa alarma. Es un compromiso:
  con ventanas más largas aguanta más, pero tarda más en detectar.»
- **«¿Cómo cuentas un acierto?»** → Apartado 2.19, incluido el suelo de azar de 0,09.

### 10 · ML contra física
- **«¿Qué es una ablación?»** → Apartado 2.18.
- **«¿Por qué añadir la inclinación empeora?»** → «Porque en estos satélites casi todas las
  maniobras cambian el semieje mayor, y la inclinación publicada es ruidosa: aporta más falsas
  alarmas que detecciones. No lo he analizado más a fondo.»
- **«¿Dos puntos es significativo?»** → «No lo he comprobado con un test estadístico. Sale de
  sumar 15 satélites; la variación entre satélites es mucho mayor, de 0,46 a 0,96. Yo lo
  presentaría como "aproximadamente igual, un poco mejor".»

### 11 · Lo que los datos públicos no ven
- **«¿Cómo mides el tamaño de la maniobra?»** → «No lo mido directamente: uso el escalón que
  aparece en el semieje mayor de los elementos, el mismo estadístico del detector. Es una
  limitación, porque el tamaño y la detección no son independientes.»
- **«¿Por qué cambiaste el gráfico?»** → Respuesta 14. Contarlo tú mismo en la publicación es
  mejor que que te lo encuentren.
- **«¿Y las maniobras fuera del plano?»** → «Casi no cambian el semieje mayor, así que con esta
  medida parecen "pequeñas". Es otra razón para no hablar de un límite en metros.»

### 12 · Un informe que no puede inventar números
- **«¿Usa IA o no?»** → Respuesta 19.
- **«¿Qué pasa si el modelo pone un número correcto en una frase falsa?»** → «Pasaría el
  control. Solo compara números con los datos citados. Por eso el texto por defecto son
  plantillas y las advertencias no las escribe el modelo.»
- **«¿Lo has probado con un modelo real?»** → «Todavía no. Está probado con modelos simulados
  en los tests.»

---

## 6. Qué se comprobó de verdad en la revisión y qué no

**Comprobado (ejecutado el 12-11-2026):**

- L = 0,694 recalculado desde los CSV con un script independiente. Coincide.
- Reejecución completa del experimento de colisiones: todas las cifras idénticas a las
  publicadas, incluida la GRU.
- Reejecución de maniobras: idénticas antes de la corrección; recuento independiente a partir
  de las series publicadas, también idéntico.
- Licencia de la ESA (API de Zenodo: CC BY 4.0, md5 correcto), texto de redistribución de
  Space-Track, política de uso de CelesTrak, fecha del 11-07-2026: leídos en la fuente.
- Tabla de resultados del artículo de la ESA (0,556 / 0,571 / 0,585; referencia 0,694; 12 de
  97): leída en el PDF.
- Historial de git sin claves ni contraseñas.
- Una descarga real de CelesTrak con el código nuevo, y el informe con dos instantáneas reales.
- Rendimiento antes y después, en navegador sin GPU.

**No comprobado:**

- Rendimiento con una tarjeta gráfica real ni en un móvil real.
- Los workflows de GitHub en GitHub (solo simulados en local).
- La ruta del informe con Claude y una clave real.
- La precisión real de SGP4 (se cita la de la bibliografía).
- Lo de Alpha-5 (pregunta de la publicación 1).
- Las tesis de TU Delft sobre detección de maniobras: no se han leído.
- Que David Shorten esté de acuerdo con publicar series derivadas de su conjunto de datos.

## 7. Deberes antes del martes (por orden)

1. Leer este documento con la web abierta. Dos horas.
2. Leer el artículo de la ESA, [arXiv:2008.03069](https://arxiv.org/abs/2008.03069): al menos
   el resumen, la sección 4 (métrica y referencias) y la 6. Es la base de cinco publicaciones.
3. Leer el resumen y la introducción de Shorten y otros,
   [arXiv:2212.08662](https://arxiv.org/abs/2212.08662).
4. Abrir `raan/collision/metrics.py` (130 líneas) y seguir la función `score` con el ejemplo
   del test `test_score_hand_computed_example`, a mano, con papel.
5. Abrir `raan/maneuver/detect.py` y leer `level_shift`. Dibuja un pico y un escalón.
6. Ensayar en voz alta, en inglés, las respuestas 1, 2 y 8.
