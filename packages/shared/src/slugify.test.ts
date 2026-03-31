import { describe, test, expect } from "bun:test";
import { slugify } from "./slugify";

describe("slugify", () => {
  test("normalizes Vietnamese diacritics", () => {
    expect(slugify("dự án 1")).toBe("du-an-1");
    expect(slugify("Hệ Thống Quản Lý")).toBe("he-thong-quan-ly");
    expect(slugify("phòng khám")).toBe("phong-kham");
  });

  test("handles Vietnamese đ/Đ", () => {
    expect(slugify("đội ngũ")).toBe("doi-ngu");
    expect(slugify("Đề Án")).toBe("de-an");
  });

  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("My Project")).toBe("my-project");
    expect(slugify("UPPER CASE")).toBe("upper-case");
  });

  test("collapses multiple non-alphanumeric chars into single hyphen", () => {
    expect(slugify("hello   world")).toBe("hello-world");
    expect(slugify("a--b__c")).toBe("a-b-c");
    expect(slugify("My  Project!!")).toBe("my-project");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
    expect(slugify("  spaces  ")).toBe("spaces");
  });

  test("passes through already-valid slugs unchanged", () => {
    expect(slugify("core-pvs-111")).toBe("core-pvs-111");
    expect(slugify("dev")).toBe("dev");
  });

  test("returns empty string for empty/whitespace input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});
