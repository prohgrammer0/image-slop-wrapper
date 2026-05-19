import { assertEquals } from "@std/assert";
import {
  clampImageCount,
  escapeHtml,
  extname,
  isSupportedImage,
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
