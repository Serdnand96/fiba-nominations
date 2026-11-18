# fonts/

Tipografías para la conversión de las cartas a PDF en el servidor. Ver el
comentario de `fonts.conf` y el punto sobre fuentes en `CLAUDE.md`.

| Archivo | Familia | Licencia | Para qué |
|---|---|---|---|
| `IBMPlexSans-*.ttf` | IBM Plex Sans | OFL | WCQ y el starter de confirmación; sustituto de Neo Sans |
| `IBMPlexSansCondensed-*.ttf` | IBM Plex Sans Condensed | OFL | sustituto de DIN (segunda opción) |
| `PTSansNarrow-*.ttf` | PT Sans Narrow | OFL | sustituto de Univers Condensed (footer de GENERIC) y DIN |
| `AlexBrush-Regular.ttf` | Alex Brush | OFL | sustituto de Cochocib Script (firma de BCLA/LSB) |
| `TitilliumWeb-Light.ttf` | Titillium Web | OFL | sustituto de Titillium Lt (membrete de LSB) |
| `Carlito-*.ttf` | Carlito | OFL | métricamente igual a Calibri, la fuente del tema de Word (cajas de texto del footer) |

`private/` no se versiona: ahí van las fuentes con licencia si FIBA las entrega
(Univers, Cochocib Script Latin Pro). Copiarlas al droplet en
`/opt/fiba-nominations/fonts/private/` alcanza; la próxima conversión ya las usa.
