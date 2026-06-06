import { assertEquals, assertThrows } from "@std/assert";
import {
  assertImagePromptWithinLimit,
  availableModels,
  clampImageCount,
  composeContextText,
  composeImagePrompt,
  contextSourceFromValue,
  DEFAULT_CONFIG,
  escapeHtml,
  extname,
  IMAGE_PROMPT_MAX_CHARS,
  imagePromptLimit,
  isSupportedContextFile,
  isSupportedImage,
  OPENAI_IMAGE_EDIT_PROMPT_MAX_CHARS,
  outputFilename,
  prepareImagePrompt,
  textPreview,
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

Deno.test("composeImagePrompt appends optional context separately", () => {
  assertEquals(
    composeImagePrompt("Generate a red front door", ""),
    "Generate a red front door",
  );
  assertEquals(
    composeImagePrompt(
      " Generate a red front door ",
      "The house is Victorian.\nKeep the sky clear. ",
    ),
    "Generate a red front door\n\nAdditional context:\nThe house is Victorian.\nKeep the sky clear.",
  );
});

Deno.test("prepareImagePrompt reduces oversized context around prompt terms", () => {
  const context = [
    "# Unrelated",
    "A long section about trains and salt roads.".repeat(80),
    "## Phyv Talltower",
    "Female vampire with coral skin and green hair. Weather magic.",
    "## Obi Ro's",
    "Female gnome with teal skin, blonde hair, and full-body tattoos.",
    "## Other",
    "Another long unrelated section.".repeat(80),
  ].join("\n");

  const prepared = prepareImagePrompt(
    "Phyv and Obi at the career fair",
    context,
    700,
  );

  assertEquals(prepared.wasReduced, true);
  assertEquals(prepared.imagePrompt.length <= 700, true);
  assertEquals(prepared.context.includes("Phyv Talltower"), true);
  assertEquals(prepared.context.includes("Obi Ro's"), true);
});

Deno.test("contextSourceFromValue defaults to files unless manual is selected", () => {
  assertEquals(contextSourceFromValue(null), "files");
  assertEquals(contextSourceFromValue("files"), "files");
  assertEquals(contextSourceFromValue("manual"), "manual");
  assertEquals(contextSourceFromValue("unexpected"), "files");
});

Deno.test("composeContextText uses only the selected context source", () => {
  assertEquals(
    composeContextText("files", "Manual note", [
      { name: "characters.md", content: "Thryi: TreeRegion elf." },
      { name: "empty.md", content: "  " },
    ]),
    "### characters.md\nThryi: TreeRegion elf.",
  );
  assertEquals(
    composeContextText("manual", "Manual note", [
      { name: "characters.md", content: "Thryi: TreeRegion elf." },
    ]),
    "Manual note",
  );
});

Deno.test("assertImagePromptWithinLimit rejects oversized provider prompts", () => {
  assertImagePromptWithinLimit("a".repeat(IMAGE_PROMPT_MAX_CHARS));

  assertThrows(
    () => assertImagePromptWithinLimit("a".repeat(IMAGE_PROMPT_MAX_CHARS + 1)),
    Error,
    `Prompt plus context is ${IMAGE_PROMPT_MAX_CHARS + 1} characters`,
  );
});

Deno.test("imagePromptLimit uses the shared local prompt guard", () => {
  assertEquals(imagePromptLimit("openai", 0), IMAGE_PROMPT_MAX_CHARS);
  assertEquals(
    imagePromptLimit("openai", 1),
    IMAGE_PROMPT_MAX_CHARS,
  );
  assertEquals(OPENAI_IMAGE_EDIT_PROMPT_MAX_CHARS, IMAGE_PROMPT_MAX_CHARS);
  assertEquals(imagePromptLimit("xai", 1), IMAGE_PROMPT_MAX_CHARS);
  assertEquals(imagePromptLimit("mulerouter", 1), IMAGE_PROMPT_MAX_CHARS);
});

Deno.test("textPreview truncates long rendered context", () => {
  assertEquals(textPreview("abcdef", 10), "abcdef");
  assertEquals(textPreview("abcdef", 3), "abc... (3 more characters)");
});

Deno.test("isSupportedImage accepts local reference image formats", () => {
  assertEquals(extname("photo.PNG"), ".png");
  assertEquals(isSupportedImage("photo.PNG"), true);
  assertEquals(isSupportedImage("photo.jpeg"), true);
  assertEquals(isSupportedImage("photo.webp"), true);
  assertEquals(isSupportedImage("notes.txt"), false);
});

Deno.test("isSupportedContextFile accepts local reusable context formats", () => {
  assertEquals(isSupportedContextFile("characters.md"), true);
  assertEquals(isSupportedContextFile("setting.txt"), true);
  assertEquals(isSupportedContextFile("metadata.yaml"), true);
  assertEquals(isSupportedContextFile("metadata.yml"), true);
  assertEquals(isSupportedContextFile("portrait.png"), false);
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
