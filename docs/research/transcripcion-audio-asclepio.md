# Transcripción de notas de voz para Asclepio (fase 1)

Investigado el 31 de julio de 2026 con documentación primaria de OpenAI,
Deepgram y Google Cloud. Alcance: una nota de voz de WhatsApp ya recibida por
Praxia; no llamadas en tiempo real ni dictado clínico.

## Recomendación

Usar **OpenAI `gpt-transcribe`** detrás de un puerto propio `AudioTranscriber`
para el piloto. No incorporar `whisper-1` como opción por defecto: la guía
actual de OpenAI recomienda `gpt-transcribe` para transcribir una grabación en
su idioma original; deja `whisper-1` para los casos especiales de subtítulos,
marcas de tiempo o traducción. [Guía de transcripción de archivos de
OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text)

La llamada es una operación HTTP multipart simple a
`POST /v1/audio/transcriptions`; retorna texto y los idiomas detectados. El
trabajo adicional imprescindible es normalizar el adjunto antes de enviarlo:
el endpoint acepta hasta 25 MB y `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav` y
`webm`, pero no enumera Ogg/Opus. Por tanto, el worker debe inspeccionar el
MIME/tamaño que entregue WhatsApp y convertir Ogg/Opus a WAV o WebM **solo en
almacenamiento temporal privado**. [Formatos y límite de
OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text) · [FAQ de
audio](https://help.openai.com/en/articles/7031512-whisper-audio-api-faq)

Esta elección evita sumar un proveedor de IA al agente que ya usará OpenAI,
mantiene una interfaz intercambiable y tiene un coste bajo. La exactitud real
para español salvadoreño, nombres propios y especialidades no debe suponerse:
es condición de salida de una evaluación con notas de voz autorizadas o
sintéticas antes de habilitar la función para una clínica.

## Comparación de proveedores

| Área | OpenAI `gpt-transcribe` (recomendado) | Deepgram Nova-3 | Google Cloud Speech-to-Text V2 |
| --- | --- | --- | --- |
| Integración de una nota terminada | Archivo multipart al endpoint de transcripción; SDK oficial de Node disponible. | `POST /v1/listen` con binario o URL; SDK JavaScript. | `Recognize` síncrono con contenido o URI de Cloud Storage; requiere proyecto, IAM y configuración de recognizer. |
| Español y contexto | `languages: ["es"]`, `prompt` y `keywords` para términos de clínica. | Parámetro `language=es`; `smart_format` y *keyterm prompting* disponibles. | Códigos BCP-47 y modelos por idioma; la API admite adaptación de frases. |
| Nota Ogg/Opus | Requiere conversión porque no está entre sus formatos documentados. | Acepta Ogg y Opus de forma nativa. | Admite `OGG_OPUS`; hay que describir correctamente el encoding/configuración. |
| Precio publicado | `gpt-transcribe`: $0.0045/min. `gpt-4o-mini-transcribe`: $0.003/min. | Nova-3 monolingüe: $0.0048/min; multilingüe: $0.0058/min. | Modelo estándar V2: $0.016/min (hasta 500,000 min/mes). |
| Retención/uso declarado | No usa el contenido para entrenamiento; para `/v1/audio/transcriptions` la tabla indica sin retención de monitoreo de abuso ni estado de aplicación; elegible para ZDR. | La respuesta es la única oportunidad para obtener el transcript. Con `mip_opt_out=true`, el contenido se retiene solo para procesar y queda fuera del programa de mejora. | Sin *data logging* opt-in, audio/transcript no se usan para otros fines; la sincronía se procesa en memoria. El modo asíncrono guarda el transcript aproximadamente cinco días. |
| Complejidad y encaje | Menor número de proveedores, a cambio de normalizar Ogg/Opus. | Menor tratamiento de formato, pero nuevo proveedor, contrato y controles MIP. | Más infraestructura, IAM y precio; no justificado por el piloto. |

Fuentes de la comparación: [OpenAI: modelos y
precios](https://developers.openai.com/api/docs/pricing) · [OpenAI: controles de
datos](https://developers.openai.com/api/docs/guides/your-data) · [Deepgram:
audio pregrabado](https://developers.deepgram.com/docs/pre-recorded-audio) ·
[Deepgram: formatos](https://developers.deepgram.com/docs/supported-audio-formats)
· [Deepgram: precios](https://deepgram.com/pricing) · [Deepgram: programa de
mejora y opt-out](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program)
· [Google: precios](https://cloud.google.com/speech-to-text/pricing) · [Google:
uso de datos](https://cloud.google.com/speech-to-text/docs/v1/data-usage-faq) ·
[Google: cuotas](https://cloud.google.com/speech-to-text/docs/quotas).

### Por qué no escoger `gpt-4o-mini-transcribe` o `whisper-1` inicialmente

`gpt-4o-mini-transcribe` reduce el coste publicado a $0.003/min, pero la guía
no lo recomienda como el punto de partida general para una grabación. Puede
ser candidato de evaluación si `gpt-transcribe` supera el presupuesto, sin
cambiar el contrato `AudioTranscriber`. `whisper-1` no es el modelo actual
recomendado para nueva transcripción general y no soporta streaming de
transcripciones; no ofrece una ventaja necesaria para notas de voz.

No hay una promesa de latencia p95 publicada que permita elegir por marketing.
Para una nota ya terminada, no se necesita streaming: medir en el piloto desde
la recepción del webhook hasta el texto final; la decisión de producto debe
tener objetivo propio (por ejemplo, p95) antes de prometer una respuesta
instantánea.

## Diseño propuesto

```text
Webhook Twilio validado
  -> MediaFetcher privado e idempotente
  -> inspección de tipo/tamaño + normalización temporal si es Ogg/Opus
  -> AudioTranscriber.transcribe(...)
  -> mensaje de conversación { origen: nota_de_voz, transcript }
  -> mismo flujo textual de Asclepio y sus herramientas de Agenda
```

El puerto no expone SDK ni credenciales del proveedor:

```ts
type AudioTranscriber = {
  transcribe(input: {
    media: ReadableStream;
    mimeType: string;
    languageHints: readonly string[];
    keywords: readonly string[];
  }): Promise<{
    text: string;
    detectedLanguages: readonly string[];
    provider: "openai";
    model: string;
  }>;
};
```

El adaptador inicial usa `gpt-transcribe`, `languages: ["es"]`, y una lista
configurada y mínima de especialidades, médicos y sedes como `keywords`. Son
pistas, no datos que el modelo deba repetir; OpenAI advierte que una keyword o
prompt inválido rechaza la petición, y que las keywords pueden introducir
términos no pronunciados, por lo que cada clínica debe evaluarlas antes de
activarlas. [Contexto de
transcripción](https://developers.openai.com/api/docs/guides/speech-to-text#add-transcription-context)

La transcripción se entrega a Asclepio como texto con la marca de origen. No
confiere autorización ni permite que el modelo salte confirmaciones: selección
de hora, alta de Paciente, cancelación y reprogramación siguen llamando las
herramientas validadas de Agenda. Tampoco hace falta diarización: el mensaje ya
está asociado al Contacto de WhatsApp. El modelo de diarización de OpenAI es
especializado y su propia guía no lo recomienda para transcripción ordinaria.
[Diarización](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization)

## Privacidad, seguridad y conservación

- Tratar audio y transcript como datos de salud potenciales. No colocar ninguno
  en logs, trazas, errores, prompts de depuración, Linear ni analítica de
  proveedor.
- Descargar el medio solo tras validar la firma del webhook, usar URL/credencial
  de proveedor únicamente en el worker y borrar el archivo temporal y la salida
  de conversión aun cuando falle el proceso.
- Persistir el transcript como contenido de conversación solamente bajo la
  política de retención de la Clínica; guardar para auditoría técnica el id de
  mensaje, hash, tamaño, proveedor/modelo, tiempo y resultado, no una copia del
  audio. La retención del medio de WhatsApp/Twilio se revisa separadamente en
  el acuerdo de proveedor.
- No usar `Files`, Assistants, Batches ni otro flujo que añada almacenamiento de
  OpenAI para este archivo. El endpoint directo de transcripción tiene la
  política de retención indicada arriba; confirmar el DPA/base legal antes de
  datos reales.
- Las alternativas no eliminan la revisión legal: Deepgram exige activar
  `mip_opt_out=true` en cada petición, y Google no debe entrar al programa de
  *data logging*.

## Fallos y comportamiento seguro

| Situación | Acción del worker | Resultado para la conversación |
| --- | --- | --- |
| Tipo no audio, archivo corrupto, demasiado grande o conversión fallida | No llamar al modelo; registrar código técnico sin contenido. | Escalamiento humano: indicar que una persona revisará la nota. |
| `400` / formato o parámetros inválidos | No reintentar ciegamente; es un error de entrada/configuración. | Escalamiento y alerta operativa. |
| `429`, `500` o `503` | Reintentos idempotentes, acotados, con `Retry-After` cuando exista y *backoff* con jitter. | Mantener el mensaje en estado `transcribiendo`; al agotar, escalar. |
| Transcript vacío o no accionable | No inferir una intención médica ni ejecutar una cita. | Pedir que lo escriba o escalar; no contar como fallo de comprensión hasta que el flujo textual lo determine. |
| Ambigüedad en datos/cita | Aplicar las confirmaciones ya decididas de Asclepio. | Solicitar aclaración; nunca asumir Paciente, fecha u hora. |

Los códigos de error y el uso de `Retry-After` están documentados por
[OpenAI](https://developers.openai.com/api/docs/guides/error-codes). La clave
de idempotencia de Praxia debe estar asociada al `MessageSid` de WhatsApp para
que una entrega duplicada no facture ni cree dos transcripciones.

## Condiciones antes de activar una Clínica

1. Conjunto de evaluación autorizado/sintético de español salvadoreño que incluya
   ruido, velocidades, nombres, fechas, horas, especialidades y DUI; medir WER o
   tasa de corrección humana y latencia p50/p95 para los modelos candidato.
2. Pruebas de Ogg/Opus, WAV/WebM, límite de 25 MB, duplicados, audio vacío,
   timeouts, `429` y caída del proveedor; verificar que los temporales se
   eliminan.
3. Revisión de DPA, aviso/consentimiento y política de retención con la Clínica,
   incluyendo que la función usa un subencargado de transcripción.
4. Interruptor por Clínica `voice_transcription_enabled`; al apagarlo, las notas
   de voz se escalan, no se mandan al proveedor.
5. Métricas sin contenido: éxito/fallo, duración, tamaño, latencia y coste
   estimado; alertar por error sostenido o gasto anómalo.

## Disparadores para reevaluar

Evaluar Deepgram si la conversión Ogg/Opus se vuelve fuente relevante de fallos
o si las pruebas de español muestran una mejora material; su API acepta ese
formato de forma nativa. Evaluar Google solo si una obligación contractual o de
residencia/organización ya lleva a Praxia a Google Cloud y justifica su
infraestructura y precio. Abrir una nueva decisión si se incorporan llamadas en
vivo, dictado clínico o retención/reproducción prolongada del audio: no son el
caso de una nota de voz de fase 1.
