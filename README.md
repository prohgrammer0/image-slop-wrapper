# Image Slop Wrapper

A minimal Deno app for generating images with OpenAI using a prompt and local reference images.

The app uses a server-rendered HTML page with a small amount of browser JavaScript, htmx, and Tailwind from CDNs. Reference images are read from a local directory, generated images are saved locally, and request history is appended to a human-editable YAML file.

## Setup

Create a local config file:

```sh
cp config.example.json config.json
```

Edit `config.json` and set your OpenAI API key:

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-image-2",
  "size": "1024x1024",
  "quality": "medium",
  "outputFormat": "png",
  "host": "127.0.0.1",
  "port": 8002
}
```

Put reference images in:

```text
reference-images/
```

Supported formats are `.png`, `.jpg`, `.jpeg`, and `.webp`.

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
2. Choose the number of images to generate.
3. Select which reference images to use.
4. Click `Generate`.

You can submit multiple requests while earlier requests are still running. Each request appears as a separate job panel.

## Files

- `reference-images/`: local reference images.
- `outputs/`: generated images.
- `requests.yaml`: local request history.
- `config.json`: local API configuration.
- `config.example.json`: checked-in config template.

`config.json`, `requests.yaml`, generated outputs, and local reference images are ignored by Git.

## Development

Use watch mode while editing:

```sh
deno task dev
```

Use non-watch mode for real generations so file changes do not interrupt in-flight requests:

```sh
deno task start
```

Run checks:

```sh
deno task check
```
