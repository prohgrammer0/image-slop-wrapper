import { assertEquals } from "@std/assert";
import {
  availableModels,
  clampImageCount,
  DEFAULT_CONFIG,
  escapeHtml,
  extname,
  isSupportedImage,
  outputFilename,
} from "./main.ts";

Deno.test("clampImageCount keeps requests in the supported range", () => {
  const form = new FormData();

  form.set("count", "0");
  assertEquals(clampImageCount(form.get("count")), 1);

  form.set("count", "3");
  assertEquals(clampImageCount(form.get("count")), 3);

  form.set("count", "50");
  assertEquals(clampImageCount(form.get("count")), 4);

  form.set("count", "nope");
  assertEquals(clampImageCount(form.get("count")), 1);
});

Deno.test("escapeHtml escapes rendered user input", () => {
  assertEquals(
    escapeHtml(`<img alt="x" data-name='y'>&`),
    "&lt;img alt=&quot;x&quot; data-name=&#39;y&#39;&gt;&amp;",
  );
});

Deno.test("isSupportedImage accepts local reference image formats", () => {
  assertEquals(extname("photo.PNG"), ".png");
  assertEquals(isSupportedImage("photo.PNG"), true);
  assertEquals(isSupportedImage("photo.jpeg"), true);
  assertEquals(isSupportedImage("photo.webp"), true);
  assertEquals(isSupportedImage("notes.txt"), false);
});

Deno.test("outputFilename includes a filesystem-safe model slug", () => {
  const filename = outputFilename("jpeg", 2, "xai:grok-imagine-image-quality");

  assertEquals(
    filename.endsWith("-xai-grok-imagine-image-quality-2.jpeg"),
    true,
  );
  assertEquals(filename.includes(":"), false);
});

Deno.test("availableModels hides providers without an API key", () => {
  assertEquals(availableModels(DEFAULT_CONFIG), []);

  const openaiOnly = {
    ...DEFAULT_CONFIG,
    providers: {
      ...DEFAULT_CONFIG.providers,
      openai: {
        ...DEFAULT_CONFIG.providers.openai,
        apiKey: "sk-test",
      },
    },
  };
  assertEquals(
    availableModels(openaiOnly).map((option) => option.model),
    ["gpt-image-2"],
  );

  const openAIAndMuleRouter = {
    ...openaiOnly,
    providers: {
      ...openaiOnly.providers,
      mulerouter: {
        ...openaiOnly.providers.mulerouter,
        apiKey: "mr-test",
      },
    },
  };
  assertEquals(
    availableModels(openAIAndMuleRouter).map((option) => option.model),
    ["gpt-image-2", "wan2.6-image"],
  );

  const allProviders = {
    ...openAIAndMuleRouter,
    providers: {
      ...openAIAndMuleRouter.providers,
      xai: {
        ...openAIAndMuleRouter.providers.xai,
        apiKey: "xai-test",
      },
    },
  };
  assertEquals(
    availableModels(allProviders).map((option) => option.model),
    [
      "gpt-image-2",
      "wan2.6-image",
      "grok-imagine-image-quality",
      "grok-imagine-image",
      "grok-imagine-image-pro",
    ],
  );
});
