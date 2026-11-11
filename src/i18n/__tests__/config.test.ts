import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fallbackLocale, isLocale, localeNames, locales, matchLocale, resolveLocale } from "../config";

describe("isLocale", () => {
    it("accepts supported locales only", () => {
        for (const l of locales) assert.equal(isLocale(l), true);
        assert.equal(isLocale("fr"), false);
        assert.equal(isLocale("pt-br"), false); // exact match required for cookie writes
        assert.equal(isLocale(undefined), false);
        assert.equal(isLocale(42), false);
    });
});

describe("matchLocale", () => {
    it("matches exact locales case-insensitively", () => {
        assert.equal(matchLocale("en"), "en");
        assert.equal(matchLocale("pt-br"), "pt-BR");
        assert.equal(matchLocale(" PT-BR "), "pt-BR");
    });

    it("falls back to the base language", () => {
        assert.equal(matchLocale("en-US"), "en");
        assert.equal(matchLocale("id-ID"), undefined); // indonesio removido (minha versao)
        assert.equal(matchLocale("pt"), "pt-BR");
        assert.equal(matchLocale("pt-PT"), "pt-BR");
    });

    it("returns undefined for empty or unsupported values", () => {
        assert.equal(matchLocale(undefined), undefined);
        assert.equal(matchLocale(null), undefined);
        assert.equal(matchLocale(""), undefined);
        assert.equal(matchLocale("   "), undefined);
        assert.equal(matchLocale("fr-FR"), undefined);
        assert.equal(matchLocale("../../etc/passwd"), undefined);
    });
});

describe("resolveLocale", () => {
    it("prefers the cookie over DEFAULT_LANGUAGE", () => {
        assert.equal(resolveLocale("en", "pt-BR"), "en");
    });

    it("uses DEFAULT_LANGUAGE when the cookie is missing or invalid", () => {
        assert.equal(resolveLocale(undefined, "pt-BR"), "pt-BR");
        assert.equal(resolveLocale("xx", "en"), "en");
    });

    it("falls back to Portuguese (minha versao)", () => {
        assert.equal(fallbackLocale, "pt-BR");
        assert.equal(resolveLocale(undefined, undefined), "pt-BR");
        assert.equal(resolveLocale("xx", "yy"), "pt-BR");
    });

    it("always returns a supported locale", () => {
        for (const input of ["", "en", "zz", "pt_BR", "ID"]) {
            assert.ok(isLocale(resolveLocale(input, input)));
        }
    });
});

describe("localeNames", () => {
    it("has a display name for every locale", () => {
        assert.deepEqual(Object.keys(localeNames).sort(), [...locales].sort());
        for (const l of locales) assert.ok(localeNames[l].trim().length > 0);
    });
});
