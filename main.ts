type ProviderName = "openai";
type ImageQuality = "low" | "medium" | "high" | "auto";
type ImageFormat = "png" | "jpeg" | "webp";

type AppConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  size: string;
  quality: ImageQuality;
  outputFormat: ImageFormat;
  host: string;
  port: number;
};

type ReferenceImage = {
  name: string;
  path: string;
};

type SavedImage = {
  filename: string;
  path: string;
  url: string;
};

type FailedImage = {
  index: number;
  message: string;
  requestId: string | null;
  safetyViolations: string[];
};

type ImageAttempt = {
  index: number;
  saved?: SavedImage;
  failure?: FailedImage;
};

type GenerateResult = {
  attempts: ImageAttempt[];
  durationMs: number;
};

const CONFIG_PATH = "config.json";
const REFERENCE_DIR = "reference-images";
const OUTPUT_DIR = "outputs";
const HISTORY_PATH = "requests.yaml";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const DEFAULT_CONFIG: AppConfig = {
  provider: "openai",
  apiKey: "",
  model: "gpt-image-2",
  size: "1024x1024",
  quality: "medium",
  outputFormat: "png",
  host: "127.0.0.1",
  port: 8000,
};

export function clampImageCount(value: FormDataEntryValue | null): number {
  const parsed = Number.parseInt(String(value ?? "1"), 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 4);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function extname(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index).toLowerCase();
}

export function isSupportedImage(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filename));
}

async function loadConfig(): Promise<AppConfig> {
  try {
    const text = await Deno.readTextFile(CONFIG_PATH);
    return { ...DEFAULT_CONFIG, ...JSON.parse(text) };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Missing ${CONFIG_PATH}. Copy config.example.json to ${CONFIG_PATH} and add your OpenAI API key.`,
      );
    }

    throw error;
  }
}

async function ensureDirectories(): Promise<void> {
  await Deno.mkdir(REFERENCE_DIR, { recursive: true });
  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
}

async function listReferenceImages(): Promise<ReferenceImage[]> {
  await Deno.mkdir(REFERENCE_DIR, { recursive: true });

  const images: ReferenceImage[] = [];
  for await (const entry of Deno.readDir(REFERENCE_DIR)) {
    if (!entry.isFile || !isSupportedImage(entry.name)) continue;
    images.push({
      name: entry.name,
      path: `${REFERENCE_DIR}/${entry.name}`,
    });
  }

  return images.sort((a, b) => a.name.localeCompare(b.name));
}

async function generateImages(
  config: AppConfig,
  prompt: string,
  count: number,
  referenceImages: ReferenceImage[],
): Promise<ImageAttempt[]> {
  if (config.provider !== "openai") {
    throw new Error(`Unsupported provider: ${config.provider}`);
  }

  const attempts: ImageAttempt[] = [];
  for (let index = 0; index < count; index += 1) {
    const attemptIndex = index + 1;
    try {
      console.log(`Generate image attempt: index=${attemptIndex}/${count}`);
      const imageBytes = referenceImages.length > 0
        ? await editOpenAIImage(config, prompt, referenceImages)
        : await generateOpenAIImage(config, prompt);
      const filename = outputFilename(config.outputFormat, attemptIndex);
      const path = `${OUTPUT_DIR}/${filename}`;
      await Deno.writeFile(path, imageBytes);
      const saved = {
        filename,
        path,
        url: `/outputs/${encodeURIComponent(filename)}`,
      };
      attempts.push({ index: attemptIndex, saved });
      console.log(
        `Generate image saved: index=${attemptIndex}/${count} filename=${filename}`,
      );
    } catch (error) {
      const failure = failedImageFromError(attemptIndex, error);
      attempts.push({ index: attemptIndex, failure });
      console.error(
        `Generate image failed: index=${attemptIndex}/${count} message=${failure.message}`,
      );
    }
  }

  return attempts;
}

async function generateOpenAIImage(
  config: AppConfig,
  prompt: string,
): Promise<Uint8Array> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      size: config.size,
      quality: config.quality,
      output_format: config.outputFormat,
    }),
  });

  return imageBytesFromOpenAIResponse(response);
}

async function editOpenAIImage(
  config: AppConfig,
  prompt: string,
  referenceImages: ReferenceImage[],
): Promise<Uint8Array> {
  const form = new FormData();
  form.set("model", config.model);
  form.set("prompt", prompt);
  form.set("size", config.size);
  form.set("quality", config.quality);
  form.set("output_format", config.outputFormat);

  for (const image of referenceImages) {
    const bytes = await Deno.readFile(image.path);
    const blob = new Blob([bytes], {
      type: contentTypeForFilename(image.name),
    });
    form.append("image[]", blob, image.name);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  return imageBytesFromOpenAIResponse(response);
}

async function imageBytesFromOpenAIResponse(
  response: Response,
): Promise<Uint8Array> {
  const text = await response.text();
  let payload: {
    data?: Array<{ b64_json?: string }>;
    error?: { message?: string };
  };

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned ${response.status}: ${text}`);
  }

  if (!response.ok) {
    const error = new Error(
      payload.error?.message ?? `OpenAI returned ${response.status}`,
    );
    error.name = "OpenAIImageError";
    throw error;
  }

  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI response did not include image data.");
  }

  return decodeBase64(b64);
}

function failedImageFromError(index: number, error: unknown): FailedImage {
  const message = error instanceof Error ? error.message : String(error);
  return {
    index,
    message,
    requestId: requestIdFromMessage(message),
    safetyViolations: safetyViolationsFromMessage(message),
  };
}

function requestIdFromMessage(message: string): string | null {
  return message.match(/\breq_[a-zA-Z0-9]+\b/)?.[0] ?? null;
}

function safetyViolationsFromMessage(message: string): string[] {
  const match = message.match(/safety_violations=\[([^\]]+)\]/);
  if (!match) return [];
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function outputFilename(format: ImageFormat, sequence: number): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(
    ".",
    "-",
  );
  return `${timestamp}-${sequence}.${format}`;
}

function contentTypeForFilename(filename: string): string {
  switch (extname(filename)) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function selectedReferenceImages(
  referenceImages: ReferenceImage[],
  selectedNames: string[],
): ReferenceImage[] {
  const selected = new Set(selectedNames);
  return referenceImages.filter((image) => selected.has(image.name));
}

async function appendHistoryRecord(
  config: AppConfig,
  prompt: string,
  requestedCount: number,
  referenceImages: ReferenceImage[],
  result: GenerateResult,
): Promise<void> {
  const saved = result.attempts
    .map((attempt) => attempt.saved)
    .filter((image): image is SavedImage => Boolean(image));
  const failures = result.attempts
    .map((attempt) => attempt.failure)
    .filter((failure): failure is FailedImage => Boolean(failure));
  const status = failures.length === 0
    ? "success"
    : saved.length === 0
    ? "failed"
    : "partial";

  await Deno.writeTextFile(
    HISTORY_PATH,
    renderHistoryRecord({
      date: new Date().toISOString(),
      prompt,
      model: config.model,
      referenceImages: referenceImages.map((image) => image.name),
      requestedCount,
      status,
      outputs: saved.map((image) => image.path),
      failures,
      durationMs: result.durationMs,
    }),
    { append: true, create: true },
  );
}

function renderHistoryRecord(record: {
  date: string;
  prompt: string;
  model: string;
  referenceImages: string[];
  requestedCount: number;
  status: string;
  outputs: string[];
  failures: FailedImage[];
  durationMs: number;
}): string {
  const lines = [
    "- date: " + yamlScalar(record.date),
    "  prompt: |",
    ...yamlBlock(record.prompt, "    "),
    "  model: " + yamlScalar(record.model),
    "  referenceImages:",
    ...yamlList(record.referenceImages, "    "),
    "  requestedCount: " + record.requestedCount,
    "  status: " + record.status,
    "  outputs:",
    ...yamlList(record.outputs, "    "),
    "  failures:",
  ];

  if (record.failures.length === 0) {
    lines.push("    []");
  } else {
    for (const failure of record.failures) {
      lines.push(`    - index: ${failure.index}`);
      lines.push(`      message: ${yamlScalar(failure.message)}`);
      lines.push(
        `      requestId: ${
          failure.requestId ? yamlScalar(failure.requestId) : "null"
        }`,
      );
      lines.push("      safetyViolations:");
      lines.push(...yamlList(failure.safetyViolations, "        "));
    }
  }

  lines.push("  durationMs: " + record.durationMs);
  return lines.join("\n") + "\n";
}

function yamlBlock(value: string, indent: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.length === 0) return [indent];
  return lines.map((line) => indent + line);
}

function yamlList(values: string[], indent: string): string[] {
  if (values.length === 0) return [indent + "[]"];
  return values.map((value) => `${indent}- ${yamlScalar(value)}`);
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function renderPage(
  config: AppConfig,
  referenceImages: ReferenceImage[],
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Image Slop Wrapper</title>
    <style>
      .htmx-indicator { display: none; }
      .htmx-request .htmx-indicator,
      .htmx-request.htmx-indicator { display: inline-flex; }
      .htmx-request .idle-label { display: none; }
    </style>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  </head>
  <body class="min-h-screen bg-zinc-950 text-zinc-100">
    <main class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <header class="flex flex-col gap-2 border-b border-zinc-800 pb-6">
        <h1 class="text-3xl font-semibold tracking-normal text-white">Image Slop Wrapper</h1>
        <p class="max-w-3xl text-sm leading-6 text-zinc-400">
          ${escapeHtml(config.provider)} / ${
    escapeHtml(config.model)
  } using ${referenceImages.length} local reference image${
    referenceImages.length === 1 ? "" : "s"
  }.
        </p>
      </header>

      <section class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          id="generate-form"
          class="flex flex-col gap-5"
          action="/generate"
          method="post"
        >
          <label class="flex flex-col gap-2">
            <span class="text-sm font-medium text-zinc-200">Prompt</span>
            <textarea
              id="prompt"
              name="prompt"
              required
              rows="9"
              class="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
              placeholder="Describe the image you want to generate..."
            ></textarea>
          </label>

          <div class="grid gap-4 sm:grid-cols-[160px_1fr] sm:items-end">
            <label class="flex flex-col gap-2">
              <span class="text-sm font-medium text-zinc-200">Count</span>
              <select
                name="count"
                class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
              >
                <option value="1">1 image</option>
                <option value="2">2 images</option>
                <option value="3">3 images</option>
                <option value="4">4 images</option>
              </select>
            </label>

            <button
              id="generate-button"
              type="submit"
              class="inline-flex h-10 items-center justify-center rounded-md bg-sky-500 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
            >
              <span class="idle-label">Generate</span>
            </button>
          </div>
        </form>

        <aside class="flex flex-col gap-3 border-t border-zinc-800 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-200">Reference images</h2>
            <div class="flex gap-2">
              <button type="button" data-select-references="all" class="text-xs font-medium text-sky-400 hover:text-sky-300">All</button>
              <button type="button" data-select-references="none" class="text-xs font-medium text-sky-400 hover:text-sky-300">None</button>
            </div>
          </div>
          ${renderReferenceList(referenceImages)}
        </aside>
      </section>

      <section id="results" aria-live="polite" class="min-h-40 border-t border-zinc-800 pt-6">
        <div id="empty-results" class="text-sm text-zinc-500">Generated images will appear here and be saved in ${OUTPUT_DIR}/.</div>
        <div id="jobs" class="flex flex-col-reverse gap-5"></div>
      </section>
    </main>
    <script>
      const form = document.querySelector("form");
      const button = document.querySelector("#generate-button");
      const emptyResults = document.querySelector("#empty-results");
      const jobs = document.querySelector("#jobs");
      let jobSequence = 0;

      function selectedReferenceCount() {
        return document.querySelectorAll('input[name="referenceImages"]:checked').length;
      }

      function createJobPanel(prompt, count) {
        jobSequence += 1;
        const jobId = \`job-\${Date.now()}-\${jobSequence}\`;
        const referenceCount = selectedReferenceCount();
        const panel = document.createElement("article");
        panel.id = jobId;
        panel.className = "rounded-md border border-sky-900/70 bg-sky-950/30 px-4 py-3";
        panel.innerHTML = \`
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-sky-100">Generating \${count} image\${count === "1" ? "" : "s"}</div>
              <div class="mt-1 text-xs text-sky-200/80">\${referenceCount} selected reference image\${referenceCount === 1 ? "" : "s"}</div>
              <div class="mt-1 truncate text-xs text-sky-200/70"></div>
            </div>
            <div class="inline-flex items-center gap-2 text-xs font-medium text-sky-100">
              <span class="h-2 w-2 animate-pulse rounded-full bg-sky-300"></span>
              In progress
            </div>
          </div>
        \`;
        panel.querySelector(".truncate").textContent = prompt;
        jobs.append(panel);
        emptyResults.hidden = true;
        return jobId;
      }

      function submitJob(event) {
        if (!form.reportValidity()) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        const formData = new FormData(form);
        const prompt = String(formData.get("prompt") || "").trim();
        const count = String(formData.get("count") || "1");
        const jobId = createJobPanel(prompt, count);

        console.info(\`Generate request submitted: \${jobId}\`);
        fetch("/generate", {
          method: "POST",
          body: formData,
        })
          .then(async (response) => {
            const body = await response.text();
            document.querySelector(\`#\${jobId}\`).outerHTML = body;
          })
          .catch((error) => {
            const panel = document.querySelector(\`#\${jobId}\`);
            panel.innerHTML = \`
              <div class="rounded-md border border-red-900/70 bg-red-950/50 px-4 py-3 text-sm leading-6 text-red-100">
                Request failed before the server returned a response.
              </div>
            \`;
            panel.querySelector("div").append(" " + error.message);
          });
      }

      form.addEventListener("submit", submitJob);
      document.querySelector('[data-select-references="all"]')?.addEventListener("click", () => {
        document.querySelectorAll('input[name="referenceImages"]').forEach((input) => input.checked = true);
      });
      document.querySelector('[data-select-references="none"]')?.addEventListener("click", () => {
        document.querySelectorAll('input[name="referenceImages"]').forEach((input) => input.checked = false);
      });
    </script>
  </body>
</html>`;
}

function renderReferenceList(referenceImages: ReferenceImage[]): string {
  if (referenceImages.length === 0) {
    return `<p class="text-sm leading-6 text-zinc-500">Place .png, .jpg, .jpeg, or .webp files in ${REFERENCE_DIR}/ to use them as references.</p>`;
  }

  const items = referenceImages
    .map((image) =>
      `<label class="grid cursor-pointer grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-md border border-zinc-800 bg-zinc-900 p-2 text-sm text-zinc-300 hover:border-zinc-700">
        <img src="/references/${
        encodeURIComponent(image.name)
      }" alt="" class="h-16 w-16 rounded object-cover">
        <span class="flex min-w-0 flex-col justify-between gap-2">
          <span class="truncate">${escapeHtml(image.name)}</span>
          <span class="inline-flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" name="referenceImages" value="${
        escapeHtml(image.name)
      }" form="generate-form" checked class="h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-sky-500">
            Use as reference
          </span>
        </span>
      </label>`
    )
    .join("");

  return `<div class="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1">${items}</div>`;
}

function renderResults(result: GenerateResult, prompt: string): string {
  const savedImages = result.attempts
    .map((attempt) => attempt.saved)
    .filter((image): image is SavedImage => Boolean(image));
  const failures = result.attempts
    .map((attempt) => attempt.failure)
    .filter((failure): failure is FailedImage => Boolean(failure));

  const statusClass = failures.length === 0
    ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-100"
    : savedImages.length === 0
    ? "border-red-900/70 bg-red-950/50 text-red-100"
    : "border-amber-900/70 bg-amber-950/40 text-amber-100";
  const statusText = failures.length === 0
    ? `Saved ${savedImages.length} image${savedImages.length === 1 ? "" : "s"}.`
    : savedImages.length === 0
    ? `All ${failures.length} image attempt${
      failures.length === 1 ? "" : "s"
    } failed.`
    : `Saved ${savedImages.length} image${
      savedImages.length === 1 ? "" : "s"
    }; ${failures.length} failed.`;

  const cards = savedImages
    .map((image) =>
      `<article class="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
        <a href="${image.url}" target="_blank" rel="noreferrer">
          <img src="${image.url}" alt="${
        escapeHtml(prompt)
      }" class="aspect-square w-full object-cover">
        </a>
        <div class="flex items-center justify-between gap-3 px-3 py-2">
          <span class="truncate text-xs text-zinc-400">${
        escapeHtml(image.filename)
      }</span>
          <a href="${image.url}" target="_blank" rel="noreferrer" class="shrink-0 text-xs font-medium text-sky-400 hover:text-sky-300">Open</a>
        </div>
      </article>`
    )
    .join("");

  const failureItems = failures
    .map((failure) =>
      `<li class="rounded-md border border-red-900/70 bg-red-950/40 px-3 py-2">
        <div class="font-medium text-red-100">Image ${failure.index} failed</div>
        <div class="mt-1 text-red-100/80">${escapeHtml(failure.message)}</div>
        ${
        failure.requestId
          ? `<div class="mt-1 text-red-100/70">Request ID: ${
            escapeHtml(failure.requestId)
          }</div>`
          : ""
      }
        ${
        failure.safetyViolations.length > 0
          ? `<div class="mt-1 text-red-100/70">Safety violations: ${
            escapeHtml(failure.safetyViolations.join(", "))
          }</div>`
          : ""
      }
      </li>`
    )
    .join("");

  return `<article class="flex flex-col gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
    <div class="rounded-md border px-4 py-3 text-sm leading-6 ${statusClass}">
      ${statusText} Duration: ${result.durationMs}ms.
    </div>
    ${
    savedImages.length > 0
      ? `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${cards}</div>`
      : ""
  }
    ${
    failures.length > 0
      ? `<ul class="flex flex-col gap-2 text-sm">${failureItems}</ul>`
      : ""
  }
  </article>`;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<div class="rounded-md border border-red-900/70 bg-red-950/50 px-4 py-3 text-sm leading-6 text-red-100">${
    escapeHtml(message)
  }</div>`;
}

async function serveOutput(pathname: string): Promise<Response> {
  const filename = decodeURIComponent(pathname.replace("/outputs/", ""));
  if (
    filename.includes("/") || filename.includes("..") ||
    !isSupportedImage(filename)
  ) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await Deno.readFile(`${OUTPUT_DIR}/${filename}`);
    return new Response(file, {
      headers: {
        "Content-Type": contentTypeForFilename(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }

    throw error;
  }
}

async function serveReference(pathname: string): Promise<Response> {
  const filename = decodeURIComponent(pathname.replace("/references/", ""));
  if (
    filename.includes("/") || filename.includes("..") ||
    !isSupportedImage(filename)
  ) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await Deno.readFile(`${REFERENCE_DIR}/${filename}`);
    return new Response(file, {
      headers: {
        "Content-Type": contentTypeForFilename(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }

    throw error;
  }
}

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    try {
      const config = await loadConfig();
      const referenceImages = await listReferenceImages();
      return html(renderPage(config, referenceImages));
    } catch (error) {
      return html(renderError(error), 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/generate") {
    const startedAt = Date.now();
    try {
      const config = await loadConfig();
      if (!config.apiKey) {
        throw new Error(
          `Set apiKey in ${CONFIG_PATH} before generating images.`,
        );
      }

      const form = await request.formData();
      const prompt = String(form.get("prompt") ?? "").trim();
      if (!prompt) {
        throw new Error("Prompt is required.");
      }

      const count = clampImageCount(form.get("count"));
      const allReferenceImages = await listReferenceImages();
      const selectedNames = form.getAll("referenceImages").map((value) =>
        String(value)
      );
      const referenceImages = selectedReferenceImages(
        allReferenceImages,
        selectedNames,
      );
      console.log(
        `Generate request: count=${count} selected_references=${referenceImages.length} prompt_chars=${prompt.length}`,
      );
      const attempts = await generateImages(
        config,
        prompt,
        count,
        referenceImages,
      );
      const durationMs = Date.now() - startedAt;
      const result = { attempts, durationMs };
      await appendHistoryRecord(
        config,
        prompt,
        count,
        referenceImages,
        result,
      );
      const saved = attempts
        .map((attempt) => attempt.saved)
        .filter((image): image is SavedImage => Boolean(image));
      const failures = attempts
        .map((attempt) => attempt.failure)
        .filter((failure): failure is FailedImage => Boolean(failure));
      console.log(
        `Generate complete: saved=${
          saved.map((image) => image.filename).join(", ")
        } failed=${failures.length} duration_ms=${durationMs}`,
      );
      return html(renderResults(result, prompt));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Generate failed: ${message} duration_ms=${Date.now() - startedAt}`,
      );
      return html(renderError(error), 500);
    }
  }

  if (request.method === "GET" && url.pathname.startsWith("/references/")) {
    return serveReference(url.pathname);
  }

  if (request.method === "GET" && url.pathname.startsWith("/outputs/")) {
    return serveOutput(url.pathname);
  }

  return new Response("Not found", { status: 404 });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

if (import.meta.main) {
  await ensureDirectories();
  const config = await loadConfig();
  Deno.serve({ hostname: config.host, port: config.port }, handler);
}
