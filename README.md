# Image Slop Wrapper

A minimal Deno app for generating images with OpenAI, Alibaba models through
MuleRouter, and Grok Imagine through xAI using a prompt and local reference
images, plus optional separate text context.

The app uses a server-rendered HTML page with a small amount of browser
JavaScript, htmx, and Tailwind from CDNs. Reference images are read from a local
directory, reusable context snippets are read from a local context directory,
generated images are saved locally, and request history is appended to a
human-editable YAML file.

## Setup

Create a local config file:

```sh
cp config.example.json config.json
```

Edit `config.json` and set the API keys you want to use. The UI only shows
models whose provider has a non-empty API key.

OpenAI keys go in `providers.openai.apiKey`. MuleRouter keys go in
`providers.mulerouter.apiKey`; create one at
<https://www.mulerouter.ai/app/api-keys>. xAI keys go in `providers.xai.apiKey`;
create one at <https://console.x.ai/>.

```json
{
  "provider": "openai",
  "model": "gpt-image-2",
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "models": ["gpt-image-2"]
    },
    "mulerouter": {
      "apiKey": "mr-...",
      "models": ["wan2.6-image"]
    },
    "xai": {
      "apiKey": "xai-...",
      "models": [
        "grok-imagine-image-quality",
        "grok-imagine-image",
        "grok-imagine-image-pro"
      ]
    }
  },
  "size": "1024x1024",
  "quality": "medium",
  "outputFormat": "png",
  "host": "127.0.0.1",
  "port": 8002
}
```

The top-level `provider`, `apiKey`, and `model` fields are kept for
compatibility with older configs. New configuration should use `providers`.

Put reference images in:

```text
reference-images/
```

Supported formats are `.png`, `.jpg`, `.jpeg`, and `.webp`.

Put reusable context snippets in:

```text
context/
```

Supported context formats are `.md`, `.txt`, `.yaml`, and `.yml`. The `context/`
directory can contain distilled character and setting briefs for image
generation. Context file contents are local-only and ignored by Git; only the
directory placeholder is tracked.

MuleRouter's `wan2.6-image` endpoint uses the Alibaba image API through:

```text
https://api.mulerouter.ai/vendors/alibaba/v1/wan2.6-image/generation
```

MuleRouter docs:
<https://www.mulerouter.ai/docs/api-reference/endpoint/alibaba/wan2.6-image/generation>

xAI's Grok Imagine image models use:

```text
https://api.x.ai/v1/images/generations
https://api.x.ai/v1/images/edits
```

The xAI edit API accepts up to three local reference images as base64 data URIs.
Generated xAI images are downloaded from the temporary URL returned by the API
and saved using the returned image MIME type.

xAI docs: <https://docs.x.ai/developers/model-capabilities/images/generation>
<https://docs.x.ai/developers/model-capabilities/images/editing>

## Usage

Start the app:

```sh
deno task start
```

Open the configured local URL, for example:

```text
http://127.0.0.1:8002/
```

In the UI:

1. Enter a prompt.
2. Choose a context mode:
   - Use selected context files. Selected file contents appear in the context
     text box as a read-only preview.
   - Use manual context from the editable text box.
3. Select a model.
4. Choose the number of images to generate.
5. Select which reference images to use. Click a reference thumbnail to preview
   it larger in a modal.
6. Click `Generate`.

The app keeps prompt and context as separate UI fields and request-history
fields, then combines the active context source with the prompt for the image
provider. Context files and manual context are mutually exclusive. The combined
text sent to the image provider must fit the active provider limit. If the
selected or manual source context is larger than that limit, the app
automatically selects prompt-relevant chunks and sends the reduced context. The
result panel shows the context that was actually sent, while request history
keeps the original selected or manual context. Provider-side validation errors
are shown in the result panel if a request is rejected after submission.

You can submit multiple requests while earlier requests are still running. Each
request appears as a separate job panel.

## Files

- `context/`: local reusable text context snippets. Contents are ignored by Git.
- `reference-images/`: local reference images. Contents are ignored by Git.
- `outputs/`: generated images. Contents are ignored by Git; filenames include
  the provider/model slug.
- `requests.yaml`: local request history.
- `config.json`: local API configuration.
- `config.example.json`: checked-in config template.

`config.json`, `requests.yaml`, local context files, generated outputs, and
local reference images are ignored by Git.

## Development

Use watch mode while editing:

```sh
deno task dev
```

Use non-watch mode for real generations so file changes do not interrupt
in-flight requests:

```sh
deno task start
```

Run checks:

```sh
deno task check
```
