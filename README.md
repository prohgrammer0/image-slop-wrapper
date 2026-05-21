# Image Slop Wrapper

A minimal Deno app for generating images with OpenAI and Alibaba models through
MuleRouter using a prompt and local reference images.

The app uses a server-rendered HTML page with a small amount of browser
JavaScript, htmx, and Tailwind from CDNs. Reference images are read from a local
directory, generated images are saved locally, and request history is appended
to a human-editable YAML file.

## Setup

Create a local config file:

```sh
cp config.example.json config.json
```

Edit `config.json` and set the API keys you want to use. The UI only shows
models whose provider has a non-empty API key.

OpenAI keys go in `providers.openai.apiKey`. MuleRouter keys go in
`providers.mulerouter.apiKey`; create one at
<https://www.mulerouter.ai/app/api-keys>.

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

MuleRouter's `wan2.6-image` endpoint uses the Alibaba image API through:

```text
https://api.mulerouter.ai/vendors/alibaba/v1/wan2.6-image/generation
```

MuleRouter docs:
<https://www.mulerouter.ai/docs/api-reference/endpoint/alibaba/wan2.6-image/generation>

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
2. Select a model.
3. Choose the number of images to generate.
4. Select which reference images to use.
5. Click `Generate`.

You can submit multiple requests while earlier requests are still running. Each
request appears as a separate job panel.

## Files

- `reference-images/`: local reference images.
- `outputs/`: generated images.
- `requests.yaml`: local request history.
- `config.json`: local API configuration.
- `config.example.json`: checked-in config template.

`config.json`, `requests.yaml`, generated outputs, and local reference images
are ignored by Git.

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
